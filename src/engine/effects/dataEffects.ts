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
} from '@/domain/gameData/registry'
import { makeTeamComp } from '@/domain/gameData/teamComposition'
import type {
  DataSrcRef,
  EffectDef,
  EffectScope,
  EffectOp,
  EffectContext,
} from '@/domain/gameData/contracts'
import type { EnemyProfile } from '@/domain/entities/appState'
import { isNoEnemy } from '@/domain/entities/appState'
import type { CombatGraph } from '@/domain/entities/combatGraph'
import { isNoWeaponId, type ResRuntime } from '@/domain/entities/runtime'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'
import type { SlotId } from '@/domain/entities/session'
import type {
  FinalStats,
  ResBaseStats,
  SkillDef,
  UnifiedBuffPool,
} from '@/domain/entities/stats'
import { evalCond, evalForm } from '@/engine/effects/evaluator'
import { ffctTrgtRt } from '@/engine/effects/targetScope'
import { makeModBuff } from '@/engine/resolvers/buffPool'
import { getMainEchoS } from '@/domain/services/runtimeSourceService'

interface LegDataFfctP {
  teamRuntime?: ResRuntime
  runtimesById?: Record<string, ResRuntime>
  actResId?: string
  baseStats?: ResBaseStats
  finalStats?: FinalStats
  sourceStats?: Record<string, FinalStats>
  selectedTargets?: Record<string, string | null>
  enemy?: EnemyProfile
}

interface GrphDataFfct {
  graph: CombatGraph
  targetSlotId: SlotId
  baseStats?: ResBaseStats
  finalStats?: FinalStats
  sourceStats?: Record<string, FinalStats>
  enemy?: EnemyProfile
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

interface FfctCtxEnt {
  baseContext: EffectContext
  // effects are bucketed by when they mutate runtime or skill data so graph
  // contexts can reuse the same source expansion without re-querying registries.
  rtPreSttsExe: EffectDef[]
  postStatEffects: EffectDef[]
  skillEffects: EffectDef[]
}

const grphFfctCtxC = new WeakMap<CombatGraph, Partial<Record<SlotId, FfctCtxEnt[]>>>()

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

function mkFfctCtxEnt(baseContext: EffectContext): FfctCtxEnt {
  const registry = getGameData()

  return {
    baseContext,
    rtPreSttsExe: listSrcRtFfc(registry, baseContext.source, 'preStats'),
    postStatEffects: listSrcRtFfc(registry, baseContext.source, 'postStats'),
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

function mkGrphFfctCt(
    graph: CombatGraph,
    targetSlotId: SlotId,
): FfctCtxEnt[] {
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
): FfctCtxEnt[] {
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
    }

    const contexts: EffectContext[] = [resContext]
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
): FfctCtxEnt[] {
  if (isGrphPtns(options)) {
    return mkGrphFfctCt(options.graph, options.targetSlotId)
  }

  return mkLegFfctCtx(tgtRt, options)
}

function mkDynmCtx(
    baseContext: EffectContext,
    options: DataFfctPtns,
    pool?: UnifiedBuffPool,
): EffectContext {
  return {
    ...baseContext,
    pool,
    baseStats: options.baseStats,
    sourceFinalStats: options.sourceStats?.[baseContext.sourceRuntime.id],
    finalStats: options.finalStats,
    enemy: options.enemy,
  }
}

// build the evaluation scope used by formulas and conditions
function mkEvalScp(context: EffectContext): EffectScope {
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
  }
}

// apply one runtime operation to the shared buff pool
function applyRtOp(
    pool: UnifiedBuffPool,
    operation: EffectOp,
    scope: EffectScope,
): void {
  if (
      operation.type === 'add_skill_mod' ||
      operation.type === 'add_skill_multiplier' ||
      operation.type === 'add_skill_hit_multiplier' ||
      operation.type === 'add_skill_scalar' ||
      operation.type === 'scale_skill_multiplier'
  ) {
    return
  }

  // immunity ops carry a scope instead of a numeric value; merge into the pool's immunity set
  if (operation.type === 'add_immunity') {
    const { scope: immScope } = operation
    if (immScope.target === 'all') {
      pool.immunities.all = true
    } else if (immScope.target === 'element') {
      pool.immunities.elements.push(...immScope.keys)
    } else if (immScope.target === 'skillType') {
      pool.immunities.skillTypes.push(...immScope.keys)
    } else {
      pool.immunities.negativeEffects.push(...immScope.keys)
    }
    return
  }

  const value = evalForm(operation.value, scope)

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
    const negFfct = Array.isArray(operation.negativeEffect)
        ? operation.negativeEffect
        : [operation.negativeEffect]

    for (const key of negFfct) {
      pool.negativeEffect[key][operation.mod] += value
    }
  }
}

// apply runtime effects for one explicit candidate source
// this keeps suggestion overlays out of the normal runtime-owned source lookup.
export function applyCandRt(
    pool: UnifiedBuffPool,
    input: CandFxNpt,
    stage: 'preStats' | 'postStats' = 'preStats',
): UnifiedBuffPool {
  const ent = mkFfctCtxEnt(mkCandCtx(input, pool))
  const effects = stage === 'postStats' ? ent.postStatEffects : ent.rtPreSttsExe
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

    for (const operation of effect.operations) {
      applyRtOp(pool, operation, scope)
    }
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

  return true
}

// apply one skill operation to a skill definition
export function applySkllOp(
    skill: SkillDef,
    operation: EffectOp,
    scope: EffectScope,
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

    const value = evalForm(operation.value, scope)

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

    const value = evalForm(operation.value, scope)
    return {
      ...skill,
      [operation.field]: (skill[operation.field] ?? 0) + value,
    }
  }

  if (operation.type === 'add_skill_multiplier') {
    if (!skllMtchRule(skill, operation)) {
      return skill
    }

    const dddMltp = evalForm(operation.value, scope)
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

    const dddMltp = evalForm(operation.value, scope)
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

  const mltpScl = evalForm(operation.value, scope)

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
    stage: 'preStats' | 'postStats' = 'preStats',
): UnifiedBuffPool {
  const next = baseBuffs

  for (const entry of makeEffectRows(runtime, options)) {
    const effects = stage === 'postStats' ? entry.postStatEffects : entry.rtPreSttsExe
    if (effects.length === 0) {
      continue
    }

    const context = mkDynmCtx(entry.baseContext, options, next)
    const scope = mkEvalScp(context)

    for (const effect of effects) {
      if (!ffctTrgtRt(effect, context)) {
        continue
      }

      if (!evalCond(effect.condition, scope)) {
        continue
      }

      for (const operation of effect.operations) {
        applyRtOp(next, operation, scope)
      }
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
    stage: 'preStats' | 'postStats' = 'preStats',
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

    for (const operation of effect.operations) {
      applyRtOp(next, operation, scope)
    }
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

      for (const operation of effect.operations) {
        next = applySkllOp(next, operation, scope)
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

    for (const operation of effect.operations) {
      next = applySkllOp(next, operation, scope)
    }
  }

  return next
}
