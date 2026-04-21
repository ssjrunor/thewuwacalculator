/*
  Author: Runor Ewhro
  Description: Applies runtime and skill data-driven effects by building
               effect contexts from combat state, evaluating conditions,
               and mutating buff pools or skill definitions.
*/

import { getGameData } from '@/data/gameData'
import { getResonatorDetailsById } from '@/data/gameData/resonators/resonatorDataStore'
import {
  listSourceEffects,
  listSourceRuntimeEffectsByStage,
} from '@/domain/gameData/registry'
import { buildTeamCompositionInfo } from '@/domain/gameData/teamComposition'
import type {
  EffectDefinition,
  EffectEvalScope,
  EffectOperation,
  EffectRuntimeContext,
} from '@/domain/gameData/contracts'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatGraph } from '@/domain/entities/combatGraph'
import { isUnsetWeaponId, type ResonatorRuntimeState } from '@/domain/entities/runtime'
import { computeEchoSetCounts } from '@/engine/pipeline/buildCombatContext'
import type { SlotId } from '@/domain/entities/session'
import type {
  FinalStats,
  ResonatorBaseStats,
  SkillDefinition,
  UnifiedBuffPool,
} from '@/domain/entities/stats'
import { evaluateCondition, evaluateFormula } from '@/engine/effects/evaluator'
import { effectTargetsRuntime } from '@/engine/effects/targetScope'
import { makeModBuff } from '@/engine/resolvers/buffPool'
import { getMainEchoSourceRef } from '@/domain/services/runtimeSourceService'

interface LegacyDataEffectOptions {
  teamRuntime?: ResonatorRuntimeState
  runtimesById?: Record<string, ResonatorRuntimeState>
  activeResonatorId?: string
  baseStats?: ResonatorBaseStats
  finalStats?: FinalStats
  sourceFinalStatsById?: Record<string, FinalStats>
  selectedTargetsByOwnerKey?: Record<string, string | null>
  enemy?: EnemyProfile
}

interface GraphDataEffectOptions {
  graph: CombatGraph
  targetSlotId: SlotId
  baseStats?: ResonatorBaseStats
  finalStats?: FinalStats
  sourceFinalStatsById?: Record<string, FinalStats>
  enemy?: EnemyProfile
}

type DataEffectOptions = LegacyDataEffectOptions | GraphDataEffectOptions

interface EffectContextEntry {
  baseContext: EffectRuntimeContext
  runtimePreStatsEffects: EffectDefinition[]
  runtimePostStatsEffects: EffectDefinition[]
  skillEffects: EffectDefinition[]
}

const graphEffectContextCache = new WeakMap<CombatGraph, Partial<Record<SlotId, EffectContextEntry[]>>>()

// check whether effect options use combat graph mode
function isGraphOptions(options: DataEffectOptions): options is GraphDataEffectOptions {
  return 'graph' in options
}

// resolve the source runtime for a given source id
function resolveSourceRuntime(
    sourceId: string,
    targetRuntime: ResonatorRuntimeState,
    teamRuntime: ResonatorRuntimeState,
    runtimesById: Record<string, ResonatorRuntimeState>,
): ResonatorRuntimeState | null {
  if (sourceId === targetRuntime.id) {
    return targetRuntime
  }

  if (sourceId === teamRuntime.id) {
    return teamRuntime
  }

  return runtimesById[sourceId] ?? null
}

function makeEffectContextEntry(baseContext: EffectRuntimeContext): EffectContextEntry {
  const registry = getGameData()

  return {
    baseContext,
    runtimePreStatsEffects: listSourceRuntimeEffectsByStage(registry, baseContext.source, 'preStats'),
    runtimePostStatsEffects: listSourceRuntimeEffectsByStage(registry, baseContext.source, 'postStats'),
    skillEffects: listSourceEffects(registry, baseContext.source, 'skill'),
  }
}

// build a weapon source context for a resonator context
function buildWeaponContext(
    resonatorContext: EffectRuntimeContext,
): EffectRuntimeContext | null {
  const weaponId = resonatorContext.sourceRuntime.build.weapon.id
  if (isUnsetWeaponId(weaponId)) {
    return null
  }

  return {
    ...resonatorContext,
    source: {
      type: 'weapon',
      id: weaponId,
    },
  }
}

// build a main echo source context for a resonator context
function buildEchoContext(
    resonatorContext: EffectRuntimeContext,
): EffectRuntimeContext | null {
  const echoSource = getMainEchoSourceRef(resonatorContext.sourceRuntime)
  if (!echoSource) {
    return null
  }

  return {
    ...resonatorContext,
    source: echoSource,
  }
}

