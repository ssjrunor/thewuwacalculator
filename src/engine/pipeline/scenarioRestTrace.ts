/*
  Author: Runor Ewhro
  Description: Resolves a scenario's non-rotation combat state into one
               provenance-preserving effect graph for future tree and web UIs.
*/

import type {
  CombatScenario,
  EnvironmentManualEffect,
  ScenarioTeamMember,
  TeamMemberId,
} from '@/domain/entities/combatScenario'
import type { MnlMod } from '@/domain/entities/manualBuffs'
import type {
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
} from '@/domain/entities/scenarioRestTrace'
import type {
  DataSrcRef,
  EffectContext,
  EffectDef,
  EffectOp,
  EffectScope,
  SourceState,
  SrcOwnDef,
} from '@/domain/gameData/contracts'
import { getSrcSttNct } from '@/domain/gameData/controlOptions'
import { NEG_EFFECT_CATS, type NegEffectKey } from '@/domain/gameData/negativeEffects'
import { readRtPath } from '@/domain/gameData/runtimePath'
import {
  getOwnForKey,
  listEffectsFor,
  listStatesFor,
} from '@/domain/services/gameDataService'
import {
  isStateEnabled,
  isStateVisible,
} from '@/domain/services/sourceStateService'
import { findCombatPartByMemberId } from '@/domain/state/combatGraph'
import {
  environmentSelectorMatches,
} from '@/domain/state/scenarioEnvironment'
import { evalCond, evalForm } from '@/engine/effects/evaluator'
import { listGraphEffectRows } from '@/engine/effects/dataEffects'
import { ffctTrgtRt } from '@/engine/effects/targetScope'
import {
  prepareCombatScenario,
  type PreparedCombatScenario,
} from '@/engine/pipeline/combatScenario'

function isTargetEffect(effect: ScenarioRestEffect): effect is ScenarioRestTargetEffect {
  return effect.destination.kind === 'target'
}

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
} from '@/domain/entities/scenarioRestTrace'

type RestSurface = 'member' | 'target'

interface PendingTargetEffect {
  base: Omit<ScenarioRestTargetEffect, 'beneficiaries' | 'stateIds'>
  beneficiaries: ScenarioRestTargetBenefit[]
}

const TARGET_MODIFIERS = new Set(['defShred', 'resShred', 'dmgVuln'])
const TARGET_NODE_ID = 'target'

function memberNodeId(memberId: TeamMemberId): ScenarioRestNodeId {
  return `member:${memberId}`
}

function memberSourceNodeId(
  memberId: TeamMemberId,
  source: DataSrcRef,
): ScenarioRestNodeId {
  return `source:${memberId}:${source.type}:${source.id}`
}

function targetSourceNodeId(targetId: string): ScenarioRestNodeId {
  return `source:target:enemy:${targetId}`
}

function environmentNodeId(sourceId: string): ScenarioRestNodeId {
  return `source:environment:${sourceId}`
}

function operationSurface(operation: EffectOp | MnlMod): RestSurface {
  if ('type' in operation) {
    if (operation.type === 'add_immunity') return 'target'
    if (operation.type === 'add_top_stat') {
      return TARGET_MODIFIERS.has(operation.stat) ? 'target' : 'member'
    }
    if (
      operation.type === 'add_attribute_mod'
      || operation.type === 'add_skilltype_mod'
      || operation.type === 'add_skill_mod'
    ) {
      return TARGET_MODIFIERS.has(operation.mod) ? 'target' : 'member'
    }
    return 'member'
  }

  if (operation.scope === 'topStat') {
    return TARGET_MODIFIERS.has(operation.stat) ? 'target' : 'member'
  }
  if (
    operation.scope === 'attribute'
    || operation.scope === 'skillType'
    || (operation.scope === 'skill' && operation.effect === 'mod')
  ) {
    return TARGET_MODIFIERS.has(operation.mod) ? 'target' : 'member'
  }
  return 'member'
}

