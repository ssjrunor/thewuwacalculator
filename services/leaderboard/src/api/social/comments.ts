/*
  Author: Runor Ewhro
  description: likes and comments on a build. reads are public; writes need a
               signed-in account, and comments are named by the account's profile
               (api/people.ts). build owners are notified of comments and likes,
               and comment authors of replies. owners can close a build to new
               comments and remove any comment on it, and people blocked by the
               owner or the replied-to author cannot write to them.
*/

import type { BuildSocialResponse, CommentItem, CommentRequest, CommentsResponse } from '@lb/contract/api'
import { readDocument, type BuildDoc } from '@lb/contract/documents'
import { auditStatement } from '../../lib/audit.ts'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import type { SessionActor } from '../../lib/session.ts'
import { linkOf } from '../../db/accounts.ts'
import { buildViewOf } from '../builds/lifecycle.ts'
import { uidToText } from '../../lib/ids.ts'
import type { ApiEnv } from '../../env.ts'
import {
  commentPage, editCommentStatement, getComment, insertCommentStatement, isShownComment, removeCommentStatement, shownCommentCount,
  type CommentPageRow, type CommentRow,
} from '../../db/comments.ts'
import { documentsOf } from '../../db/documents.ts'
import { getPlayer, sessionHasUid } from '../../db/identity.ts'
import { notifyStatement } from '../../db/notifications.ts'
import { blocks, isBookmarked, isFollowing, likesOn, likeStatement, unlikeStatement } from '../../db/social.ts'
import { accountRefs } from '../people.ts'
import type { RouteContext } from '../router.ts'
import { visibleBuild as visibleView } from '../board/routes.ts'
import { rateLimit } from '../cards/routes.ts'
import { optionalSession, requireAccount } from '../auth/sessions.ts'
import { staffAudit, staffName, staffWith, type Staff } from '../auth/staff.ts'
import { assertCommentRoom, assertNotMuted } from '../auth/writers.ts'

const PAGE = 30
const MAX_BODY = 1000

/** a comment's text: line breaks kept (at most one blank line in a row), other control characters dropped, trimmed. */
function cleanBody(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError('bad_request', "hmm... write a comment before sending it :P")
  const kept = [...value.replace(/\r\n?/g, '\n')].filter((ch) => { const code = ch.codePointAt(0)!; return code === 10 || (code >= 32 && code !== 127) })
  const body = kept.join('').replace(/\n{3,}/g, '\n\n').trim()
  if (!body || body.length > MAX_BODY) throw new HttpError('bad_request', `hmm... comments need 1 to ${MAX_BODY} characters. check yours and try again :P`)
  return body
}

/** a page cursor: `<created_at>.<id>`. */
export const cursorOf = (row: { created_at: number; id: string }) => `${row.created_at}.${row.id}`
export function parseCursor(value: string | null): { at: number; id: string } | null {
  if (!value) return null
  const dot = value.indexOf('.')
  const at = Number(value.slice(0, dot))
  if (dot < 1 || !Number.isSafeInteger(at)) throw new HttpError('bad_request', "oopsies... we couldn't load that page of results. refresh the list and try again.")
  return { at, id: value.slice(dot + 1) }
}

/** a setup uid's build is on the boards and nowhere else: it takes no likes or comments (identity.ts). */
/** a build as comments and likes need it: its public id and its player. */
type BuildRow = { id: string; uid: string }

/** a build the viewer may open, as comments and likes need it. */
async function visibleBuild(context: RouteContext): Promise<{ build: BuildRow; own: boolean }> {
  const { ref, uid, own } = await visibleView(context)
  return { build: { id: ref.id, uid }, own }
}

/** a kept build by id, or null. */
async function getStandingBuild(env: Pick<ApiEnv, 'BOARDS'>, id: string): Promise<BuildRow | null> {
  const found = await buildViewOf(env, id).catch(() => null)
  const state = found?.view.row.state
  return found && state === 'active' ? { id: found.ref.id, uid: uidToText(found.view.row.uid) } : null
}

const isSetupBuild = async (db: D1Database, build: BuildRow): Promise<boolean> => (await getPlayer(db, build.uid))?.setup_at != null

/** whether a build accepts new comments: closed in its build document by the owner, and always closed for setup uids. */
async function commentsOpen(db: D1Database, build: BuildRow): Promise<boolean> {
  if (await isSetupBuild(db, build)) return false
  const buildId = build.id
  const row = (await documentsOf(db, ['build'], [buildId])).get(`build:${buildId}`)
  const doc = row ? readDocument('build', row.schema_ver, row.body) as BuildDoc | null : null
  return doc?.commentsOpen ?? true
}

const ownerAccountOf = async (db: D1Database, uid: string) => (await linkOf(db, uid))?.account_id ?? null