// build echo set source contexts for a resonator context
function buildEchoSetContexts(
    resonatorContext: EffectRuntimeContext,
): EffectRuntimeContext[] {
  return Object.keys(resonatorContext.echoSetCounts).map((setId) => ({
    ...resonatorContext,
    source: { type: 'echoSet' as const, id: setId },
  }))
}

function buildGraphEffectContextEntries(
    graph: CombatGraph,
    targetSlotId: SlotId,
): EffectContextEntry[] {
  const cachedBySlot = graphEffectContextCache.get(graph)
  const cachedEntries = cachedBySlot?.[targetSlotId]
  if (cachedEntries) {
    return cachedEntries
  }

  const resonatorDetailsById = getResonatorDetailsById()
  const targetParticipant = graph.participants[targetSlotId]
  if (!targetParticipant) {
    return []
  }

  const activeParticipant = graph.participants[graph.activeSlotId] ?? targetParticipant
  const teamMemberIds = Array.from(
      new Set(Object.values(graph.participants).map((participant) => participant.resonatorId)),
  )
  const team = buildTeamCompositionInfo(teamMemberIds)

  const entries = Object.values(graph.participants).flatMap((sourceParticipant) => {
    const resonatorContext: EffectRuntimeContext = {
      team,
      source: {
        type: 'resonator',
        id: sourceParticipant.resonatorId,
        negativeEffectSources: resonatorDetailsById[sourceParticipant.resonatorId]?.negativeEffectSources,
      },
      target: {
        type: 'resonator',
        id: targetParticipant.resonatorId,
        negativeEffectSources: resonatorDetailsById[targetParticipant.resonatorId]?.negativeEffectSources,
      },
      sourceRuntime: sourceParticipant.runtime,
      targetRuntime: targetParticipant.runtime,
      activeRuntime: activeParticipant.runtime,
      targetRuntimeId: targetParticipant.resonatorId,
      activeResonatorId: activeParticipant.resonatorId,
      teamMemberIds,
      echoSetCounts: computeEchoSetCounts(sourceParticipant.runtime.build.echoes),
      selectedTargetsByOwnerKey: {
        ...sourceParticipant.slot.routing.selectedTargetsByOwnerKey,
      },
    }

    const contexts: EffectRuntimeContext[] = [
      resonatorContext,
      ...buildEchoSetContexts(resonatorContext),
    ]
    const weaponContext = buildWeaponContext(resonatorContext)
    const echoContext = buildEchoContext(resonatorContext)

    if (weaponContext) {
      contexts.push(weaponContext)
    }

    if (echoContext) {
      contexts.push(echoContext)
    }

    return contexts.map(makeEffectContextEntry)
  })

  const nextCachedBySlot = cachedBySlot ?? {}
  nextCachedBySlot[targetSlotId] = entries
  graphEffectContextCache.set(graph, nextCachedBySlot)
  return entries
}

function buildLegacyEffectContextEntries(
    targetRuntime: ResonatorRuntimeState,
    options: LegacyDataEffectOptions,
): EffectContextEntry[] {
  const resonatorDetailsById = getResonatorDetailsById()
  const teamRuntime = options.teamRuntime ?? targetRuntime
  const runtimesById = options.runtimesById ?? {}
  const activeResonatorId = options.activeResonatorId ?? targetRuntime.id
  const activeRuntime =
      resolveSourceRuntime(activeResonatorId, targetRuntime, teamRuntime, runtimesById) ?? targetRuntime

  const sourceIds = Array.from(
      new Set([
        teamRuntime.id,
        ...teamRuntime.build.team.filter((memberId): memberId is string => Boolean(memberId)),
      ]),
  )
  const team = buildTeamCompositionInfo(sourceIds)

  return sourceIds.flatMap((sourceId) => {
    const sourceRuntime = resolveSourceRuntime(sourceId, targetRuntime, teamRuntime, runtimesById)
    if (!sourceRuntime) {
      return []
    }

    const resonatorContext: EffectRuntimeContext = {
      team,
      source: {
        type: 'resonator',
        id: sourceId,
        negativeEffectSources: resonatorDetailsById[sourceId]?.negativeEffectSources,
      },
      target: {
        type: 'resonator',
        id: targetRuntime.id,
        negativeEffectSources: resonatorDetailsById[targetRuntime.id]?.negativeEffectSources,
      },
      sourceRuntime,
      targetRuntime,
      activeRuntime,
      targetRuntimeId: targetRuntime.id,
      activeResonatorId,
      teamMemberIds: sourceIds,
      echoSetCounts: computeEchoSetCounts(sourceRuntime.build.echoes),
      selectedTargetsByOwnerKey: options.selectedTargetsByOwnerKey,
    }

    const contexts: EffectRuntimeContext[] = [resonatorContext]
    const weaponContext = buildWeaponContext(resonatorContext)
    const echoContext = buildEchoContext(resonatorContext)

    if (weaponContext) {
      contexts.push(weaponContext)
    }

    if (echoContext) {
      contexts.push(echoContext)
    }

    return contexts.map(makeEffectContextEntry)
  })
}

