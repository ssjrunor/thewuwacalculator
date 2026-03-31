/*
  Author: Runor Ewhro
  Description: Defines manual buff editor types for quick buffs and custom
               modifiers across stats, attributes, skill types, and skills.
*/

import type { AttributeKey, ModBuff, SkillTypeKey } from './stats'

export type ManualBaseStatKey = 'atk' | 'hp' | 'def'
export type ManualBaseStatField = 'percent' | 'flat'

export type ManualTopStatKey =
    | 'flatDmg'
    | 'amplify'
    | 'critRate'
    | 'critDmg'
    | 'energyRegen'
    | 'healingBonus'
    | 'shieldBonus'
    | 'dmgBonus'
    | 'defIgnore'
    | 'defShred'
    | 'tuneBreakBoost'
    | 'special'

export type ManualModifierValueKey = keyof ModBuff
export type ManualModifierScope = 'baseStat' | 'topStat' | 'attribute' | 'skillType' | 'skill'
export type ManualSkillMatchMode = 'skillId' | 'tab'

export interface ManualQuickBuffs {
  atk: { flat: number; percent: number }
  hp: { flat: number; percent: number }
  def: { flat: number; percent: number }
  critRate: number
  critDmg: number
  energyRegen: number
  healingBonus: number
}

// shared manual modifier base fields
interface ManualModifierBase {
  id: string
  enabled: boolean
  label?: string
  scope: ManualModifierScope
  value: number
}

export interface ManualBaseStatModifier extends ManualModifierBase {
  scope: 'baseStat'
  stat: ManualBaseStatKey
  field: ManualBaseStatField
}

export interface ManualTopStatModifier extends ManualModifierBase {
  scope: 'topStat'
  stat: ManualTopStatKey
}

export interface ManualAttributeModifier extends ManualModifierBase {
  scope: 'attribute'
  attribute: AttributeKey | 'all'
  mod: ManualModifierValueKey
}

export interface ManualSkillTypeModifier extends ManualModifierBase {
  scope: 'skillType'
  skillType: SkillTypeKey
  mod: ManualModifierValueKey
}

export interface ManualSkillModifier extends ManualModifierBase {
  scope: 'skill'
  matchMode: ManualSkillMatchMode
  skillId?: string
  tab?: string
  mod: ManualModifierValueKey
}

export type ManualModifier =
    | ManualBaseStatModifier
    | ManualTopStatModifier
    | ManualAttributeModifier
    | ManualSkillTypeModifier
    | ManualSkillModifier

export interface ManualBuffs {
  quick: ManualQuickBuffs
  modifiers: ManualModifier[]
}