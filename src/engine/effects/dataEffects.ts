/*
  Author: Runor Ewhro
  Description: Applies runtime and skill data-driven effects by building
               effect contexts from combat state, evaluating conditions,
               and mutating buff pools or skill definitions.
*/

import { getGameData } from '@/data/gameData'
import { getResonatorDetailsById } from '@/data/gameData/resonators/resonatorDataStore'
import { listSourceEffects } from '@/domain/gameData/registry'
import { buildTeamCompositionInfo } from '@/domain/gameData/teamComposition'
import type {
  DataSourceRef,
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

// build selected target routing for a source participant from the graph
function buildSelectedTargetsByOwnerKey(
    graph: CombatGraph,
    sourceResonatorId: string,
): Record<string, string | null> {
  const sourceParticipant = Object.values(graph.participants).find(
      (participant) => participant.resonatorId === sourceResonatorId,
  )

  if (!sourceParticipant) {
    return {}
  }

  return { ...sourceParticipant.slot.routing.selectedTargetsByOwnerKey }
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
  const echoId = resonatorContext.sourceRuntime.build.echoes[0]?.id
  if (!echoId) {
    return null
  }

  return {
    ...resonatorContext,
    source: {
      type: 'echo',
      id: echoId,
    },
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

// build all effect contexts relevant to a target runtime
function buildEffectContexts(
    targetRuntime: ResonatorRuntimeState,
    options: DataEffectOptions = {},
): EffectRuntimeContext[] {
  const resonatorDetailsById = getResonatorDetailsById()

  if (isGraphOptions(options)) {
    const targetParticipant = options.graph.participants[options.targetSlotId]
    if (!targetParticipant) {
      return []
    }

    const activeParticipant =
        options.graph.participants[options.graph.activeSlotId] ?? targetParticipant

    const teamMemberIds = Array.from(
        new Set(Object.values(options.graph.participants).map((participant) => participant.resonatorId)),
    )
    const team = buildTeamCompositionInfo(teamMemberIds)

    return Object.values(options.graph.participants).flatMap((sourceParticipant) => {
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
        baseStats: options.baseStats,
        sourceFinalStats: options.sourceFinalStatsById?.[sourceParticipant.resonatorId],
        finalStats: options.finalStats,
        selectedTargetsByOwnerKey: buildSelectedTargetsByOwnerKey(
            options.graph,
            sourceParticipant.resonatorId,
        ),
        enemy: options.enemy,
      }

      const weaponContext = buildWeaponContext(resonatorContext)
      const echoContext = buildEchoContext(resonatorContext)
      const echoSetContexts = buildEchoSetContexts(resonatorContext)

      return [
        resonatorContext,
        ...(weaponContext ? [weaponContext] : []),
        ...(echoContext ? [echoContext] : []),
        ...echoSetContexts,
      ]
    })
  }

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
      baseStats: options.baseStats,
      sourceFinalStats: options.sourceFinalStatsById?.[sourceId],
      finalStats: options.finalStats,
      selectedTargetsByOwnerKey: options.selectedTargetsByOwnerKey,
      enemy: options.enemy,
    }

    const weaponContext = buildWeaponContext(resonatorContext)
    const echoContext = buildEchoContext(resonatorContext)

    return [
      resonatorContext,
      ...(weaponContext ? [weaponContext] : []),
      ...(echoContext ? [echoContext] : []),
    ]
  })
}

// build the evaluation scope used by formulas and conditions
function makeEvalScope(
    context: EffectRuntimeContext,
    options: Pick<DataEffectOptions, 'baseStats' | 'finalStats'> = {},
): EffectEvalScope {
  return {
    sourceRuntime: context.sourceRuntime,
    sourceFinalStats: context.sourceFinalStats,
    targetRuntime: context.targetRuntime,
    activeRuntime: context.activeRuntime,
    context,
    pool: context.pool,
    baseStats: options.baseStats ?? context.baseStats,
    finalStats: options.finalStats ?? context.finalStats,
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

// list effects for a source and trigger
function listScopedEffects(source: DataSourceRef, trigger: 'runtime' | 'skill') {
  return listSourceEffects(getGameData(), source, trigger)
}

// apply runtime-triggered data effects to a unified buff pool
export function applyRuntimeDataEffects(
    runtime: ResonatorRuntimeState,
    baseBuffs: UnifiedBuffPool,
    options: DataEffectOptions = {},
    stage: 'preStats' | 'postStats' = 'preStats',
): UnifiedBuffPool {
  const next = baseBuffs

  for (const baseContext of buildEffectContexts(runtime, options)) {
    const context = {
      ...baseContext,
      pool: next,
    }
    const effects = listScopedEffects(context.source, 'runtime')
    const scope = makeEvalScope(context, options)

    for (const effect of effects) {
      if ((effect.stage ?? 'preStats') !== stage) {
        continue
      }

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

  for (const context of buildEffectContexts(runtime, options)) {
    const effects = listScopedEffects(context.source, 'skill')
    const scope = makeEvalScope(context, options)

    for (const effect of effects) {
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