/** GET /builds/:id/social: counts and the viewer's own state; per-viewer, so not cached. */
export async function buildSocial(context: RouteContext): Promise<Response> {
  const { build } = await visibleBuild(context)
  const db = context.env.LB
  const viewer = (await optionalSession(context))?.accountId ?? null
  const [likes, comments, following, open, bookmarked] = await Promise.all([likesOn(db, build.id, viewer),
    shownCommentCount(db, build.id, viewer), viewer ? isFollowing(db, viewer, 'player', build.uid) : false, commentsOpen(db, build),
    viewer ? isBookmarked(db, viewer, build.id) : false])
  const body: BuildSocialResponse = { ...likes, comments, following, commentsOpen: open, bookmarked }
  return json(body)
}

/** PUT /builds/:id/like: owners cannot like their own build. */
export async function likeBuild(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  await rateLimit(context.env.SUBMIT_LIMIT, `like:${session.accountId}`)
  const { build, own } = await visibleBuild(context)
  if (own) throw new HttpError('bad_request', "that's your own build! likes are for someone else's :P")
  const db = context.env.LB
  if (await isSetupBuild(db, build)) throw new HttpError('forbidden', "likes aren't available on this build.")
  const added = await likeStatement(db, build.id, session.accountId, context.now).run()
  const owner = await ownerAccountOf(db, build.uid)
  // likes gather into the owner's one unread row for the build.
  if (added.meta.changes && owner && owner !== session.accountId) {
    await notifyStatement(db, { accountId: owner, kind: 'like', subjectId: build.id, buildId: build.id }, context.now).run()
  }
  return json(await likesOn(db, build.id, session.accountId))
}

/** DELETE /builds/:id/like. */
export async function unlikeBuild(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const { build } = await visibleBuild(context)
  await unlikeStatement(context.env.LB, build.id, session.accountId).run()
  return json(await likesOn(context.env.LB, build.id, session.accountId))
}

interface Viewer { accountId: string | null; ownsBuild: boolean; staff: boolean }

type Authors = Awaited<ReturnType<typeof accountRefs>>

function commentItem(row: CommentPageRow, viewer: Viewer, authors: Authors, replies?: CommentItem[]): CommentItem {
  const shown = row.shown === 1
  const own = viewer.accountId != null && row.account_id === viewer.accountId
  return { id: row.id, parentId: row.parent_id, author: shown ? authors(row.account_id) : null, body: shown ? row.body : null,
    createdAt: row.created_at, editedAt: row.edited_at, removed: !shown, own,
    canRemove: shown && ((own) || viewer.ownsBuild || viewer.staff), ...(replies ? { replies } : {}) }
}

async function viewerOf(context: RouteContext, build: BuildRow, session: SessionActor | null): Promise<Viewer> {
  const accountId = session?.accountId ?? null
  return { accountId, ownsBuild: accountId != null && await sessionHasUid(context.env.LB, session!, build.uid, context.now),
    staff: await staffWith(context, 'comments.moderate') != null }
}

/** GET /builds/:id/comments?before=: top-level comments newest first, each with its replies. */
export async function listComments(context: RouteContext): Promise<Response> {
  const { build } = await visibleBuild(context)
  const db = context.env.LB
  const session = await optionalSession(context)
  const viewer = await viewerOf(context, build, session)
  const [page, open] = await Promise.all([commentPage(db, build.id, viewer.accountId, parseCursor(context.url.searchParams.get('before')), PAGE),
    commentsOpen(db, build)])
  const authors = await accountRefs(db, [...page.top, ...page.replies].filter((row) => row.shown === 1).map((row) => row.account_id))
  const repliesOf = new Map<string, CommentItem[]>()
  for (const reply of page.replies) repliesOf.set(reply.parent_id!, [...repliesOf.get(reply.parent_id!) ?? [], commentItem(reply, viewer, authors)])
  // a removed or hidden comment stays only as the holder of replies that show.
  const comments = page.top.filter((row) => row.shown === 1 || repliesOf.has(row.id))
    .map((row) => commentItem(row, viewer, authors, repliesOf.get(row.id) ?? []))
  const body: CommentsResponse = { comments, open, next: page.top.length === PAGE ? cursorOf(page.top.at(-1)!) : null }
  return json(body)
}

async function written(db: D1Database, id: string, viewer: Viewer): Promise<CommentItem> {
  const row = (await getComment(db, id))!
  return commentItem({ ...row, shown: 1 }, viewer, await accountRefs(db, [row.account_id]))
}

