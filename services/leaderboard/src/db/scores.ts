/*
  Author: Runor Ewhro
  description: records scenario scores, tracks job completion, and queries ranked board entries.
*/

export interface ScoreRow {
  build_id: string
  scenario_id: string
  status: 'ok' | 'unsupported' | 'error'
  damage: number | null
  duration: number | null
  dps: number | null
  score: number | null
  flags: number
  program_sha256: string | null
  error: string | null
  scored_at: number
}

export interface JobRow {
  build_id: string
  ruleset_id: string
  expected: number
  done: number
  status: 'scoring' | 'scored' | 'failed'
  created_at: number
  finished_at: number | null
}

/** display notes on a score row. */
export const SCORE_FLAGS = {
  /** generated and executed, but the scenario has no reference values for this sequence. */
  noRefs: 1,
} as const

/** start (or restart) scoring a build under a ruleset: forget its old rows there and expect `expected` new ones. */
export function startJobStatements(db: D1Database, buildId: string, rulesetId: string, expected: number, now: number) {
  return [
    db.prepare(`DELETE FROM build_scores WHERE build_id = ? AND scenario_id IN (SELECT id FROM scenarios WHERE ruleset_id = ?)`)
      .bind(buildId, rulesetId),
    db.prepare(`INSERT INTO score_jobs (build_id, ruleset_id, expected, done, status, created_at, finished_at)
      VALUES (?, ?, ?, 0, 'scoring', ?, NULL)
      ON CONFLICT (build_id, ruleset_id) DO UPDATE SET expected = excluded.expected, done = 0, status = 'scoring',
        created_at = excluded.created_at, finished_at = NULL`).bind(buildId, rulesetId, expected, now),
  ]
}

export const getJob = (db: D1Database, buildId: string, rulesetId: string) =>
  db.prepare('SELECT * FROM score_jobs WHERE build_id = ? AND ruleset_id = ?').bind(buildId, rulesetId).first<JobRow>()

export type NewScore = Omit<ScoreRow, 'build_id' | 'scored_at'>

/** writes one scenario's row and counts it once; returns the job after the write. */
export async function recordScore(db: D1Database, buildId: string, rulesetId: string, score: NewScore,
  now: number): Promise<JobRow | null> {
  // count the first scenario row before its upsert in the same batch; repeat queue delivery updates the row without incrementing done.
  const [, , job] = await db.batch([
    db.prepare(`UPDATE score_jobs SET done = done + 1 WHERE build_id = ? AND ruleset_id = ? AND status = 'scoring'
      AND NOT EXISTS (SELECT 1 FROM build_scores WHERE build_id = ? AND scenario_id = ?)`)
      .bind(buildId, rulesetId, buildId, score.scenario_id),
    db.prepare(`INSERT INTO build_scores (build_id, scenario_id, status, damage, duration, dps, score, flags,
        program_sha256, error, scored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (build_id, scenario_id) DO UPDATE SET status = excluded.status, damage = excluded.damage,
        duration = excluded.duration, dps = excluded.dps, score = excluded.score, flags = excluded.flags,
        program_sha256 = excluded.program_sha256, error = excluded.error, scored_at = excluded.scored_at`)
      .bind(buildId, score.scenario_id, score.status, score.damage, score.duration, score.dps, score.score, score.flags,
        score.program_sha256, score.error, now),
    db.prepare('SELECT * FROM score_jobs WHERE build_id = ? AND ruleset_id = ?').bind(buildId, rulesetId),
  ])
  return (job.results as JobRow[])[0] ?? null
}

export async function scoresFor(db: D1Database, buildId: string, rulesetId: string): Promise<ScoreRow[]> {
  const { results } = await db.prepare(`SELECT s.* FROM build_scores s JOIN scenarios c ON c.id = s.scenario_id
    WHERE s.build_id = ? AND c.ruleset_id = ? ORDER BY c.team_rank, c.id`).bind(buildId, rulesetId).all<ScoreRow>()
  return results
}

/** the last scenario of a job writes the board entry (or removes it when nothing scored). claims the job first,
    so two consumers finishing together write it once. returns false when another consumer already finished it. */
