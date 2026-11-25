/*
  Author: Runor Ewhro
  description: appeal routes: GET /account/sanctions and POST
               /sanctions/:id/appeal for the sanctioned account (the only routes
               a suspended session may use), and GET /admin/appeals and POST
               /admin/appeals/:id for staff. a granted appeal lifts its sanction,
               and the account is notified of either outcome.
*/

import type {
  Appeal, AppealDecision, AppealRequest, OwnSanctionsResponse, StaffAppeal, StaffAppealsResponse,
} from '@lb/contract/api'
import { auditStatement } from '../../lib/audit.ts'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import {
  appealCount, appealsByStatus, decideAppealStatement, getAppeal, insertAppealStatement, latestAppeals, type AppealRow,
} from '../../db/appeals.ts'
import { notifyStatement } from '../../db/notifications.ts'
import { getSanction, sanctionsOfAccount } from '../../db/sanctions.ts'
import type { RouteContext } from '../router.ts'
import { requireAccount } from '../auth/sessions.ts'
import { authorize, staffAudit, staffName } from '../auth/staff.ts'
import { rateLimit } from '../cards/routes.ts'
import { liftStatements, movesBoards, sanction } from './tools.ts'
import { syncPlayerBoards } from '../players.ts'

/** a sanction may be appealed this many times in all. */
const APPEALS_PER_SANCTION = 3
const MAX_BODY = 2000

const appeal = (row: AppealRow): Appeal => ({ id: row.id, sanctionId: row.sanction_id, status: row.status, body: row.body,
  response: row.response, createdAt: row.created_at, decidedAt: row.decided_at })

function text(value: unknown, max: number, what: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim() : ''
  if (!clean || clean.length > max) throw new HttpError('bad_request', `hmm... ${what} needs 1 to ${max} characters. check what you wrote and try again :P`)
  return clean
}

/** GET /account/sanctions: the sanctions on the account and its linked uids, each with its latest appeal. */
export async function ownSanctions(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context, { stopped: true })
  const db = context.env.LB
  const rows = await sanctionsOfAccount(db, session.accountId)
  const appeals = await latestAppeals(db, rows.map((row) => row.id))
  const body: OwnSanctionsResponse = { sanctions: rows.map((row) => {
    const latest = appeals.get(row.id)
    return { ...sanction(row), appeal: latest ? appeal(latest) : null }
  }) }
  return json(body)
}

/** POST /sanctions/:id/appeal { body }. */
export async function fileAppeal(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context, { stopped: true })
  await rateLimit(context.env.REPORT_LIMIT, `appeal:${session.accountId}`)
  const db = context.env.LB
  const row = (await sanctionsOfAccount(db, session.accountId)).find((entry) => entry.id === context.params.id)
  if (!row) throw new HttpError('not_found', "hmm... we couldn't find that sanction. refresh your account standing and try again.")
  if (row.lifted_at != null || (row.expires_at != null && row.expires_at <= context.now)) {
    throw new HttpError('bad_request', "this sanction has already ended, so there's nothing left to appeal.")
  }
  const latest = (await latestAppeals(db, [row.id])).get(row.id)
  if (latest?.status === 'open') throw new HttpError('duplicate', "your appeal is already waiting for staff review. check your inbox or account standing for the reply.")
  if (await appealCount(db, row.id) >= APPEALS_PER_SANCTION) throw new HttpError('forbidden', "this sanction has reached its appeal limit, so another appeal can't be submitted.")
  const body = text((await readJsonBody<Partial<AppealRequest>>(context.request)).body, MAX_BODY, 'an appeal')
  const made = insertAppealStatement(db, { sanctionId: row.id, accountId: session.accountId, body }, context.now)
  await db.batch([made.statement, auditStatement(db, { actorKind: 'account', actorId: session.accountId, action: 'appeal.write',
    subjectKind: 'sanction', subjectId: row.id, data: { appealId: made.id } }, context.now)])
  return json(appeal((await getAppeal(db, made.id))!), { status: 201 })
}

const STATUSES: readonly AppealRow['status'][] = ['open', 'upheld', 'granted']

/** GET /admin/appeals?status=open. */
export async function listAppeals(context: RouteContext): Promise<Response> {
  await authorize(context, 'sanctions.issue')
  const db = context.env.LB
  const status = (context.url.searchParams.get('status') ?? 'open') as AppealRow['status']
  if (!STATUSES.includes(status)) throw new HttpError('bad_request', 'status is open, upheld or granted')
  const rows = await appealsByStatus(db, status, 100)
  const sanctions = await Promise.all(rows.map((row) => getSanction(db, row.sanction_id)))
  const body: StaffAppealsResponse = { appeals: rows.map((row, index): StaffAppeal => ({ ...appeal(row), accountId: row.account_id,
    decidedBy: row.decided_by, sanction: sanction(sanctions[index]!) })) }
  return json(body)
}

/** POST /admin/appeals/:id { status, response }: uphold the sanction, or grant the appeal and lift it. */
export async function decideAppeal(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'sanctions.issue')
  const db = context.env.LB
  const row = await getAppeal(db, context.params.id)
  if (!row) throw new HttpError('not_found', "hmm... we couldn't find that appeal. refresh the appeal list and try again.")
  if (row.status !== 'open') throw new HttpError('bad_request', "this appeal already has a decision. refresh the page to see it.")
  const decision = await readJsonBody<Partial<AppealDecision>>(context.request)
  if (decision.status !== 'upheld' && decision.status !== 'granted') throw new HttpError('bad_request', 'status is upheld or granted')
  const response = text(decision.response, 1000, 'a response')
  const held = (await getSanction(db, row.sanction_id))!
  const by = staffName(who)
  const lift = decision.status === 'granted' && held.lifted_at == null ? await liftStatements(db, held, by, context.now) : []
  await db.batch([decideAppealStatement(db, row.id, { status: decision.status, response, by }, context.now), ...lift,
    notifyStatement(db, { accountId: row.account_id, kind: 'appeal', subjectId: row.id,
      data: { status: decision.status, response, sanctionId: held.id } }, context.now),
    staffAudit(context, who, { action: 'appeal.decide', subjectKind: 'sanction', subjectId: held.id,
      data: { appealId: row.id, status: decision.status } })])
  if (lift.length && movesBoards(held)) await syncPlayerBoards(context.env, held.subject_id)
  return json(appeal((await getAppeal(db, row.id))!))
}
