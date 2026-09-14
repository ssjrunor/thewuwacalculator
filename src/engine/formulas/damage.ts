/*
  Author: Runor Ewhro
  Description: Computes final skill results for direct damage, support,
               tune rupture, and negative-effect archetypes by combining
               final stats, enemy data, and skill metadata.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import { isNoEnemy } from '@/domain/entities/appState'
import type {
  DamageResult,
  AttributeKey,
  FinalStats,
  ModBuff,
  NegEffectKey,
  SkillDef,
  SkillTypeKey,
} from '@/domain/entities/stats'
import { getNegEffectDef, NEG_EFFECT_ELEM } from '@/domain/gameData/negativeEffects'
import { getNegBase } from '@/engine/formulas/negativeEffects'
import { getTuneLevel } from '@/engine/formulas/tuneRupture'
import {
  compileSkillRecord,
  FIELD_AMPLIFY,
  FIELD_CRIT_DMG,
  FIELD_CRIT_RATE,
  FIELD_DEF_IGNORE,
  FIELD_DEF_SHRED,
  FIELD_DMG_BONUS,
  FIELD_DMG_VULN,
  FIELD_RES_SHRED,
  type SkillRecord,
} from '@/engine/formulas/skillRecord.ts'
import {
  defenseReduction,
  gatherPools,
  getEnemyRes,
  layerModifier,
  resistMult,
  resolveDamageFactors,
  resolveHits,
} from '@/engine/formulas/damageFactors.ts'
import { syncNumericTeam, type NumericTeamState } from '@/engine/effects/numericTeam.ts'
import {
  NUMERIC_ATTRIBUTES,
  NUMERIC_FINAL_CELL_COUNT,
  NUMERIC_NEGATIVE_EFFECTS,
  NUMERIC_SKILL_TYPES,
  finalAttributeCell,
  finalCoreCell,
  finalNegativeCell,
  finalSkillTypeCell,
  finalTopCell,
  packFinalStats,
} from '@/engine/rotation/numericLayout.ts'

export interface DirectSkillCtx {
  baseAtk: number
  baseHp: number
  baseDef: number
  finalAtk: number
  finalHp: number
  finalDef: number
  finalER: number
  critRate: number
  critDmg: number
  dmgBonus: number
  amplify: number
  finalDmg: number
  resMult: number
  defMult: number
  dmgVulnMult: number
  dmgBonusMult: number
  ampMult: number
  finalDmgMult: number
  scalingAtk: number
  scalingHp: number
  scalingDef: number
  scalingER: number
  multiplier: number
  hitScale: number
  hitCount: number
  flatDmg: number
  fixedDmg: number
}

export interface CalcSkillDamageOptions {
  includeSubHits?: boolean
}

/**
 * Allocation-free damage output used by compiled rotation execution.
 * The caller owns the storage, so a feature evaluation can contribute its
 * three scalar results without constructing a DamageResult or sub-hit rows.
 */
export interface SkillDamageScoreTarget {
  values: Float64Array
  offset?: number
}

interface HitSummary {
  hitScale: number
  hitCount: number
}

/**
 * What the enemy side of the calculation came to for one skill.
 *
 * These four are layered the way crit and bonus are: the sheet's figure is
 * only the first of six, and the rest arrive from the attribute, skill type
 * and skill buffs in force. Reading them off the final stats states the wrong
 * one, and states defence ignore and defence shred as the same number whenever
 * the sheet carries neither.
 */
export function resolveSkillFactors(
    finalStats: FinalStats,
    skill: SkillDef,
    enemy: EnemyProfile,
): {
  defIgnore: number
  defShred: number
  dmgVuln: number
  /** the enemy's resistance to this element after every shred, or null when
      there is no enemy to resist */
  resistance: number | null
} {
  const pools = gatherPools(finalStats, skill)

  return {
    defIgnore: finalStats.defIgnore + layerModifier(pools, (pool) => pool.defIgnore),
    defShred: finalStats.defShred + layerModifier(pools, (pool) => pool.defShred),
    dmgVuln: finalStats.dmgVuln + layerModifier(pools, (pool) => pool.dmgVuln),
    resistance: isNoEnemy(enemy)
      ? null
      : getEnemyRes(enemy, skill.element) - layerModifier(pools, (pool) => pool.resShred),
  }
}

/**
 * The names this file's callers already use, over the shared factor set. The
 * math lives in damageFactors so the results pane explains the same numbers.
 */
