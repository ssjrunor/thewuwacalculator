/*
  Author: Runor Ewhro
  Description: runs full resonator or combat-graph simulations by constructing
               the needed transient combat graph and combat context, then
               delegating the actual skill/rotation evaluation to simulateRotation.
*/

import type { CombatGraph } from '@/domain/entities/combatGraph'
import type { ResSeed } from '@/domain/entities/runtime'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResRuntime } from '@/domain/entities/runtime'
import { makeCombatGraph } from '@/domain/state/combatGraph'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext'
import { smltRot } from '@/engine/pipeline/simulateRotation'
import {
  runRotNspc,
  type RotInspectionOptions,
  type RotNspcEnt,
  type RotSimulationDetail,
  type RotSimulationMode,
} from '@/engine/rotation/system'
import type { SimResult } from '@/engine/pipeline/types'
import type { SlotId } from '@/domain/entities/session'

// run a simulation starting from one active resonator runtime
// this path is used when the caller has a runtime + seed and wants the helper
// to create the transient graph around that active character
export function runResSmlt(
    runtime: ResRuntime,
    seed: ResSeed,
    enemy: EnemyProfile,
    runtimesById: Record<string, ResRuntime> = {},
    selTrgtByOwn: Record<string, string | null> = {},
    options: {
      mode?: RotSimulationMode
      detail?: RotSimulationDetail
    } = {},
): SimResult {
  // build a temporary combat graph with this resonator in the active slot
  // and any extra participant runtimes supplied by the caller
  const graph = makeCombatGraph({
    actRt: runtime,
    activeSeed: seed,
    partRts: runtimesById,
    targetsByRes: {
      [runtime.id]: selTrgtByOwn,
    },
  })

  // compute the combat context for the active slot so all buffs, stats,
  // and graph-linked runtime effects are resolved before simulation
  const context = makeCombatEnv({
    graph,
    targetSlotId: 'active',
    enemy,
  })

  // simulate the full rotation/damage pipeline from the resolved context
  return smltRot(context, seed, runtimesById, options)
}

// run a simulation when the caller already has a fully built combat graph
// this avoids rebuilding the graph and lets the caller choose which slot is the target
export function runCmbtGrphS(
    graph: CombatGraph,
    targetSlotId: SlotId,
    seed: ResSeed,
    enemy: EnemyProfile,
    options: {
      mode?: RotSimulationMode
      detail?: RotSimulationDetail
    } = {},
): SimResult {
  const tgtPart = graph.participants[targetSlotId]

  // build a resonator-id lookup from the graph participants because downstream
  // simulation helpers expect a runtime map keyed by resonator id
  const rtLkp = Object.fromEntries(
      Object.values(graph.participants).map((participant) => [participant.resonatorId, participant.runtime]),
  )

  if (!tgtPart) {
    throw new Error(`Missing combat graph participant for slot ${targetSlotId}`)
  }

  // resolve the combat context for the chosen slot within the provided graph
  const context = makeCombatEnv({
    graph,
    targetSlotId,
    enemy,
  })

  // simulate from the selected participant's perspective using the shared graph data
  return smltRot(context, seed, rtLkp, options)
}

export function nspcResRot(
    runtime: ResRuntime,
    seed: ResSeed,
    enemy: EnemyProfile,
    runtimesById: Record<string, ResRuntime> = {},
    selTrgtByOwn: Record<string, string | null> = {},
    options: RotInspectionOptions = {},
): {
  rotations: {
    personal: {
      entries: RotNspcEnt[]
    }
    team: {
      entries: RotNspcEnt[]
    }
  }
} {
  // build the same transient graph/context surface as normal live simulation
  // so the inspector sees the exact same team, routing, and enemy state
  const graph = makeCombatGraph({
    actRt: runtime,
    activeSeed: seed,
    partRts: runtimesById,
    targetsByRes: {
      [runtime.id]: selTrgtByOwn,
    },
  })

  const context = makeCombatEnv({
    graph,
    targetSlotId: 'active',
    enemy,
  })

  // the inspector only needs node-level execution trace rows, not full totals
  return runRotNspc(context, seed, runtimesById, undefined, options)
}
