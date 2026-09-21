/*
  Author: Runor Ewhro
  Description: Applies runtime and skill data-driven effects by building
               effect contexts from combat state, evaluating conditions,
               and mutating buff pools or skill definitions.
*/

import { getGameData } from '@/data/gameData'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import {
  listEffects,
  listSrcRtFfc,
} from '@/data/gameData/registry'
import { makeTeamComp } from '@/engine/gameData/teamComposition'
import type {
  CondExpr,
  DataSrcRef,
  EffectDef,
  EffectScope,
  EffectOp,
  EffectContext,
  FormExpr,
  BaseStatFld,
  BaseStatKey,
  TopBuffStatK,
} from '@/domain/gameData/contracts'
import type { EnemyProfile } from '@/domain/entities/appState'
import { isNoEnemy } from '@/domain/entities/appState'
import type { CombatGraph, SlotId } from '@/domain/entities/combatGraph'
import { isNoWeaponId, type ResRuntime } from '@/domain/entities/runtime'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'
import type {
  FinalStats,
  AttributeKey,
  ModBuff,
  NegEffectBuff,
  NegEffectKey,
  ResBaseStats,
  SkillTypeKey,
  SkillDef,
  UnifiedBuffPool,
} from '@/domain/entities/stats'
import { evalCond, evalForm } from '@/engine/effects/evaluator'
import { ffctTrgtRt } from '@/engine/effects/targetScope'
import { makeModBuff } from '@/engine/resolvers/buffPool'
import { getMainEchoS } from '@/engine/services/runtimeSourceService'

interface LegDataFfctP {
  teamRuntime?: ResRuntime
  runtimesById?: Record<string, ResRuntime>
  actResId?: string
  baseStats?: ResBaseStats
  finalStats?: FinalStats
  sourceStats?: Record<string, FinalStats>
  selectedTargets?: Record<string, string | null>
  enemy?: EnemyProfile
  effectScalesByRuntimePath?: Record<string, Record<string, number>>
  // echo set sources are only assembled in the graph path; opt them into the
  // legacy path for standalone build-stat derivation.
  includeEchoSets?: boolean
}

interface GrphDataFfct {
  graph: CombatGraph
  targetSlotId: SlotId
  baseStats?: ResBaseStats
  finalStats?: FinalStats
  sourceStats?: Record<string, FinalStats>
  enemy?: EnemyProfile
  effectScalesByRuntimePath?: Record<string, Record<string, number>>
}

type DataFfctPtns = LegDataFfctP | GrphDataFfct

export interface CandFxNpt {
  baseCtx: EffectContext
  source: DataSrcRef
  srcRt: ResRuntime
  tgtRt?: ResRuntime
  baseStats?: ResBaseStats
  finalStats?: FinalStats
  srcFinal?: FinalStats
  enemy?: EnemyProfile
}

export interface EffectContextRow {
  baseContext: EffectContext
  // effects are bucketed by when they mutate runtime or skill data so graph
  // contexts can reuse the same source expansion without re-querying registries.
  rtPreSttsExe: EffectDef[]
  postStatEffects: EffectDef[]
  finalStatEffects: EffectDef[]
  skillEffects: EffectDef[]
}

const grphFfctCtxC = new WeakMap<CombatGraph, Partial<Record<SlotId, EffectContextRow[]>>>()

// check whether effect options use combat graph mode
function isGrphPtns(options: DataFfctPtns): options is GrphDataFfct {
  return 'graph' in options
}

// resolve the source runtime for a given source id
function resSrcRt(
    sourceId: string,
    tgtRt: ResRuntime,
    teamRuntime: ResRuntime,
    runtimesById: Record<string, ResRuntime>,
): ResRuntime | null {
  if (sourceId === tgtRt.id) {
    return tgtRt
  }

  if (sourceId === teamRuntime.id) {
    return teamRuntime
  }

  return runtimesById[sourceId] ?? null
}

function mkFfctCtxEnt(baseContext: EffectContext): EffectContextRow {
  const registry = getGameData()

  return {
    baseContext,
    rtPreSttsExe: listSrcRtFfc(registry, baseContext.source, 'preStats'),
    postStatEffects: listSrcRtFfc(registry, baseContext.source, 'postStats'),
    finalStatEffects: listSrcRtFfc(registry, baseContext.source, 'finalStats'),
    skillEffects: listEffects(registry, baseContext.source, 'skill'),
  }
}