function calcDamageCtx(
    finalStats: FinalStats,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
) {
  const factors = resolveDamageFactors(finalStats, skill, enemy, level)

  return {
    zeroed: factors.zeroed,
    skillTypeAll: factors.skillTypeAll,
    skillTypeBuff: factors.skillTypeBuff,
    attributeAll: factors.attributeAll,
    attributeElement: factors.attrElement,
    skillBuffs: factors.skillBuffs,
    resMult: factors.resMult,
    defenseMultiplier: factors.defMult,
    damageBonusMultiplier: factors.dmgBonusMult,
    amplifyMultiplier: factors.ampMult,
    dmgVulnMultiplier: factors.dmgVulnMult,
    finalDmgMultiplier: factors.finalDmgMult,
    critRate: factors.critRate,
    critDmg: factors.critDmg,
  }
}

// build a zeroed result while preserving the skill hit structure
function shldInclSubHits(options?: CalcSkillDamageOptions): boolean {
  return options?.includeSubHits !== false
}

function summarizeHits(hits: SkillDef['hits']): HitSummary {
  let hitScale = 0
  let hitCount = 0

  for (const hit of hits) {
    hitScale += hit.multiplier * hit.count
    hitCount += hit.count
  }

  return {
    hitScale,
    hitCount,
  }
}

function makeDirectSkill(
    finalStats: FinalStats,
    skill: SkillDef,
    shared: ReturnType<typeof calcDamageCtx>,
): DirectSkillCtx {
  const hits = resolveHits(skill, skill.multiplier)
  const hitSummary = summarizeHits(hits)

  return {
    baseAtk: finalStats.atk.base,
    baseHp: finalStats.hp.base,
    baseDef: finalStats.def.base,
    finalAtk: finalStats.atk.final,
    finalHp: finalStats.hp.final,
    finalDef: finalStats.def.final,
    finalER: finalStats.energyRegen,
    critRate: shared.critRate * 100,
    critDmg: shared.critDmg * 100,
    dmgBonus: (shared.damageBonusMultiplier - 1) * 100,
    amplify: (shared.amplifyMultiplier - 1) * 100,
    finalDmg: (shared.finalDmgMultiplier - 1) * 100,
    resMult: shared.resMult,
    defMult: shared.defenseMultiplier,
    dmgVulnMult: shared.dmgVulnMultiplier,
    dmgBonusMult: shared.damageBonusMultiplier,
    ampMult: shared.amplifyMultiplier,
    finalDmgMult: shared.finalDmgMultiplier,
    scalingAtk: skill.scaling.atk,
    scalingHp: skill.scaling.hp,
    scalingDef: skill.scaling.def,
    scalingER: skill.scaling.energyRegen,
    multiplier: skill.multiplier,
    hitScale: hits.length > 0 ? hitSummary.hitScale : skill.multiplier,
    hitCount: hits.length > 0 ? hitSummary.hitCount : 1,
    flatDmg: finalStats.flatDmg + skill.flat,
    fixedDmg: skill.fixedDmg ?? 0,
  }
}

// expose a detailed direct-damage calculation context for debugging or inspection
export function makeSkillDamage(
    finalStats: FinalStats,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
): DirectSkillCtx {
  const shared = calcDamageCtx(finalStats, skill, enemy, level)
  return makeDirectSkill(finalStats, skill, shared)
}

export interface DamageCombatState {
  spectroFrazzle?: number
  spctFrzz?: number
  aeroErosion?: number
  fusionBurst?: number
  glacioChafe?: number
  electroFlare?: number
  electroRage?: number
}

export interface NumericDamageLane {
  finals: Float64Array
  offset: number
  immunityAll: number
  immunityElements: number
  immunitySkillTypes: number
  immunityNegative: number
}

export interface NumericEffectiveStats {
  atk: number | null
  hp: number | null
  def: number | null
  multiplier: number | null
  critRate: number | null
  critDmg: number | null
  bonus: number | null
  amplify: number | null
  energyRegen: number | null
  defIgnore: number | null
  defShred: number | null
  dmgVuln: number | null
  resistance: number | null
  tuneBreakBoost: number | null
  finalDmg: number | null
  flatDmg: number | null
}

const skillTypeIndex = new Map(NUMERIC_SKILL_TYPES.map((field, index) => [field, index]))

