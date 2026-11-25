/*
  Author: Runor Ewhro
  description: rollout records. a rollout names a published ruleset to score
               every kept build into; each board reads it from the catalog,
               installs the ruleset as rolling and fans its builds out on the
               bulk lane (BoardDO.syncCatalog, rollOut). the ruleset goes live
               once every board has scored it (moderation/rollouts.ts).
*/

export type RolloutKeep = 'scenario' | 'data' | 'none'

export interface RolloutRow {
  ruleset_id: string
  from_ruleset: string | null
  status: 'scoring' | 'done' | 'cancelled'
  keep: RolloutKeep
  boards: number
  started_by: string
  started_at: number
  live_at: number | null
  finished_at: number | null
}

export const getRollout = (db: D1Database, rulesetId: string) =>
  db.prepare('SELECT * FROM rollouts WHERE ruleset_id = ?').bind(rulesetId).first<RolloutRow>()

export async function openRollouts(db: D1Database): Promise<RolloutRow[]> {
  const { results } = await db.prepare(`SELECT * FROM rollouts WHERE status = 'scoring' ORDER BY started_at`).all<RolloutRow>()
  return results
}

export const startRolloutStatement = (db: D1Database, row: Pick<RolloutRow, 'ruleset_id' | 'from_ruleset' | 'keep' | 'boards' | 'started_by' | 'started_at'>) =>
  db.prepare(`INSERT INTO rollouts (ruleset_id, from_ruleset, status, keep, boards, started_by, started_at)
    VALUES (?, ?, 'scoring', ?, ?, ?, ?)`).bind(row.ruleset_id, row.from_ruleset, row.keep, row.boards, row.started_by, row.started_at)

export const rolloutLiveStatement = (db: D1Database, rulesetId: string, now: number) =>
  db.prepare('UPDATE rollouts SET live_at = ? WHERE ruleset_id = ? AND live_at IS NULL').bind(now, rulesetId)

export const finishRolloutStatement = (db: D1Database, rulesetId: string, status: 'done' | 'cancelled', now: number) =>
  db.prepare(`UPDATE rollouts SET status = ?, finished_at = ? WHERE ruleset_id = ? AND status = 'scoring'`).bind(status, now, rulesetId)
