/*
  Author: Runor Ewhro
  Description: Implements prepared workspace data-flow and calculation invariants.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatGraph, SlotId } from '@/domain/entities/combatGraph'
import type { ResRuntime, ResSeed } from '@/domain/entities/runtime'
import { findCombatPart, makeCombatGraph } from '@/domain/state/combatGraph'
import { makeRuntimeCat, type PrepRtCat } from '@/domain/services/runtimeSourceService'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext'
import { prprRtSkll } from '@/engine/pipeline/prepareRuntimeSkill'
import { smltRot } from '@/engine/pipeline/simulateRotation'
import type { CombatContext, SimResult } from '@/engine/pipeline/types'
import type { SkillDef } from '@/domain/entities/stats'
import type { DamageFeature } from '@/domain/gameData/contracts'
import type { RotationNode } from '@/domain/gameData/contracts'
import {
  executeRotationProgram,
  directFeatureRows,
  prepareRunEnv,
  prepareRotationProgram,
  type RunEnvironment,
  type ProgramResult,
  type RunDetail,
} from '@/engine/rotation/execute'
import { orderStoredRotationProgram } from '@/engine/rotation/programOrder.ts'

export interface PrepDrctTpt {
  finalStats: CombatContext['finalStats']
  allFeatures: DamageFeature[]
  allSkills: DamageFeature[]
}

export interface PrepWork {
  revision: number
  enemy: EnemyProfile
  actRt: ResRuntime | null
  activeSeed: ResSeed | null
  prtcRntmById: Record<string, ResRuntime>
  activeTarget: Record<string, string | null>
  combatGraph: CombatGraph | null
  activeSlotId: SlotId | null
  activeContext: CombatContext | null
  cntxBySlotId: Partial<Record<SlotId, CombatContext>>
  cntxByResId: Record<string, CombatContext>
  actCat: PrepRtCat | null
  visSkll: SkillDef[]
  directOutput: PrepDrctTpt | null
  rotNvrn: RunEnvironment | null
}

interface MkPrepWorkNp {
  revision?: number
  runtime: ResRuntime | null
  seed?: ResSeed | null
  enemy: EnemyProfile
  prtcRntmById?: Record<string, ResRuntime>
  activeTarget?: Record<string, string | null>
  combatGraph?: CombatGraph | null
}

// Build one combat context for every participant so multiple Simulation surfaces
// can reuse them without rebuilding the graph repeatedly
function mkCntx(
    graph: CombatGraph,
    enemy: EnemyProfile,
): Pick<PrepWork, 'cntxBySlotId' | 'cntxByResId'> & {
  getBySlotId: (slotId: SlotId) => CombatContext | null
} {
  const cntxBySlotId: Partial<Record<SlotId, CombatContext>> = {}
  const cntxByResId: Record<string, CombatContext> = {}
  const cache = new Map<SlotId, CombatContext>()

  const getBySlotId = (slotId: SlotId): CombatContext | null => {
    const cached = cache.get(slotId)
    if (cached) return cached
    const participant = graph.participants[slotId]
    if (!participant) return null
    const context = makeCombatEnv({ graph, targetSlotId: slotId, enemy })
    cache.set(slotId, context)
    return context
  }

  for (const participant of Object.values(graph.participants)) {
    Object.defineProperty(cntxBySlotId, participant.slotId, {
      enumerable: true,
      get: () => getBySlotId(participant.slotId) ?? undefined,
    })
    Object.defineProperty(cntxByResId, participant.resonatorId, {
      enumerable: true,
      get: () => getBySlotId(participant.slotId) ?? undefined,
    })
  }

  return {
    cntxBySlotId: cntxBySlotId,
    cntxByResId: cntxByResId,
    getBySlotId,
  }
}

// prepare only the skills that survive runtime visibility checks
function mkVsblSkll(
    runtime: ResRuntime | null,
    context: CombatContext | null,
    catalog: PrepRtCat | null,
): SkillDef[] {
  if (!runtime || !context || !catalog) {
    return []
  }

  return catalog.skills.flatMap((skill) => {
    const prepared = prprRtSkll(runtime, skill, context)
    return prepared.visible === false ? [] : [prepared]
  })
}

export function mkPrepWork({
  revision = 0,
  runtime,
  seed = null,
  enemy,
  prtcRntmById: partRntmById = {},
  activeTarget: actTrgtSlct = {},
  combatGraph = null,
}: MkPrepWorkNp): PrepWork {
  if (!runtime) {
    return {
      revision,
      enemy,
      actRt: null,
      activeSeed: seed,
      prtcRntmById: partRntmById,
      activeTarget: actTrgtSlct,
      combatGraph: null,
      activeSlotId: null,
      activeContext: null,
      cntxBySlotId: {},
      cntxByResId: {},
      actCat: null,
      visSkll: [],
      directOutput: null,
      rotNvrn: null,
    }
  }

  const graph = combatGraph?.participants
      ? combatGraph
      : makeCombatGraph({
        actRt: runtime,
        activeSeed: seed ?? undefined,
        partRts: partRntmById,
        targetsByRes: {
          [runtime.id]: actTrgtSlct,
        },
      })

  const activeSlotId = findCombatPart(graph, runtime.id) ?? graph.activeSlotId
  const contexts = mkCntx(graph, enemy)
  const activeContext = activeSlotId ? contexts.getBySlotId(activeSlotId) : null
  const rotNvrn = activeContext && seed
      ? prepareRunEnv(activeContext, seed)
      : null
  let actCatCache: PrepRtCat | null | undefined
  let visibleSkillsCache: SkillDef[] | undefined
  let directOutputCache: PrepDrctTpt | null | undefined

  return {
    revision,
    enemy,
    actRt: runtime,
    activeSeed: seed,
    prtcRntmById: partRntmById,
    activeTarget: actTrgtSlct,
    combatGraph: graph,
    activeSlotId,
    activeContext: activeContext,
    cntxBySlotId: contexts.cntxBySlotId,
    cntxByResId: contexts.cntxByResId,
    get actCat() {
      if (actCatCache === undefined) actCatCache = makeRuntimeCat(runtime, seed)
      return actCatCache
    },
    get visSkll() {
      if (!visibleSkillsCache) {
        const catalog = actCatCache === undefined
          ? (actCatCache = makeRuntimeCat(runtime, seed))
          : actCatCache
        visibleSkillsCache = mkVsblSkll(runtime, activeContext, catalog)
      }
      return visibleSkillsCache
    },
    get directOutput() {
      if (directOutputCache === undefined) {
        const drctFeats = activeContext && seed ? directFeatureRows(activeContext, seed) : []
        directOutputCache = activeContext
          ? {
            finalStats: activeContext.finalStats,
            allFeatures: drctFeats,
            allSkills: drctFeats.filter((entry) => entry.feature.variant !== 'subHit'),
          }
          : null
      }
      return directOutputCache
    },
    rotNvrn: rotNvrn,
  }
}

const detailedProgramCache = new WeakMap<
  PrepWork,
  WeakMap<RotationNode[], ProgramResult>
>()
const orderedStoredProgramCache = new WeakMap<RotationNode[], RotationNode[]>()

export interface PreparedDetailedProgramRun {
  result: ProgramResult
  /** program normalization/compilation performed by this invocation */
  prepareMs: number
  /** numeric rotation execution performed by this invocation */
  executeMs: number
  /** true when both preparation and execution were reused */
  cacheHit: boolean
}

