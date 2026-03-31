/*
  Author: Runor Ewhro
  Description: chooses the correct live simulation path for the active
               resonator, using an existing combat graph when possible and
               falling back to a standalone resonator simulation otherwise.
*/

import { runCombatGraphSimulation, runResonatorSimulation } from '@/engine/pipeline'
import type { ResonatorSeed, ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatGraph } from '@/domain/entities/combatGraph'
import {
  buildPreparedWorkspace,
  runPreparedWorkspaceSimulation,
  type PreparedWorkspace,
} from '@/engine/pipeline/preparedWorkspace'

export function buildPreparedLiveComputation(
    preparedWorkspace: PreparedWorkspace | null,
) {
  if (!preparedWorkspace) {
    return null
  }

  return runPreparedWorkspaceSimulation(preparedWorkspace)
}

// build the current live computation result for the calculator
// returns null when the active runtime or seed is missing
export function buildLiveComputation(
    runtime: ResonatorRuntimeState | null,
    seed: ResonatorSeed | null,
    enemy: EnemyProfile,
    runtimesById: Record<string, ResonatorRuntimeState> = {},
    graph: CombatGraph | null = null,
    selectedTargetsByOwnerKey: Record<string, string | null> = {},
) {
  if (!runtime || !seed) return null

  const preparedWorkspace = buildPreparedWorkspace({
    runtime,
    seed,
    enemy,
    participantRuntimesById: runtimesById,
    activeTargetSelections: selectedTargetsByOwnerKey,
    combatGraph: graph,
  })

  const preparedSimulation = runPreparedWorkspaceSimulation(preparedWorkspace)
  if (preparedSimulation) {
    return preparedSimulation
  }

  // if we already have a combat graph whose active participant matches
  // this runtime, reuse the graph-based simulation path so all participant
  // interactions and graph state stay consistent
  if (graph?.participants.active?.resonatorId === runtime.id) {
    return runCombatGraphSimulation(graph, 'active', seed, enemy)
  }

  // otherwise simulate directly from the runtime plus any linked teammate runtimes
  return runResonatorSimulation(runtime, seed, enemy, runtimesById, selectedTargetsByOwnerKey)
}
