/*
  Author: Runor Ewhro
  Description: Defines the zod schema used to validate manual quick buffs
               and custom manual modifier entries.
*/

import { z } from 'zod'

// shared base stat buff schema
const baseStatBuff = z.object({
  percent: z.number(),
  flat: z.number(),
}).strict()

// quick manual buff schema
const mnlQckBffsSc = z.object({
  atk: baseStatBuff,
  hp: baseStatBuff,
  def: baseStatBuff,
  critRate: z.number(),
  critDmg: z.number(),
  energyRegen: z.number(),
  healingBonus: z.number(),
}).strict()

const skillTypeSchema = z.enum([
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
])

// discriminated manual modifier schema
const mnlModSchm = z.union([
  z.object({
    id: z.string(),
    enabled: z.boolean(),
    label: z.string().optional(),
    scope: z.literal('baseStat'),
    stat: z.enum(['atk', 'hp', 'def']),
    field: z.enum(['percent', 'flat']),
    value: z.number(),
  }).strict(),
  z.object({
    id: z.string(),
    enabled: z.boolean(),
    label: z.string().optional(),
    scope: z.literal('topStat'),
    stat: z.enum([
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
      'special',
    ]),
    value: z.number(),
  }).strict(),
  z.object({
    id: z.string(),
    enabled: z.boolean(),
    label: z.string().optional(),
    scope: z.literal('attribute'),
    attribute: z.enum(['all', 'aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc', 'physical']),
    mod: z.enum(['resShred', 'dmgBonus', 'amplify', 'defIgnore', 'defShred', 'dmgVuln', 'critRate', 'critDmg']),
    value: z.number(),
  }).strict(),
  z.object({
    id: z.string(),
    enabled: z.boolean(),
    label: z.string().optional(),
    scope: z.literal('skillType'),
    skillType: skillTypeSchema,
    mod: z.enum(['resShred', 'dmgBonus', 'amplify', 'defIgnore', 'defShred', 'dmgVuln', 'critRate', 'critDmg']),
    value: z.number(),
  }).strict(),
  z.object({
    id: z.string(),
    enabled: z.boolean(),
    label: z.string().optional(),
    scope: z.literal('negativeEffect'),
    negativeEffect: z.enum(['spectroFrazzle', 'aeroErosion', 'fusionBurst', 'havocBane', 'glacioChafe', 'electroFlare']),
    mod: z.enum(['critRate', 'critDmg', 'multiplier']),
    value: z.number(),
  }).strict(),
  z.object({
    id: z.string(),
    enabled: z.boolean(),
    label: z.string().optional(),
    scope: z.literal('skill'),
    matchMode: z.enum(['skillId', 'tab', 'skillType', 'archetype']),
    skillId: z.string().optional(),
    tab: z.string().optional(),
    skillType: skillTypeSchema.optional(),
    archetype: z.string().optional(),
    effect: z.literal('mod'),
    mod: z.enum(['resShred', 'dmgBonus', 'amplify', 'defIgnore', 'defShred', 'dmgVuln', 'critRate', 'critDmg']),
    value: z.number(),
  }).strict(),
  z.object({
    id: z.string(),
    enabled: z.boolean(),
    label: z.string().optional(),
    scope: z.literal('skill'),
    matchMode: z.enum(['skillId', 'tab', 'skillType', 'archetype']),
    skillId: z.string().optional(),
    tab: z.string().optional(),
    skillType: skillTypeSchema.optional(),
    archetype: z.string().optional(),
    effect: z.literal('addMultiplier'),
    value: z.number(),
  }).strict(),
  z.object({
    id: z.string(),
    enabled: z.boolean(),
    label: z.string().optional(),
    scope: z.literal('skill'),
    matchMode: z.enum(['skillId', 'tab', 'skillType', 'archetype']),
    skillId: z.string().optional(),
    tab: z.string().optional(),
    skillType: skillTypeSchema.optional(),
    archetype: z.string().optional(),
    effect: z.literal('scaleMultiplier'),
    value: z.number(),
  }).strict(),
  z.object({
    id: z.string(),
    enabled: z.boolean(),
    label: z.string().optional(),
    scope: z.literal('skill'),
    matchMode: z.enum(['skillId', 'tab', 'skillType', 'archetype']),
    skillId: z.string().optional(),
    tab: z.string().optional(),
    skillType: skillTypeSchema.optional(),
    archetype: z.string().optional(),
    effect: z.literal('addHitMultiplier'),
    hitIndex: z.number(),
    value: z.number(),
  }).strict(),
  z.object({
    id: z.string(),
    enabled: z.boolean(),
    label: z.string().optional(),
    scope: z.literal('skill'),
    matchMode: z.enum(['skillId', 'tab', 'skillType', 'archetype']),
    skillId: z.string().optional(),
    tab: z.string().optional(),
    skillType: skillTypeSchema.optional(),
    archetype: z.string().optional(),
    effect: z.literal('scalar'),
    field: z.enum([
      'fixedDmg',
      'skillHealingBonus',
      'skillShieldBonus',
      'tuneRuptureCritRate',
      'tuneRuptureCritDmg',
      'negativeEffectCritRate',
      'negativeEffectCritDmg',
    ]),
    value: z.number(),
  }).strict(),
])

// full manual buffs schema
export const mnlBffsSchm = z.object({
  quick: mnlQckBffsSc,
  modifiers: z.array(mnlModSchm),
}).strict()
