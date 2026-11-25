/*
  Author: Runor Ewhro
  description: settings documents written by a signed-in account: its profile,
               its showcase card per resonator, its saved board views, and notes
               on builds of its linked uids. a write sends the whole document,
               which is parsed by the shared schema and stored as parsed. images
               must be the writer's own uploads and show to others once approved.
*/

import {
  DOCUMENTS, documentMedia, isDocumentKind, loadoutKey, readDocument, withApprovedMedia, type DocumentKind, type ProfileDoc,
} from '@lb/contract/documents'
import type { DocumentResponse } from '@lb/contract/api'
import { auditStatement } from '../../lib/audit.ts'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import { deleteDocumentStatement, documentsOf, putDocumentStatement, type DocumentRow } from '../../db/documents.ts'
import { approvedOf } from '../../db/media.ts'
import type { RouteContext } from '../router.ts'
import { requireAccount } from '../auth/sessions.ts'
import { staffName, staffWith } from '../auth/staff.ts'
import { assertNotMuted } from '../auth/writers.ts'
import { ownedBuild } from '../builds/lifecycle.ts'
import { rowsOf } from '../crossBoard.ts'
import { uidToText } from '../../lib/ids.ts'
import type { ApiEnv } from '../../env.ts'

type Shown = NonNullable<ReturnType<typeof readDocument>>

/** documents for a reader, keyed `kind:owner`, parsed at the current version; unapproved images are dropped unless
    the reader owns them. */
export async function shownDocuments(db: D1Database, kinds: DocumentKind[], ownerIds: string[], own: boolean): Promise<Map<string, Shown>> {
  const rows = await documentsOf(db, kinds, ownerIds)
  const read = [...rows.values()].flatMap((row) => {
    const body = readDocument(row.kind, row.schema_ver, row.body)
    return body ? [{ row, body }] : []
  })
  const approved = own ? null : await approvedOf(db, read.flatMap(({ row, body }) => documentMedia(row.kind, body)))
  return new Map(read.map(({ row, body }) => [`${row.kind}:${row.owner_id}`, approved ? withApprovedMedia(row.kind, body, approved) : body]))
}

/** what a person lets others see beyond their shown builds (their account profile's privacy; open when unset, and
    for a uid on no account). */
export async function privacyOf(db: D1Database, accountId: string | null): Promise<ProfileDoc['privacy']> {
  if (!accountId) return { history: true, followers: true }
  const row = (await documentsOf(db, ['profile'], [accountId])).get(`profile:${accountId}`)
  const body = row ? readDocument('profile', row.schema_ver, row.body) as ProfileDoc | null : null
  return body?.privacy ?? { history: true, followers: true }
}

/** checks that a document's images are the writer's own uploads and none were rejected. */
export async function checkMedia(db: D1Database, accountId: string | null, ids: string[]): Promise<void> {
  if (!ids.length) return
  if (!accountId) throw new HttpError('unauthorized', "hold on... sign in before uploading or using your own images :P")
  const { results } = await db.prepare(`SELECT id FROM media WHERE account_id = ? AND status IN ('pending', 'approved')
    AND id IN (SELECT value FROM json_each(?))`).bind(accountId, JSON.stringify(ids)).all<{ id: string }>()
  if (results.length !== new Set(ids).size) throw new HttpError('bad_request', "hmm... one of these images isn't an available upload from your account. upload it again or choose one of your own images :P")
}

/** checks that a profile features only builds of the uids linked to the account. */
async function checkFeatured(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, accountId: string, featured: string[]): Promise<void> {
  if (!featured.length) return
  const [rows, { results }] = await Promise.all([rowsOf(env, featured),
    env.LB.prepare('SELECT uid FROM account_uids WHERE account_id = ?').bind(accountId).all<{ uid: string }>()])
  const uids = new Set(results.map((row) => row.uid))
  const mine = featured.every((id) => {
    const row = rows.get(id)
    return row && row.state === 'active' && uids.has(uidToText(row.uid))
  })
  if (!mine) throw new HttpError('bad_request', "hmm... you can only feature your own available builds. refresh your profile and pick again :P")
}

function parse<K extends DocumentKind>(kind: K, body: unknown) {
  const result = DOCUMENTS[kind].schema.safeParse(body)
  if (!result.success) {
    // schema paths name the field to fix; avoid exposing the validator's JSON/type diagnostics in the UI.
    const issue = result.error.issues[0]
    const labels: Record<string, string> = { displayName: 'display name', bio: 'signature', links: 'profile links',
      accent: 'accent colour', avatar: 'avatar', banner: 'banner', featured: 'featured builds', privacy: 'privacy settings',
      avatarFrame: 'avatar framing', bannerFrame: 'banner framing', commentsOpen: 'comment setting', title: 'build title',
      note: 'build note', tags: 'build tags', views: 'saved views', style: 'card style', saved: 'card settings' }
    const field = issue?.path.includes('label') ? 'profile link label' : labels[String(issue?.path[0])] ?? `${kind} settings`
    let detail = `hmm... check your ${field} and try saving again :P`
    if (issue?.path.includes('url')) detail = "hmm... each profile link needs a full https:// address :P"
    else if (issue?.code === 'too_big') {
      const unit = issue.origin === 'string' ? 'characters' : issue.origin === 'array' ? 'items' : null
      detail = unit ? `woah... your ${field} can have up to ${issue.maximum} ${unit}. shorten it a little and try again :P`
        : `hmm... one of your ${field} values is too high. adjust it and try again :P`
    } else if (issue?.code === 'too_small') {
      detail = issue.origin === 'string' ? `hmm... your ${field} needs at least ${issue.minimum} ${issue.minimum === 1 ? 'character' : 'characters'} :P`
        : `hmm... one of your ${field} values is too low. adjust it and try again :P`
    }
    throw new HttpError('bad_request', detail)
  }
  return result.data
}