export async function finishJob(db: D1Database, job: { buildId: string; rulesetId: string }, entry: {
  resonatorId: string; uid: string; sequence: number; best: { scenario_id: string; score: number; dps: number } | null
}, now: number): Promise<boolean> {
  const claimed = await db.prepare(`UPDATE score_jobs SET status = 'scored', finished_at = ?
    WHERE build_id = ? AND ruleset_id = ? AND status = 'scoring' AND done >= expected`).bind(now, job.buildId, job.rulesetId).run()
  // the conditional update grants one consumer permission to publish the completed job's board result.
  if (!claimed.meta.changes) return false
  await db.batch(entry.best
    ? [db.prepare(`INSERT INTO board_entries (ruleset_id, resonator_id, uid, build_id, best_scenario, score, dps, sequence, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (ruleset_id, resonator_id, uid) DO UPDATE SET build_id = excluded.build_id,
          best_scenario = excluded.best_scenario, score = excluded.score, dps = excluded.dps,
          sequence = excluded.sequence, updated_at = excluded.updated_at`)
      .bind(job.rulesetId, entry.resonatorId, entry.uid, job.buildId, entry.best.scenario_id, entry.best.score,
        entry.best.dps, entry.sequence, now)]
    : [db.prepare('DELETE FROM board_entries WHERE ruleset_id = ? AND resonator_id = ? AND uid = ? AND build_id = ?')
      .bind(job.rulesetId, entry.resonatorId, entry.uid, job.buildId)])
  return true
}

export const failJobStatement = (db: D1Database, buildId: string, rulesetId: string, now: number) =>
  db.prepare(`UPDATE score_jobs SET status = 'failed', finished_at = ? WHERE build_id = ? AND ruleset_id = ? AND status = 'scoring'`)
    .bind(now, buildId, rulesetId)

/** a build leaving the board (deleted, hidden, replaced) takes its entries with it. */
export const removeBoardEntriesStatement = (db: D1Database, buildId: string) =>
  db.prepare('DELETE FROM board_entries WHERE build_id = ?').bind(buildId)

export const boardEntryFor = (db: D1Database, rulesetId: string, buildId: string) =>
  db.prepare('SELECT best_scenario FROM board_entries WHERE ruleset_id = ? AND build_id = ?').bind(rulesetId, buildId)
    .first<{ best_scenario: string }>()

export const removeUidBoardEntriesStatement = (db: D1Database, uid: string) =>
  db.prepare('DELETE FROM board_entries WHERE uid = ?').bind(uid)

export async function openJobs(db: D1Database, rulesetId: string): Promise<{ scoring: number; failed: number; scored: number }> {
  const { results } = await db.prepare(`SELECT status, COUNT(*) AS n FROM score_jobs WHERE ruleset_id = ? GROUP BY status`)
    .bind(rulesetId).all<{ status: JobRow['status']; n: number }>()
  const counts = { scoring: 0, failed: 0, scored: 0 }
  for (const row of results) counts[row.status] = row.n
  return counts
}

// boards

export interface BoardFilter {
  rulesetId: string
  resonatorId: string
  team: string | null
  member: string | null
  weapon: string | null
  sequence: number | null
  region: string | null
  limit: number
  offset: number
}

export interface BoardQueryRow {
  rank: number
  build_id: string
  uid: string
  last_name: string | null
  hide_uid: 0 | 1
  region: string | null
  sequence: number
  score: number
  dps: number
  drawn_at: number
  scenario_id: string
}

const filtered = (filter: BoardFilter) => filter.team != null || filter.member != null || filter.weapon != null

