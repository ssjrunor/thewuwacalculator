/*
  Author: Runor Ewhro
  description: previews enemy-console drafts through the same scenario graph
               as committed calculations, retaining routing and manual effects.
*/

import type { CombatScenario } from '@/domain/entities/combatScenario'
import { reviseCombatScenario } from '@/domain/entities/combatScenario'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResRuntime } from '@/domain/entities/runtime'
import { applyRuntimeToSimulation } from '@/engine/runtime/runtimeAdapters'
import { prepareCombatScenarioForUi } from '@/engine/pipeline/combatScenario'

export function prepareEnemyConsoleDraft(
  scenario: CombatScenario | null, runtime: ResRuntime | null, enemy: EnemyProfile,
) {
  if (!scenario || !runtime) return null
  // apply the draft runtime to a copy of the scenario, then resolve the draft
  // enemy through the same context path used by committed calculations.
  const draft = applyRuntimeToSimulation(scenario, runtime.id, runtime).scenario
  return prepareCombatScenarioForUi(reviseCombatScenario(draft, { target: enemy })).workspace.activeContext
}
