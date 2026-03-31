/*
  Author: Runor Ewhro
  Description: builds the canonical prepared workspace surface used by
               calculator stages, overview summaries, and live simulations.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatGraph } from '@/domain/entities/combatGraph'
import type { ResonatorRuntimeState, ResonatorSeed } from '@/domain/entities/runtime'
import { findCombatParticipantSlotId, buildTransientCombatGraph } from '@/domain/state/combatGraph'
import { buildPreparedRuntimeCatalog, type PreparedRuntimeCatalog } from '@/domain/services/runtimeSourceService'
import { buildCombatContext } from '@/engine/pipeline/buildCombatContext'
import { prepareRuntimeSkill } from '@/engine/pipeline/prepareRuntimeSkill'
import { simulateRotation } from '@/engine/pipeline/simulateRotation'
import type { CombatContext, SimulationResult } from '@/engine/pipeline/types'
import type { SkillDefinition } from '@/domain/entities/stats'
import type { SlotId } from '@/domain/entities/session'
import type { DamageFeatureResult } from '@/domain/gameData/contracts'
import {
  buildDirectFeatureResults,
  buildPreparedRotationEnvironment,
  type PreparedRotationEnvironment,
} from '@/engine/rotation/system'

export interface PreparedDirectOutput {
  finalStats: CombatContext['finalStats']
  allFeatures: DamageFeatureResult[]
  allSkills: DamageFeatureResult[]
}

export interface PreparedWorkspace {
  revision: number
  enemy: EnemyProfile
  activeRuntime: ResonatorRuntimeState | null
  activeSeed: ResonatorSeed | null
  participantRuntimesById: Record<string, ResonatorRuntimeState>
  activeTargetSelections: Record<string, string | null>
  combatGraph: CombatGraph | null
  activeSlotId: SlotId | null
  activeContext: CombatContext | null
  contextsBySlotId: Partial<Record<SlotId, CombatContext>>
  contextsByResonatorId: Record<string, CombatContext>
  activeCatalog: PreparedRuntimeCatalog | null
  visibleSkills: SkillDefinition[]
  directOutput: PreparedDirectOutput | null
  rotationEnvironment: PreparedRotationEnvironment | null
}

interface BuildPreparedWorkspaceInput {
  revision?: number
  runtime: ResonatorRuntimeState | null
  seed?: ResonatorSeed | null
  enemy: EnemyProfile
  participantRuntimesById?: Record<string, ResonatorRuntimeState>
  activeTargetSelections?: Record<string, string | null>
  combatGraph?: CombatGraph | null
}

function buildContexts(
    graph: CombatGraph,
    enemy: EnemyProfile,
): Pick<PreparedWorkspace, 'contextsBySlotId' | 'contextsByResonatorId'> {
  const contextsBySlotId: Partial<Record<SlotId, CombatContext>> = {}
  const contextsByResonatorId: Record<string, CombatContext> = {}

  for (const participant of Object.values(graph.participants)) {
    const context = buildCombatContext({
      graph,
      targetSlotId: participant.slotId,
      enemy,
    })

    contextsBySlotId[participant.slotId] = context
    contextsByResonatorId[participant.resonatorId] = context
  }

  return {
    contextsBySlotId,
    contextsByResonatorId,
  }
}

function buildVisibleSkills(
    runtime: ResonatorRuntimeState | null,
    context: CombatContext | null,
    catalog: PreparedRuntimeCatalog | null,
): SkillDefinition[] {
  if (!runtime || !context || !catalog) {
    return []
  }

  return catalog.skills.flatMap((skill) => {
    const prepared = prepareRuntimeSkill(runtime, skill, context)
    return prepared.visible === false ? [] : [prepared]
  })
}

export function buildPreparedWorkspace({
  revision = 0,
  runtime,
  seed = null,
  enemy,
  participantRuntimesById = {},
  activeTargetSelections = {},
  combatGraph = null,
}: BuildPreparedWorkspaceInput): PreparedWorkspace {
  if (!runtime) {
    return {
      revision,
      enemy,
      activeRuntime: null,
      activeSeed: seed,
      participantRuntimesById,
      activeTargetSelections,
      combatGraph: null,
      activeSlotId: null,
      activeContext: null,
      contextsBySlotId: {},
      contextsByResonatorId: {},
      activeCatalog: null,
      visibleSkills: [],
      directOutput: null,
      rotationEnvironment: null,
    }
  }

  const graph = combatGraph?.participants
      ? combatGraph
      : buildTransientCombatGraph({
        activeRuntime: runtime,
        activeSeed: seed ?? undefined,
        participantRuntimes: participantRuntimesById,
        selectedTargetsByResonatorId: {
          [runtime.id]: activeTargetSelections,
        },
      })

  const activeSlotId = findCombatParticipantSlotId(graph, runtime.id) ?? graph.activeSlotId
  const { contextsBySlotId, contextsByResonatorId } = buildContexts(graph, enemy)
  const activeContext = activeSlotId ? contextsBySlotId[activeSlotId] ?? null : null
  const activeCatalog = buildPreparedRuntimeCatalog(runtime, seed)
  const directFeatures = activeContext && seed ? buildDirectFeatureResults(activeContext, seed) : []
  const directOutput = activeContext
      ? {
        finalStats: activeContext.finalStats,
        allFeatures: directFeatures,
        allSkills: directFeatures.filter((entry) => entry.feature.variant !== 'subHit'),
      }
      : null
  const rotationEnvironment = activeContext && seed
      ? buildPreparedRotationEnvironment(activeContext, seed)
      : null

  return {
    revision,
    enemy,
    activeRuntime: runtime,
    activeSeed: seed,
    participantRuntimesById,
    activeTargetSelections,
    combatGraph: graph,
    activeSlotId,
    activeContext,
    contextsBySlotId,
    contextsByResonatorId,
    activeCatalog,
    visibleSkills: buildVisibleSkills(runtime, activeContext, activeCatalog),
    directOutput,
    rotationEnvironment,
  }
}

export function runPreparedWorkspaceSimulation(
    prepared: PreparedWorkspace,
): SimulationResult | null {
  if (!prepared.activeContext || !prepared.activeSeed || !prepared.activeRuntime) {
    return null
  }

  return simulateRotation(
      prepared.activeContext,
      prepared.activeSeed,
      prepared.participantRuntimesById,
      {
        directOutput: prepared.directOutput,
        rotationEnvironment: prepared.rotationEnvironment,
      },
  )
}
