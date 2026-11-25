/*
  Author: Runor Ewhro
  description: selects the highest score with deterministic damage and scenario-id tie breaks.
*/

export interface RankableScore {
  scenarioId: string
  status: 'ok' | 'unsupported' | 'error'
  score: number | null
  damage: number | null
}

export function pickBest<T extends RankableScore>(rows: readonly T[]): T | null {
  let best: T | null = null
  // score, total damage, and scenario id make the result independent of arrival order.
  for (const row of rows) {
    if (row.status !== 'ok' || row.score == null || row.damage == null) continue
    if (!best || row.score > best.score! ||
      (row.score === best.score && (row.damage > best.damage! ||
        (row.damage === best.damage && row.scenarioId < best.scenarioId)))) best = row
  }
  return best
}
