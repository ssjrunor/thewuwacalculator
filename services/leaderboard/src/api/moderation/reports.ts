/*
  Author: Runor Ewhro
  description: POST /reports: anyone may report a build (turnstile and a per-ip
               limit); a session's uid is recorded as the reporter.
*/

import type { ReportRequest, ReportResponse } from '@/domain/leaderboard/api'
import { auditStatement } from '../../lib/audit.ts'
import { HttpError, clientIp, json, readJsonBody } from '../../lib/http.ts'
import { requireTurnstile } from '../../lib/turnstile.ts'
import { getBuild } from '../../db/builds.ts'
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
    throw new HttpError('bad_request', 'send { buildId, reason, details? }')
  }
  if (body.details != null && (typeof body.details !== 'string' || body.details.length > 2000)) {
    throw new HttpError('bad_request', 'details is a string of at most 2000 characters')
  }
  const build = await getBuild(env.LB, body.buildId)
  if (!build || build.state !== 'active') throw new HttpError('not_found', 'no such build')
  const session = await optionalSession(context)
  const { id, statement } = insertReportStatement(env.LB, { buildId: build.id, reason: body.reason as ReportRequest['reason'],
    details: body.details ?? null, reporterUid: session?.uid ?? null }, now)
  await env.LB.batch([statement, auditStatement(env.LB, { actorKind: session?.uid ? 'uid' : 'system', actorId: session?.uid ?? null,
    action: 'report.create', subjectKind: 'build', subjectId: build.id, data: { reportId: id, reason: body.reason } }, now)])
  const response: ReportResponse = { reportId: id }
  return json(response, { status: 201 })
}