// build a weapon source context for a resonator context
function mkWpnCtx(
    resContext: EffectContext,
): EffectContext | null {
  const weaponId = resContext.sourceRuntime.build.weapon.id
  if (isNoWeaponId(weaponId)) {
    return null
  }

  return {
    ...resContext,
    source: {
      type: 'weapon',
      id: weaponId,
    },
  }
}

// build a main echo source context for a resonator context
function mkEchoCtx(
    resContext: EffectContext,
): EffectContext | null {
  const echoSource = getMainEchoS(resContext.sourceRuntime)
  if (!echoSource) {
    return null
  }

  return {
    ...resContext,
    source: echoSource,
  }
}

// build echo set source contexts for a resonator context
function mkEchoSetCnt(
    resContext: EffectContext,
): EffectContext[] {
  return Object.keys(resContext.echoSetCounts).map((setId) => ({
    ...resContext,
    source: { type: 'echoSet' as const, id: setId },
  }))
}

export function listGraphEffectRows(
    graph: CombatGraph,
    targetSlotId: SlotId,
): EffectContextRow[] {
  const cachedBySlot = grphFfctCtxC.get(graph)
  const cchdEnts = cachedBySlot?.[targetSlotId]
  if (cchdEnts) {
    return cchdEnts
  }

  const resDtlsById = getResDtlsBy()
  const tgtPart = graph.participants[targetSlotId]
  if (!tgtPart) {
    return []
  }

  const actPart = graph.participants[graph.activeSlotId] ?? tgtPart
  const teamMemIds = Array.from(
      new Set(Object.values(graph.participants).map((participant) => participant.resonatorId)),
  )
  const team = makeTeamComp(teamMemIds)

  const entries = Object.values(graph.participants).flatMap((srcPart) => {
    const resContext: EffectContext = {
      team,
      source: {
        type: 'resonator',
        id: srcPart.resonatorId,
        negativeEffectSources: resDtlsById[srcPart.resonatorId]?.negativeEffectSources,
      },
      target: {
        type: 'resonator',
        id: tgtPart.resonatorId,
        negativeEffectSources: resDtlsById[tgtPart.resonatorId]?.negativeEffectSources,
      },
      sourceRuntime: srcPart.runtime,
      targetRuntime: tgtPart.runtime,
      activeRuntime: actPart.runtime,
      targetRuntimeId: tgtPart.resonatorId,
      activeResonatorId: actPart.resonatorId,
      teamMemberIds: teamMemIds,
      echoSetCounts: countEchoSets(srcPart.runtime.build.echoes),
      selectedTargetsByOwnerKey: {
        ...srcPart.slot.routing.selectedTargetsByOwnerKey,
      },
      effectScalesByRuntimePath: graph.effectScalesByRuntimePath,
    }

    const contexts: EffectContext[] = [
      resContext,
      ...mkEchoSetCnt(resContext),
    ]
    const wpnCtx = mkWpnCtx(resContext)
    const echoContext = mkEchoCtx(resContext)

    if (wpnCtx) {
      contexts.push(wpnCtx)
    }

    if (echoContext) {
      contexts.push(echoContext)
    }

    return contexts.map(mkFfctCtxEnt)
  })

  const nextCchdBySl = cachedBySlot ?? {}
  nextCchdBySl[targetSlotId] = entries
  grphFfctCtxC.set(graph, nextCchdBySl)
  return entries
}