function objectDamageLane(finalStats: FinalStats): NumericDamageLane {
  let elements = 0
  let skillTypes = 0
  let negative = 0
  const immunities = finalStats.immunities
  for (const key of immunities?.elements ?? []) {
    const index = NUMERIC_ATTRIBUTES.indexOf(key)
    if (index > 0) elements |= 1 << (index - 1)
  }
  for (const key of immunities?.skillTypes ?? []) {
    const index = NUMERIC_SKILL_TYPES.indexOf(key)
    if (index >= 0) skillTypes |= 1 << index
  }
  for (const key of immunities?.negativeEffects ?? []) {
    const index = NUMERIC_NEGATIVE_EFFECTS.indexOf(key)
    if (index >= 0) negative |= 1 << index
  }
  return {
    finals: packFinalStats(finalStats),
    offset: 0,
    immunityAll: immunities?.all ? 1 : 0,
    immunityElements: elements,
    immunitySkillTypes: skillTypes,
    immunityNegative: negative,
  }
}

function teamDamageLane(
    state: NumericTeamState,
    lane: number,
    finals: Float64Array = state.finals,
): NumericDamageLane {
  // reading derived stats is the point where any deferred rebuild has to land
  syncNumericTeam(state)
  return {
    finals,
    offset: finals === state.finals ? lane * NUMERIC_FINAL_CELL_COUNT : 0,
    immunityAll: state.immunityAll[lane] ?? 0,
    immunityElements: state.immunityElements[lane] ?? 0,
    immunitySkillTypes: state.immunitySkillTypes[lane] ?? 0,
    immunityNegative: state.immunityNegative[lane] ?? 0,
  }
}

function numericFinal(lane: NumericDamageLane, cell: number): number {
  return lane.finals[lane.offset + cell] ?? 0
}

function numericTop(lane: NumericDamageLane, stat: Parameters<typeof finalTopCell>[0]): number {
  return numericFinal(lane, finalTopCell(stat))
}

function numericAttribute(
    lane: NumericDamageLane,
    attribute: 'all' | AttributeKey,
    field: keyof ModBuff,
): number {
  return numericFinal(lane, finalAttributeCell(attribute, field))
}

function numericSkillType(
    lane: NumericDamageLane,
    skillType: SkillTypeKey,
    field: keyof ModBuff,
): number {
  return numericFinal(lane, finalSkillTypeCell(skillType, field))
}

function numericSkillTypes(
    lane: NumericDamageLane,
    skillTypes: readonly SkillTypeKey[],
    field: keyof ModBuff,
): number {
  let value = 0
  let seen = 0
  for (const skillType of skillTypes) {
    if (skillType === 'all') continue
    const index = skillTypeIndex.get(skillType) ?? 0
    const bit = 1 << index
    if (seen & bit) continue
    seen |= bit
    value += numericSkillType(lane, skillType, field)
  }
  return value
}

function numericLayer(
    lane: NumericDamageLane,
    skill: SkillDef,
    field: keyof ModBuff,
): number {
  return numericAttribute(lane, 'all', field)
    + numericAttribute(lane, skill.element, field)
    + numericSkillType(lane, 'all', field)
    + numericSkillTypes(lane, skill.skillType, field)
    + (skill.skillBuffs?.[field] ?? 0)
}

function numericBasePower(lane: NumericDamageLane, skill: SkillDef): number {
  return numericFinal(lane, finalCoreCell('atk', 'final')) * skill.scaling.atk
    + numericFinal(lane, finalCoreCell('hp', 'final')) * skill.scaling.hp
    + numericFinal(lane, finalCoreCell('def', 'final')) * skill.scaling.def
    + numericTop(lane, 'energyRegen') * skill.scaling.energyRegen
}

function numericImmune(lane: NumericDamageLane, skill: SkillDef): boolean {
  if (lane.immunityAll) return true
  const attribute = NUMERIC_ATTRIBUTES.indexOf(skill.element) - 1
  if (attribute >= 0 && (lane.immunityElements & (1 << attribute))) return true
  for (const type of skill.skillType) {
    const index = skillTypeIndex.get(type)
    if (index !== undefined && (lane.immunitySkillTypes & (1 << index))) return true
  }
  const negative = NUMERIC_NEGATIVE_EFFECTS.indexOf(skill.archetype as NegEffectKey)
  return negative >= 0 && Boolean(lane.immunityNegative & (1 << negative))
}

function numericSkillMultiplier(skill: SkillDef): number {
  if (skill.hits.length > 0) {
    let total = 0
    for (const hit of skill.hits) total += hit.multiplier * hit.count
    return total
  }
  return (skill.archetype === 'tuneRupture' || skill.archetype === 'hack')
    ? skill.tuneRuptureScale ?? 16
    : skill.multiplier
}

