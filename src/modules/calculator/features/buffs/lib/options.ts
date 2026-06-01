/*
  Author: Runor Ewhro
  Description: Defines grouped manual-buff option metadata so the calculator
               can render editable buff controls from a stable authored list.
*/

import type {
  MnlBaseStatK,
  MnlNegFfctModKey,
  MnlModScp,
  MnlModVlKey,
  QuickBuffs,
  MnlSkllSclrK,
  MnlSkllMtchM,
  MnlTopStatKe,
} from '@/domain/entities/manualBuffs.ts'
import type { NegEffectKey } from '@/domain/entities/stats.ts'
import { BUFF_SKILL_TABS, makeSkillTabOptions } from '@/modules/calculator/model/skillTabs.ts'

export interface BuffOption<T extends string = string> {
  value: T
  label: string
  max?: number
}

export const MAINSTATBUFF: Array<{ label: string; stat: MnlBaseStatK }> = [
  { label: 'Attack', stat: 'atk' },
  { label: 'HP', stat: 'hp' },
  { label: 'Defense', stat: 'def' },
]

export const MAINSCLRBUFF: Array<{
  key: Exclude<keyof QuickBuffs, 'atk' | 'hp' | 'def'>
  label: string
  max?: number
}> = [
  { key: 'critRate', label: 'Crit Rate' },
  { key: 'critDmg', label: 'Crit DMG' },
  { key: 'energyRegen', label: 'Energy Regen' },
  { key: 'healingBonus', label: 'Healing Bonus' },
]

export const DVNCSCPPTNS: Array<BuffOption<MnlModScp>> = [
  { value: 'topStat', label: 'Top Stat' },
  { value: 'attribute', label: 'Element' },
  { value: 'skillType', label: 'Skill Type' },
  { value: 'negativeEffect', label: 'Negative Effect' },
  { value: 'skill', label: 'Specific Skill' },
  { value: 'baseStat', label: 'Base Stat' },
]

export const DEFDVNCMODSC: MnlModScp = 'topStat'

export const DVNCTOPSTATP: Array<BuffOption<MnlTopStatKe>> = [
  { value: 'dmgBonus', label: 'Global DMG Bonus' },
  { value: 'amplify', label: 'Amplify' },
  { value: 'flatDmg', label: 'Flat Damage', max: 9999999 },
  { value: 'critRate', label: 'Crit Rate' },
  { value: 'critDmg', label: 'Crit DMG' },
  { value: 'energyRegen', label: 'Energy Regen' },
  { value: 'healingBonus', label: 'Healing Bonus' },
  { value: 'shieldBonus', label: 'Shield Bonus' },
  { value: 'defIgnore', label: 'DEF Ignore' },
  { value: 'defShred', label: 'DEF Shred' },
  { value: 'dmgVuln', label: 'DMG Vulnerability' },
  { value: 'tuneBreakBoost', label: 'Tune Break Boost' },
  { value: 'special', label: 'Special Modifier' },
]

export const DVNCTTRBPTNS: Array<BuffOption> = [
  { value: 'all', label: 'All Elements' },
  { value: 'physical', label: 'Physical' },
  { value: 'glacio', label: 'Glacio' },
  { value: 'fusion', label: 'Fusion' },
  { value: 'electro', label: 'Electro' },
  { value: 'aero', label: 'Aero' },
  { value: 'spectro', label: 'Spectro' },
  { value: 'havoc', label: 'Havoc' },
]

export const ADV_SKILL_TYPES: Array<BuffOption> = [
  { value: 'all', label: 'All Skill Types' },
  { value: 'basicAtk', label: 'Basic Attack' },
  { value: 'heavyAtk', label: 'Heavy Attack' },
  { value: 'resonanceSkill', label: 'Resonance Skill' },
  { value: 'resonanceLiberation', label: 'Resonance Liberation' },
  { value: 'introSkill', label: 'Intro Skill' },
  { value: 'outroSkill', label: 'Outro Skill' },
  { value: 'echoSkill', label: 'Echo Skill' },
  { value: 'coord', label: 'Coordinated Attack' },
  { value: 'spectroFrazzle', label: 'Spectro Frazzle' },
  { value: 'aeroErosion', label: 'Aero Erosion' },
  { value: 'fusionBurst', label: 'Fusion Burst' },
  { value: 'havocBane', label: 'Havoc Bane' },
  { value: 'glacioChafe', label: 'Glacio Chafe' },
  { value: 'electroFlare', label: 'Electro Flare' },
  { value: 'healing', label: 'Healing' },
  { value: 'shield', label: 'Shield' },
  { value: 'tuneRupture', label: 'Tune Rupture' },
  { value: 'hack', label: 'Hack' },
]