function mkLegFfctCtx(
    tgtRt: ResRuntime,
    options: LegDataFfctP,
): EffectContextRow[] {
  const resDtlsById = getResDtlsBy()
  const teamRuntime = options.teamRuntime ?? tgtRt
  const runtimesById = options.runtimesById ?? {}
  const actResId = options.actResId ?? tgtRt.id
  const actRt =
      resSrcRt(actResId, tgtRt, teamRuntime, runtimesById) ?? tgtRt

  const sourceIds = Array.from(
      new Set([
        teamRuntime.id,
        ...teamRuntime.build.team.filter((memberId): memberId is string => Boolean(memberId)),
      ]),
  )
  const team = makeTeamComp(sourceIds)

  return sourceIds.flatMap((sourceId) => {
    const srcRt = resSrcRt(sourceId, tgtRt, teamRuntime, runtimesById)
    if (!srcRt) {
      return []
    }

    const resContext: EffectContext = {
      team,
      source: {
        type: 'resonator',
        id: sourceId,
        negativeEffectSources: resDtlsById[sourceId]?.negativeEffectSources,
      },
      target: {
        type: 'resonator',
        id: tgtRt.id,
        negativeEffectSources: resDtlsById[tgtRt.id]?.negativeEffectSources,
      },
      sourceRuntime: srcRt,
      targetRuntime: tgtRt,
      activeRuntime: actRt,
      targetRuntimeId: tgtRt.id,
      activeResonatorId: actResId,
      teamMemberIds: sourceIds,
      echoSetCounts: countEchoSets(srcRt.build.echoes),
      selectedTargetsByOwnerKey: options.selectedTargets,
      effectScalesByRuntimePath: options.effectScalesByRuntimePath,
    }

    const contexts: EffectContext[] = [
      resContext,
      ...(options.includeEchoSets ? mkEchoSetCnt(resContext) : []),
    ]
    const wpnCtx = mkWpnCtx(resContext)
    const echoContext = mkEchoCtx(resContext)

    if (wpnCtx) {
      contexts.push(wpnCtx)
    }

    if (echoContext) {
      contexts.push(echoContext)
    }

    return contexts.map(mkFfctCtxEnt)
  })
}

// build all effect contexts relevant to a target runtime
function makeEffectRows(
    tgtRt: ResRuntime,
    options: DataFfctPtns = {},
): EffectContextRow[] {
  if (isGrphPtns(options)) {
    return listGraphEffectRows(options.graph, options.targetSlotId)
  }

  return mkLegFfctCtx(tgtRt, options)
}

function mkDynmCtx(
    baseContext: EffectContext,
    options: DataFfctPtns,
    pool?: UnifiedBuffPool,
): EffectContext {
  /*
    Resolving a source's final stats is a full pre-stats pass, and only a
    formula that reaches for `sourceFinalStats` ever needs one. Hand it over as
    a getter so the cost lands on the effects that actually read it instead of
    on every context built.
  */
  return {
    ...baseContext,
    pool,
    baseStats: options.baseStats,
    get sourceFinalStats() {
      return options.sourceStats?.[baseContext.sourceRuntime.id]
    },
    finalStats: options.finalStats,
    enemy: options.enemy,
    effectScalesByRuntimePath: options.effectScalesByRuntimePath ?? baseContext.effectScalesByRuntimePath,
  }
}

// build the evaluation scope used by formulas and conditions
function mkEvalScp(context: EffectContext): EffectScope {
  return {
    sourceRuntime: context.sourceRuntime,
    // kept lazy so an unread source never pays for its stat resolution
    get sourceFinalStats() {
      return context.sourceFinalStats
    },
    targetRuntime: context.targetRuntime,
    activeRuntime: context.activeRuntime,
    context,
    pool: context.pool,
    baseStats: context.baseStats,
    finalStats: context.finalStats,
  }
}

// build one explicit source context for candidate evaluation
// suggestion candidates can score a source that is not actually equipped yet.
function mkCandCtx(input: CandFxNpt, pool?: UnifiedBuffPool): EffectContext {
  return {
    ...input.baseCtx,
    source: input.source,
    sourceRuntime: input.srcRt,
    targetRuntime: input.tgtRt ?? input.baseCtx.targetRuntime,
    activeRuntime: input.baseCtx.activeRuntime,
    pool,
    baseStats: input.baseStats,
    sourceFinalStats: input.srcFinal,
    finalStats: input.finalStats,
    enemy: input.enemy,
    effectScalesByRuntimePath: input.baseCtx.effectScalesByRuntimePath,
  }
}

