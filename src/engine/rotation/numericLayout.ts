/*
  Author: Runor Ewhro
  Description: Implements the numericLayout logic for the rotation module.
*/

/*
  Dense numeric layouts shared by the rotation dataflow compiler and executor.
  Authored names are resolved once during preparation; execution addresses only
  numeric cells in these arrays.
*/

import type {
  AttributeKey,
  FinalStats,
  ModBuff,
  NegEffectKey,
  ResBaseStats,
  SkillTypeKey,
  UnifiedBuffPool,
} from '@/domain/entities/stats.ts'
import type { BaseStatKey } from '@/domain/gameData/contracts.ts'
import { mkNfdBuffPoo } from '@/engine/resolvers/buffPool.ts'

export const NUMERIC_ATTRIBUTES: readonly ('all' | AttributeKey)[] = [
  'all', 'aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc', 'physical',
]

export const NUMERIC_SKILL_TYPES: readonly SkillTypeKey[] = [
  'all', 'basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation',
  'introSkill', 'outroSkill', 'echoSkill', 'coord', 'spectroFrazzle',
  'aeroErosion', 'fusionBurst', 'havocBane', 'glacioChafe', 'electroFlare',
  'healing', 'shield', 'tuneRupture', 'hack',
]

export const NUMERIC_NEGATIVE_EFFECTS: readonly NegEffectKey[] = [
  'spectroFrazzle', 'aeroErosion', 'fusionBurst', 'havocBane', 'glacioChafe',
  'electroFlare',
]

export const NUMERIC_MOD_FIELDS: readonly (keyof ModBuff)[] = [
  'resShred', 'dmgBonus', 'amplify', 'defIgnore', 'defShred', 'dmgVuln',
  'critRate', 'critDmg',
]

export const NUMERIC_TOP_STATS = [
  'flatDmg', 'amplify', 'critRate', 'critDmg', 'energyRegen', 'healingBonus',
  'shieldBonus', 'dmgBonus', 'defIgnore', 'defShred', 'dmgVuln',
  'tuneBreakBoost', 'finalDmg',
] as const

export const NUMERIC_BASE_KEYS: readonly BaseStatKey[] = ['atk', 'hp', 'def']
export const NUMERIC_NEGATIVE_FIELDS = ['critRate', 'critDmg', 'multiplier'] as const

export const POOL_BASE_OFFSET = 0
export const POOL_FIXED_OFFSET = POOL_BASE_OFFSET + NUMERIC_BASE_KEYS.length * 2
export const POOL_TOP_OFFSET = POOL_FIXED_OFFSET + NUMERIC_BASE_KEYS.length
export const POOL_ATTRIBUTE_OFFSET = POOL_TOP_OFFSET + NUMERIC_TOP_STATS.length
export const POOL_SKILL_TYPE_OFFSET =
  POOL_ATTRIBUTE_OFFSET + NUMERIC_ATTRIBUTES.length * NUMERIC_MOD_FIELDS.length
export const POOL_NEGATIVE_OFFSET =
  POOL_SKILL_TYPE_OFFSET + NUMERIC_SKILL_TYPES.length * NUMERIC_MOD_FIELDS.length
export const NUMERIC_POOL_CELL_COUNT =
  POOL_NEGATIVE_OFFSET + NUMERIC_NEGATIVE_EFFECTS.length * NUMERIC_NEGATIVE_FIELDS.length

export const FINAL_CORE_OFFSET = 0
export const FINAL_TOP_OFFSET = 6
export const FINAL_ATTRIBUTE_OFFSET = FINAL_TOP_OFFSET + NUMERIC_TOP_STATS.length
export const FINAL_SKILL_TYPE_OFFSET =
  FINAL_ATTRIBUTE_OFFSET + NUMERIC_ATTRIBUTES.length * NUMERIC_MOD_FIELDS.length
export const FINAL_NEGATIVE_OFFSET =
  FINAL_SKILL_TYPE_OFFSET + NUMERIC_SKILL_TYPES.length * NUMERIC_MOD_FIELDS.length
export const NUMERIC_FINAL_CELL_COUNT =
  FINAL_NEGATIVE_OFFSET + NUMERIC_NEGATIVE_EFFECTS.length * NUMERIC_NEGATIVE_FIELDS.length

const baseIndexes = new Map(NUMERIC_BASE_KEYS.map((key, index) => [key, index]))
const topIndexes = new Map(NUMERIC_TOP_STATS.map((key, index) => [key, index]))
const attributeIndexes = new Map(NUMERIC_ATTRIBUTES.map((key, index) => [key, index]))
const skillTypeIndexes = new Map(NUMERIC_SKILL_TYPES.map((key, index) => [key, index]))
const negativeIndexes = new Map(NUMERIC_NEGATIVE_EFFECTS.map((key, index) => [key, index]))
const modIndexes = new Map(NUMERIC_MOD_FIELDS.map((key, index) => [key, index]))
const negativeFieldIndexes = new Map(NUMERIC_NEGATIVE_FIELDS.map((key, index) => [key, index]))

