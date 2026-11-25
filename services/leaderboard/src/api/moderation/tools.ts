/*
  Author: Runor Ewhro
  description: staff tools besides closing reports: claiming and noting a
               report, issuing and lifting sanctions, any subject's history,
               roles, clearing a document, and the media review queue. each
               route requires one permission (auth/staff.ts) and is audited under
               the staff member.
*/

import type {
  HistoryEvent, HistoryResponse, MediaListResponse, ReportDetailResponse, ReportNote, RoleRequest, Sanction, SanctionRequest, StaffComment,
  StaffDocumentsResponse, StaffReport,
} from '@lb/contract/api'
import { isDocumentKind, readDocument } from '@lb/contract/documents'
import { ROLES } from '@lb/contract/permissions'
import { actionsBy, historyOf, type AuditRow, type SubjectKind } from '../../lib/audit.ts'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import { getAccount, linkOf, setRoleStatement } from '../../db/accounts.ts'
import { getComment, type CommentRow } from '../../db/comments.ts'
import { notifyStatement } from '../../db/notifications.ts'
import { deleteDocumentStatement, documentQueue, documentsOf, markReviewedStatement } from '../../db/documents.ts'
import { getPlayer } from '../../db/identity.ts'
import { getMedia, mediaByStatus, setMediaStatusStatement } from '../../db/media.ts'
import {
  assignReportStatement, getReport, insertReportNoteStatement, reportNotes, reportsAbout, type ReportNoteRow, type ReportRow,
} from '../../db/moderation.ts'
import {
  getSanction, insertSanctionStatement, liftSanctionStatement, sanctionsOf, type SanctionKind, type SanctionRow,
} from '../../db/sanctions.ts'
import { bumpPlayerStatement } from '../../db/identity.ts'
import { parseBuildId } from '../../lib/ids.ts'
import { syncPlayerBoards } from '../players.ts'
import { boardOf, cardRef } from '../stubs.ts'
import type { RouteContext } from '../router.ts'
import { authorize, staffAudit as audit, staffName } from '../auth/staff.ts'
import { mediaItem } from '../media/routes.ts'

const DAY_MS = 86_400_000

// shapes

export const staffReport = (row: ReportRow): StaffReport => ({
  id: row.id, buildId: row.build_id, reason: row.reason, details: row.details, status: row.status,
  resolution: row.resolution, createdAt: row.created_at, resolvedAt: row.resolved_at, assignedTo: row.assigned_to, assignedAt: row.assigned_at,
  commentId: row.comment_id,
})

export const staffComment = (row: CommentRow): StaffComment => ({ id: row.id, buildId: row.build_id, accountId: row.account_id,
  body: row.body, createdAt: row.created_at, removedAt: row.removed_at, removedBy: row.removed_by })

const reportNote = (row: ReportNoteRow): ReportNote => ({ id: row.id, author: row.author, body: row.body, createdAt: row.created_at })

export const sanction = (row: SanctionRow): Sanction => ({
  id: row.id, subjectKind: row.subject_kind, subjectId: row.subject_id, kind: row.kind, reason: row.reason, reportId: row.report_id,
  issuedBy: row.issued_by, createdAt: row.created_at, expiresAt: row.expires_at, liftedAt: row.lifted_at, liftedBy: row.lifted_by,
})

const historyEvent = (row: AuditRow): HistoryEvent => ({
  id: row.id, at: row.at, actorKind: row.actor_kind, actorId: row.actor_id, action: row.action, data: row.data ? JSON.parse(row.data) : null,
})

// reports

async function reportOr404(db: D1Database, id: string): Promise<ReportRow> {
  const report = await getReport(db, id)
  if (!report) throw new HttpError('not_found', "hmm... we couldn't find that report. refresh the queue and try again.")
  return report
}

