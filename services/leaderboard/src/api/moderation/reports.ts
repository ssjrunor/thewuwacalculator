/*
  Author: Runor Ewhro
  description: POST /reports: anyone may report a build (turnstile and a per-ip limit); a session's uid and account
               are recorded as the reporter.
*/

import type { ReportRequest, ReportResponse } from '@lb/contract/api'
import { auditStatement } from '../../lib/audit.ts'
import { HttpError, clientIp, json, readJsonBody } from '../../lib/http.ts'
import { requireTurnstile } from '../../lib/turnstile.ts'
import { buildViewOf } from '../builds/lifecycle.ts'
import { uidToText } from '../../lib/ids.ts'
import { insertReportStatement } from '../../db/moderation.ts'
import { rateLimit } from '../cards/routes.ts'
import type { RouteContext } from '../router.ts'
import { optionalSession } from '../auth/sessions.ts'

const REASONS = new Set<ReportRequest['reason']>(['misread', 'not_owner', 'abuse', 'other'])

export async function submitReport(context: RouteContext): Promise<Response> {
  const { request, env, now } = context
  const ip = clientIp(request)
  await rateLimit(env.REPORT_LIMIT, `report:${ip}`)
  const body = await readJsonBody<Partial<ReportRequest>>(request)
  await requireTurnstile(body.turnstileToken, env.TURNSTILE_SECRET, ip)
  if (typeof body.buildId !== 'string' || !REASONS.has(body.reason as ReportRequest['reason'])) {
    throw new HttpError('bad_request', "hmm... pick a report reason first. if you already did, reopen the report and try again :P")
  }
  if (body.details != null && (typeof body.details !== 'string' || body.details.length > 2000)) {
    throw new HttpError('bad_request', "woah... report details can have up to 2000 characters. shorten them a little and try again :P")
  }
  const session = await optionalSession(context)
  // only kept builds can be reported
  const found = await buildViewOf(env, body.buildId).catch(() => null)
  const state = found?.view.row.state
  if (!found || state !== 'active') throw new HttpError('not_found', "hmm... this build isn't available. it may have been hidden or deleted.")
  const build = { id: found.ref.id, uid: uidToText(found.view.row.uid) }
  const { id, statement } = insertReportStatement(env.LB, { buildId: build.id, subjectUid: build.uid,
    reason: body.reason as ReportRequest['reason'], details: body.details ?? null,
    reporterAccount: session?.accountId ?? null }, now)
  await env.LB.batch([statement, auditStatement(env.LB, { actorKind: session?.accountId ? 'account' : 'system', actorId: session?.accountId ?? null,
    action: 'report.create', subjectKind: 'build', subjectId: build.id,
    data: { reportId: id, reason: body.reason } }, now)])
  const response: ReportResponse = { reportId: id }
  return json(response, { status: 201 })
}