// build all effect contexts relevant to a target runtime
function buildEffectContextEntries(
    targetRuntime: ResonatorRuntimeState,
    options: DataEffectOptions = {},
): EffectContextEntry[] {
  if (isGraphOptions(options)) {
    return buildGraphEffectContextEntries(options.graph, options.targetSlotId)
  }

  return buildLegacyEffectContextEntries(targetRuntime, options)
}

function buildDynamicContext(
    baseContext: EffectRuntimeContext,
    options: DataEffectOptions,
    pool?: UnifiedBuffPool,
): EffectRuntimeContext {
  return {
    ...baseContext,
    pool,
    baseStats: options.baseStats,
    sourceFinalStats: options.sourceFinalStatsById?.[baseContext.sourceRuntime.id],
    finalStats: options.finalStats,
    enemy: options.enemy,
  }
}

// build the evaluation scope used by formulas and conditions
function makeEvalScope(context: EffectRuntimeContext): EffectEvalScope {
  return {
    sourceRuntime: context.sourceRuntime,
    sourceFinalStats: context.sourceFinalStats,
    targetRuntime: context.targetRuntime,
    activeRuntime: context.activeRuntime,
    context,
    pool: context.pool,
    baseStats: context.baseStats,
    finalStats: context.finalStats,
  }
}

// apply one runtime operation to the shared buff pool
function applyRuntimeOperation(
    pool: UnifiedBuffPool,
    operation: EffectOperation,
    scope: EffectEvalScope,
): void {
  if (operation.type === 'scale_skill_multiplier') {
    return
  }

  const value = evaluateFormula(operation.value, scope)

  if (operation.type === 'add_base_stat') {
    pool[operation.stat][operation.field] += value
    return
  }

  if (operation.type === 'add_top_stat') {
    pool[operation.stat] += value
    return
  }

  if (operation.type === 'add_attribute_mod') {
    const attributes = Array.isArray(operation.attribute) ? operation.attribute : [operation.attribute]
    for (const attr of attributes) {
      pool.attribute[attr][operation.mod] += value
    }
    return
  }

  if (operation.type === 'add_skilltype_mod') {
    const skillTypes = Array.isArray(operation.skillType) ? operation.skillType : [operation.skillType]
    for (const st of skillTypes) {
      pool.skillType[st][operation.mod] += value
    }
    return
  }

  if (operation.type === 'add_negative_effect_mod') {
    const negativeEffects = Array.isArray(operation.negativeEffect)
        ? operation.negativeEffect
        : [operation.negativeEffect]

    for (const key of negativeEffects) {
      pool.negativeEffect[key][operation.mod] += value
    }
  }
}

// check whether a skill matches an operation's skill match rule
function skillMatchesRule(skill: SkillDefinition, operation: EffectOperation): boolean {
  if (
      operation.type !== 'scale_skill_multiplier' &&
      operation.type !== 'add_skill_mod' &&
      operation.type !== 'add_skill_multiplier' &&
      operation.type !== 'add_skill_hit_multiplier' &&
      operation.type !== 'add_skill_scalar'
  ) {
    return false
  }

  if (!operation.match) {
    return true
  }

  if (operation.match.skillIds && !operation.match.skillIds.includes(skill.id)) {
    return false
  }

  if (operation.match.tabs && !operation.match.tabs.includes(skill.tab)) {
    return false
  }

  if (
      operation.match.skillTypes &&
      !skill.skillType.some((type) => operation.match!.skillTypes!.includes(type))
  ) {
    return false
  }

  return true
}

