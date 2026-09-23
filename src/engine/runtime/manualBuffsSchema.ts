/*
  Author: Runor Ewhro
  Description: Defines the zod schema used to validate manual quick buffs
               and custom manual modifier entries.
*/

import * as z from 'zod/mini'

// shared base stat buff schema
const baseStatBuff = z.lazy(() => z.strictObject({
  percent: z.number(),
  flat: z.number(),
}))

// quick manual buff schema
const mnlQckBffsSc = z.lazy(() => z.strictObject({
  atk: baseStatBuff,
  hp: baseStatBuff,
  def: baseStatBuff,
  critRate: z.number(),
  critDmg: z.number(),
  energyRegen: z.number(),
  healingBonus: z.number(),
}))

const skillTypeSchema = z.lazy(() => z.enum([
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
]))

// Preserve imported and persisted buffs written before the finalDmg rename.
const mnlTopStatSchema = z.lazy(() => z.pipe(z.transform((value) => value === 'special' ? 'finalDmg' : value), z.enum([
    'flatDmg',
    'amplify',
    'critRate',
    'critDmg',
    'energyRegen',
    'healingBonus',
    'shieldBonus',
    'dmgBonus',
    'defIgnore',
    'defShred',
    'dmgVuln',
    'tuneBreakBoost',
    'finalDmg',
  ])))

// discriminated manual modifier schema
const mnlModSchm = z.lazy(() => z.union([
  z.strictObject({
    id: z.string(),
    enabled: z.boolean(),
    label: z.optional(z.string()),
    scope: z.literal('baseStat'),
    stat: z.enum(['atk', 'hp', 'def']),
    field: z.enum(['percent', 'flat']),
    value: z.number(),
  }),
  z.strictObject({
    id: z.string(),
    enabled: z.boolean(),
    label: z.optional(z.string()),
    scope: z.literal('topStat'),
    stat: mnlTopStatSchema,
    value: z.number(),
  }),
  z.strictObject({
    id: z.string(),
    enabled: z.boolean(),
    label: z.optional(z.string()),
    scope: z.literal('attribute'),
    attribute: z.enum(['all', 'aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc', 'physical']),
    mod: z.enum(['resShred', 'dmgBonus', 'amplify', 'defIgnore', 'defShred', 'dmgVuln', 'critRate', 'critDmg']),
    value: z.number(),
  }),
  z.strictObject({
    id: z.string(),
    enabled: z.boolean(),
    label: z.optional(z.string()),
    scope: z.literal('skillType'),
    skillType: skillTypeSchema,
    mod: z.enum(['resShred', 'dmgBonus', 'amplify', 'defIgnore', 'defShred', 'dmgVuln', 'critRate', 'critDmg']),
    value: z.number(),
  }),
  z.strictObject({
    id: z.string(),
    enabled: z.boolean(),
    label: z.optional(z.string()),
    scope: z.literal('negativeEffect'),
    negativeEffect: z.enum(['spectroFrazzle', 'aeroErosion', 'fusionBurst', 'havocBane', 'glacioChafe', 'electroFlare']),
    mod: z.enum(['critRate', 'critDmg', 'multiplier']),
    value: z.number(),
  }),
  z.strictObject({
    id: z.string(),
    enabled: z.boolean(),
    label: z.optional(z.string()),
    scope: z.literal('skill'),
    matchMode: z.enum(['skillId', 'tab', 'skillType', 'archetype']),
    skillId: z.optional(z.string()),
    tab: z.optional(z.string()),
    skillType: z.optional(skillTypeSchema),
    archetype: z.optional(z.string()),
    effect: z.literal('mod'),
    mod: z.enum(['resShred', 'dmgBonus', 'amplify', 'defIgnore', 'defShred', 'dmgVuln', 'critRate', 'critDmg']),
    value: z.number(),
  }),
  z.strictObject({
    id: z.string(),
    enabled: z.boolean(),
    label: z.optional(z.string()),
    scope: z.literal('skill'),
    matchMode: z.enum(['skillId', 'tab', 'skillType', 'archetype']),
    skillId: z.optional(z.string()),
    tab: z.optional(z.string()),
    skillType: z.optional(skillTypeSchema),
    archetype: z.optional(z.string()),
    effect: z.literal('addMultiplier'),
    value: z.number(),
  }),
  z.strictObject({
    id: z.string(),
    enabled: z.boolean(),
    label: z.optional(z.string()),
    scope: z.literal('skill'),
    matchMode: z.enum(['skillId', 'tab', 'skillType', 'archetype']),
    skillId: z.optional(z.string()),
    tab: z.optional(z.string()),
    skillType: z.optional(skillTypeSchema),
    archetype: z.optional(z.string()),
    effect: z.literal('scaleMultiplier'),
    value: z.number(),
  }),
  z.strictObject({
    id: z.string(),
    enabled: z.boolean(),
    label: z.optional(z.string()),
    scope: z.literal('skill'),
    matchMode: z.enum(['skillId', 'tab', 'skillType', 'archetype']),
    skillId: z.optional(z.string()),
    tab: z.optional(z.string()),
    skillType: z.optional(skillTypeSchema),
    archetype: z.optional(z.string()),
    effect: z.literal('addHitMultiplier'),
    hitIndex: z.number(),
    value: z.number(),
  }),
  z.strictObject({
    id: z.string(),
    enabled: z.boolean(),
    label: z.optional(z.string()),
    scope: z.literal('skill'),
    matchMode: z.enum(['skillId', 'tab', 'skillType', 'archetype']),
    skillId: z.optional(z.string()),
    tab: z.optional(z.string()),
    skillType: z.optional(skillTypeSchema),
    archetype: z.optional(z.string()),
    effect: z.literal('scalar'),
    field: z.enum([
      'fixedDmg',
      'offTune',
      'directOffTune',
      'skillHealingBonus',
      'skillShieldBonus',
      'tuneRuptureCritRate',
      'tuneRuptureCritDmg',
      'negativeEffectCritRate',
      'negativeEffectCritDmg',
    ]),
    value: z.number(),
  }),
]))

// full manual buffs schema
export const mnlBffsSchm = z.lazy(() => z.strictObject({
  quick: mnlQckBffsSc,
  modifiers: z.array(mnlModSchm),
}))
