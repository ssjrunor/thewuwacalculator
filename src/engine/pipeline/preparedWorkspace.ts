/*
  Author: Runor Ewhro
  Description: builds the canonical prepared main surface used by
               calculator stages, overview summaries, and live simulations.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatGraph } from '@/domain/entities/combatGraph'
import type { ResRuntime, ResSeed } from '@/domain/entities/runtime'
import { findCombatPart, makeCombatGraph } from '@/domain/state/combatGraph'
import { makeRuntimeCat, type PrepRtCat } from '@/domain/services/runtimeSourceService'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext'
import { prprRtSkll } from '@/engine/pipeline/prepareRuntimeSkill'
import { smltRot } from '@/engine/pipeline/simulateRotation'
import type { CombatContext, SimResult } from '@/engine/pipeline/types'
import type { SkillDef } from '@/domain/entities/stats'
import type { SlotId } from '@/domain/entities/session'
import type { DamageFeature } from '@/domain/gameData/contracts'
import {
  mkDrctFeatRs,
  mkPrepRotNvr,
  type PrepRotNvrn,
  type RotSimulationDetail,
  type RotSimulationMode,
} from '@/engine/rotation/system'

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
  rotNvrn: PrepRotNvrn | null
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

// build one combat context for every participant so multiple calculator surfaces
// can reuse them without rebuilding the graph repeatedly
function mkCntx(
    graph: CombatGraph,
    enemy: EnemyProfile,
): Pick<PrepWork, 'cntxBySlotId' | 'cntxByResId'> {
  const cntxBySlotId: Partial<Record<SlotId, CombatContext>> = {}
  const cntxByResId: Record<string, CombatContext> = {}

  for (const participant of Object.values(graph.participants)) {
    const context = makeCombatEnv({
      graph,
      targetSlotId: participant.slotId,
      enemy,
    })

    cntxBySlotId[participant.slotId] = context
    cntxByResId[participant.resonatorId] = context
  }

  return {
    cntxBySlotId: cntxBySlotId,
    cntxByResId: cntxByResId,
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
  const { cntxBySlotId: cntxBySlotId, cntxByResId: cntxByResId } = mkCntx(graph, enemy)
  const activeContext = activeSlotId ? cntxBySlotId[activeSlotId] ?? null : null
  const actCat = makeRuntimeCat(runtime, seed)
  // split direct feature output out here so overview, damage, and rotation
  // surfaces can all reuse the same expensive direct computation
  const drctFeats = activeContext && seed ? mkDrctFeatRs(activeContext, seed) : []
  const directOutput = activeContext
      ? {
        finalStats: activeContext.finalStats,
        allFeatures: drctFeats,
        allSkills: drctFeats.filter((entry) => entry.feature.variant !== 'subHit'),
      }
      : null
  const rotNvrn = activeContext && seed
      ? mkPrepRotNvr(activeContext, seed)
      : null

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
    cntxBySlotId: cntxBySlotId,
    cntxByResId: cntxByResId,
    actCat: actCat,
    visSkll: mkVsblSkll(runtime, activeContext, actCat),
    directOutput,
    rotNvrn: rotNvrn,
  }
}

// run the full simulation from a previously prepared workspace snapshot
export function runPrepWorkS(
    prepared: PrepWork,
    options: {
      mode?: RotSimulationMode
      detail?: RotSimulationDetail
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
        mode: options.mode,
        detail: options.detail,
      },
  )
}
