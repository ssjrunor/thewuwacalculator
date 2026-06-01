/*
  Author: Runor Ewhro
  Description: Defines shared stat, buff, and skill calculation types used
               across resonator data, final stats, and damage computation.
*/

import type { CondExpr } from '@/domain/gameData/contracts'

export type AttributeKey =
    | 'aero'
    | 'glacio'
    | 'spectro'
    | 'fusion'
    | 'electro'
    | 'havoc'
    | 'physical'

export type SkillTypeKey =
    | 'all'
    | 'basicAtk'
    | 'heavyAtk'
    | 'resonanceSkill'
    | 'resonanceLiberation'
    | 'introSkill'
    | 'outroSkill'
    | 'echoSkill'
    | 'coord'
    | 'spectroFrazzle'
    | 'aeroErosion'
    | 'fusionBurst'
    | 'havocBane'
    | 'glacioChafe'
    | 'electroFlare'
    | 'healing'
    | 'shield'
    | 'tuneRupture'
    | 'hack'

export type SkillArch =
    | 'skillDamage'
    | 'tuneRupture'
    | 'hack'
    | 'spectroFrazzle'
    | 'aeroErosion'
    | 'fusionBurst'
    | 'glacioChafe'
    | 'electroFlare'
    | 'healing'
    | 'shield'

export type SkillAggType = 'damage' | 'healing' | 'shield'

export interface BaseStatBuff {
  percent: number
  flat: number
}

export interface ModBuff {
  resShred: number
  dmgBonus: number
  amplify: number
  defIgnore: number
  defShred: number
  dmgVuln: number
  critRate: number
  critDmg: number
}

export type NegEffectKey =
    | 'spectroFrazzle'
    | 'aeroErosion'
    | 'fusionBurst'
    | 'havocBane'
    | 'glacioChafe'
    | 'electroFlare'

export interface NegEffectBuff {
  critRate: number
  critDmg: number
  multiplier: number
}

// scoped damage immunities applied against an enemy. a skill deals zero damage when it matches
// any populated scope: `all`, its `element`, any of its `skillTypes`, or its negative-effect archetype.
export interface ImmunitySet {
  all: boolean
  elements: AttributeKey[]
  skillTypes: SkillTypeKey[]
  negativeEffects: NegEffectKey[]
}

export type AttrBuffs = Record<'all' | AttributeKey, ModBuff>
export type SkillTypeBuffs = Record<SkillTypeKey, ModBuff>
export type NegEffectBuffs = Record<NegEffectKey, NegEffectBuff>

export interface UnifiedBuffPool {
  atk: BaseStatBuff
  hp: BaseStatBuff
  def: BaseStatBuff
  attribute: AttrBuffs
  skillType: SkillTypeBuffs
  negativeEffect: NegEffectBuffs
  flatDmg: number
  amplify: number
  critRate: number
  critDmg: number
  energyRegen: number
  healingBonus: number
  shieldBonus: number
  dmgBonus: number
  defIgnore: number
  defShred: number
  dmgVuln: number
  tuneBreakBoost: number
  special: number
  immunities: ImmunitySet
}

export interface ResBaseStats {
  hp: number
  atk: number
  def: number
  critRate: number
  critDmg: number
  energyRegen: number
  healingBonus: number
  tuneBreakBoost: number
}

export interface FinalStats {
  atk: { base: number; final: number }
  hp: { base: number; final: number }
  def: { base: number; final: number }
  attribute: AttrBuffs
  skillType: SkillTypeBuffs
  negativeEffect: NegEffectBuffs
  flatDmg: number
  amplify: number
  critRate: number
  critDmg: number
  energyRegen: number
  healingBonus: number
  shieldBonus: number
  dmgBonus: number
  defIgnore: number
  defShred: number
  dmgVuln: number
  tbb: number
  special: number
  immunities?: ImmunitySet
}

export interface ScalingStats {
  atk: number
  hp: number
  def: number
  energyRegen: number
}

export type SkillLevelSrc =
    | 'normalAttack'
    | 'resonanceSkill'
    | 'forteCircuit'
    | 'resonanceLiberation'
    | 'introSkill'
    | 'tuneBreak'

export interface SkillHitTable {
  label?: string
  count: number
  values: number[]
}

export interface SkillSubHit {
  label?: string
  count: number
  multiplier: number
  normal: number
  crit: number
  avg: number
}

export interface SkillDef {
  id: string
  label: string
  tab: string
  sectionTitle?: string
  // ordered skill types; the primary display type is always skillType[0]
  skillType: SkillTypeKey[]
  archetype: SkillArch
  aggregationType: SkillAggType
  element: AttributeKey
  multiplier: number
  multiplierValues?: number[]
  flat: number
  flatValues?: number[]
  fixedDmg?: number
  fixedDmgValues?: number[]
  scaling: ScalingStats
  skillBuffs?: Partial<ModBuff>
  skillHealingBonus?: number
  skillShieldBonus?: number
  // legacy fallback for manually-authored seeds without explicit tune rupture hits
  tuneRuptureScale?: number
  tuneRuptureCritRate?: number
  tuneRuptureCritDmg?: number
  negativeEffectCritRate?: number
  negativeEffectCritDmg?: number
  levelSource?: SkillLevelSrc | null
  visible?: boolean
  visibleWhen?: CondExpr
  skillTypeWhen?: Array<{
    when: CondExpr
    skillType: SkillTypeKey[]
  }>
  hits: Array<{
    label?: string
    count: number
    multiplier: number
  }>
  hitTable?: SkillHitTable[]
  fixedMv?: number
}

export interface SkillCalcResult {
  normal: number
  crit: number
  avg: number
  subHits: SkillSubHit[]
}

export type DamageResult = SkillCalcResult