function runtimeRefForPath(
    context: EffectContext,
    from: Extract<CondExpr, { path: string }>['from'] | Extract<FormExpr, { path: string }>['from'],
    path: string,
): { runtimeId: string; path: string } | null {
  if (from === 'sourceRuntime') {
    return { runtimeId: context.sourceRuntime.id, path }
  }

  if (from === 'targetRuntime') {
    return { runtimeId: context.targetRuntime.id, path }
  }

  if (from === 'activeRuntime' && context.activeRuntime) {
    return { runtimeId: context.activeRuntime.id, path }
  }

  if (!from && path.startsWith('runtime.')) {
    return { runtimeId: context.sourceRuntime.id, path: path.replace(/^runtime\./, '') }
  }

  if (!from && path.startsWith('sourceRuntime.')) {
    return { runtimeId: context.sourceRuntime.id, path: path.replace(/^sourceRuntime\./, '') }
  }

  if (!from && path.startsWith('targetRuntime.')) {
    return { runtimeId: context.targetRuntime.id, path: path.replace(/^targetRuntime\./, '') }
  }

  if (!from && path.startsWith('activeRuntime.') && context.activeRuntime) {
    return { runtimeId: context.activeRuntime.id, path: path.replace(/^activeRuntime\./, '') }
  }

  return null
}

function getRuntimePathScale(
    context: EffectContext,
    condition: Extract<CondExpr, { path: string }>,
): number {
  const ref = runtimeRefForPath(context, condition.from, condition.path)
  if (!ref) {
    return 1
  }

  return context.effectScalesByRuntimePath?.[ref.runtimeId]?.[ref.path] ?? 1
}

function effectConditionScale(
    condition: CondExpr | undefined,
    scope: EffectScope,
): number {
  if (!condition || condition.type === 'always') {
    return 1
  }

  if (condition.type === 'not') {
    return 1
  }

  if (condition.type === 'and') {
    return condition.values.reduce(
        (scale, child) => Math.min(scale, effectConditionScale(child, scope)),
        1,
    )
  }

  if (condition.type === 'or') {
    const passingScales = condition.values
        .filter((child) => evalCond(child, scope))
        .map((child) => effectConditionScale(child, scope))

    return passingScales.length > 0 ? Math.max(...passingScales) : 1
  }

  return getRuntimePathScale(scope.context, condition)
}

function formExprScale(
    formula: FormExpr,
    scope: EffectScope,
): number {
  if (formula.type === 'const') {
    return 1
  }

  if (formula.type === 'read' || formula.type === 'table') {
    const ref = runtimeRefForPath(scope.context, formula.from, formula.path)
    if (!ref) {
      return 1
    }

    return scope.context.effectScalesByRuntimePath?.[ref.runtimeId]?.[ref.path] ?? 1
  }

  if (formula.type === 'add' || formula.type === 'mul') {
    return formula.values.reduce(
        (scale, child) => Math.min(scale, formExprScale(child, scope)),
        1,
    )
  }

  return formExprScale(formula.value, scope)
}

// apply one runtime operation to the shared buff pool
const RT_OP_BASE = 1
const RT_OP_FIXED = 2
const RT_OP_TOP = 3
const RT_OP_ATTRIBUTE = 4
const RT_OP_SKILL_TYPE = 5
const RT_OP_NEGATIVE = 6
const RT_OP_IMMUNITY = 7

type RuntimeImmunityOp = Extract<EffectOp, { type: 'add_immunity' }>

interface CompiledRuntimeEffect {
  readonly opcodes: Uint8Array
  readonly keysA: readonly string[]
  readonly keysB: readonly string[]
  readonly formulas: ReadonlyArray<FormExpr | null>
  readonly immunities: ReadonlyArray<RuntimeImmunityOp['scope'] | null>
  readonly groups: Int32Array
}

const runtimeEffectPrograms = new WeakMap<EffectDef, CompiledRuntimeEffect>()

