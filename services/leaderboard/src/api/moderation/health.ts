/*
  Author: Runor Ewhro
  description: GET /admin/health: the numbers that say the pipeline is moving,
               over the last `hours` (default 24). card intake by status, read
               outcomes with reader errors and timings, dead letters, the live
               ruleset's jobs (and how many are stale), open reports and live
               sessions. answered from d1 alone, so it works while a queue is stuck.
*/

import { verifyAccess } from '../../lib/access.ts'
import { json } from '../../lib/http.ts'
import { liveRulesetId } from '../../db/rulesets.ts'
import { openJobs } from '../../db/scores.ts'
import type { RouteContext } from '../router.ts'

const HOUR_MS = 3_600_000
/** flag scoring jobs older than two hours as stale in the health response. */
const STALE_JOB_MS = 2 * HOUR_MS
const STUCK_CARD_MS = HOUR_MS / 2

type Counts = Record<string, number>

async function countBy(db: D1Database, sql: string, ...params: unknown[]): Promise<Counts> {
  const { results } = await db.prepare(sql).bind(...params).all<{ key: string | null; n: number }>()
  return Object.fromEntries(results.map((row) => [row.key ?? 'none', row.n]))
}

export interface HealthReport {
  windowHours: number
  cards: { submitted: Counts; stuckPending: number }
  reads: { outcomes: Counts; readerErrors: number; /** whole-read latency, browser start included. */ wallMs: { avg: number | null; max: number | null } }
  deadLetters: Counts
  scoring: { rulesetId: string | null; jobs: { scoring: number; failed: number; scored: number }; stale: number;
    errorRows: number }
  reports: { open: number }
  sessions: { live: number }
}

// query independent pipeline counts concurrently and use the live ruleset only for current scoring-job totals.
export async function healthReport(db: D1Database, now: number, hours = 24): Promise<HealthReport> {
  const since = now - hours * HOUR_MS
  const live = await liveRulesetId(db)
  const [submitted, stuck, outcomes, readerStats, deadLetters, stale, errorRows, reports, sessions] = await Promise.all([
    countBy(db, 'SELECT status AS key, COUNT(*) AS n FROM cards WHERE fetched_at >= ? GROUP BY status', since),
    db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE status = 'pending' AND fetched_at < ?`).bind(now - STUCK_CARD_MS)
      .first<number>('n'),
    countBy(db, 'SELECT outcome AS key, COUNT(*) AS n FROM card_reads WHERE created_at >= ? GROUP BY outcome', since),
    db.prepare(`SELECT SUM(CASE WHEN json_extract(confidence, '$.error') IS NOT NULL THEN 1 ELSE 0 END) AS errors,
        AVG(json_extract(confidence, '$.wallMs')) AS avg, MAX(json_extract(confidence, '$.wallMs')) AS max
      FROM card_reads WHERE created_at >= ?`).bind(since).first<{ errors: number | null; avg: number | null; max: number | null }>(),
    countBy(db, `SELECT action AS key, COUNT(*) AS n FROM audit_log WHERE at >= ? AND action LIKE '%.dead_letter' GROUP BY action`, since),
    live ? db.prepare(`SELECT COUNT(*) AS n FROM score_jobs WHERE ruleset_id = ? AND status = 'scoring' AND created_at < ?`)
      .bind(live, now - STALE_JOB_MS).first<number>('n') : Promise.resolve(0),
    db.prepare(`SELECT COUNT(*) AS n FROM build_scores WHERE status = 'error' AND scored_at >= ?`).bind(since).first<number>('n'),
    db.prepare(`SELECT COUNT(*) AS n FROM reports WHERE status = 'open'`).first<number>('n'),
    db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ? AND revoked_at IS NULL').bind(now).first<number>('n'),
  ])
  return {
    windowHours: hours,
    cards: { submitted, stuckPending: stuck ?? 0 },
    reads: { outcomes, readerErrors: readerStats?.errors ?? 0,
      wallMs: { avg: readerStats?.avg == null ? null : Math.round(readerStats.avg), max: readerStats?.max ?? null } },
    deadLetters,
    scoring: { rulesetId: live, jobs: live ? await openJobs(db, live) : { scoring: 0, failed: 0, scored: 0 }, stale: stale ?? 0,
      errorRows: errorRows ?? 0 },
    reports: { open: reports ?? 0 },
    sessions: { live: sessions ?? 0 },
  }
}

export async function health(context: RouteContext): Promise<Response> {
  await verifyAccess(context.request, { team: context.env.ACCESS_TEAM_DOMAIN, audience: context.env.ACCESS_AUD })
  const hours = Math.min(24 * 30, Math.max(1, Number(context.url.searchParams.get('hours')) || 24))
  return json(await healthReport(context.env.LB, context.now, hours))
}
