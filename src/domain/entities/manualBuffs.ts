/*
  Author: Runor Ewhro
  Description: Defines manual buff editor types for quick buffs and custom
               modifiers across stats, attributes, skill types, and skills.
*/

import type { AttributeKey, ModBuff, NegEffectBuff, NegEffectKey, SkillTypeKey } from './stats'

export type MnlBaseStatK = 'atk' | 'hp' | 'def'
export type MnlBaseStatF = 'percent' | 'flat'

export type MnlTopStatKe =
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
    | 'dmgVuln'
    | 'tuneBreakBoost'
    | 'special'

export type MnlModVlKey = keyof ModBuff
export type MnlNegFfctModKey = keyof NegEffectBuff
export type MnlModScp = 'baseStat' | 'topStat' | 'attribute' | 'skillType' | 'negativeEffect' | 'skill'
export type MnlSkllMtchM = 'skillId' | 'tab' | 'skillType' | 'archetype'
export type MnlSkllSclrK =
    | 'fixedDmg'
    | 'skillHealingBonus'
    | 'skillShieldBonus'
    | 'tuneRuptureCritRate'
    | 'tuneRuptureCritDmg'
    | 'negativeEffectCritRate'
    | 'negativeEffectCritDmg'
export type MnlSkllFfctK = 'mod' | 'addMultiplier' | 'scaleMultiplier' | 'addHitMultiplier' | 'scalar'

export interface QuickBuffs {
  atk: { flat: number; percent: number }
  hp: { flat: number; percent: number }
  def: { flat: number; percent: number }
  critRate: number
  critDmg: number
  energyRegen: number
  healingBonus: number
}

// shared manual modifier base fields
interface MnlModBase {
  id: string
  enabled: boolean
  label?: string
  scope: MnlModScp
  value: number
}

export interface MnlBaseStatM extends MnlModBase {
  scope: 'baseStat'
  stat: MnlBaseStatK
  field: MnlBaseStatF
}

export interface MnlTopStatMo extends MnlModBase {
  scope: 'topStat'
  stat: MnlTopStatKe
}

export interface MnlTtrbMod extends MnlModBase {
  scope: 'attribute'
  attribute: AttributeKey | 'all'
  mod: MnlModVlKey
}

export interface MnlSkllTypeM extends MnlModBase {
  scope: 'skillType'
  skillType: SkillTypeKey
  mod: MnlModVlKey
}

export interface MnlNegFfctM extends MnlModBase {
  scope: 'negativeEffect'
  negativeEffect: NegEffectKey
  mod: MnlNegFfctModKey
}

interface MnlSkllModBa extends MnlModBase {
  scope: 'skill'
  matchMode: MnlSkllMtchM
  skillId?: string
  tab?: string
  skillType?: SkillTypeKey
  archetype?: string
}

export interface MnlSkllBuffM extends MnlSkllModBa {
  effect: 'mod'
  mod: MnlModVlKey
}

export interface MnlSkllAddMl extends MnlSkllModBa {
  effect: 'addMultiplier'
}

export interface MnlSkllSclMl extends MnlSkllModBa {
  effect: 'scaleMultiplier'
}

export interface MnlSkllHitMl extends MnlSkllModBa {
  effect: 'addHitMultiplier'
  hitIndex: number
}

export interface MnlSkllSclrM extends MnlSkllModBa {
  effect: 'scalar'
  field: MnlSkllSclrK
}

export type MnlSkllMod =
    | MnlSkllBuffM
    | MnlSkllAddMl
    | MnlSkllSclMl
    | MnlSkllHitMl
    | MnlSkllSclrM

export type MnlMod =
    | MnlBaseStatM
    | MnlTopStatMo
    | MnlTtrbMod
    | MnlSkllTypeM
    | MnlNegFfctM
    | MnlSkllMod

export interface ManualBuffs {
  quick: QuickBuffs
  modifiers: MnlMod[]
}