function compileRuntimeEffect(effect: EffectDef): CompiledRuntimeEffect {
  const cached = runtimeEffectPrograms.get(effect)
  if (cached) return cached

  const opcodes: number[] = []
  const keysA: string[] = []
  const keysB: string[] = []
  const formulas: Array<FormExpr | null> = []
  const immunities: Array<RuntimeImmunityOp['scope'] | null> = []
  const groups: number[] = []
  const emit = (
      opcode: number,
      keyA = '',
      keyB = '',
      formula: FormExpr | null = null,
      immunity: RuntimeImmunityOp['scope'] | null = null,
      group = 0,
  ): void => {
    opcodes.push(opcode)
    keysA.push(keyA)
    keysB.push(keyB)
    formulas.push(formula)
    immunities.push(immunity)
    groups.push(group)
  }

  for (let operationIndex = 0; operationIndex < effect.operations.length; operationIndex += 1) {
    const operation = effect.operations[operationIndex]
    if (!operation) continue
    if (operation.type === 'add_immunity') {
      emit(RT_OP_IMMUNITY, '', '', null, operation.scope, operationIndex)
    } else if (operation.type === 'add_base_stat') {
      emit(RT_OP_BASE, operation.stat, operation.field, operation.value, null, operationIndex)
    } else if (operation.type === 'set_final_stat') {
      emit(RT_OP_FIXED, operation.stat, '', operation.value, null, operationIndex)
    } else if (operation.type === 'add_top_stat') {
      emit(RT_OP_TOP, operation.stat, '', operation.value, null, operationIndex)
    } else if (operation.type === 'add_attribute_mod') {
      const attributes = Array.isArray(operation.attribute) ? operation.attribute : [operation.attribute]
      for (const attribute of attributes) {
        emit(RT_OP_ATTRIBUTE, attribute, operation.mod, operation.value, null, operationIndex)
      }
    } else if (operation.type === 'add_skilltype_mod') {
      const skillTypes = Array.isArray(operation.skillType) ? operation.skillType : [operation.skillType]
      for (const skillType of skillTypes) {
        emit(RT_OP_SKILL_TYPE, skillType, operation.mod, operation.value, null, operationIndex)
      }
    } else if (operation.type === 'add_negative_effect_mod') {
      const negativeEffects = Array.isArray(operation.negativeEffect)
        ? operation.negativeEffect
        : [operation.negativeEffect]
      for (const negativeEffect of negativeEffects) {
        emit(RT_OP_NEGATIVE, negativeEffect, operation.mod, operation.value, null, operationIndex)
      }
    }
  }

  const program: CompiledRuntimeEffect = {
    opcodes: Uint8Array.from(opcodes),
    keysA,
    keysB,
    formulas,
    immunities,
    groups: Int32Array.from(groups),
  }
  runtimeEffectPrograms.set(effect, program)
  return program
}

function executeRuntimeEffect(
    pool: UnifiedBuffPool,
    effect: EffectDef,
    scope: EffectScope,
    effectScale: number,
): void {
  const program = compileRuntimeEffect(effect)
  let previousGroup = -1
  let previousValue = 0
  for (let index = 0; index < program.opcodes.length; index += 1) {
    const opcode = program.opcodes[index]
    if (opcode === RT_OP_IMMUNITY) {
      const immunity = program.immunities[index]
      if (!immunity) continue
      if (immunity.target === 'all') pool.immunities.all = true
      else if (immunity.target === 'element') pool.immunities.elements.push(...immunity.keys)
      else if (immunity.target === 'skillType') pool.immunities.skillTypes.push(...immunity.keys)
      else pool.immunities.negativeEffects.push(...immunity.keys)
      continue
    }

    const formula = program.formulas[index]
    if (!formula) continue
    const group = program.groups[index] ?? -1
    const value = group === previousGroup
      ? previousValue
      : evalForm(formula, scope) * Math.min(effectScale, formExprScale(formula, scope))
    previousGroup = group
    previousValue = value
    const keyA = program.keysA[index] ?? ''
    const keyB = program.keysB[index] ?? ''
    if (opcode === RT_OP_BASE) {
      pool[keyA as BaseStatKey][keyB as BaseStatFld] += value
    } else if (opcode === RT_OP_FIXED) {
      pool.fixedStats[keyA as BaseStatKey] = value
    } else if (opcode === RT_OP_TOP) {
      pool[keyA as TopBuffStatK] += value
    } else if (opcode === RT_OP_ATTRIBUTE) {
      pool.attribute[keyA as AttributeKey | 'all'][keyB as keyof ModBuff] += value
    } else if (opcode === RT_OP_SKILL_TYPE) {
      pool.skillType[keyA as SkillTypeKey][keyB as keyof ModBuff] += value
    } else if (opcode === RT_OP_NEGATIVE) {
      pool.negativeEffect[keyA as NegEffectKey][keyB as keyof NegEffectBuff] += value
    }
  }
}

