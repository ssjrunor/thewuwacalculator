/*
  Author: Runor Ewhro
  Description: runs full resonator or combat-graph simulations by constructing
               the needed transient combat graph and combat context, then
               delegating the actual skill/rotation evaluation to simulateRotation.
*/

import type { CombatGraph } from '@/domain/entities/combatGraph'
import type { ResonatorSeed } from '@/domain/entities/runtime'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import { buildTransientCombatGraph } from '@/domain/state/combatGraph'
import { buildCombatContext } from '@/engine/pipeline/buildCombatContext'
import { simulateRotation } from '@/engine/pipeline/simulateRotation'
import type { SimulationResult } from '@/engine/pipeline/types'
import type { SlotId } from '@/domain/entities/session'

// run a simulation starting from one active resonator runtime
// this path is used when the caller has a runtime + seed and wants the helper
// to create the transient graph around that active character
export function runResonatorSimulation(
    runtime: ResonatorRuntimeState,
    seed: ResonatorSeed,
    enemy: EnemyProfile,
    runtimesById: Record<string, ResonatorRuntimeState> = {},
    selectedTargetsByOwnerKey: Record<string, string | null> = {},
): SimulationResult {
  // build a temporary combat graph with this resonator in the active slot
  // and any extra participant runtimes supplied by the caller
  const graph = buildTransientCombatGraph({
    activeRuntime: runtime,
    activeSeed: seed,
    participantRuntimes: runtimesById,
    selectedTargetsByResonatorId: {
      [runtime.id]: selectedTargetsByOwnerKey,
    },
  })

  // compute the combat context for the active slot so all buffs, stats,
  // and graph-linked runtime effects are resolved before simulation
  const context = buildCombatContext({
    graph,
    targetSlotId: 'active',
    enemy,
  })

  // simulate the full rotation/damage pipeline from the resolved context
  return simulateRotation(context, seed, runtimesById)
}

// run a simulation when the caller already has a fully built combat graph
// this avoids rebuilding the graph and lets the caller choose which slot is the target
export function runCombatGraphSimulation(
    graph: CombatGraph,
    targetSlotId: SlotId,
    seed: ResonatorSeed,
    enemy: EnemyProfile,
): SimulationResult {
  const targetParticipant = graph.participants[targetSlotId]

  // build a resonator-id lookup from the graph participants because downstream
  // simulation helpers expect a runtime map keyed by resonator id
  const runtimeLookup = Object.fromEntries(
      Object.values(graph.participants).map((participant) => [participant.resonatorId, participant.runtime]),
  )

  if (!targetParticipant) {
    throw new Error(`Missing combat graph participant for slot ${targetSlotId}`)
  }

  // resolve the combat context for the chosen slot within the provided graph
  const context = buildCombatContext({
    graph,
    targetSlotId,
    enemy,
  })

  // simulate from the selected participant's perspective using the shared graph data
  return simulateRotation(context, seed, runtimeLookup)
}