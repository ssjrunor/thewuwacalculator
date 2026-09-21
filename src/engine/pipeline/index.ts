/*
  Author: Runor Ewhro
  Description: runs full resonator or combat-graph simulations by constructing
               the needed transient combat graph and combat context, then
               delegating the actual skill/rotation evaluation to simulateRotation.
*/

import type { CombatGraph, SlotId } from '@/domain/entities/combatGraph'
import type { ResSeed } from '@/domain/entities/runtime'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResRuntime } from '@/domain/entities/runtime'
import { makeCombatGraph } from '@/engine/runtime/combatGraph'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext'
import { smltRot } from '@/engine/pipeline/simulateRotation'
import {
  executeRotationProgram,
  prepareRunEnv,
  prepareRotationProgram,
  runDetailedRotation,
  type DetailedRunOpts,
  type InspectEntry,
  type ProgramOpts,
  type RunDetail,
} from '@/engine/rotation/execute'
import type { FeatureResult, RotationNode } from '@/domain/gameData/contracts'
import type { SimResult } from '@/engine/pipeline/types'

export {
  tracePreparedRestState,
  traceScenarioRestState,
} from '@/engine/pipeline/scenarioRestTrace'
export type {
  ScenarioRestEffect,
  ScenarioRestEffectId,
  ScenarioRestMemberEffect,
  ScenarioRestMemberIndex,
  ScenarioRestNodeId,
  ScenarioRestOperation,
  ScenarioRestOperationDefinition,
  ScenarioRestResolution,
  ScenarioRestSourceState,
  ScenarioRestStateId,
  ScenarioRestStateTrace,
  ScenarioRestTargetBenefit,
  ScenarioRestTargetEffect,
  ScenarioRestTargetState,
  ScenarioRestTraceIndexes,
  ScenarioRestTraceNode,
} from '@/engine/pipeline/scenarioRestTrace'

export interface PreparedResSimulation {
  graph: CombatGraph
  context: ReturnType<typeof makeCombatEnv>
  runtimesById: Record<string, ResRuntime>
}

// Construct the shared graph/context boundary used by live simulation,
// inspection, optimizer compilation, and suggestion evaluation.
export function prepareResSimulation(
    runtime: ResRuntime,
    seed: ResSeed,
    enemy: EnemyProfile,
    runtimesById: Record<string, ResRuntime> = {},
    selTrgtByOwn: Record<string, string | null> = {},
): PreparedResSimulation {
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

  return { graph, context, runtimesById }
}

export interface MaterializedResRotation extends PreparedResSimulation {
  entries: FeatureResult[]
  inspection: InspectEntry[]
}

export function materializeResRotation(options: {
  runtime: ResRuntime
  seed: ResSeed
  enemy: EnemyProfile
  items: RotationNode[]
  runtimesById?: Record<string, ResRuntime>
  selectedTargets?: Record<string, string | null>
  detail?: RunDetail
  inspect?: boolean
  includeSnapshots?: boolean
  captureEntries?: boolean
  onDamageInvocation?: ProgramOpts['onDamageInvocation']
}): MaterializedResRotation {
  const prepared = prepareResSimulation(
    options.runtime,
    options.seed,
    options.enemy,
    options.runtimesById,
    options.selectedTargets,
  )
  const execution = executeRotationProgram(
    prepareRunEnv(prepared.context, options.seed),
    prepareRotationProgram(options.items),
    {
      detail: options.detail,
      inspect: options.inspect,
      includeSnapshots: options.includeSnapshots,
      captureEntries: options.captureEntries,
      onDamageInvocation: options.onDamageInvocation,
    },
  )

  return { ...prepared, ...execution }
}

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
      sequence?: RotationNode[]
      program?: RotationNode[]
      detail?: RunDetail
    } = {},
): SimResult {
  const { context } = prepareResSimulation(runtime, seed, enemy, runtimesById, selTrgtByOwn)

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
      sequence?: RotationNode[]
      program?: RotationNode[]
      detail?: RunDetail
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

export function inspectResRotation(
    runtime: ResRuntime,
    seed: ResSeed,
    enemy: EnemyProfile,
    runtimesById: Record<string, ResRuntime> = {},
    selTrgtByOwn: Record<string, string | null> = {},
    options: DetailedRunOpts = {},
): InspectEntry[] {
  // build the same transient graph/context surface as normal live simulation
  // so the inspector sees the exact same team, routing, and enemy state
  const { context } = prepareResSimulation(runtime, seed, enemy, runtimesById, selTrgtByOwn)

  // the inspector only needs node-level execution trace rows, not full totals
  return runDetailedRotation(context, seed, undefined, options).inspection
}

export function runDetailedResRotation(
    runtime: ResRuntime,
    seed: ResSeed,
    enemy: EnemyProfile,
    runtimesById: Record<string, ResRuntime> = {},
    selTrgtByOwn: Record<string, string | null> = {},
    options: DetailedRunOpts = {},
): { entries: FeatureResult[]; inspection: InspectEntry[] } {
  const { context } = prepareResSimulation(runtime, seed, enemy, runtimesById, selTrgtByOwn)

  return runDetailedRotation(context, seed, undefined, options)
}