export const DVNCBASESTAT: Array<BuffOption<MnlBaseStatK>> = [
  { value: 'atk', label: 'Attack' },
  { value: 'hp', label: 'HP' },
  { value: 'def', label: 'Defense' },
]

export const DVNCBASESTuv: Array<BuffOption<'percent' | 'flat'>> = [
  { value: 'percent', label: 'Percent' },
  { value: 'flat', label: 'Flat', max: 9999 },
]

export const ADV_SKILL_MATCH: Array<BuffOption<MnlSkllMtchM>> = [
  { value: 'skillId', label: 'Skill' },
  { value: 'tab', label: 'Tab' },
  { value: 'skillType', label: 'Skill Type' },
]

export const MOD_VL_PTNS: Array<BuffOption<MnlModVlKey>> = [
  { value: 'dmgBonus', label: 'DMG Bonus' },
  { value: 'amplify', label: 'Amplify' },
  { value: 'resShred', label: 'RES Shred' },
  { value: 'defIgnore', label: 'DEF Ignore' },
  { value: 'defShred', label: 'DEF Shred' },
  { value: 'dmgVuln', label: 'DMG Vulnerability' },
  { value: 'critRate', label: 'Crit Rate' },
  { value: 'critDmg', label: 'Crit DMG' },
]

export const SKLLMODPTNS: Array<BuffOption> = [
  ...MOD_VL_PTNS,
  { value: 'addMultiplier', label: 'Add Multiplier', max: 9999 },
  { value: 'addHitMultiplier', label: 'Add Hit Multiplier', max: 9999 },
  { value: 'scaleMultiplier', label: 'Scale Multiplier', max: 9999 },
  { value: 'scalar', label: 'Skill Scalar', max: 9999999 },
]

export const NEG_EFFECT_OPTS: Array<BuffOption<NegEffectKey>> = [
  { value: 'spectroFrazzle', label: 'Spectro Frazzle' },
  { value: 'aeroErosion', label: 'Aero Erosion' },
  { value: 'fusionBurst', label: 'Fusion Burst' },
  { value: 'havocBane', label: 'Havoc Bane' },
  { value: 'glacioChafe', label: 'Glacio Chafe' },
  { value: 'electroFlare', label: 'Electro Flare' },
]

export const NEG_EFFECT_MODS: Array<BuffOption<MnlNegFfctModKey>> = [
  { value: 'critRate', label: 'Crit Rate' },
  { value: 'critDmg', label: 'Crit DMG' },
  { value: 'multiplier', label: 'Multiplier', max: 9999 },
]

export const SKLLSCLRPTNS: Array<BuffOption<MnlSkllSclrK>> = [
  { value: 'fixedDmg', label: 'Fixed DMG', max: 9999999 },
  { value: 'skillHealingBonus', label: 'Healing Bonus' },
  { value: 'skillShieldBonus', label: 'Shield Bonus' },
  { value: 'tuneRuptureCritRate', label: 'Tune Rupture Crit Rate' },
  { value: 'tuneRuptureCritDmg', label: 'Tune Rupture Crit DMG' },
  { value: 'negativeEffectCritRate', label: 'Negative Effect Crit Rate' },
  { value: 'negativeEffectCritDmg', label: 'Negative Effect Crit DMG' },
]

export const SKILL_TAB_OPTIONS: Array<BuffOption> = makeSkillTabOptions(BUFF_SKILL_TABS)
export const BUFF_CLIP_VER = 1
