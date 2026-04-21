/*
  Author: Runor Ewhro
  Description: builds a runtime combat context and prepares runtime skills by
               resolving base skill data and then applying combat-dependent
               skill effects for a specific active runtime.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatGraph } from '@/domain/entities/combatGraph'
import type { ResonatorRuntimeState, ResonatorSeed } from '@/domain/entities/runtime'
import type { SkillDefinition } from '@/domain/entities/stats'
import type { CombatContext } from '@/engine/pipeline/types'
import { buildTransientCombatGraph } from '@/domain/state/combatGraph'
import { buildCombatContext } from '@/engine/pipeline/buildCombatContext'
import { listRuntimeSkills } from '@/domain/services/runtimeSourceService'
import { applySkillDataEffects } from '@/engine/effects/dataEffects'
import { resolveSkill } from '@/engine/pipeline/resolveSkill'

const preparedSkillCache = new WeakMap<CombatGraph, WeakMap<EnemyProfile, Map<string, SkillDefinition>>>()

interface RuntimeSkillContextInput {
  // active runtime whose skills are being prepared
  runtime: ResonatorRuntimeState

  // resonator seed used to build the transient combat graph
  seed: ResonatorSeed

  // enemy profile used for stat and damage context resolution
  enemy: EnemyProfile

  // optional additional participant runtimes keyed by resonator id
  runtimesById?: Record<string, ResonatorRuntimeState>

  // optional selected-target mapping for the active resonator
  selectedTargetsByOwnerKey?: Record<string, string | null>
}

interface RuntimeSkillContextResult {
  // fully resolved combat context for the active runtime
  context: CombatContext
}

export interface PreparedRuntimeSkillResult extends RuntimeSkillContextResult {
  // prepared skill after runtime resolution and skill-data effects
  skill: SkillDefinition
}

function makePreparedSkillCacheKey(
    runtimeId: string,
    targetSlotId: CombatContext['targetSlotId'],
    skillId: string,
): string {
  return `${targetSlotId}:${runtimeId}:${skillId}`
}

function getPreparedSkillCache(
    context: CombatContext,
): Map<string, SkillDefinition> {
  let cacheByEnemy = preparedSkillCache.get(context.graph)
  if (!cacheByEnemy) {
    cacheByEnemy = new WeakMap<EnemyProfile, Map<string, SkillDefinition>>()
    preparedSkillCache.set(context.graph, cacheByEnemy)
  }

  let cache = cacheByEnemy.get(context.enemy)
  if (!cache) {
    cache = new Map<string, SkillDefinition>()
    cacheByEnemy.set(context.enemy, cache)
  }

  return cache
}

// build a transient combat graph around the active runtime and return the
// resolved combat context for the active slot
export function buildRuntimeSkillContext({
                                           runtime,
                                           seed,
                                           enemy,
                                           runtimesById = {},
                                           selectedTargetsByOwnerKey = {},
                                         }: RuntimeSkillContextInput): RuntimeSkillContextResult {
  const graph = buildTransientCombatGraph({
    activeRuntime: runtime,
    activeSeed: seed,
    participantRuntimes: runtimesById,
    selectedTargetsByResonatorId: {
      [runtime.id]: selectedTargetsByOwnerKey,
    },
  })

  return {
    context: buildCombatContext({
      graph,
      targetSlotId: 'active',
      enemy,
    }),
  }
}

// resolve a skill against the runtime first, then apply skill-specific
// data effects using the already-built combat context
export function prepareRuntimeSkill(
    runtime: ResonatorRuntimeState,
    skill: SkillDefinition,
    context: CombatContext,
): SkillDefinition {
  const cache = getPreparedSkillCache(context)
  const cacheKey = makePreparedSkillCacheKey(runtime.id, context.targetSlotId, skill.id)
  const cached = cache.get(cacheKey)
  if (cached) {
    return cached
  }

  const prepared = applySkillDataEffects(runtime, resolveSkill(runtime, skill), {
    graph: context.graph,
    targetSlotId: context.targetSlotId,
    baseStats: context.baseStats,
    finalStats: context.finalStats,
    enemy: context.enemy,
  })

  cache.set(cacheKey, prepared)
  return prepared
}

// locate one runtime skill by id, prepare it, and hide it from callers if
// the prepared result is explicitly marked invisible
export function prepareRuntimeSkillById(
    runtime: ResonatorRuntimeState,
    skillId: string,
    context: CombatContext,
): SkillDefinition | null {
  const skill = listRuntimeSkills(runtime).find((entry) => entry.id === skillId)
  if (!skill) {
    return null
  }

  const prepared = prepareRuntimeSkill(runtime, skill, context)
  return prepared.visible === false ? null : prepared
}

// convenience helper that builds the combat context and prepares one skill id
// in a single call
export function buildPreparedRuntimeSkill(
    params: RuntimeSkillContextInput & { skillId: string },
): PreparedRuntimeSkillResult | null {
  const { runtime, skillId } = params
  const { context } = buildRuntimeSkillContext(params)
  const skill = prepareRuntimeSkillById(runtime, skillId, context)

  if (!skill) {
    return null
  }

  return {
    context,
    skill,
  }
}
