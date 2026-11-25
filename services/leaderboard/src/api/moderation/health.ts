/*
  Author: Runor Ewhro
  description: GET /admin/health: pipeline health over the last `hours`
               (default 24): dead letters, open reports and live sessions from
               D1; each active board's report (rulesets, builds, outbox backlog
               and size); live-ruleset jobs, error rows and over-perfect scores
               summed across boards; and stuck reads in the registry shards.
*/

import { authorize } from '../auth/staff.ts'
import { json } from '../../lib/http.ts'
import type { ApiEnv } from '../../env.ts'
import { liveRulesetId } from '../../db/rulesets.ts'
import { openRollouts } from '../../db/rollouts.ts'
import { rulesetJobs, type JobTotals } from '../boardCommands.ts'
import { rulesetResonators } from '../../db/rulesets.ts'
import { ALL_SHARDS, boardOf, shardStub } from '../stubs.ts'
import { STUCK_PENDING_MS } from '../maintenance.ts'
import type { RouteContext } from '../router.ts'

const HOUR_MS = 3_600_000

type Counts = Record<string, number>

export interface HealthReport {
  windowHours: number
  deadLetters: Counts
  scoring: { rulesetId: string | null; fingerprint: string | null; jobs: JobTotals | null; errorRows: number
    overPerfect: { n: number; scores: Array<{ buildId: string; scenarioId: string; score: number }> } }
  cards: { stuckPending: number }
  rollout: { rulesetId: string; startedAt: number; jobs: JobTotals } | null
  boards: Array<Awaited<ReturnType<ReturnType<typeof boardOf>['health']>>>
  reports: { open: number }
  sessions: { live: number }
}

export async function healthReport(env: Pick<ApiEnv, 'LB' | 'BOARDS' | 'CARD_REGISTRY'>, now: number, hours = 24): Promise<HealthReport> {
  const db = env.LB
  const since = now - hours * HOUR_MS
  const live = await liveRulesetId(db)
  const [deadLetters, reports, sessions, fingerprint, [open]] = await Promise.all([
    db.prepare(`SELECT action AS key, COUNT(*) AS n FROM audit_log WHERE at >= ? AND action LIKE '%.dead_letter' GROUP BY action`)
      .bind(since).all<{ key: string; n: number }>().then(({ results }) => Object.fromEntries(results.map((row) => [row.key, row.n]))),
    db.prepare(`SELECT COUNT(*) AS n FROM reports WHERE status = 'open'`).first<number>('n'),
    db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ? AND revoked_at IS NULL').bind(now).first<number>('n'),
    live ? db.prepare('SELECT fingerprint FROM rulesets WHERE id = ?').bind(live).first<string | null>('fingerprint') : Promise.resolve(null),
    openRollouts(db),
  ])
  const resonators = [...new Set([...live ? await rulesetResonators(db, live) : [], ...open ? await rulesetResonators(db, open.ruleset_id) : []])]
  const [jobs, rolling, boards] = await Promise.all([
    live ? rulesetJobs(env, live, { force: false }) : Promise.resolve(null),
    open ? rulesetJobs(env, open.ruleset_id, { force: false }) : Promise.resolve(null),
    Promise.all(resonators.map((id) => boardOf(env, id).health(Number(id)))),
  ])
  // a card pending this long after its fetch lost its read; maintenance queues it again.
  const stuck = await Promise.all(ALL_SHARDS.map((shard) => shardStub(env, shard).stuckPending(shard, now - STUCK_PENDING_MS, 1000)))
  const overPerfect = boards.flatMap((board) => board.overPerfect.scores).sort((a, b) => b.score - a.score).slice(0, 5)
  return {
    windowHours: hours, deadLetters,
    scoring: { rulesetId: live, fingerprint: fingerprint ?? null, jobs, errorRows: boards.reduce((sum, board) => sum + board.errorRows, 0),
      overPerfect: { n: boards.reduce((sum, board) => sum + board.overPerfect.n, 0), scores: overPerfect } },
    cards: { stuckPending: stuck.reduce((sum, cards) => sum + cards.length, 0) },
    rollout: open && rolling ? { rulesetId: open.ruleset_id, startedAt: open.started_at, jobs: rolling } : null,
    boards, reports: { open: reports ?? 0 }, sessions: { live: sessions ?? 0 },
  }
}

export async function health(context: RouteContext): Promise<Response> {
  await authorize(context, 'health.read')
  const hours = Math.min(24 * 30, Math.max(1, Number(context.url.searchParams.get('hours')) || 24))
  return json(await healthReport(context.env, context.now, hours))
}

/**
 * GET /admin/timings?hours=: where scoring time goes, from every board's recorded timings (24 hours by default, 14
 * days at most): per scenario its count, mean, p50, p95 and max, the anchor sources it used and its mean per stage,
 * slowest total first, with the totals over all of them.
 */
export async function timings(context: RouteContext): Promise<Response> {
  await authorize(context, 'health.read')
  const { env, now } = context
  const hours = Math.min(24 * 14, Math.max(1, Number(context.url.searchParams.get('hours')) || 24))
  const live = await liveRulesetId(env.LB)
  const open = (await openRollouts(env.LB))[0]
  const resonators = [...new Set([...live ? await rulesetResonators(env.LB, live) : [], ...open ? await rulesetResonators(env.LB, open.ruleset_id) : []])]
  const rows = (await Promise.all(resonators.map((id) => boardOf(env, id).timings(Number(id), now - hours * HOUR_MS)))).flat()
  const byKey = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = row.key ?? '(ended ruleset)'
    byKey.set(key, [...byKey.get(key) ?? [], row])
  }
  const at = (sorted: number[], fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
  const scenarios = [...byKey].map(([key, group]) => {
    const ms = group.map((row) => row.ms).sort((a, b) => a - b)
    const anchors: Record<string, number> = {}
    const stages: Record<string, number> = {}
    for (const row of group) {
      anchors[row.anchor ?? 'none'] = (anchors[row.anchor ?? 'none'] ?? 0) + 1
      for (const [stage, spent] of Object.entries(row.stages ? JSON.parse(row.stages) as Record<string, number> : {})) stages[stage] = (stages[stage] ?? 0) + spent
    }
    for (const stage of Object.keys(stages)) stages[stage] = Math.round(stages[stage] / group.length)
    const total = ms.reduce((sum, value) => sum + value, 0)
    return { key, n: group.length, totalMs: Math.round(total), meanMs: Math.round(total / group.length), p50Ms: at(ms, 0.5), p95Ms: at(ms, 0.95),
      maxMs: ms[ms.length - 1], anchors, stages }
  }).sort((a, b) => b.totalMs - a.totalMs)
  const all = rows.map((row) => row.ms).sort((a, b) => a - b)
  const total = all.reduce((sum, value) => sum + value, 0)
  return json({ windowHours: hours, cells: rows.length, totalMs: Math.round(total), meanMs: rows.length ? Math.round(total / rows.length) : 0,
    p50Ms: all.length ? at(all, 0.5) : 0, p95Ms: all.length ? at(all, 0.95) : 0, scenarios })
}
