/*
  Author: Runor Ewhro
  description: selects the highest score with deterministic DPS and scenario-id tie breaks.
*/

export interface RankableScore {
  scenarioId: string
  status: 'ok' | 'unsupported' | 'error'
  score: number | null
  dps: number | null
}

export function pickBest<T extends RankableScore>(rows: readonly T[]): T | null {
  let best: T | null = null
  // reject unsupported or unscored rows; score, DPS, and scenario id produce a result independent of arrival order.
  for (const row of rows) {
    if (row.status !== 'ok' || row.score == null || row.dps == null) continue
    if (!best || row.score > best.score! ||
      (row.score === best.score && (row.dps > best.dps! ||
        (row.dps === best.dps && row.scenarioId < best.scenarioId)))) best = row
  }
  return best
}