/** GET /admin/reports/:id: the report, its notes and its build's history. */
export async function reportDetail(context: RouteContext): Promise<Response> {
  await authorize(context, 'reports.review')
  const db = context.env.LB
  const report = await reportOr404(db, context.params.id)
  const [notes, history, comment] = await Promise.all([reportNotes(db, report.id),
    report.comment_id ? historyOf(db, 'comment', report.comment_id, 100) : historyOf(db, 'build', report.build_id, 100),
    report.comment_id ? getComment(db, report.comment_id) : null])
  const body: ReportDetailResponse = { report: staffReport(report), comment: comment ? staffComment(comment) : null,
    notes: notes.map(reportNote), history: history.map(historyEvent) }
  return json(body)
}

/** POST /admin/reports/:id/assign { take }: take the report, or let it go. */
export async function assignReport(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'reports.review')
  const db = context.env.LB
  const report = await reportOr404(db, context.params.id)
  const { take } = await readJsonBody<{ take?: unknown }>(context.request)
  if (typeof take !== 'boolean') throw new HttpError('bad_request', 'send { take: boolean }')
  const to = take ? staffName(who) : null
  await db.batch([assignReportStatement(db, report.id, to, context.now),
    audit(context, who, { action: 'report.assign', subjectKind: 'report', subjectId: report.id, data: { to } })])
  return json(staffReport((await getReport(db, report.id))!))
}

/** POST /admin/reports/:id/notes { body }. */
export async function noteReport(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'reports.review')
  const db = context.env.LB
  const report = await reportOr404(db, context.params.id)
  const { body } = await readJsonBody<{ body?: unknown }>(context.request)
  if (typeof body !== 'string' || !body.trim() || body.length > 2000) throw new HttpError('bad_request', 'a note is 1 to 2000 characters')
  const made = insertReportNoteStatement(db, { reportId: report.id, author: staffName(who), body: body.trim() }, context.now)
  await db.batch([made.statement, audit(context, who, { action: 'report.note', subjectKind: 'report', subjectId: report.id,
    data: { noteId: made.id } })])
  return json(reportNote((await reportNotes(db, report.id)).find((note) => note.id === made.id)!), { status: 201 })
}

// sanctions

const SANCTION_KINDS: readonly SanctionKind[] = ['warn', 'mute', 'suspend', 'ban']
const auditSubject = (kind: 'uid' | 'account'): SubjectKind => kind === 'uid' ? 'player' : 'account'

/** whether a sanction changes how a uid's builds list: a uid ban does, on issue and on lift. */
export const movesBoards = (row: Pick<SanctionRow, 'kind' | 'subject_kind'>) => row.kind === 'ban' && row.subject_kind === 'uid'

/** statements for lifting a sanction: the lift, plus a players.ver bump for a uid ban so its boards resync. after the
    batch, the uid is synced to its boards (syncPlayerBoards), and a uid banned by another sanction stays off. */
export async function liftStatements(db: D1Database, row: SanctionRow, by: string, now: number): Promise<D1PreparedStatement[]> {
  return [liftSanctionStatement(db, row.id, by, now), ...(movesBoards(row) ? [bumpPlayerStatement(db, row.subject_id)] : [])]
}

