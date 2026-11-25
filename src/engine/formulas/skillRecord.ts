/*
  Author: Runor Ewhro
  description: resolves authored skill stat names to packed cell indices once
               before damage calculation. cell order must match the object path
               because floating point addition depends on term order.
*/

import type { ModBuff, SkillDef, SkillTypeKey } from '@/domain/entities/stats.ts'
import { ATTR_ENEMY_RES, type EnemyResistN } from '@/domain/entities/appState.ts'
import {
  NUMERIC_ATTRIBUTES,
  NUMERIC_NEGATIVE_EFFECTS,
  NUMERIC_SKILL_TYPES,
  finalAttributeCell,
  finalCoreCell,
  finalSkillTypeCell,
  finalTopCell,
} from '@/engine/rotation/numericLayout.ts'
import type { NegEffectKey } from '@/domain/entities/stats.ts'

/** the layered modifiers a direct damage skill resolves, in kernel order. */
export const SKILL_FIELDS = [
  'resShred', 'defIgnore', 'defShred', 'dmgVuln', 'dmgBonus', 'amplify', 'critRate', 'critDmg', 'resIgnore',
] as const

export type SkillField = typeof SKILL_FIELDS[number]

export const FIELD_RES_SHRED = 0
export const FIELD_RES_IGNORE = 8
export const FIELD_DEF_IGNORE = 1
export const FIELD_DEF_SHRED = 2
export const FIELD_DMG_VULN = 3
export const FIELD_DMG_BONUS = 4
export const FIELD_AMPLIFY = 5
export const FIELD_CRIT_RATE = 6
export const FIELD_CRIT_DMG = 7

/** resistance shred and ignore are layered fields without a top-level sheet stat. */
const FIELD_HAS_TOP: readonly boolean[] = [false, true, true, true, true, true, true, true, false]

export interface SkillRecord {
  /** only direct damage is lowered; anything else falls back to the object path. */
  readonly lowered: boolean

  /** [multiplier, count] pairs. */
  readonly hits: Float64Array
  readonly scalingAtk: number
  readonly scalingHp: number
  readonly scalingDef: number
  readonly scalingEnergyRegen: number
  readonly flat: number

  /** csr over `fieldCells`, one run per entry in SKILL_FIELDS. */
  readonly fieldStart: Int32Array
  readonly fieldCells: Int32Array
  readonly fieldTopCell: Int32Array
  readonly fieldConst: Float64Array

  readonly coreAtkCell: number
  readonly coreHpCell: number
  readonly coreDefCell: number
  readonly energyRegenCell: number
  readonly flatDmgCell: number
  readonly finalDmgCell: number

  /** immunity is a bit test once the names are indices. */
  readonly attributeBit: number
  readonly skillTypeMask: number
  readonly negativeBit: number

  /** which bucket of the enemy's resistances this skill is resisted by. */
  readonly enemyResKey: EnemyResistN
}

const recordCache = new WeakMap<SkillDef, SkillRecord>()

const skillTypeIndexes = new Map(NUMERIC_SKILL_TYPES.map((key, index) => [key, index]))

function uniqueSkillTypes(skillTypes: readonly SkillTypeKey[]): SkillTypeKey[] {
  const ordered: SkillTypeKey[] = []
  let seen = 0
  for (const skillType of skillTypes) {
    if (skillType === 'all') continue
    const index = skillTypeIndexes.get(skillType) ?? 0
    const bit = 1 << index
    if (seen & bit) continue
    seen |= bit
    ordered.push(skillType)
  }
  return ordered
}

export function skillTypeMaskOf(skillTypes: readonly SkillTypeKey[]): number {
  let mask = 0
  for (const skillType of skillTypes) {
    const index = skillTypeIndexes.get(skillType)
    if (index !== undefined) mask |= 1 << index
  }
  return mask
}

/**
 * lower one skill. resolved skills are immutable; their identity is the cache key.
 */
export function compileSkillRecord(skill: SkillDef): SkillRecord {
  const cached = recordCache.get(skill)
  if (cached) return cached

  const record = buildSkillRecord(skill)
  recordCache.set(skill, record)
  return record
}

function buildSkillRecord(skill: SkillDef): SkillRecord {
  const types = uniqueSkillTypes(skill.skillType)
  const fieldStart = new Int32Array(SKILL_FIELDS.length + 1)
  const fieldTopCell = new Int32Array(SKILL_FIELDS.length)
  const fieldConst = new Float64Array(SKILL_FIELDS.length)
  const cells: number[] = []

  for (let field = 0; field < SKILL_FIELDS.length; field += 1) {
    const name = SKILL_FIELDS[field]! as keyof ModBuff
    fieldStart[field] = cells.length
    /*
      the exact order the object path summed these in: every attribute, then
      every skill type, then the skill's own buffs.
    */
    cells.push(finalAttributeCell('all', name))
    cells.push(finalAttributeCell(skill.element, name))
    cells.push(finalSkillTypeCell('all', name))
    for (const skillType of types) cells.push(finalSkillTypeCell(skillType, name))
    fieldConst[field] = skill.skillBuffs?.[name] ?? 0
    fieldTopCell[field] = FIELD_HAS_TOP[field]
      ? finalTopCell(name as Parameters<typeof finalTopCell>[0])
      : -1
  }
  fieldStart[SKILL_FIELDS.length] = cells.length

  const hits = new Float64Array(skill.hits.length * 2)
  for (let index = 0; index < skill.hits.length; index += 1) {
    hits[index * 2] = skill.hits[index]!.multiplier
    hits[index * 2 + 1] = skill.hits[index]!.count
  }

  const attributeIndex = NUMERIC_ATTRIBUTES.indexOf(skill.element) - 1
  const negativeIndex = NUMERIC_NEGATIVE_EFFECTS.indexOf(skill.archetype as NegEffectKey)

  return {
    // fixed damage, healing, shields, tune rupture, hack, and the negative
    // effects each have their own shape; they stay on the object path.
    lowered: skill.archetype === 'skillDamage' && (skill.fixedDmg ?? 0) <= 0,
    hits,
    scalingAtk: skill.scaling.atk,
    scalingHp: skill.scaling.hp,
    scalingDef: skill.scaling.def,
    scalingEnergyRegen: skill.scaling.energyRegen,
    flat: skill.flat,
    fieldStart,
    fieldCells: Int32Array.from(cells),
    fieldTopCell,
    fieldConst,
    coreAtkCell: finalCoreCell('atk', 'final'),
    coreHpCell: finalCoreCell('hp', 'final'),
    coreDefCell: finalCoreCell('def', 'final'),
    energyRegenCell: finalTopCell('energyRegen'),
    flatDmgCell: finalTopCell('flatDmg'),
    finalDmgCell: finalTopCell('finalDmg'),
    attributeBit: attributeIndex >= 0 ? 1 << attributeIndex : 0,
    skillTypeMask: skillTypeMaskOf(skill.skillType),
    negativeBit: negativeIndex >= 0 ? 1 << negativeIndex : 0,
    enemyResKey: ATTR_ENEMY_RES[skill.element],
  }
}
