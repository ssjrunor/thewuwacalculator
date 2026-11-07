/*
  Author: Runor Ewhro
  description: scores the matching scenarios for one build and selects its best result.
*/

import type { ScenarioDef } from '@/domain/leaderboard/ruleset'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import { pickBest } from './pickBest'
import { canonicalResonatorId } from './scenarioInput'
import { scoreScenario, type ScenarioScore, type ScenarioScoringContext } from './scoreScenario'

export function scenariosForResonator(defs: readonly ScenarioDef[], resonatorId: string): ScenarioDef[] {
  const scored = canonicalResonatorId(resonatorId)
  return defs.filter((def) => canonicalResonatorId(def.resonatorId) === scored)
}

export interface BuildScores {
  rows: ScenarioScore[]
  best: ScenarioScore | null
  /** milliseconds per scenario, in row order. */
  ms: number[]
}

export async function scoreBuild(snapshot: BuildSnapshot, defs: readonly ScenarioDef[],
  context: ScenarioScoringContext): Promise<BuildScores> {
  const rows: ScenarioScore[] = []
  const ms: number[] = []
  // score scenarios in definition order and retain matching timing entries for per-scenario diagnostics.
  for (const def of scenariosForResonator(defs, snapshot.resonator.id)) {
    const started = performance.now()
    rows.push(await scoreScenario(snapshot, def, context))
    ms.push(performance.now() - started)
  }
  return { rows, best: pickBest(rows), ms }
}