/** Prepared execution with phase timing for performance-facing consumers. */
export function runPrepWorkDetailedProgramTimed(
  prepared: PrepWork,
  items: RotationNode[],
  cacheIdentity: RotationNode[] = items,
): PreparedDetailedProgramRun | null {
  if (!prepared.activeContext || !prepared.activeSeed || !prepared.rotNvrn) {
    return null
  }

  let byProgram = detailedProgramCache.get(prepared)
  if (!byProgram) {
    byProgram = new WeakMap()
    detailedProgramCache.set(prepared, byProgram)
  }

  const cached = byProgram.get(cacheIdentity)
  if (cached) {
    return { result: cached, prepareMs: 0, executeMs: 0, cacheHit: true }
  }

  const prepareStartedAt = performance.now()
  const program = prepareRotationProgram(items)
  const prepareMs = performance.now() - prepareStartedAt
  const executeStartedAt = performance.now()
  const result = executeRotationProgram(
    prepared.rotNvrn,
    program,
    { inspect: true, includeSnapshots: true },
  )
  const executeMs = performance.now() - executeStartedAt
  byProgram.set(cacheIdentity, result)
  return { result, prepareMs, executeMs, cacheHit: false }
}

/**
 * Execute one advanced program against an existing workspace while retaining
 * the complete inspection surface required by the rotation page. The cache is
 * identity-based: immutable workspace/program inputs share the exact result,
 * while an edited program array always receives a fresh evaluation.
 */
export function runPrepWorkDetailedProgram(
  prepared: PrepWork,
  items: RotationNode[],
  cacheIdentity: RotationNode[] = items,
): ProgramResult | null {
  return runPrepWorkDetailedProgramTimed(prepared, items, cacheIdentity)?.result ?? null
}

/**
 * Stored editor programs execute their Preamble before their Main section.
 * Keep that presentation rule at the shared execution boundary so every
 * consumer reuses the same exact detailed result, including imported programs
 * whose section markers happen to be interleaved in the persisted array.
 */
export function runPrepWorkDetailedStoredProgram(
  prepared: PrepWork,
  sourceItems: RotationNode[],
): ProgramResult | null {
  let items = orderedStoredProgramCache.get(sourceItems)
  if (!items) {
    items = orderStoredRotationProgram(sourceItems)
    orderedStoredProgramCache.set(sourceItems, items)
  }
  return runPrepWorkDetailedProgram(prepared, items, sourceItems)
}

// run the full simulation from a previously prepared workspace snapshot
export function runPrepWorkS(
    prepared: PrepWork,
    options: {
      sequence?: RotationNode[]
      program?: RotationNode[]
      detail?: RunDetail
    } = {},
): SimResult | null {
  if (!prepared.activeContext || !prepared.activeSeed || !prepared.actRt) {
    return null
  }

  return smltRot(
      prepared.activeContext,
      prepared.activeSeed,
      prepared.prtcRntmById,
      {
        directOutput: prepared.directOutput,
        rotNvrn: prepared.rotNvrn,
        sequence: options.sequence,
        program: options.program,
        detail: options.detail,
      },
  )
}