/** POST /admin/sanctions. */
export async function issueSanction(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'sanctions.issue')
  const db = context.env.LB
  const body = await readJsonBody<Partial<SanctionRequest>>(context.request)
  if (body.subjectKind !== 'uid' && body.subjectKind !== 'account') throw new HttpError('bad_request', 'subjectKind is uid or account')
  if (typeof body.subjectId !== 'string') throw new HttpError('bad_request', 'send the subjectId')
  if (!SANCTION_KINDS.includes(body.kind as SanctionKind)) throw new HttpError('bad_request', 'kind is warn, mute, suspend or ban')
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) throw new HttpError('bad_request', 'a reason is 1 to 500 characters')
  const kind = body.kind as SanctionKind
  if (kind === 'suspend' && !(Number.isInteger(body.days) && body.days! >= 1 && body.days! <= 3650)) {
    throw new HttpError('bad_request', 'a suspension lasts 1 to 3650 days')
  }
  if (kind === 'mute' && body.days != null && !(Number.isInteger(body.days) && body.days >= 1 && body.days <= 3650)) {
    throw new HttpError('bad_request', 'a mute lasts 1 to 3650 days, or until lifted')
  }
  if ((kind === 'warn' || kind === 'ban') && body.days != null) throw new HttpError('bad_request', `a ${kind === 'warn' ? 'warning' : 'ban'} has no length`)
  if (body.reportId != null) await reportOr404(db, body.reportId)
  if (body.subjectKind === 'uid' && !await getPlayer(db, body.subjectId)) throw new HttpError('not_found', 'no such uid')
  if (body.subjectKind === 'account') {
    const account = await getAccount(db, body.subjectId)
    if (!account) throw new HttpError('not_found', 'no such account')
    // staff are sanctioned only by someone who can change their role.
    if (account.role !== 'user') await authorize(context, 'roles.assign')
  }
  const expiresAt = (kind === 'suspend' || kind === 'mute') && body.days != null ? context.now + body.days * DAY_MS : null
  const made = insertSanctionStatement(db, { subjectKind: body.subjectKind, subjectId: body.subjectId, kind, reason: body.reason.trim(),
    reportId: body.reportId ?? null, issuedBy: staffName(who), expiresAt }, context.now)
  // the account sanctioned, or the one a sanctioned uid is linked to, is told why and until when.
  const told = body.subjectKind === 'account' ? body.subjectId : (await linkOf(db, body.subjectId))?.account_id
  await db.batch([made.statement,
    ...(told ? [notifyStatement(db, { accountId: told, kind: 'sanction', subjectId: made.id,
      data: { kind, reason: body.reason.trim(), expiresAt, uid: body.subjectKind === 'uid' ? body.subjectId : null } }, context.now)] : []),
    ...(kind === 'ban' && body.subjectKind === 'uid' ? [bumpPlayerStatement(db, body.subjectId)] : []),
    audit(context, who, { action: 'sanction.issue', subjectKind: auditSubject(body.subjectKind), subjectId: body.subjectId,
      data: { sanctionId: made.id, kind, days: body.days ?? null, reportId: body.reportId ?? null } })])
  // a banned uid leaves every board; D1's listed views already leave it out of everything else.
  if (kind === 'ban' && body.subjectKind === 'uid') await syncPlayerBoards(context.env, body.subjectId)
  return json(sanction((await getSanction(db, made.id))!), { status: 201 })
}

/** POST /admin/sanctions/:id/lift: lifting a uid ban restores its builds to their boards from stored scores. */
export async function liftSanction(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'sanctions.issue')
  const db = context.env.LB
  const row = await getSanction(db, context.params.id)
  if (!row) throw new HttpError('not_found', "hmm... we couldn't find that sanction. refresh your account standing and try again.")
  if (row.lifted_at != null) throw new HttpError('bad_request', "this sanction has already been lifted. refresh the page to see its status.")
  await db.batch([...await liftStatements(db, row, staffName(who), context.now),
    audit(context, who, { action: 'sanction.lift', subjectKind: auditSubject(row.subject_kind), subjectId: row.subject_id,
      data: { sanctionId: row.id } })])
  if (movesBoards(row)) await syncPlayerBoards(context.env, row.subject_id)
  return json(sanction((await getSanction(db, row.id))!))
}

// history

const HISTORY_SUBJECTS: readonly SubjectKind[] = ['build', 'card', 'player', 'account', 'report', 'ruleset', 'sanction', 'media', 'document', 'score', 'comment']

/** GET /admin/history/:kind/:id: what happened to a subject (and, for a player or an account, what it did),
    with its sanctions and the reports about it. */