/**
 * Extract the rotation register directly from the exact numeric final plane
 * used by the damage kernel. This is deliberately a projection rather than a
 * second calculation route: no FinalStats, buff-pool, or CombatContext object
 * is materialized for captured feature rows.
 */
export function resolveNumericEffectiveStats(
    state: NumericTeamState,
    laneIndex: number,
    finals: Float64Array,
    skill: SkillDef,
    enemy: EnemyProfile,
): NumericEffectiveStats {
  const lane = teamDamageLane(state, laneIndex, finals)
  const skillBuff = (field: keyof ModBuff): number => skill.skillBuffs?.[field] ?? 0
  const type = (field: keyof ModBuff): number => numericSkillTypes(lane, skill.skillType, field)
  const allType = (field: keyof ModBuff): number => numericSkillType(lane, 'all', field)
  const attr = (field: keyof ModBuff): number =>
    numericAttribute(lane, 'all', field) + numericAttribute(lane, skill.element, field)
  const layered = (field: keyof ModBuff): number =>
    attr(field) + allType(field) + type(field) + skillBuff(field)
  const noEnemy = isNoEnemy(enemy)
  const resistance = noEnemy
    ? null
    : getEnemyRes(enemy, skill.element) - layered('resShred')
  const base: NumericEffectiveStats = {
    atk: numericFinal(lane, finalCoreCell('atk', 'final')),
    hp: numericFinal(lane, finalCoreCell('hp', 'final')),
    def: numericFinal(lane, finalCoreCell('def', 'final')),
    multiplier: numericSkillMultiplier(skill),
    critRate: numericTop(lane, 'critRate'),
    critDmg: numericTop(lane, 'critDmg'),
    bonus: numericTop(lane, 'dmgBonus'),
    amplify: numericTop(lane, 'amplify'),
    energyRegen: numericTop(lane, 'energyRegen'),
    defIgnore: numericTop(lane, 'defIgnore') + layered('defIgnore'),
    defShred: numericTop(lane, 'defShred') + layered('defShred'),
    dmgVuln: numericTop(lane, 'dmgVuln') + layered('dmgVuln'),
    resistance,
    tuneBreakBoost: numericTop(lane, 'tuneBreakBoost'),
    finalDmg: numericTop(lane, 'finalDmg'),
    flatDmg: numericTop(lane, 'flatDmg') + skill.flat,
  }

  if (skill.archetype === 'healing') {
    return { ...base, bonus: numericTop(lane, 'healingBonus') + (skill.skillHealingBonus ?? 0) }
  }
  if (skill.archetype === 'shield') {
    return { ...base, bonus: numericTop(lane, 'shieldBonus') + (skill.skillShieldBonus ?? 0) }
  }
  if (skill.archetype === 'tuneRupture' || skill.archetype === 'hack') {
    return {
      ...base,
      ...(skill.archetype === 'tuneRupture'
        ? {
          critRate: (skill.tuneRuptureCritRate ?? 0) * 100,
          critDmg: (skill.tuneRuptureCritDmg ?? 1) * 100,
        }
        : {}),
      bonus: numericSkillType(lane, skill.archetype, 'dmgBonus'),
      amplify: numericTop(lane, 'amplify'),
      defIgnore: type('defIgnore') + skillBuff('defIgnore'),
    }
  }
  if (NUMERIC_NEGATIVE_EFFECTS.includes(skill.archetype as NegEffectKey)) {
    const archetype = skill.archetype as NegEffectKey
    return {
      ...base,
      critRate: ((skill.negativeEffectCritRate ?? 0) * 100)
        + numericFinal(lane, finalNegativeCell(archetype, 'critRate')),
      critDmg: ((skill.negativeEffectCritDmg ?? 1) * 100)
        + numericFinal(lane, finalNegativeCell(archetype, 'critDmg')),
      bonus: type('dmgBonus'),
      amplify: numericTop(lane, 'amplify') + type('amplify'),
      defIgnore: type('defIgnore') + skillBuff('defIgnore'),
      defShred: numericTop(lane, 'defShred') + attr('defShred') + type('defShred'),
      dmgVuln: numericTop(lane, 'dmgVuln') + attr('dmgVuln') + type('dmgVuln'),
      resistance: noEnemy
        ? null
        : getEnemyRes(enemy, skill.element) - attr('resShred') - type('resShred'),
    }
  }

  return {
    ...base,
    critRate: numericTop(lane, 'critRate') + layered('critRate'),
    critDmg: numericTop(lane, 'critDmg') + layered('critDmg'),
    bonus: numericTop(lane, 'dmgBonus') + layered('dmgBonus'),
    amplify: numericTop(lane, 'amplify') + layered('amplify'),
  }
}