/** the main board reads board_entries; a team, member or weapon filter takes each build's best matching scenario. */
export async function boardRows(db: D1Database, filter: BoardFilter): Promise<{ rows: BoardQueryRow[]; total: number }> {
  if (!filtered(filter)) {
    const where = `WHERE e.ruleset_id = ?1 AND e.resonator_id = ?2 AND (?3 IS NULL OR e.sequence = ?3) AND (?4 IS NULL OR p.region = ?4)`
    const binds = [filter.rulesetId, filter.resonatorId, filter.sequence, filter.region]
    const [rows, total] = await db.batch([
      db.prepare(`SELECT * FROM (
          SELECT RANK() OVER (ORDER BY e.score DESC) AS rank, e.build_id, e.uid, p.last_name, p.hide_uid, p.region,
            e.sequence, e.score, e.dps, b.drawn_at, e.best_scenario AS scenario_id
          FROM board_entries e JOIN players p ON p.uid = e.uid JOIN builds b ON b.id = e.build_id
          ${where} AND b.state = 'active') ORDER BY score DESC, build_id LIMIT ?5 OFFSET ?6`)
        .bind(...binds, filter.limit, filter.offset),
      db.prepare(`SELECT COUNT(*) AS n FROM board_entries e JOIN players p ON p.uid = e.uid JOIN builds b ON b.id = e.build_id
        ${where} AND b.state = 'active'`).bind(...binds),
    ])
    return { rows: rows.results as BoardQueryRow[], total: (total.results[0] as { n: number }).n }
  }
  // scenario filters calculate each build's highest matching score from its individual scenario rows.
  const best = `SELECT s.build_id, MAX(s.score) AS score FROM build_scores s JOIN scenarios c ON c.id = s.scenario_id
    WHERE c.ruleset_id = ?1 AND c.resonator_id = ?2 AND s.status = 'ok' AND s.score IS NOT NULL
      AND (?3 IS NULL OR c.team_key = ?3) AND (?4 IS NULL OR c.weapon_id = ?4)
      AND (?5 IS NULL OR EXISTS (SELECT 1 FROM scenario_members m WHERE m.scenario_id = c.id AND m.resonator_id = ?5))
    GROUP BY s.build_id`
  const joined = `FROM (${best}) f JOIN builds b ON b.id = f.build_id AND b.state = 'active' JOIN players p ON p.uid = b.uid
    WHERE (?6 IS NULL OR b.sequence = ?6) AND (?7 IS NULL OR p.region = ?7)`
  const binds = [filter.rulesetId, filter.resonatorId, filter.team, filter.weapon, filter.member, filter.sequence, filter.region]
  const [rows, total] = await db.batch([
    db.prepare(`SELECT * FROM (
        SELECT RANK() OVER (ORDER BY f.score DESC) AS rank, b.id AS build_id, b.uid, p.last_name, p.hide_uid, p.region,
          b.sequence, f.score,
          (SELECT s2.dps FROM build_scores s2 JOIN scenarios c2 ON c2.id = s2.scenario_id
            WHERE s2.build_id = b.id AND c2.ruleset_id = ?1 AND s2.score = f.score
              AND (?3 IS NULL OR c2.team_key = ?3) AND (?4 IS NULL OR c2.weapon_id = ?4)
            ORDER BY s2.dps DESC, c2.id LIMIT 1) AS dps,
          b.drawn_at,
          (SELECT s3.scenario_id FROM build_scores s3 JOIN scenarios c3 ON c3.id = s3.scenario_id
            WHERE s3.build_id = b.id AND c3.ruleset_id = ?1 AND s3.score = f.score
              AND (?3 IS NULL OR c3.team_key = ?3) AND (?4 IS NULL OR c3.weapon_id = ?4)
            ORDER BY s3.dps DESC, c3.id LIMIT 1) AS scenario_id
        ${joined}) ORDER BY score DESC, build_id LIMIT ?8 OFFSET ?9`).bind(...binds, filter.limit, filter.offset),
    db.prepare(`SELECT COUNT(*) AS n ${joined}`).bind(...binds),
  ])
  return { rows: rows.results as BoardQueryRow[], total: (total.results[0] as { n: number }).n }
}

/** each scenario-cell rank of a build: its place on that scenario's own board. */
export async function cellRanks(db: D1Database, buildId: string, rulesetId: string): Promise<Map<string, number>> {
  const { results } = await db.prepare(`SELECT s.scenario_id, (
      SELECT COUNT(*) + 1 FROM build_scores o JOIN builds ob ON ob.id = o.build_id AND ob.state = 'active'
      WHERE o.scenario_id = s.scenario_id AND o.status = 'ok' AND o.score > s.score) AS rank
    FROM build_scores s JOIN scenarios c ON c.id = s.scenario_id
    WHERE s.build_id = ? AND c.ruleset_id = ? AND s.status = 'ok' AND s.score IS NOT NULL`).bind(buildId, rulesetId)
    .all<{ scenario_id: string; rank: number }>()
  return new Map(results.map((row) => [row.scenario_id, row.rank]))
}