export async function subjectHistory(context: RouteContext): Promise<Response> {
  await authorize(context, 'history.read')
  const db = context.env.LB
  const kind = context.params.kind as SubjectKind
  const id = context.params.id
  if (!HISTORY_SUBJECTS.includes(kind)) throw new HttpError('bad_request', 'no such kind of subject')
  const actor = kind === 'player' ? { actorKind: 'uid' as const, actorId: id } : kind === 'account' ? { actorKind: 'account' as const, actorId: id } : null
  const [about, by, sanctions, reports, held] = await Promise.all([
    historyOf(db, kind, id, 200),
    actor ? actionsBy(db, actor, 200) : [],
    kind === 'player' ? sanctionsOf(db, 'uid', id) : kind === 'account' ? sanctionsOf(db, 'account', id) : [],
    kind === 'build' ? reportsAbout(db, { buildId: id }) : kind === 'player' ? reportsAbout(db, { uid: id }) : [],
    heldHistory(context, kind, id),
  ])
  const events = [...new Map([...about, ...by, ...held].map((row) => [row.id, row])).values()].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
  const body: HistoryResponse = { subjectKind: kind, subjectId: id, events: events.map(historyEvent), sanctions: sanctions.map(sanction),
    reports: reports.map(staffReport) }
  return json(body)
}

/** what a build's board or a card's registry shard recorded of it, as audit rows. */
async function heldHistory(context: RouteContext, kind: SubjectKind, id: string): Promise<AuditRow[]> {
  const asRow = (prefix: string) => (event: { at: number; kind: string; actor: string | null; data: string | null }, i: number): AuditRow => {
    const [actorKind, ...rest] = (event.actor ?? 'system').split(':')
    return { id: `${prefix}:${i}`, at: event.at, actor_kind: (rest.length ? actorKind : 'system') as AuditRow['actor_kind'],
      actor_id: rest.length ? rest.join(':') : null, action: event.kind as AuditRow['action'], subject_kind: kind, subject_id: id, data: event.data }
  }
  if (kind === 'build') {
    const key = parseBuildId(id)
    return key ? (await boardOf(context.env, key.resonator).events(key.resonator, key.local)).map(asRow(`board:${id}`)) : []
  }
  if (kind === 'card') {
    const ref = cardRef(context.env, id)
    return ref ? (await ref.stub.history(ref.shard, ref.no)).events.map(asRow(`card:${id}`)) : []
  }
  return []
}

// roles

/** POST /admin/accounts/:id/role { role }. */
export async function assignRole(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'roles.assign')
  const db = context.env.LB
  const account = await getAccount(db, context.params.id)
  if (!account) throw new HttpError('not_found', 'no such account')
  const { role } = await readJsonBody<Partial<RoleRequest>>(context.request)
  if (!ROLES.includes(role as never)) throw new HttpError('bad_request', `role is ${ROLES.join(', ')}`)
  if (who.actorKind === 'account' && who.actorId === account.id) throw new HttpError('bad_request', 'you cannot change your own role')
  await db.batch([setRoleStatement(db, account.id, role!),
    audit(context, who, { action: 'account.role', subjectKind: 'account', subjectId: account.id, data: { from: account.role, to: role } })])
  return json({ id: account.id, role })
}

// documents

/** DELETE /admin/documents/:kind/:ownerId: clear a document someone wrote (its owner can write a new one). */
export async function clearDocument(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'documents.moderate')
  const { kind, ownerId } = context.params
  if (!isDocumentKind(kind)) throw new HttpError('not_found', 'no such document')
  const db = context.env.LB
  await db.batch([deleteDocumentStatement(db, kind, ownerId),
    audit(context, who, { action: 'document.clear', subjectKind: 'document', subjectId: `${kind}:${ownerId}` })])
  return json({ ok: true })
}

/** GET /admin/documents?status=unreviewed|reviewed&cursor=: public documents, newest write first; a write after a
    review returns the document to the unreviewed queue. */