function writeScore(target: SkillDamageScoreTarget, normal: number, crit: number, avg: number): void {
  const offset = target.offset ?? 0
  target.values[offset] = normal
  target.values[offset + 1] = crit
  target.values[offset + 2] = avg
}

/**
 * Canonical damage kernel. Every app-facing damage route reaches this function.
 * It reads a flat final-stat lane and can either write only three score scalars
 * or additionally capture the exact per-hit rows from the same arithmetic.
 */
/*
  The lowered path for ordinary direct damage. Every stat it reads was resolved
  to a cell index when the skill was compiled, so this walks index arrays and
  never touches a string, a map, or a hit object.
*/
function runLoweredSkillDamage(
    target: SkillDamageScoreTarget,
    lane: NumericDamageLane,
    record: SkillRecord,
    enemy: EnemyProfile,
    level: number,
    multiplierScale: number,
): void {
  const finals = lane.finals
  const base = lane.offset

  if (lane.immunityAll
    || (lane.immunityElements & record.attributeBit)
    || (lane.immunitySkillTypes & record.skillTypeMask)
    || (lane.immunityNegative & record.negativeBit)) {
    writeScore(target, 0, 0, 0)
    return
  }

  const noEnemy = isNoEnemy(enemy)
  const baseRes = noEnemy ? 0 : enemy.res[record.enemyResKey]
  if (baseRes === 100) {
    writeScore(target, 0, 0, 0)
    return
  }

  const cells = record.fieldCells
  const starts = record.fieldStart
  const field = (index: number): number => {
    let sum = 0
    const end = starts[index + 1]!
    for (let cursor = starts[index]!; cursor < end; cursor += 1) {
      sum += finals[base + cells[cursor]!] ?? 0
    }
    sum += record.fieldConst[index]!
    const topCell = record.fieldTopCell[index]!
    return topCell >= 0 ? (finals[base + topCell] ?? 0) + sum : sum
  }

  const defIgnore = field(FIELD_DEF_IGNORE)
  const defShred = field(FIELD_DEF_SHRED)
  const enemyDefense = noEnemy
    ? 0
    : ((8 * enemy.level) + 792) * defenseReduction(defIgnore, defShred)
  const defenseMult = noEnemy
    ? 1
    : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))

  const totalMultiplier =
    (noEnemy ? 1 : resistMult(baseRes - field(FIELD_RES_SHRED))) *
    defenseMult *
    (1 + field(FIELD_DMG_VULN) / 100) *
    (1 + field(FIELD_DMG_BONUS) / 100) *
    (1 + field(FIELD_AMPLIFY) / 100) *
    (1 + (finals[base + record.finalDmgCell] ?? 0) / 100)

  const critRate = field(FIELD_CRIT_RATE) / 100
  const critDmg = field(FIELD_CRIT_DMG) / 100
  const basePower =
    (finals[base + record.coreAtkCell] ?? 0) * record.scalingAtk
    + (finals[base + record.coreHpCell] ?? 0) * record.scalingHp
    + (finals[base + record.coreDefCell] ?? 0) * record.scalingDef
    + (finals[base + record.energyRegenCell] ?? 0) * record.scalingEnergyRegen
  const flat = (finals[base + record.flatDmgCell] ?? 0) + record.flat

  let normalTotal = 0
  let critTotal = 0
  let avgTotal = 0
  const hits = record.hits
  for (let index = 0; index < hits.length; index += 2) {
    const normal = (basePower * hits[index]! * multiplierScale + flat) * totalMultiplier
    const crit = normal * critDmg
    const avg = critRate >= 1 ? crit : crit * critRate + normal * (1 - critRate)
    const count = hits[index + 1]!
    normalTotal += normal * count
    critTotal += crit * count
    avgTotal += avg * count
  }
  writeScore(target, normalTotal, critTotal, avgTotal)
}