function gameOperationPath(operation: EffectOp, qualifier?: string): string {
  const surface = operationSurface(operation)
  const root = surface === 'target' ? 'target' : 'member'
  if (operation.type === 'add_base_stat') {
    return `${root}.baseStats.${operation.stat}.${operation.field}`
  }
  if (operation.type === 'set_final_stat') {
    return `${root}.finalStats.${operation.stat}`
  }
  if (operation.type === 'add_immunity') {
    return `${root}.immunities.${operation.scope.target}`
  }
  if (operation.type === 'add_top_stat') {
    return `${root}.buffs.${operation.stat}`
  }
  if (operation.type === 'add_attribute_mod') {
    return `${root}.buffs.attribute.${qualifier ?? String(operation.attribute)}.${operation.mod}`
  }
  if (operation.type === 'add_skilltype_mod') {
    return `${root}.buffs.skillType.${qualifier ?? String(operation.skillType)}.${operation.mod}`
  }
  if (operation.type === 'add_negative_effect_mod') {
    return `${root}.buffs.negativeEffect.${qualifier ?? String(operation.negativeEffect)}.${operation.mod}`
  }
  if (operation.type === 'add_skill_mod') {
    return `${root}.skills.match.${operation.mod}`
  }
  if (operation.type === 'add_skill_multiplier') {
    return `${root}.skills.match.multiplier`
  }
  if (operation.type === 'add_skill_hit_multiplier') {
    return `${root}.skills.match.hits.${operation.hitIndex}.multiplier`
  }
  if (operation.type === 'add_skill_scalar') {
    return `${root}.skills.match.${operation.field}`
  }
  return `${root}.skills.match.multiplierScale`
}