// apply runtime effects for one explicit candidate source
// this keeps suggestion overlays out of the normal runtime-owned source lookup.
export function applyCandRt(
    pool: UnifiedBuffPool,
    input: CandFxNpt,
    stage: 'preStats' | 'postStats' | 'finalStats' = 'preStats',
): UnifiedBuffPool {
  const ent = mkFfctCtxEnt(mkCandCtx(input, pool))
  const effects = stage === 'finalStats'
    ? ent.finalStatEffects
    : stage === 'postStats'
      ? ent.postStatEffects
      : ent.rtPreSttsExe
  if (effects.length === 0) {
    return pool
  }

  const context = mkCandCtx(input, pool)
  const scope = mkEvalScp(context)

  for (const effect of effects) {
    if (!ffctTrgtRt(effect, context)) {
      continue
    }

    if (!evalCond(effect.condition, scope)) {
      continue
    }

    const effectScale = effectConditionScale(effect.condition, scope)
    executeRuntimeEffect(pool, effect, scope, effectScale)
  }

  return pool
}

// check whether a skill matches an operation's skill match rule
function skllMtchRule(skill: SkillDef, operation: EffectOp): boolean {
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

  if (operation.match.elements && !operation.match.elements.includes(skill.element)) {
    return false
  }

  if (
      operation.match.labelIncludes &&
      !operation.match.labelIncludes.some((label) => skill.label.includes(label))
  ) {
    return false
  }

  return true
}