export function poolBaseCell(stat: BaseStatKey, field: 'percent' | 'flat'): number {
  return POOL_BASE_OFFSET + (baseIndexes.get(stat) ?? 0) * 2 + (field === 'flat' ? 1 : 0)
}

export function poolFixedCell(stat: BaseStatKey): number {
  return POOL_FIXED_OFFSET + (baseIndexes.get(stat) ?? 0)
}

export function poolTopCell(stat: typeof NUMERIC_TOP_STATS[number]): number {
  return POOL_TOP_OFFSET + (topIndexes.get(stat) ?? 0)
}

export function poolAttributeCell(
    attribute: 'all' | AttributeKey,
    field: keyof ModBuff,
): number {
  return POOL_ATTRIBUTE_OFFSET +
    (attributeIndexes.get(attribute) ?? 0) * NUMERIC_MOD_FIELDS.length +
    (modIndexes.get(field) ?? 0)
}

export function poolSkillTypeCell(skillType: SkillTypeKey, field: keyof ModBuff): number {
  return POOL_SKILL_TYPE_OFFSET +
    (skillTypeIndexes.get(skillType) ?? 0) * NUMERIC_MOD_FIELDS.length +
    (modIndexes.get(field) ?? 0)
}

export function poolNegativeCell(
    negativeEffect: NegEffectKey,
    field: typeof NUMERIC_NEGATIVE_FIELDS[number],
): number {
  return POOL_NEGATIVE_OFFSET +
    (negativeIndexes.get(negativeEffect) ?? 0) * NUMERIC_NEGATIVE_FIELDS.length +
    (negativeFieldIndexes.get(field) ?? 0)
}

export function packBuffPool(pool: UnifiedBuffPool, output: Float64Array = new Float64Array(NUMERIC_POOL_CELL_COUNT)) {
  for (const stat of NUMERIC_BASE_KEYS) {
    output[poolBaseCell(stat, 'percent')] = pool[stat].percent
    output[poolBaseCell(stat, 'flat')] = pool[stat].flat
    output[poolFixedCell(stat)] = pool.fixedStats[stat] ?? Number.NaN
  }
  for (const stat of NUMERIC_TOP_STATS) output[poolTopCell(stat)] = pool[stat]
  for (const attribute of NUMERIC_ATTRIBUTES) {
    for (const field of NUMERIC_MOD_FIELDS) {
      output[poolAttributeCell(attribute, field)] = pool.attribute[attribute][field]
    }
  }
  for (const skillType of NUMERIC_SKILL_TYPES) {
    for (const field of NUMERIC_MOD_FIELDS) {
      output[poolSkillTypeCell(skillType, field)] = pool.skillType[skillType][field]
    }
  }
  for (const negativeEffect of NUMERIC_NEGATIVE_EFFECTS) {
    for (const field of NUMERIC_NEGATIVE_FIELDS) {
      output[poolNegativeCell(negativeEffect, field)] = pool.negativeEffect[negativeEffect][field]
    }
  }
  return output
}

/** Recalculate one participant's final numeric plane without allocating objects. */
export function deriveFinalPlane(
    base: ResBaseStats,
    weaponAttack: number,
    pool: Float64Array,
    output: Float64Array = new Float64Array(NUMERIC_FINAL_CELL_COUNT),
): Float64Array {
  const atkBase = base.atk + weaponAttack
  const bases = [atkBase, base.hp, base.def]
  for (let index = 0; index < NUMERIC_BASE_KEYS.length; index += 1) {
    const stat = NUMERIC_BASE_KEYS[index]!
    const baseValue = bases[index] ?? 0
    const fixed = pool[poolFixedCell(stat)]
    output[FINAL_CORE_OFFSET + index * 2] = baseValue
    output[FINAL_CORE_OFFSET + index * 2 + 1] = Number.isNaN(fixed)
      ? baseValue * (1 + (pool[poolBaseCell(stat, 'percent')] ?? 0) / 100) +
        (pool[poolBaseCell(stat, 'flat')] ?? 0)
      : fixed
  }

  for (let index = 0; index < NUMERIC_TOP_STATS.length; index += 1) {
    const stat = NUMERIC_TOP_STATS[index]!
    let value = pool[poolTopCell(stat)] ?? 0
    if (stat === 'critRate') value += base.critRate
    else if (stat === 'critDmg') value += base.critDmg
    else if (stat === 'energyRegen') value += base.energyRegen
    else if (stat === 'healingBonus') value += base.healingBonus
    else if (stat === 'tuneBreakBoost') value += base.tuneBreakBoost
    output[FINAL_TOP_OFFSET + index] = value
  }
  output.set(
    pool.subarray(POOL_ATTRIBUTE_OFFSET, POOL_SKILL_TYPE_OFFSET),
    FINAL_ATTRIBUTE_OFFSET,
  )
  output.set(
    pool.subarray(POOL_SKILL_TYPE_OFFSET, POOL_NEGATIVE_OFFSET),
    FINAL_SKILL_TYPE_OFFSET,
  )
  output.set(pool.subarray(POOL_NEGATIVE_OFFSET), FINAL_NEGATIVE_OFFSET)
  return output
}