// apply one skill operation to a skill definition
function applySkillOperation(
    skill: SkillDefinition,
    operation: EffectOperation,
    scope: EffectEvalScope,
): SkillDefinition {
  if (operation.type === 'add_skill_mod') {
    if (!skillMatchesRule(skill, operation)) {
      return skill
    }

    const value = evaluateFormula(operation.value, scope)

    return {
      ...skill,
      skillBuffs: {
        ...(skill.skillBuffs ?? makeModBuff()),
        [operation.mod]: (skill.skillBuffs?.[operation.mod] ?? 0) + value,
      },
    }
  }

  if (operation.type === 'add_skill_scalar') {
    if (!skillMatchesRule(skill, operation)) {
      return skill
    }

    const value = evaluateFormula(operation.value, scope)
    return {
      ...skill,
      [operation.field]: (skill[operation.field] ?? 0) + value,
    }
  }

  if (operation.type === 'add_skill_multiplier') {
    if (!skillMatchesRule(skill, operation)) {
      return skill
    }

    const addedMultiplier = evaluateFormula(operation.value, scope)
    const currentMultiplier = skill.multiplier

    if (currentMultiplier <= 0 || addedMultiplier === 0) {
      return skill
    }

    if (skill.hits.length === 0) {
      return {
        ...skill,
        multiplier: currentMultiplier + addedMultiplier,
      }
    }

    const multiplierScale = (currentMultiplier + addedMultiplier) / currentMultiplier
    const hits = skill.hits.map((hit) => ({
      ...hit,
      multiplier: hit.multiplier * multiplierScale,
    }))

    return {
      ...skill,
      multiplier: hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0),
      hits,
    }
  }

  if (operation.type === 'add_skill_hit_multiplier') {
    if (!skillMatchesRule(skill, operation)) {
      return skill
    }

    const addedMultiplier = evaluateFormula(operation.value, scope)
    if (addedMultiplier === 0 || operation.hitIndex < 0 || operation.hitIndex >= skill.hits.length) {
      return skill
    }

    const hits = skill.hits.map((hit, index) => (
      index === operation.hitIndex
        ? { ...hit, multiplier: hit.multiplier + addedMultiplier }
        : hit
    ))

    return {
      ...skill,
      multiplier: hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0),
      hits,
    }
  }

  if (operation.type !== 'scale_skill_multiplier') {
    return skill
  }

  if (!skillMatchesRule(skill, operation)) {
    return skill
  }

  const multiplierScale = evaluateFormula(operation.value, scope)

  if (skill.hits.length === 0) {
    return {
      ...skill,
      multiplier: skill.multiplier * multiplierScale,
    }
  }

  const hits = skill.hits.map((hit) => ({
    ...hit,
    multiplier: hit.multiplier * multiplierScale,
  }))

  return {
    ...skill,
    multiplier: hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0),
    hits,
  }
}

// apply runtime-triggered data effects to a unified buff pool
export function applyRuntimeDataEffects(
    runtime: ResonatorRuntimeState,
    baseBuffs: UnifiedBuffPool,
    options: DataEffectOptions = {},
    stage: 'preStats' | 'postStats' = 'preStats',
): UnifiedBuffPool {
  const next = baseBuffs

  for (const entry of buildEffectContextEntries(runtime, options)) {
    const effects = stage === 'postStats' ? entry.runtimePostStatsEffects : entry.runtimePreStatsEffects
    if (effects.length === 0) {
      continue
    }

    const context = buildDynamicContext(entry.baseContext, options, next)
    const scope = makeEvalScope(context)

    for (const effect of effects) {
      if (!effectTargetsRuntime(effect, context)) {
        continue
      }

      if (!evaluateCondition(effect.condition, scope)) {
        continue
      }

      for (const operation of effect.operations) {
        applyRuntimeOperation(next, operation, scope)
      }
    }
  }

  return next
}

// apply skill-triggered data effects to a skill definition
export function applySkillDataEffects(
    runtime: ResonatorRuntimeState,
    baseSkill: SkillDefinition,
    options: DataEffectOptions = {},
): SkillDefinition {
  let next = baseSkill

  for (const entry of buildEffectContextEntries(runtime, options)) {
    if (entry.skillEffects.length === 0) {
      continue
    }

    const context = buildDynamicContext(entry.baseContext, options)
    const scope = makeEvalScope(context)

    for (const effect of entry.skillEffects) {
      if (!effectTargetsRuntime(effect, context)) {
        continue
      }

      if (!evaluateCondition(effect.condition, scope)) {
        continue
      }

      for (const operation of effect.operations) {
        next = applySkillOperation(next, operation, scope)
      }
    }
  }

  return next
}