// apply one skill operation to a skill definition
export function applySkllOp(
    skill: SkillDef,
    operation: EffectOp,
    scope: EffectScope,
    effectScale = 1,
): SkillDef {
  if (
      operation.type === 'add_base_stat' ||
      operation.type === 'add_top_stat' ||
      operation.type === 'add_attribute_mod' ||
      operation.type === 'add_skilltype_mod' ||
      operation.type === 'add_negative_effect_mod'
  ) {
    return skill
  }

  if (operation.type === 'add_skill_mod') {
    if (!skllMtchRule(skill, operation)) {
      return skill
    }

    const value = evalForm(operation.value, scope) * effectScale

    return {
      ...skill,
      skillBuffs: {
        ...(skill.skillBuffs ?? makeModBuff()),
        [operation.mod]: (skill.skillBuffs?.[operation.mod] ?? 0) + value,
      },
    }
  }

  if (operation.type === 'add_skill_scalar') {
    if (!skllMtchRule(skill, operation)) {
      return skill
    }

    const value = evalForm(operation.value, scope) * effectScale
    return {
      ...skill,
      [operation.field]: (skill[operation.field] ?? 0) + value,
    }
  }

  if (operation.type === 'add_skill_multiplier') {
    if (!skllMtchRule(skill, operation)) {
      return skill
    }

    const dddMltp = evalForm(operation.value, scope) * effectScale
    const curMltp = skill.multiplier

    if (curMltp <= 0 || dddMltp === 0) {
      return skill
    }

    if (skill.hits.length === 0) {
      return {
        ...skill,
        multiplier: curMltp + dddMltp,
      }
    }

    const mltpScl = (curMltp + dddMltp) / curMltp
    const hits = skill.hits.map((hit) => ({
      ...hit,
      multiplier: hit.multiplier * mltpScl,
    }))

    return {
      ...skill,
      multiplier: hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0),
      hits,
    }
  }

  if (operation.type === 'add_skill_hit_multiplier') {
    if (!skllMtchRule(skill, operation)) {
      return skill
    }

    const dddMltp = evalForm(operation.value, scope) * effectScale
    if (dddMltp === 0 || operation.hitIndex < 0 || operation.hitIndex >= skill.hits.length) {
      return skill
    }

    const hits = skill.hits.map((hit, index) => (
      index === operation.hitIndex
        ? { ...hit, multiplier: hit.multiplier + dddMltp }
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

  if (!skllMtchRule(skill, operation)) {
    return skill
  }

  const rawMltpScl = evalForm(operation.value, scope)
  const mltpScl = 1 + (rawMltpScl - 1) * effectScale

  if (skill.hits.length === 0) {
    return {
      ...skill,
      multiplier: skill.multiplier * mltpScl,
    }
  }

  const hits = skill.hits.map((hit) => ({
    ...hit,
    multiplier: hit.multiplier * mltpScl,
  }))

  return {
    ...skill,
    multiplier: hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0),
    hits,
  }
}

// apply runtime-triggered data effects to a unified buff pool
export function applyRtDataF(
    runtime: ResRuntime,
    baseBuffs: UnifiedBuffPool,
    options: DataFfctPtns = {},
    stage: 'preStats' | 'postStats' | 'finalStats' = 'preStats',
    sourceFilter?: (source: DataSrcRef) => boolean,
    effectFilter?: (effect: EffectDef, context: EffectContext) => boolean,
): UnifiedBuffPool {
  const next = baseBuffs

  for (const entry of makeEffectRows(runtime, options)) {
    if (sourceFilter && !sourceFilter(entry.baseContext.source)) {
      continue
    }

    const effects = stage === 'finalStats'
      ? entry.finalStatEffects
      : stage === 'postStats'
        ? entry.postStatEffects
        : entry.rtPreSttsExe
    if (effects.length === 0) {
      continue
    }

    const context = mkDynmCtx(entry.baseContext, options, next)
    const scope = mkEvalScp(context)

    for (const effect of effects) {
      if (effectFilter && !effectFilter(effect, context)) {
        continue
      }

      if (!ffctTrgtRt(effect, context)) {
        continue
      }

      if (!evalCond(effect.condition, scope)) {
        continue
      }

      const effectScale = effectConditionScale(effect.condition, scope)
      executeRuntimeEffect(next, effect, scope, effectScale)
    }
  }

  return next
}

// apply enemy-sourced runtime effects (debuff vulnerability + immunities) into the pool.
// enemy effects are applied once per target, never per source participant, and read their
// conditions from the persisted enemy state via `context.enemy.status.<field>`.
export function applyEnemyRtDataF(
    runtime: ResRuntime,
    baseBuffs: UnifiedBuffPool,
    options: DataFfctPtns = {},
    stage: 'preStats' | 'postStats' | 'finalStats' = 'preStats',
): UnifiedBuffPool {
  const next = baseBuffs
  const enemy = options.enemy

  if (!enemy || isNoEnemy(enemy)) {
    return next
  }

  const enemyEffects = listSrcRtFfc(getGameData(), { type: 'enemy', id: enemy.id }, stage)
  if (enemyEffects.length === 0) {
    return next
  }

  // borrow any resolved context as scaffolding, then point the source at the enemy.
  // enemy effects only read context.enemy, so the borrowed source/target runtimes are unused.
  const baseEntry = makeEffectRows(runtime, options)[0]
  if (!baseEntry) {
    return next
  }

  const context = mkDynmCtx(
      { ...baseEntry.baseContext, source: { type: 'enemy', id: enemy.id } },
      options,
      next,
  )
  const scope = mkEvalScp(context)

  for (const effect of enemyEffects) {
    if (!evalCond(effect.condition, scope)) {
      continue
    }

    const effectScale = effectConditionScale(effect.condition, scope)
    executeRuntimeEffect(next, effect, scope, effectScale)
  }

  return next
}

// apply skill-triggered data effects to a skill definition
export function applySkllDat(
    runtime: ResRuntime,
    baseSkill: SkillDef,
    options: DataFfctPtns = {},
): SkillDef {
  let next = baseSkill

  for (const entry of makeEffectRows(runtime, options)) {
    if (entry.skillEffects.length === 0) {
      continue
    }

    const context = mkDynmCtx(entry.baseContext, options)
    const scope = mkEvalScp(context)

    for (const effect of entry.skillEffects) {
      if (!ffctTrgtRt(effect, context)) {
        continue
      }

      if (!evalCond(effect.condition, scope)) {
        continue
      }

      const effectScale = effectConditionScale(effect.condition, scope)
      for (const operation of effect.operations) {
        next = applySkllOp(next, operation, scope, effectScale)
      }
    }
  }

  return next
}

// apply skill effects for one explicit candidate source
// weapon suggestions use this to score passive variants before they are equipped.
export function applyCandSk(
    baseSkill: SkillDef,
    input: CandFxNpt,
): SkillDef {
  let next = baseSkill
  const ent = mkFfctCtxEnt(mkCandCtx(input))

  if (ent.skillEffects.length === 0) {
    return next
  }

  const context = mkCandCtx(input)
  const scope = mkEvalScp(context)

  for (const effect of ent.skillEffects) {
    if (!ffctTrgtRt(effect, context)) {
      continue
    }

    if (!evalCond(effect.condition, scope)) {
      continue
    }

    const effectScale = effectConditionScale(effect.condition, scope)
    for (const operation of effect.operations) {
      next = applySkllOp(next, operation, scope, effectScale)
    }
  }

  return next
}