/** POST /builds/:id/comments { body, parentId? }. */
export async function postComment(context: RouteContext): Promise<Response> {
  const { accountId } = await requireAccount(context)
  await rateLimit(context.env.SUBMIT_LIMIT, `comment:${accountId}`)
  await assertNotMuted(context.env.LB, { uid: null, accountId }, context.now)
  await assertCommentRoom(context.env.LB, accountId, context.now)
  const { build, own } = await visibleBuild(context)
  const db = context.env.LB
  const request = await readJsonBody<Partial<CommentRequest>>(context.request)
  const text = cleanBody(request.body)
  if (!own && !await commentsOpen(db, build)) throw new HttpError('forbidden', "the owner has closed comments on this build. existing comments are still available to read.")
  let parent: CommentRow | null = null
  if (request.parentId != null) {
    parent = typeof request.parentId === 'string' ? await getComment(db, request.parentId) : null
    if (!parent || parent.build_id !== build.id || !await isShownComment(db, parent.id, accountId)) throw new HttpError('not_found', "hmm... that comment isn't available anymore. refresh the thread to see what's still there.")
    if (parent.parent_id) throw new HttpError('bad_request', "hold on... replies go under the original comment. reply to that one to join the thread :P")
  }
  const owner = await ownerAccountOf(db, build.uid)
  if (owner && owner !== accountId && await blocks(db, owner, accountId)) throw new HttpError('forbidden', "comments aren't available to you on this build.")
  const replyTo = parent?.account_id && parent.account_id !== accountId ? parent.account_id : null
  if (replyTo && await blocks(db, replyTo, accountId)) throw new HttpError('forbidden', "replies aren't available to you on this comment.")
  const made = insertCommentStatement(db, { buildId: build.id, parentId: parent?.id ?? null, accountId, body: text }, context.now)
  // the comment names its writer, so the notice has no separate actor
  const about = { subjectId: made.id, buildId: build.id }
  await db.batch([made.statement,
    auditStatement(db, { actorKind: 'account', actorId: accountId, action: 'comment.write', subjectKind: 'comment', subjectId: made.id,
      data: { buildId: build.id, parentId: parent?.id ?? null } }, context.now),
    ...(owner && owner !== accountId ? [notifyStatement(db, { accountId: owner, kind: 'comment', ...about }, context.now)] : []),
    // the build's owner hears of a reply as a comment already.
    ...(replyTo && replyTo !== owner ? [notifyStatement(db, { accountId: replyTo, kind: 'reply', ...about }, context.now)] : []),
  ])
  return json(await written(db, made.id, { accountId, ownsBuild: own, staff: false }), { status: 201 })
}

/** a comment on a build that still stands, or a 404. */
async function standingComment(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, id: string): Promise<{ comment: CommentRow; build: BuildRow }> {
  const comment = await getComment(env.LB, id)
  const build = comment && comment.removed_at == null ? await getStandingBuild(env, comment.build_id) : null
  if (!comment || !build) throw new HttpError('not_found', "hmm... that comment isn't available anymore. refresh the thread to see what's still there.")
  return { comment, build }
}

/** PATCH /comments/:id { body }: its author edits it. */
export async function editComment(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const db = context.env.LB
  const { comment, build } = await standingComment(context.env, context.params.id)
  if (comment.account_id !== session.accountId) throw new HttpError('not_found', "hmm... that comment isn't available anymore. refresh the thread to see what's still there.")
  await assertNotMuted(db, { uid: null, accountId: session.accountId }, context.now)
  const text = cleanBody((await readJsonBody<{ body?: unknown }>(context.request)).body)
  await db.batch([editCommentStatement(db, comment.id, text, context.now),
    auditStatement(db, { actorKind: 'account', actorId: session.accountId, action: 'comment.edit', subjectKind: 'comment', subjectId: comment.id },
      context.now)])
  return json(await written(db, comment.id, await viewerOf(context, build, session)))
}

/** a staff member removes a comment: the text stays in its history for review, and its author is told. */
export function staffRemoveComment(context: RouteContext, who: Staff, comment: CommentRow, reportId: string | null = null): D1PreparedStatement[] {
  const db = context.env.LB
  return [removeCommentStatement(db, comment.id, staffName(who), context.now),
    staffAudit(context, who, { action: 'comment.remove', subjectKind: 'comment', subjectId: comment.id,
      data: { by: 'staff', body: comment.body, reportId } }),
    ...(comment.account_id ? [notifyStatement(db, { accountId: comment.account_id, kind: 'comment_removed', subjectId: comment.id,
      buildId: comment.build_id, data: { reportId } }, context.now)] : [])]
}

/** DELETE /comments/:id: by its author, the build's owner, or staff. */
export async function removeComment(context: RouteContext): Promise<Response> {
  const db = context.env.LB
  const { comment, build } = await standingComment(context.env, context.params.id)
  const session = await optionalSession(context)
  const accountId = session?.accountId ?? null
  if (accountId && comment.account_id === accountId) {
    // an author's own removal deletes the comment text entirely
    await db.batch([removeCommentStatement(db, comment.id, 'author', context.now),
      auditStatement(db, { actorKind: 'account', actorId: accountId, action: 'comment.remove', subjectKind: 'comment', subjectId: comment.id,
        data: { by: 'author' } }, context.now)])
  } else if (accountId && await sessionHasUid(db, session!, build.uid, context.now)) {
    await db.batch([removeCommentStatement(db, comment.id, 'owner', context.now),
      auditStatement(db, { actorKind: 'account', actorId: accountId, action: 'comment.remove', subjectKind: 'comment', subjectId: comment.id,
        data: { by: 'owner', body: comment.body } }, context.now)])
  } else {
    const staff = await staffWith(context, 'comments.moderate')
    if (!staff) throw new HttpError('not_found', "hmm... that comment isn't available anymore. refresh the thread to see what's still there.")
    await db.batch(staffRemoveComment(context, staff, comment))
  }
  return json({ ok: true })
}