function runNumericDamageKernel(
    target: SkillDamageScoreTarget,
    lane: NumericDamageLane,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
    combatState: DamageCombatState | undefined,
    multiplierScale: number,
    subHits?: DamageResult['subHits'],
): void {
  /*
    Sub-hit rows are the one thing the lowered path does not produce, because
    they exist to be displayed rather than summed.
  */
  if (!subHits) {
    const record = compileSkillRecord(skill)
    if (record.lowered) {
      runLoweredSkillDamage(target, lane, record, enemy, level, multiplierScale)
      return
    }
  }

  let normalTotal = 0
  let critTotal = 0
  let avgTotal = 0
  const emit = (hit: SkillDef['hits'][number], normal: number, crit: number, avg: number) => {
    normalTotal += normal * hit.count
    critTotal += crit * hit.count
    avgTotal += avg * hit.count
    subHits?.push({ ...hit, normal, crit, avg })
  }
  const zero = () => {
    if (subHits) {
      for (const hit of skill.hits) subHits.push({ ...hit, normal: 0, crit: 0, avg: 0 })
    }
    writeScore(target, 0, 0, 0)
  }

  if (skill.archetype !== 'healing' && skill.archetype !== 'shield' && numericImmune(lane, skill)) {
    zero()
    return
  }

  if (skill.archetype === 'healing' || skill.archetype === 'shield') {
    const bonus = skill.archetype === 'healing'
      ? numericTop(lane, 'healingBonus') + (skill.skillHealingBonus ?? 0)
      : numericTop(lane, 'shieldBonus') + (skill.skillShieldBonus ?? 0)
    const value = Math.max(
      1,
      (numericBasePower(lane, skill) * skill.multiplier * multiplierScale + skill.flat) *
        (1 + bonus / 100),
    )
    writeScore(target, 0, 0, value)
    return
  }

  if (skill.archetype === 'skillDamage') {
    if ((skill.fixedDmg ?? 0) > 0) {
      const value = Math.max(1, skill.fixedDmg ?? 0)
      const hits = resolveHits(skill, 1)
      let totalScale = 0
      for (const hit of hits) totalScale += hit.multiplier * multiplierScale * hit.count
      for (const hit of hits) {
        const scaled = hit.multiplier * multiplierScale
        const normal = totalScale > 0 ? value * scaled / totalScale : value
        emit(hit, normal, normal, normal)
      }
      writeScore(target, normalTotal, critTotal, avgTotal)
      return
    }

    const noEnemy = isNoEnemy(enemy)
    const baseRes = noEnemy ? 0 : getEnemyRes(enemy, skill.element)
    if (baseRes === 100) {
      zero()
      return
    }
    const defIgnore = numericTop(lane, 'defIgnore') + numericLayer(lane, skill, 'defIgnore')
    const defShred = numericTop(lane, 'defShred') + numericLayer(lane, skill, 'defShred')
    const enemyDefense = noEnemy
      ? 0
      : ((8 * enemy.level) + 792) * defenseReduction(defIgnore, defShred)
    const defenseMult = noEnemy
      ? 1
      : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))
    const totalMultiplier =
      (noEnemy ? 1 : resistMult(baseRes - numericLayer(lane, skill, 'resShred'))) *
      defenseMult *
      (1 + (numericTop(lane, 'dmgVuln') + numericLayer(lane, skill, 'dmgVuln')) / 100) *
      (1 + (numericTop(lane, 'dmgBonus') + numericLayer(lane, skill, 'dmgBonus')) / 100) *
      (1 + (numericTop(lane, 'amplify') + numericLayer(lane, skill, 'amplify')) / 100) *
      (1 + numericTop(lane, 'finalDmg') / 100)
    const critRate = (numericTop(lane, 'critRate') + numericLayer(lane, skill, 'critRate')) / 100
    const critDmg = (numericTop(lane, 'critDmg') + numericLayer(lane, skill, 'critDmg')) / 100
    const basePower = numericBasePower(lane, skill)
    const flat = numericTop(lane, 'flatDmg') + skill.flat
    for (const hit of skill.hits) {
      const normal = (basePower * hit.multiplier * multiplierScale + flat) * totalMultiplier
      const crit = normal * critDmg
      const avg = critRate >= 1 ? crit : crit * critRate + normal * (1 - critRate)
      emit(hit, normal, crit, avg)
    }
    writeScore(target, normalTotal, critTotal, avgTotal)
    return
  }

  if (skill.archetype === 'tuneRupture' || skill.archetype === 'hack') {
    const baseRes = getEnemyRes(enemy, skill.element)
    if (baseRes === 100) {
      zero()
      return
    }
    const kind = skill.archetype
    const defIgnore = numericSkillTypes(lane, skill.skillType, 'defIgnore')
      + (skill.skillBuffs?.defIgnore ?? 0)
    const defShred = numericTop(lane, 'defShred') + numericLayer(lane, skill, 'defShred')
    const enemyDefense = ((8 * enemy.level) + 792) * defenseReduction(defIgnore, defShred)
    const defenseMult = (800 + 8 * level) /
      (800 + 8 * level + Math.max(0, enemyDefense))
    const classMult = enemy.class === 3 || enemy.class === 4 ? 14 : enemy.class === 2 ? 3 : 1
    const perHit =
      resistMult(baseRes - numericLayer(lane, skill, 'resShred')) *
      defenseMult *
      (1 + (numericTop(lane, 'dmgVuln') + numericLayer(lane, skill, 'dmgVuln')) / 100) *
      classMult *
      (1 + numericTop(lane, 'amplify') / 100) *
      (1 + numericSkillType(lane, kind, 'dmgBonus') / 100) *
      (1 + numericTop(lane, 'tuneBreakBoost') / 100)
    const critDmg = kind === 'tuneRupture' ? (skill.tuneRuptureCritDmg ?? 1) : 1
    const critRate = kind === 'tuneRupture' ? (skill.tuneRuptureCritRate ?? 0) : 0
    const levelScale = getTuneLevel(level)
    for (const hit of resolveHits(skill, skill.tuneRuptureScale ?? 16)) {
      const normal = hit.multiplier * multiplierScale * levelScale * perHit
      const crit = normal * critDmg
      const avg = critRate >= 1 ? crit : crit * critRate + normal * (1 - critRate)
      emit(hit, normal, crit, avg)
    }
    writeScore(target, normalTotal, critTotal, avgTotal)
    return
  }

  const archetype = skill.archetype as Extract<
    NegEffectKey,
    'spectroFrazzle' | 'aeroErosion' | 'fusionBurst' | 'glacioChafe' | 'electroFlare'
  >
  const stacks = combatState?.[archetype]
    ?? (archetype === 'spectroFrazzle' ? combatState?.spctFrzz : 0)
    ?? 0
  const stackCount = skill.stackMode === 'fixedMax'
    ? skill.stackMax ?? getNegEffectDef(archetype)
    : stacks
  const additional = archetype === 'electroFlare' && stacks > getNegEffectDef('electroFlare')
    ? (combatState?.electroRage ?? 0)
    : 0
  if (stackCount <= 0 && additional <= 0) {
    zero()
    return
  }
  const element = NEG_EFFECT_ELEM[archetype]
  const noEnemy = isNoEnemy(enemy)
  const baseRes = noEnemy ? 0 : getEnemyRes(enemy, element)
  if (baseRes === 100) {
    zero()
    return
  }
  const typeResShred = numericSkillTypes(lane, skill.skillType, 'resShred')
  const typeDefIgnore = numericSkillTypes(lane, skill.skillType, 'defIgnore')
  const typeDefShred = numericSkillTypes(lane, skill.skillType, 'defShred')
  const typeDmgVuln = numericSkillTypes(lane, skill.skillType, 'dmgVuln')
  const defShred = numericTop(lane, 'defShred')
    + numericAttribute(lane, 'all', 'defShred')
    + numericAttribute(lane, element, 'defShred')
    + typeDefShred
  const enemyDefense = noEnemy
    ? 0
    : ((8 * enemy.level) + 792) * defenseReduction(
      typeDefIgnore + (skill.skillBuffs?.defIgnore ?? 0),
      defShred,
    )
  const defenseMult = noEnemy
    ? 1
    : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))
  const perStack = getNegBase(archetype, level, stackCount, { fixedMv: skill.fixedMv })
    + (archetype === 'electroFlare'
      ? getNegBase(archetype, level, additional, { fixedMv: skill.fixedMv })
      : 0)
  const multiplier =
    perStack *
    (1 + numericTop(lane, 'amplify') / 100) *
    (1 + numericSkillTypes(lane, skill.skillType, 'amplify') / 100) *
    (1 + numericSkillTypes(lane, skill.skillType, 'dmgBonus') / 100) *
    (1 + numericTop(lane, 'finalDmg') / 100) *
    (noEnemy
      ? 1
      : resistMult(
        baseRes
        - numericAttribute(lane, 'all', 'resShred')
        - numericAttribute(lane, element, 'resShred')
        - typeResShred,
      )) *
    defenseMult *
    (1 + numericFinal(lane, finalNegativeCell(archetype, 'multiplier'))) *
    (1 + (
      numericTop(lane, 'dmgVuln')
      + numericAttribute(lane, 'all', 'dmgVuln')
      + numericAttribute(lane, element, 'dmgVuln')
      + typeDmgVuln
    ) / 100)
  const critRate = (skill.negativeEffectCritRate ?? 0)
    + numericFinal(lane, finalNegativeCell(archetype, 'critRate')) / 100
  const critDmg = (skill.negativeEffectCritDmg ?? 1)
    + numericFinal(lane, finalNegativeCell(archetype, 'critDmg')) / 100
  for (const hit of resolveHits(skill, 1)) {
    const normal = hit.multiplier * multiplierScale * multiplier
    const crit = normal * critDmg
    const avg = critRate >= 1 ? crit : crit * critRate + normal * (1 - critRate)
    emit(hit, normal, crit, avg)
  }
  writeScore(target, normalTotal, critTotal, avgTotal)
}