/** Cold parity helper used only by tests and captured-result materialization. */
export function packFinalStats(finalStats: FinalStats): Float64Array {
  const output = new Float64Array(NUMERIC_FINAL_CELL_COUNT)
  const cores = [finalStats.atk, finalStats.hp, finalStats.def]
  for (let index = 0; index < cores.length; index += 1) {
    output[FINAL_CORE_OFFSET + index * 2] = cores[index]?.base ?? 0
    output[FINAL_CORE_OFFSET + index * 2 + 1] = cores[index]?.final ?? 0
  }
  const topValues: Record<typeof NUMERIC_TOP_STATS[number], number> = {
    flatDmg: finalStats.flatDmg,
    amplify: finalStats.amplify,
    critRate: finalStats.critRate,
    critDmg: finalStats.critDmg,
    energyRegen: finalStats.energyRegen,
    healingBonus: finalStats.healingBonus,
    shieldBonus: finalStats.shieldBonus,
    dmgBonus: finalStats.dmgBonus,
    defIgnore: finalStats.defIgnore,
    defShred: finalStats.defShred,
    dmgVuln: finalStats.dmgVuln,
    tuneBreakBoost: finalStats.tbb,
    finalDmg: finalStats.finalDmg,
  }
  for (let index = 0; index < NUMERIC_TOP_STATS.length; index += 1) {
    output[FINAL_TOP_OFFSET + index] = topValues[NUMERIC_TOP_STATS[index]!] ?? 0
  }
  for (const attribute of NUMERIC_ATTRIBUTES) {
    for (const field of NUMERIC_MOD_FIELDS) {
      output[FINAL_ATTRIBUTE_OFFSET +
        (attributeIndexes.get(attribute) ?? 0) * NUMERIC_MOD_FIELDS.length +
        (modIndexes.get(field) ?? 0)] = finalStats.attribute[attribute][field]
    }
  }
  for (const skillType of NUMERIC_SKILL_TYPES) {
    for (const field of NUMERIC_MOD_FIELDS) {
      output[FINAL_SKILL_TYPE_OFFSET +
        (skillTypeIndexes.get(skillType) ?? 0) * NUMERIC_MOD_FIELDS.length +
        (modIndexes.get(field) ?? 0)] = finalStats.skillType[skillType][field]
    }
  }
  for (const negativeEffect of NUMERIC_NEGATIVE_EFFECTS) {
    for (const field of NUMERIC_NEGATIVE_FIELDS) {
      output[FINAL_NEGATIVE_OFFSET +
        (negativeIndexes.get(negativeEffect) ?? 0) * NUMERIC_NEGATIVE_FIELDS.length +
        (negativeFieldIndexes.get(field) ?? 0)] = finalStats.negativeEffect[negativeEffect][field]
    }
  }
  return output
}

export function finalCoreCell(stat: BaseStatKey, field: 'base' | 'final'): number {
  return FINAL_CORE_OFFSET + (baseIndexes.get(stat) ?? 0) * 2 + (field === 'final' ? 1 : 0)
}

export function finalTopCell(stat: typeof NUMERIC_TOP_STATS[number]): number {
  return FINAL_TOP_OFFSET + (topIndexes.get(stat) ?? 0)
}

export function finalAttributeCell(
    attribute: 'all' | AttributeKey,
    field: keyof ModBuff,
): number {
  return FINAL_ATTRIBUTE_OFFSET +
    (attributeIndexes.get(attribute) ?? 0) * NUMERIC_MOD_FIELDS.length +
    (modIndexes.get(field) ?? 0)
}

export function finalSkillTypeCell(skillType: SkillTypeKey, field: keyof ModBuff): number {
  return FINAL_SKILL_TYPE_OFFSET +
    (skillTypeIndexes.get(skillType) ?? 0) * NUMERIC_MOD_FIELDS.length +
    (modIndexes.get(field) ?? 0)
}