function makeEffectScope(context: EffectContext): EffectScope {
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

function resolveGameOperations(
  effect: EffectDef,
  context: EffectContext,
): ScenarioRestOperation[] {
  const scope = makeEffectScope(context)
  const operations: ScenarioRestOperation[] = []

  effect.operations.forEach((operation, operationIndex) => {
    // Skill-triggered mutations need a concrete skill and are deliberately not
    // part of a scenario rest-state trace.
    if (
      operation.type === 'add_skill_mod'
      || operation.type === 'add_skill_multiplier'
      || operation.type === 'add_skill_hit_multiplier'
      || operation.type === 'add_skill_scalar'
      || operation.type === 'scale_skill_multiplier'
    ) {
      return
    }

    if (operation.type === 'add_immunity') {
      operations.push({
        id: `${effect.id}:operation:${operationIndex}`,
        operationIndex,
        path: gameOperationPath(operation),
        value: true,
        definition: { kind: 'gameData', operation: structuredClone(operation) },
      })
      return
    }

    const value = evalForm(operation.value, scope)
    if (!Number.isFinite(value) || value === 0) return
    const qualifiers = operation.type === 'add_attribute_mod'
      ? (Array.isArray(operation.attribute) ? operation.attribute : [operation.attribute])
      : operation.type === 'add_skilltype_mod'
        ? (Array.isArray(operation.skillType) ? operation.skillType : [operation.skillType])
        : operation.type === 'add_negative_effect_mod'
          ? (Array.isArray(operation.negativeEffect) ? operation.negativeEffect : [operation.negativeEffect])
          : [undefined]

    qualifiers.forEach((qualifier, qualifierIndex) => {
      operations.push({
        id: `${effect.id}:operation:${operationIndex}:${qualifierIndex}`,
        operationIndex,
        path: gameOperationPath(operation, qualifier),
        value,
        definition: { kind: 'gameData', operation: structuredClone(operation) },
      })
    })
  })

  return operations
}

function isCurrentState(
  state: SourceState,
  context: EffectContext,
): { active: boolean; value: boolean | number | string } {
  const fallback = getSrcSttNct(
    context.sourceRuntime,
    context.targetRuntime,
    state,
    context.activeRuntime,
  )
  const raw = readRtPath(context.sourceRuntime, state.path)
  const value = (raw ?? fallback) as boolean | number | string

  if (state.kind === 'toggle') return { active: value === true, value }
  if (state.kind === 'select') {
    const normalized = value == null ? '' : String(value)
    const defaultValue = state.defaultValue == null ? '' : String(state.defaultValue)
    return { active: normalized !== '' && normalized !== defaultValue, value: normalized }
  }

  const numericValue = typeof value === 'number' ? value : Number(value)
  const defaultValue = typeof state.defaultValue === 'number'
    ? state.defaultValue
    : Number(state.defaultValue ?? 0)
  return {
    active: Number.isFinite(numericValue) && numericValue !== 0 && numericValue !== defaultValue,
    value: Number.isFinite(numericValue) ? numericValue : 0,
  }
}

function effectResolution(
  scenario: CombatScenario,
  sourceMember: ScenarioTeamMember,
  effect: EffectDef,
): ScenarioRestResolution {
  const targetScope = effect.targetScope ?? 'self'
  if (targetScope === 'self') return { kind: 'self' }
  if (targetScope === 'teamWide') return { kind: 'teamWide' }
  if (targetScope === 'otherTeammates') return { kind: 'otherTeammates' }

  const route = effect.ownerKey
    ? scenario.environment.routing.bySourceMemberId[sourceMember.id]?.[effect.ownerKey]
    : undefined
  if (route) return { kind: 'explicitRoute', targetMemberId: route }

  const fallback = targetScope === 'activeOther'
    && scenario.initialOnFieldMemberId === sourceMember.id
    ? scenario.team.members.find((member) => member.id !== sourceMember.id)?.id
    : scenario.initialOnFieldMemberId

  return {
    kind: 'initialOnFieldFallback',
    targetMemberId: fallback ?? scenario.initialOnFieldMemberId,
  }
}

function manualOperationPath(modifier: MnlMod): string {
  const root = operationSurface(modifier) === 'target' ? 'target' : 'member'
  if (modifier.scope === 'baseStat') {
    return `${root}.baseStats.${modifier.stat}.${modifier.field}`
  }
  if (modifier.scope === 'topStat') {
    return `${root}.buffs.${modifier.stat}`
  }
  if (modifier.scope === 'attribute') {
    return `${root}.buffs.attribute.${modifier.attribute}.${modifier.mod}`
  }
  if (modifier.scope === 'skillType') {
    return `${root}.buffs.skillType.${modifier.skillType}.${modifier.mod}`
  }
  if (modifier.scope === 'negativeEffect') {
    return `${root}.buffs.negativeEffect.${modifier.negativeEffect}.${modifier.mod}`
  }
  return `${root}.skills.${modifier.matchMode}.${modifier.effect}`
}

function resolveManualOperations(effect: EnvironmentManualEffect): ScenarioRestOperation[] {
  const operations: ScenarioRestOperation[] = []
  const pushQuick = (
    stat: Extract<ScenarioRestOperationDefinition, { kind: 'manualQuick' }>['stat'],
    value: number,
    field?: 'flat' | 'percent',
  ) => {
    if (!Number.isFinite(value) || value === 0) return
    const suffix = field ? `.${field}` : ''
    operations.push({
      id: `${effect.id}:quick:${stat}${suffix}`,
      operationIndex: operations.length,
      path: `member.buffs.${stat}${suffix}`,
      value,
      definition: { kind: 'manualQuick', stat, field },
    })
  }

  pushQuick('atk', effect.buffs.quick.atk.flat, 'flat')
  pushQuick('atk', effect.buffs.quick.atk.percent, 'percent')
  pushQuick('hp', effect.buffs.quick.hp.flat, 'flat')
  pushQuick('hp', effect.buffs.quick.hp.percent, 'percent')
  pushQuick('def', effect.buffs.quick.def.flat, 'flat')
  pushQuick('def', effect.buffs.quick.def.percent, 'percent')
  pushQuick('critRate', effect.buffs.quick.critRate)
  pushQuick('critDmg', effect.buffs.quick.critDmg)
  pushQuick('energyRegen', effect.buffs.quick.energyRegen)
  pushQuick('healingBonus', effect.buffs.quick.healingBonus)

  for (const modifier of effect.buffs.modifiers) {
    if (
      !modifier.enabled
      || !Number.isFinite(modifier.value)
      || modifier.value === 0
      || modifier.scope === 'skill'
    ) {
      continue
    }
    operations.push({
      id: `${effect.id}:modifier:${modifier.id}`,
      operationIndex: operations.length,
      path: manualOperationPath(modifier),
      value: modifier.value,
      definition: { kind: 'manualModifier', modifier: structuredClone(modifier) },
    })
  }

  return operations
}

function targetModifierOperations(
  scenario: CombatScenario,
): ScenarioRestOperation[] {
  const modifiers = scenario.environment.targetModifiers
  const operations: ScenarioRestOperation[] = []
  const push = (
    modifier: Extract<ScenarioRestOperationDefinition, { kind: 'environmentTargetModifier' }>['modifier'],
    value: number,
    attribute?: string,
  ) => {
    if (!Number.isFinite(value) || value === 0) return
    operations.push({
      id: `environment:target:${modifier}:${attribute ?? 'all'}`,
      operationIndex: operations.length,
      path: attribute
        ? `target.buffs.attribute.${attribute}.resShred`
        : modifier === 'defenseReduction'
          ? 'target.buffs.defShred'
          : 'target.buffs.dmgVuln',
      value,
      definition: { kind: 'environmentTargetModifier', modifier, attribute },
    })
  }

  push('defenseReduction', modifiers.defenseReduction)
  for (const [attribute, value] of Object.entries(modifiers.resistanceReduction)) {
    push('resistanceReduction', value ?? 0, attribute)
  }
  push('damageTakenAmplification', modifiers.damageTakenAmplification)
  return operations
}

function addIndex(index: Record<string, string[]>, key: string, value: string): void {
  const values = index[key] ?? (index[key] = [])
  if (!values.includes(value)) values.push(value)
}

type RestEffectDefinition = EffectDef | Pick<EffectDef, 'id' | 'label' | 'ownerKey'>

function cloneEffectDefinition(effect: RestEffectDefinition): EffectDef | null {
  return 'operations' in effect ? structuredClone(effect) : null
}

function cloneOwner(ownerKey: string | undefined): SrcOwnDef | null {
  if (!ownerKey) return null
  const owner = getOwnForKey(ownerKey)
  return owner ? structuredClone(owner) : null
}

function activeTargetStates(scenario: CombatScenario): ScenarioRestTargetState[] {
  const states: ScenarioRestTargetState[] = []
  for (const [key, value] of Object.entries(scenario.environment.combatState)) {
    if (value === 0) continue
    states.push({
      id: `target-state:environment:${key}`,
      source: 'environmentCombat',
      key,
      label: NEG_EFFECT_CATS[key as NegEffectKey]?.label ?? key,
      value,
      definition: null,
    })
  }

  const definitions = new Map(
    listStatesFor('enemy', scenario.target.id).map((state) => [state.path, state]),
  )
  for (const [key, value] of Object.entries(scenario.target.status ?? {})) {
    const definition = definitions.get(`enemy.status.${key}`) ?? null
    const defaultValue = definition?.defaultValue
    if (value === false || value === 0 || value === '' || value === defaultValue) continue
    states.push({
      id: `target-state:enemy:${key}`,
      source: 'enemyStatus',
      key,
      label: definition?.label ?? key,
      value,
      definition,
    })
  }
  return states
}

/** Resolve a prepared scenario without running or mutating its rotation program. */
export function tracePreparedRestState(
  prepared: PreparedCombatScenario,
): ScenarioRestStateTrace {
  const { scenario } = prepared
  const graph = prepared.workspace.combatGraph
  if (!graph) throw new Error('A scenario rest trace requires a prepared combat graph')

  const nodes = new Map<ScenarioRestNodeId, ScenarioRestTraceNode>()
  const sourceStates = new Map<ScenarioRestStateId, ScenarioRestSourceState>()
  const memberEffects: ScenarioRestMemberEffect[] = []
  const targetEffects = new Map<ScenarioRestEffectId, PendingTargetEffect>()
  const memberByResonatorId = new Map(
    scenario.team.members.map((member) => [member.resonatorId, member]),
  )

  nodes.set(TARGET_NODE_ID, {
    id: TARGET_NODE_ID,
    kind: 'target',
    targetId: scenario.target.id,
    profile: structuredClone(scenario.target),
  })
  for (const member of scenario.team.members) {
    nodes.set(memberNodeId(member.id), {
      id: memberNodeId(member.id),
      kind: 'member',
      memberId: member.id,
      resonatorId: member.resonatorId,
    })
  }

  const addMemberEffect = (
    sourceNodeId: ScenarioRestNodeId,
    effect: RestEffectDefinition,
    stage: ScenarioRestMemberEffect['stage'],
    resolution: ScenarioRestResolution,
    memberId: TeamMemberId,
    operations: ScenarioRestOperation[],
  ) => {
    if (operations.length === 0) return
    memberEffects.push({
      id: `effect:${sourceNodeId}:${effect.id}:member:${memberId}`,
      sourceNodeId,
      effectId: effect.id,
      label: effect.label,
      ownerKey: effect.ownerKey,
      owner: cloneOwner(effect.ownerKey),
      definition: cloneEffectDefinition(effect),
      stage,
      resolution,
      destination: { kind: 'member', memberId },
      operations,
      stateIds: [],
    })
  }

  const addTargetEffect = (
    sourceNodeId: ScenarioRestNodeId,
    effect: RestEffectDefinition,
    stage: ScenarioRestTargetEffect['stage'],
    resolution: ScenarioRestResolution,
    memberId: TeamMemberId,
    operations: ScenarioRestOperation[],
  ) => {
    if (operations.length === 0) return
    const id = `effect:${sourceNodeId}:${effect.id}:target`
    const existing = targetEffects.get(id)
    if (existing) {
      existing.beneficiaries.push({ memberId, operations })
      return
    }
    targetEffects.set(id, {
      base: {
        id,
        sourceNodeId,
        effectId: effect.id,
        label: effect.label,
        ownerKey: effect.ownerKey,
        owner: cloneOwner(effect.ownerKey),
        definition: cloneEffectDefinition(effect),
        stage,
        resolution,
        destination: { kind: 'target' },
      },
      beneficiaries: [{ memberId, operations }],
    })
  }

  for (const targetMember of scenario.team.members) {
    const slotId = findCombatPartByMemberId(graph, targetMember.id)
    const targetContext = prepared.workspace.cntxByResId[targetMember.resonatorId]
    if (!slotId || !targetContext) continue

    for (const row of listGraphEffectRows(graph, slotId)) {
      const sourceMember = memberByResonatorId.get(row.baseContext.sourceRuntime.id)
      if (!sourceMember) continue
      const sourceNodeId = memberSourceNodeId(sourceMember.id, row.baseContext.source)
      nodes.set(sourceNodeId, {
        id: sourceNodeId,
        kind: 'memberSource',
        memberId: sourceMember.id,
        source: { ...row.baseContext.source },
      })
      const sourceContext = prepared.workspace.cntxByResId[sourceMember.resonatorId]
      const context: EffectContext = {
        ...row.baseContext,
        baseStats: targetContext.baseStats,
        finalStats: targetContext.finalStats,
        pool: targetContext.buffs,
        sourceFinalStats: sourceContext?.finalStats,
        enemy: scenario.target,
      }

      for (const state of listStatesFor(context.source.type, context.source.id)) {
        if (
          !isStateVisible(context.sourceRuntime, context.targetRuntime, state, context.activeRuntime)
          || !isStateEnabled(context.sourceRuntime, context.targetRuntime, state, context.activeRuntime)
        ) {
          continue
        }
        const current = isCurrentState(state, context)
        if (!current.active) continue
        const id = `source-state:${sourceNodeId}:${state.id}`
        const existing = sourceStates.get(id)
        if (existing) {
          if (!existing.applicableToMemberIds.includes(targetMember.id)) {
            existing.applicableToMemberIds.push(targetMember.id)
          }
        } else {
          sourceStates.set(id, {
            id,
            sourceNodeId,
            source: { ...context.source },
            stateId: state.id,
            ownerKey: state.ownerKey,
            label: state.label,
            path: state.path,
            value: current.value,
            applicableToMemberIds: [targetMember.id],
            definition: structuredClone(state),
          })
        }
      }

      const stages = [
        ['preStats', row.rtPreSttsExe],
        ['postStats', row.postStatEffects],
      ] as const
      for (const [stage, effects] of stages) {
        for (const effect of effects) {
          if (!ffctTrgtRt(effect, context)) continue
          if (!evalCond(effect.condition, makeEffectScope(context))) continue
          const operations = resolveGameOperations(effect, context)
          const memberOperations = operations.filter((operation) => operation.path.startsWith('member.'))
          const targetOperations = operations.filter((operation) => operation.path.startsWith('target.'))
          const resolution = effectResolution(scenario, sourceMember, effect)
          addMemberEffect(sourceNodeId, effect, stage, resolution, targetMember.id, memberOperations)
          addTargetEffect(sourceNodeId, effect, stage, resolution, targetMember.id, targetOperations)
        }
      }
    }
  }

  for (const manualEffect of scenario.environment.manualEffects) {
    if (!manualEffect.enabled) continue
    const sourceNodeId = environmentNodeId(`manual:${manualEffect.id}`)
    nodes.set(sourceNodeId, {
      id: sourceNodeId,
      kind: 'environmentSource',
      sourceType: 'manualEffect',
      sourceId: manualEffect.id,
      label: manualEffect.label,
      selector: structuredClone(manualEffect.selector),
    })
    const operations = resolveManualOperations(manualEffect)
    const memberOperations = operations.filter((operation) => operation.path.startsWith('member.'))
    const targetOperations = operations.filter((operation) => operation.path.startsWith('target.'))
    const effectDef = {
      id: manualEffect.id,
      label: manualEffect.label ?? 'Manual effect',
    }
    const resolution: ScenarioRestResolution = {
      kind: 'environmentSelector',
      selector: structuredClone(manualEffect.selector),
    }
    for (const member of scenario.team.members) {
      if (!environmentSelectorMatches(manualEffect.selector, member)) continue
      addMemberEffect(sourceNodeId, effectDef, 'base', resolution, member.id, structuredClone(memberOperations))
      addTargetEffect(sourceNodeId, effectDef, 'base', resolution, member.id, structuredClone(targetOperations))
    }
  }

  const environmentOperations = targetModifierOperations(scenario)
  if (environmentOperations.length > 0) {
    const sourceNodeId = environmentNodeId('target-modifiers')
    nodes.set(sourceNodeId, {
      id: sourceNodeId,
      kind: 'environmentSource',
      sourceType: 'targetModifiers',
      sourceId: 'target-modifiers',
      label: 'Environment target modifiers',
    })
    for (const member of scenario.team.members) {
      addTargetEffect(
        sourceNodeId,
        { id: 'target-modifiers', label: 'Environment target modifiers' },
        'base',
        { kind: 'environmentTargetModifier' },
        member.id,
        structuredClone(environmentOperations),
      )
    }
  }

  if (scenario.environment.combatState.havocBane > 0) {
    const sourceNodeId = environmentNodeId('combat-state')
    nodes.set(sourceNodeId, {
      id: sourceNodeId,
      kind: 'environmentSource',
      sourceType: 'combatState',
      sourceId: 'combat-state',
      label: 'Shared combat state',
    })
    const operations: ScenarioRestOperation[] = [{
      id: 'environment:combat-state:havocBane:defShred',
      operationIndex: 0,
      path: 'target.buffs.defShred',
      value: scenario.environment.combatState.havocBane * 2,
      definition: { kind: 'combatStateDerived', state: 'havocBane' },
    }]
    for (const member of scenario.team.members) {
      addTargetEffect(
        sourceNodeId,
        { id: 'combat-state:havocBane', label: 'Havoc Bane DEF reduction' },
        'base',
        { kind: 'targetIntrinsic' },
        member.id,
        structuredClone(operations),
      )
    }
  }

  const enemyEffects = listEffectsFor('enemy', scenario.target.id, 'runtime')
  if (enemyEffects.length > 0) {
    const sourceNodeId = targetSourceNodeId(scenario.target.id)
    nodes.set(sourceNodeId, {
      id: sourceNodeId,
      kind: 'targetSource',
      targetId: scenario.target.id,
      source: { type: 'enemy', id: scenario.target.id },
    })
    for (const targetMember of scenario.team.members) {
      const slotId = findCombatPartByMemberId(graph, targetMember.id)
      const targetContext = prepared.workspace.cntxByResId[targetMember.resonatorId]
      const baseContext = slotId ? listGraphEffectRows(graph, slotId)[0]?.baseContext : null
      if (!baseContext || !targetContext) continue
      const context: EffectContext = {
        ...baseContext,
        source: { type: 'enemy', id: scenario.target.id },
        baseStats: targetContext.baseStats,
        finalStats: targetContext.finalStats,
        pool: targetContext.buffs,
        sourceFinalStats: undefined,
        enemy: scenario.target,
      }
      for (const effect of enemyEffects) {
        if (!evalCond(effect.condition, makeEffectScope(context))) continue
        const operations = resolveGameOperations(effect, context)
        const memberOperations = operations.filter((operation) => operation.path.startsWith('member.'))
        const targetOperations = operations.filter((operation) => operation.path.startsWith('target.'))
        const stage = effect.stage ?? 'preStats'
        addMemberEffect(sourceNodeId, effect, stage, { kind: 'targetIntrinsic' }, targetMember.id, memberOperations)
        addTargetEffect(sourceNodeId, effect, stage, { kind: 'targetIntrinsic' }, targetMember.id, targetOperations)
      }
    }
  }

  const resolvedSourceStates = Array.from(sourceStates.values())
  const withStateIds = (effect: ScenarioRestEffect): ScenarioRestEffect => {
    const applicableMembers = isTargetEffect(effect)
      ? effect.beneficiaries.map((beneficiary) => beneficiary.memberId)
      : [effect.destination.memberId]
    return {
      ...effect,
      stateIds: resolvedSourceStates
        .filter((state) => (
          state.sourceNodeId === effect.sourceNodeId
          && state.ownerKey === effect.ownerKey
          && state.applicableToMemberIds.some((memberId) => applicableMembers.includes(memberId))
        ))
        .map((state) => state.id),
    }
  }
  const effects = [
    ...memberEffects,
    ...Array.from(targetEffects.values()).map(({ base, beneficiaries }) => ({
      ...base,
      beneficiaries,
      stateIds: [],
    } satisfies ScenarioRestTargetEffect)),
  ].map(withStateIds)
  const targetStates = activeTargetStates(scenario)
  const usedSourceNodeIds = new Set([
    ...effects.map((effect) => effect.sourceNodeId),
    ...resolvedSourceStates.map((state) => state.sourceNodeId),
  ])
  const resolvedNodes = Array.from(nodes.values()).filter((node) => (
    node.kind === 'member'
    || node.kind === 'target'
    || usedSourceNodeIds.has(node.id)
  ))
  const indexes: ScenarioRestTraceIndexes = {
    bySourceNodeId: {},
    byDestinationNodeId: {},
    members: Object.fromEntries(scenario.team.members.map((member) => [
      member.id,
      {
        memberId: member.id,
        sourceNodeIds: [],
        sourceStateIds: [],
        receivedEffectIds: [],
        contributedEffectIds: [],
        targetBenefitEffectIds: [],
      },
    ])) as Record<TeamMemberId, ScenarioRestMemberIndex>,
    target: {
      nodeId: TARGET_NODE_ID,
      stateIds: targetStates.map((state) => state.id),
      receivedEffectIds: [],
    },
  }

  for (const node of resolvedNodes) {
    if (node.kind !== 'memberSource') continue
    indexes.members[node.memberId]?.sourceNodeIds.push(node.id)
  }
  for (const state of resolvedSourceStates) {
    const node = nodes.get(state.sourceNodeId)
    if (node?.kind === 'memberSource') {
      indexes.members[node.memberId]?.sourceStateIds.push(state.id)
    }
  }
  for (const effect of effects) {
    addIndex(indexes.bySourceNodeId, effect.sourceNodeId, effect.id)
    const sourceNode = nodes.get(effect.sourceNodeId)
    if (sourceNode?.kind === 'memberSource') {
      const contributed = indexes.members[sourceNode.memberId]?.contributedEffectIds
      if (contributed && !contributed.includes(effect.id)) contributed.push(effect.id)
    }
    if (!isTargetEffect(effect)) {
      const destinationNodeId = memberNodeId(effect.destination.memberId)
      addIndex(indexes.byDestinationNodeId, destinationNodeId, effect.id)
      indexes.members[effect.destination.memberId]?.receivedEffectIds.push(effect.id)
      continue
    }
    addIndex(indexes.byDestinationNodeId, TARGET_NODE_ID, effect.id)
    indexes.target.receivedEffectIds.push(effect.id)
    for (const beneficiary of effect.beneficiaries) {
      indexes.members[beneficiary.memberId]?.targetBenefitEffectIds.push(effect.id)
    }
  }

  return {
    scenarioId: scenario.id,
    revision: scenario.revision,
    contextMemberId: scenario.contextMemberId,
    initialOnFieldMemberId: scenario.initialOnFieldMemberId,
    nodes: resolvedNodes,
    sourceStates: resolvedSourceStates,
    targetStates,
    effects,
    indexes,
  }
}

/** Prepare and trace the scenario's persisted rest state without executing a rotation. */
export function traceScenarioRestState(
  scenario: CombatScenario,
): ScenarioRestStateTrace {
  return tracePreparedRestState(prepareCombatScenario(scenario))
}