/**
 * Score one recorded invocation against a caller-owned stat plane. Recorded
 * replay owns its own lane view, because the team state that produced it is
 * long gone by the time it is replayed.
 */
export function scoreDamageAgainstLane(
    target: SkillDamageScoreTarget,
    lane: NumericDamageLane,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
    combatState: DamageCombatState | undefined,
    multiplierScale: number,
): void {
  runNumericDamageKernel(target, lane, skill, enemy, level, combatState, multiplierScale)
}

/** Object compatibility boundary. Object stats are packed once, then use the same kernel. */
export function calcSkillDamageScoreInto(
    target: SkillDamageScoreTarget,
    finalStats: FinalStats,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
    combatState?: DamageCombatState,
    multiplierScale = 1,
): void {
  runNumericDamageKernel(
    target,
    objectDamageLane(finalStats),
    skill,
    enemy,
    level,
    combatState,
    multiplierScale,
  )
}

/** Allocation-free score execution against a prepared three-lane team state. */
export function calcPackedSkillDamageScoreInto(
    target: SkillDamageScoreTarget,
    state: NumericTeamState,
    lane: number,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
    combatState?: DamageCombatState,
    multiplierScale = 1,
): void {
  runNumericDamageKernel(
    target,
    teamDamageLane(state, lane),
    skill,
    enemy,
    level,
    combatState,
    multiplierScale,
  )
}

