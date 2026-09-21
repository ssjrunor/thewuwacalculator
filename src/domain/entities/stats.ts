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
  fixedStats: Partial<Record<'atk' | 'hp' | 'def', number>>
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
  /** Additive bonus applied on top of the native 1.0 (100%) baseline. */
  offTuneBuildupRate: number
  tuneBreakBoost: number
  finalDmg: number
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
  /** Resolved factor; 1 is the native 100% buildup rate. */
  offTuneBuildupRate: number
  tbb: number
  finalDmg: number
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

/**
 * One concrete DamageList packet. Unlike SkillDef, this owns the packet's
 * coefficient and combat metadata instead of inheriting them from the
 * displayed parent action.
 */
export interface SkillDamageEntry {
  id: string
  resonatorId: string
  rawSkillId: string
  skillId: string | null
  hitKey: string
  hitIndex: number | null
  label: string
  count: number
  multiplier: number
  values: number[]
  skillType: SkillTypeKey[]
  element: AttributeKey
  scaling: ScalingStats
  damageType: string
  rawType: string
  propertyName: string
  rawCondition?: string
  energy?: number
  energyValues?: number[]
  elementPower?: number
  elementPowerValues?: number[]
  hardness?: number
  hardnessValues?: number[]
  toughness?: number
  toughnessValues?: number[]
  weakness?: number
  weaknessValues?: number[]
  replacesEntryId?: string
  variantWhen?: CondExpr
  provenance: 'matched' | 'authored' | 'unlinked'
}

/** One hit's share of a skill's Off-Tune, before any buildup rate. */
export interface OffTuneHit {
  label: string
  count: number
  /** the hit's Off-Tune for a single landing */
  weakness: number
  /** weakness x count */
  total: number
}

/** A named addition to a skill's Off-Tune, on one side of the buildup rate. */
export interface OffTuneSource {
  label: string
  value: number
}

/**
 * How one execution arrived at its Off-Tune.
 *
 * The register cell can only show where the gauge ended up. This is the work
 * behind that figure, kept unrounded, so the readout can name every hit and
 * every buff rather than asking the reader to trust a total.
 */
export interface OffTuneTrace {
  /** the gauge before this entry */
  before: number
  /** the gauge after it */
  after: number
  /** the ceiling the gauge is read against */
  max: number
  /** this entry emptied the gauge, which only a Tune Break does */
  reset: boolean
  /** the gain was dropped: the target still refuses Off-Tune after a break */
  sealed: boolean
  /** this entry stands in a Tune Break's aftermath, so it can carry the mark */
  afterBreak: boolean
  /** this entry is where counting starts again, by mark or by default */
  resume: 'mark' | 'default' | null
  /** the first entry to fill the gauge since the last reset */
  crest: boolean
  /** the gauge was already full when this entry landed */
  held: boolean
  hits: OffTuneHit[]
  hitTotal: number
  /** additions that ride the buildup rate alongside the hits */
  pre: OffTuneSource[]
  preTotal: number
  /** the rate those were multiplied by */
  rate: number
  /** what the rate is made of, each as a share of 1 */
  rateSources: OffTuneSource[]
  /** (hitTotal + preTotal) x rate */
  rated: number
  /** additions the rate never touches */
  post: OffTuneSource[]
  postTotal: number
  /** the node's repeat count, which the whole gain is taken through */
  repeats: number
  /** what this entry actually put on the gauge */
  gain: number
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
  /** Additional Off-Tune that is multiplied by Off-Tune Buildup Rate. */
  offTune?: number
  /** Fixed Off-Tune applied after Off-Tune Buildup Rate. */
  directOffTune?: number
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
  stackMode?: 'fixedMax'
  stackMax?: number
  levelSource?: SkillLevelSrc | null
  visible?: boolean
  visibleWhen?: CondExpr
  skillTypeWhen?: Array<{
    when: CondExpr
    skillType: SkillTypeKey[]
  }>
  skillVariantWhen?: Array<{
    when: CondExpr
    patch: SkillVariantPatch
  }>
  hits: Array<{
    label?: string
    count: number
    multiplier: number
  }>
  hitTable?: SkillHitTable[]
  damageEntries?: SkillDamageEntry[]
  fixedMv?: number
}

export type SkillVariantPatch = Partial<Omit<SkillDef, 'id' | 'skillVariantWhen'>>

export interface SkillCalcResult {
  normal: number
  crit: number
  avg: number
  subHits: SkillSubHit[]
}

export type DamageResult = SkillCalcResult