export async function listDocuments(context: RouteContext): Promise<Response> {
  await authorize(context, 'documents.moderate')
  const status = context.url.searchParams.get('status') ?? 'unreviewed'
  if (status !== 'unreviewed' && status !== 'reviewed') throw new HttpError('bad_request', 'status is unreviewed or reviewed')
  const raw = context.url.searchParams.get('cursor')
  const cursor = raw ? /^(\d+)\.(.+)$/.exec(raw) : null
  if (raw && !cursor) throw new HttpError('bad_request', 'bad cursor')
  const limit = 50
  const rows = await documentQueue(context.env.LB, status === 'reviewed', cursor ? { at: Number(cursor[1]), key: cursor[2] } : null, limit + 1)
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  const body: StaffDocumentsResponse = {
    documents: page.map((row) => ({ kind: row.kind, ownerId: row.owner_id, body: readDocument(row.kind, row.schema_ver, row.body),
      updatedAt: row.updated_at, reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by })),
    next: rows.length > limit && last ? `${last.updated_at}.${last.kind}:${last.owner_id}` : null,
  }
  return json(body)
}

/** POST /admin/documents/:kind/:ownerId/reviewed { updatedAt }: marks the read version reviewed; later writes are not covered. */
export async function reviewDocument(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'documents.moderate')
  const { kind, ownerId } = context.params
  if (!isDocumentKind(kind)) throw new HttpError('not_found', 'no such document')
  const { updatedAt } = await readJsonBody<{ updatedAt?: unknown }>(context.request)
  if (typeof updatedAt !== 'number') throw new HttpError('bad_request', 'send the updatedAt you read')
  const db = context.env.LB
  if (!(await documentsOf(db, [kind], [ownerId])).has(`${kind}:${ownerId}`)) throw new HttpError('not_found', 'no such document')
  const marked = await markReviewedStatement(db, kind, ownerId, updatedAt, staffName(who), context.now).run()
  if (!marked.meta.changes) throw new HttpError('duplicate', "hold on... this content changed while you were reviewing it. refresh it before marking it reviewed.")
  await audit(context, who, { action: 'document.reviewed', subjectKind: 'document', subjectId: `${kind}:${ownerId}`, data: { updatedAt } }).run()
  return json({ ok: true })
}

// media

/** GET /admin/media?status=pending|approved|rejected: the review queue, oldest first. */
export async function listMedia(context: RouteContext): Promise<Response> {
  await authorize(context, 'media.review')
  const status = context.url.searchParams.get('status') ?? 'pending'
  if (status !== 'pending' && status !== 'approved' && status !== 'rejected') throw new HttpError('bad_request', 'status is pending, approved or rejected')
  const body: MediaListResponse = { media: (await mediaByStatus(context.env.LB, status, 200)).map(mediaItem) }
  return json(body)
}

/** POST /admin/media/:id { status: approved | rejected }. a rejected image's bytes are erased. */
export async function reviewMedia(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'media.review')
  const db = context.env.LB
  const media = await getMedia(db, context.params.id)
  if (!media || media.status === 'deleted' || media.status === 'rejected') throw new HttpError('not_found', "hmm... that image isn't available. it may have been removed or may still be awaiting review.")
  const { status } = await readJsonBody<{ status?: unknown }>(context.request)
  if (status !== 'approved' && status !== 'rejected') throw new HttpError('bad_request', 'status is approved or rejected')
  await db.batch([setMediaStatusStatement(db, media.id, status, staffName(who), context.now),
    notifyStatement(db, { accountId: media.account_id, kind: 'media', subjectId: media.id, data: { purpose: media.purpose, status } }, context.now),
    audit(context, who, { action: status === 'approved' ? 'media.approved' : 'media.rejected', subjectKind: 'media', subjectId: media.id })])
  if (status === 'rejected') await context.env.CARDS.delete(media.r2_key)
  return json(mediaItem((await getMedia(db, media.id))!))
}