/** Score a caller-owned final plane while reusing the team's immunity lane. */
export function calcNumericPlaneSkillDamageScoreInto(
    target: SkillDamageScoreTarget,
    state: NumericTeamState,
    lane: number,
    finals: Float64Array,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
    combatState?: DamageCombatState,
    multiplierScale = 1,
): void {
  runNumericDamageKernel(
    target,
    teamDamageLane(state, lane, finals),
    skill,
    enemy,
    level,
    combatState,
    multiplierScale,
  )
}

/** Detailed output is optional capture from the same flat numeric kernel. */
export function calcNumericSkillDamage(
    state: NumericTeamState,
    lane: number,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
    combatState?: DamageCombatState,
    options?: CalcSkillDamageOptions,
): DamageResult {
  const values = new Float64Array(3)
  const subHits: DamageResult['subHits'] = []
  runNumericDamageKernel(
    { values },
    teamDamageLane(state, lane),
    skill,
    enemy,
    level,
    combatState,
    1,
    shldInclSubHits(options) ? subHits : undefined,
  )
  return { normal: values[0]!, crit: values[1]!, avg: values[2]!, subHits }
}

/** Detailed capture from a caller-owned final plane. */
export function calcNumericPlaneSkillDamage(
    state: NumericTeamState,
    lane: number,
    finals: Float64Array,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
    combatState?: DamageCombatState,
    options?: CalcSkillDamageOptions,
): DamageResult {
  const values = new Float64Array(3)
  const subHits: DamageResult['subHits'] = []
  runNumericDamageKernel(
    { values },
    teamDamageLane(state, lane, finals),
    skill,
    enemy,
    level,
    combatState,
    1,
    shldInclSubHits(options) ? subHits : undefined,
  )
  return { normal: values[0]!, crit: values[1]!, avg: values[2]!, subHits }
}

/**
 * Legacy-shaped API retained for external callers. It is now only a packing
 * boundary; it no longer owns a second formula implementation.
 */
export function calcSkillDamage(
    finalStats: FinalStats,
    skill: SkillDef,
    enemy: EnemyProfile,
    level: number,
    combatState?: DamageCombatState,
    options?: CalcSkillDamageOptions,
): DamageResult {
  const values = new Float64Array(3)
  const subHits: DamageResult['subHits'] = []
  runNumericDamageKernel(
    { values },
    objectDamageLane(finalStats),
    skill,
    enemy,
    level,
    combatState,
    1,
    shldInclSubHits(options) ? subHits : undefined,
  )
  return { normal: values[0]!, crit: values[1]!, avg: values[2]!, subHits }
}