export function finalNegativeCell(
    negativeEffect: NegEffectKey,
    field: typeof NUMERIC_NEGATIVE_FIELDS[number],
): number {
  return FINAL_NEGATIVE_OFFSET +
    (negativeIndexes.get(negativeEffect) ?? 0) * NUMERIC_NEGATIVE_FIELDS.length +
    (negativeFieldIndexes.get(field) ?? 0)
}

/** Cold object facade for existing UI and persistence consumers. */
export function unpackBuffPool(
    cells: Float64Array,
    immunities: UnifiedBuffPool['immunities'],
): UnifiedBuffPool {
  const pool = mkNfdBuffPoo()
  for (const stat of NUMERIC_BASE_KEYS) {
    pool[stat].percent = cells[poolBaseCell(stat, 'percent')] ?? 0
    pool[stat].flat = cells[poolBaseCell(stat, 'flat')] ?? 0
    const fixed = cells[poolFixedCell(stat)]
    if (!Number.isNaN(fixed)) pool.fixedStats[stat] = fixed
  }
  for (const stat of NUMERIC_TOP_STATS) pool[stat] = cells[poolTopCell(stat)] ?? 0
  for (const attribute of NUMERIC_ATTRIBUTES) {
    for (const field of NUMERIC_MOD_FIELDS) {
      pool.attribute[attribute][field] = cells[poolAttributeCell(attribute, field)] ?? 0
    }
  }
  for (const skillType of NUMERIC_SKILL_TYPES) {
    for (const field of NUMERIC_MOD_FIELDS) {
      pool.skillType[skillType][field] = cells[poolSkillTypeCell(skillType, field)] ?? 0
    }
  }
  for (const effect of NUMERIC_NEGATIVE_EFFECTS) {
    for (const field of NUMERIC_NEGATIVE_FIELDS) {
      pool.negativeEffect[effect][field] = cells[poolNegativeCell(effect, field)] ?? 0
    }
  }
  pool.immunities = immunities
  return pool
}

/** Cold object facade for existing UI and result consumers. */
export function unpackFinalStats(
    cells: Float64Array,
    pool: UnifiedBuffPool,
): FinalStats {
  return {
    atk: { base: cells[finalCoreCell('atk', 'base')] ?? 0, final: cells[finalCoreCell('atk', 'final')] ?? 0 },
    hp: { base: cells[finalCoreCell('hp', 'base')] ?? 0, final: cells[finalCoreCell('hp', 'final')] ?? 0 },
    def: { base: cells[finalCoreCell('def', 'base')] ?? 0, final: cells[finalCoreCell('def', 'final')] ?? 0 },
    attribute: pool.attribute,
    skillType: pool.skillType,
    negativeEffect: pool.negativeEffect,
    flatDmg: cells[finalTopCell('flatDmg')] ?? 0,
    amplify: cells[finalTopCell('amplify')] ?? 0,
    critRate: cells[finalTopCell('critRate')] ?? 0,
    critDmg: cells[finalTopCell('critDmg')] ?? 0,
    energyRegen: cells[finalTopCell('energyRegen')] ?? 0,
    healingBonus: cells[finalTopCell('healingBonus')] ?? 0,
    shieldBonus: cells[finalTopCell('shieldBonus')] ?? 0,
    dmgBonus: cells[finalTopCell('dmgBonus')] ?? 0,
    defIgnore: cells[finalTopCell('defIgnore')] ?? 0,
    defShred: cells[finalTopCell('defShred')] ?? 0,
    dmgVuln: cells[finalTopCell('dmgVuln')] ?? 0,
    tbb: cells[finalTopCell('tuneBreakBoost')] ?? 0,
    finalDmg: cells[finalTopCell('finalDmg')] ?? 0,
    immunities: pool.immunities,
  }
}

/** Cold boundary for consumers that need an object view of an exact VM plane. */
export function materializeFinalPlane(
    cells: Float64Array,
    offset = 0,
): FinalStats {
  const view = cells.subarray(offset, offset + NUMERIC_FINAL_CELL_COUNT)
  const pool = mkNfdBuffPoo()
  for (const attribute of NUMERIC_ATTRIBUTES) {
    for (const field of NUMERIC_MOD_FIELDS) {
      pool.attribute[attribute][field] = view[finalAttributeCell(attribute, field)] ?? 0
    }
  }
  for (const skillType of NUMERIC_SKILL_TYPES) {
    for (const field of NUMERIC_MOD_FIELDS) {
      pool.skillType[skillType][field] = view[finalSkillTypeCell(skillType, field)] ?? 0
    }
  }
  for (const effect of NUMERIC_NEGATIVE_EFFECTS) {
    for (const field of NUMERIC_NEGATIVE_FIELDS) {
      pool.negativeEffect[effect][field] = view[finalNegativeCell(effect, field)] ?? 0
    }
  }
  return unpackFinalStats(view, pool)
}