const response = (row: Pick<DocumentRow, 'kind' | 'owner_id'>, body: Shown, at: number): DocumentResponse =>
  ({ kind: row.kind, ownerId: row.owner_id, body, updatedAt: at })

type Owner = (typeof DOCUMENTS)[DocumentKind]['owner']

interface Target {
  kind: DocumentKind
  ownerId: string
  uid: string | null
  accountId: string | null
}

/** resolves a document's owner: the signed-in account (profile, saved views, card looks per resonator as
    `account:resonator`) or a build of a uid linked to it. */
async function target(context: RouteContext, kind: string, from: Owner): Promise<Target> {
  if (!isDocumentKind(kind) || DOCUMENTS[kind].owner !== from) throw new HttpError('not_found', 'no such document')
  if (from === 'build') {
    const { ref, uid, session } = await ownedBuild(context, context.params.id, { linked: true })
    return { kind, ownerId: ref.id, uid, accountId: session.accountId }
  }
  const session = await requireAccount(context)
  const who = { uid: null, accountId: session.accountId }
  if (from === 'account') return { kind, ownerId: session.accountId, ...who }
  const resonatorId = context.params.resonatorId
  if (!/^\d{4}$/.test(resonatorId)) throw new HttpError('bad_request', "hmm... we couldn't identify that resonator. reopen its board and try again.")
  const has = await context.env.LB.prepare(`SELECT 1 AS n FROM player_boards b JOIN account_uids l ON l.uid = b.uid
      WHERE l.account_id = ? AND b.resonator_id = ? AND b.standing > 0 LIMIT 1`).bind(session.accountId, resonatorId).first()
  if (!has) throw new HttpError('not_found', "hmm... you haven't submitted a build for that resonator yet. submit a card first :P")
  return { kind, ownerId: loadoutKey(session.accountId, resonatorId), ...who }
}

const actorOf = (at: Target) => at.uid ? { actorKind: 'uid' as const, actorId: at.uid } : { actorKind: 'account' as const, actorId: at.accountId! }

/** PUT a document: the whole body, parsed and stored as parsed. */
function putAt(from: Owner, fixedKind?: DocumentKind) {
  return async (context: RouteContext): Promise<Response> => {
    const at = await target(context, fixedKind ?? context.params.kind, from)
    const { kind, ownerId } = at
    const db = context.env.LB
    // muted writers cannot change documents others read; saved views are private and exempt
    if (kind !== 'views') await assertNotMuted(db, at, context.now)
    const body = parse(kind, await readJsonBody<unknown>(context.request))
    await checkMedia(db, at.accountId, documentMedia(kind, body))
    if (kind === 'profile') await checkFeatured(context.env, at.accountId!, (body as { featured: string[] }).featured)
    // a writer exempt from review leaves no document in the staff queue.
    const exempt = await staffWith(context, 'review.exempt')
    await db.batch([putDocumentStatement(db, { kind, ownerId, version: DOCUMENTS[kind].version, body,
      reviewedBy: exempt ? staffName(exempt) : null }, context.now),
      auditStatement(db, { ...actorOf(at), action: 'document.write', subjectKind: 'document', subjectId: `${kind}:${ownerId}` }, context.now)])
    return json(response({ kind, owner_id: ownerId }, body, context.now))
  }
}

function deleteAt(from: Owner, fixedKind?: DocumentKind) {
  return async (context: RouteContext): Promise<Response> => {
    const at = await target(context, fixedKind ?? context.params.kind, from)
    const db = context.env.LB
    await db.batch([deleteDocumentStatement(db, at.kind, at.ownerId),
      auditStatement(db, { ...actorOf(at), action: 'document.clear', subjectKind: 'document', subjectId: `${at.kind}:${at.ownerId}` }, context.now)])
    return json({ ok: true })
  }
}

/** PUT and DELETE /players/me/documents/:kind: the signed-in person's profile. */
export const putPlayerDocument = putAt('account')
export const deletePlayerDocument = deleteAt('account')
/** PUT and DELETE /builds/:id/documents/:kind (a build's notes). */
export const putBuildDocument = putAt('build')
export const deleteBuildDocument = deleteAt('build')
/** PUT and DELETE /players/me/cards/:resonatorId: the showcase card every build of that resonator wears, across the
    person's uids. */
export const putCardDocument = putAt('loadout', 'card')
export const deleteCardDocument = deleteAt('loadout', 'card')
/** PUT and DELETE /account/documents/:kind (saved board views; the profile too). */
export const putAccountDocument = putAt('account')
export const deleteAccountDocument = deleteAt('account')

/** GET /account/documents/:kind: the account's document, or null. */
export async function getAccountDocument(context: RouteContext): Promise<Response> {
  const at = await target(context, context.params.kind, 'account')
  const row = (await documentsOf(context.env.LB, [at.kind], [at.ownerId])).get(`${at.kind}:${at.ownerId}`)
  const body = row ? readDocument(row.kind, row.schema_ver, row.body) : null
  return json(row && body ? response(row, body, row.updated_at) : null)
}
