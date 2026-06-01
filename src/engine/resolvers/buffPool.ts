/*
  Author: Runor Ewhro
  Description: Provides helpers for creating and merging unified buff pool
               structures, including base stat, attribute, and skill-type buffs.
*/

import type {
  AttrBuffs,
  AttributeKey,
  BaseStatBuff,
  ModBuff,
  NegEffectBuff,
  NegEffectBuffs,
  NegEffectKey,
  SkillTypeBuffs,
  SkillTypeKey,
  UnifiedBuffPool,
  ImmunitySet,
} from '@/domain/entities/stats'

// supported elemental attribute keys
const ttrbKeys: AttributeKey[] = [
  'aero',
  'glacio',
  'spectro',
  'fusion',
  'electro',
  'havoc',
  'physical',
]

// supported skill type keys used in the shared skill-type bucket
const skllTypeKeys: Array<keyof SkillTypeBuffs> = [
  'all',
  'basicAtk',
  'heavyAtk',
  'resonanceSkill',
  'resonanceLiberation',
  'introSkill',
  'outroSkill',
  'echoSkill',
  'coord',
  'spectroFrazzle',
  'aeroErosion',
  'fusionBurst',
  'havocBane',
  'glacioChafe',
  'electroFlare',
  'healing',
  'shield',
  'tuneRupture',
  'hack',
]

const negFfctKeys: NegEffectKey[] = [
  'spectroFrazzle',
  'aeroErosion',
  'fusionBurst',
  'havocBane',
  'glacioChafe',
  'electroFlare',
]

// create a zeroed base stat buff object
export function mkBaseStatBu(): BaseStatBuff {
  return { percent: 0, flat: 0 }
}

// create a zeroed modifier buff object
export function makeModBuff(): ModBuff {
  return {
    resShred: 0,
    dmgBonus: 0,
    amplify: 0,
    defIgnore: 0,
    defShred: 0,
    dmgVuln: 0,
    critRate: 0,
    critDmg: 0,
  }
}

export function mkNegFfctBuf(): NegEffectBuff {
  return {
    critRate: 0,
    critDmg: 0,
    multiplier: 0,
  }
}

// create the attribute modifier bucket with one entry for "all"
// plus one entry for each elemental attribute
export function mkTtrbBkt(): AttrBuffs {
  const base = Object.fromEntries(ttrbKeys.map((key) => [key, makeModBuff()])) as Record<
      AttributeKey,
      ModBuff
  >

  return {
    all: makeModBuff(),
    ...base,
  }
}

// create the skill type modifier bucket with one entry per skill type
export function mkSkllTypeBk(): SkillTypeBuffs {
  return Object.fromEntries(skllTypeKeys.map((key) => [key, makeModBuff()])) as SkillTypeBuffs
}

export function mkNegFfctBkt(): NegEffectBuffs {
  return Object.fromEntries(
      negFfctKeys.map((key) => [key, mkNegFfctBuf()]),
  ) as NegEffectBuffs
}

// create an empty immunity set (no immunities)
export function mkImmunitySet(): ImmunitySet {
  return { all: false, elements: [], skillTypes: [], negativeEffects: [] }
}

// create a fully zeroed unified buff pool
export function mkNfdBuffPoo(): UnifiedBuffPool {
  return {
    atk: mkBaseStatBu(),
    hp: mkBaseStatBu(),
    def: mkBaseStatBu(),
    attribute: mkTtrbBkt(),
    skillType: mkSkllTypeBk(),
    negativeEffect: mkNegFfctBkt(),
    flatDmg: 0,
    amplify: 0,
    critRate: 0,
    critDmg: 0,
    energyRegen: 0,
    healingBonus: 0,
    shieldBonus: 0,
    dmgBonus: 0,
    defIgnore: 0,
    defShred: 0,
    dmgVuln: 0,
    tuneBreakBoost: 0,
    special: 0,
    immunities: mkImmunitySet(),
  }
}

// aggregate modifier buffs across multiple skill types into one combined buff
// the "all" bucket is intentionally ignored here because it is handled separately
export function mergeSkillType(
    bucket: SkillTypeBuffs,
    skillTypes: SkillTypeKey[],
): ModBuff {
  const result = makeModBuff()
  const seen = new Set<SkillTypeKey>()

  for (const key of skillTypes) {
    if (key === 'all' || seen.has(key)) continue
    seen.add(key)

    const buff = bucket[key]
    for (const field of Object.keys(result) as (keyof ModBuff)[]) {
      result[field] += buff?.[field]
    }
  }

  return result
}

// merge a partial base stat buff into a target base stat buff in place
export function mrgBaseStatB(target: BaseStatBuff, source: Partial<BaseStatBuff>): void {
  target.percent += source.percent ?? 0
  target.flat += source.flat ?? 0
}

// merge a partial modifier buff into a target modifier buff in place
export function mergeModBuff(target: ModBuff, source: Partial<ModBuff>): void {
  target.resShred += source.resShred ?? 0
  target.dmgBonus += source.dmgBonus ?? 0
  target.amplify += source.amplify ?? 0
  target.defIgnore += source.defIgnore ?? 0
  target.defShred += source.defShred ?? 0
  target.dmgVuln += source.dmgVuln ?? 0
  target.critRate += source.critRate ?? 0
  target.critDmg += source.critDmg ?? 0
}
