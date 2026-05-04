/*
  Author: Runor Ewhro
  Description: Defines shared stat, buff, and skill calculation types used
               across resonator data, final stats, and damage computation.
*/

import type { ConditionExpression } from '@/domain/gameData/contracts'

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

export type SkillArchetype =
    | 'skillDamage'
    | 'tuneRupture'
    | 'spectroFrazzle'
    | 'aeroErosion'
    | 'fusionBurst'
    | 'glacioChafe'
    | 'electroFlare'
    | 'healing'
    | 'shield'

export type SkillAggregationType = 'damage' | 'healing' | 'shield'

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

export type NegativeEffectKey =
    | 'spectroFrazzle'
    | 'aeroErosion'
    | 'fusionBurst'
    | 'havocBane'
    | 'glacioChafe'
    | 'electroFlare'

export interface NegativeEffectBuff {
  critRate: number
  critDmg: number
  multiplier: number
}

export type AttributeBucket = Record<'all' | AttributeKey, ModBuff>
export type SkillTypeBucket = Record<SkillTypeKey, ModBuff>
export type NegativeEffectBucket = Record<NegativeEffectKey, NegativeEffectBuff>

export interface UnifiedBuffPool {
  atk: BaseStatBuff
  hp: BaseStatBuff
  def: BaseStatBuff
  attribute: AttributeBucket
  skillType: SkillTypeBucket
  negativeEffect: NegativeEffectBucket
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
}

export interface ResonatorBaseStats {
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
  attribute: AttributeBucket
  skillType: SkillTypeBucket
  negativeEffect: NegativeEffectBucket
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
}

export interface ScalingVector {
  atk: number
  hp: number
  def: number
  energyRegen: number
}

export type SkillLevelSourceKey =
    | 'normalAttack'
    | 'resonanceSkill'
    | 'forteCircuit'
    | 'resonanceLiberation'
    | 'introSkill'
    | 'tuneBreak'

export interface SkillHitTableEntry {
  label?: string
  count: number
  values: number[]
}

export interface SkillSubHitResult {
  label?: string
  count: number
  multiplier: number
  normal: number
  crit: number
  avg: number
}

export interface SkillDefinition {
  id: string
  label: string
  tab: string
  sectionTitle?: string
  // ordered skill types; the primary display type is always skillType[0]
  skillType: SkillTypeKey[]
  archetype: SkillArchetype
  aggregationType: SkillAggregationType
  element: AttributeKey
  multiplier: number
  multiplierValues?: number[]
  flat: number
  flatValues?: number[]
  fixedDmg?: number
  fixedDmgValues?: number[]
  scaling: ScalingVector
  skillBuffs?: Partial<ModBuff>
  skillHealingBonus?: number
  skillShieldBonus?: number
  // legacy fallback for manually-authored seeds without explicit tune rupture hits
  tuneRuptureScale?: number
  tuneRuptureCritRate?: number
  tuneRuptureCritDmg?: number
  negativeEffectCritRate?: number
  negativeEffectCritDmg?: number
  levelSource?: SkillLevelSourceKey | null
  visible?: boolean
  visibleWhen?: ConditionExpression
  skillTypeWhen?: Array<{
    when: ConditionExpression
    skillType: SkillTypeKey[]
  }>
  hits: Array<{
    label?: string
    count: number
    multiplier: number
  }>
  hitTable?: SkillHitTableEntry[]
  fixedMv?: number
}

export interface SkillComputationResult {
  normal: number
  crit: number
  avg: number
  subHits: SkillSubHitResult[]
}

export type DamageResult = SkillComputationResult
