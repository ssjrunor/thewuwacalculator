/*
  Author: Runor Ewhro
  Description: Defines the zod schema used to validate manual quick buffs
               and custom manual modifier entries.
*/

import { z } from 'zod'

// shared base stat buff schema
const baseStatBuffSchema = z.object({
  percent: z.number(),
  flat: z.number(),
}).strict()

// quick manual buff schema
const manualQuickBuffsSchema = z.object({
  atk: baseStatBuffSchema,
  hp: baseStatBuffSchema,
  def: baseStatBuffSchema,
  critRate: z.number(),
  critDmg: z.number(),
  energyRegen: z.number(),
  healingBonus: z.number(),
}).strict()

// discriminated manual modifier schema
const manualModifierSchema = z.discriminatedUnion('scope', [
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
    skillType: z.enum([
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
      'healing',
      'shield',
      'tuneRupture',
    ]),
    mod: z.enum(['resShred', 'dmgBonus', 'amplify', 'defIgnore', 'defShred', 'dmgVuln', 'critRate', 'critDmg']),
    value: z.number(),
  }).strict(),
  z.object({
    id: z.string(),
    enabled: z.boolean(),
    label: z.string().optional(),
    scope: z.literal('skill'),
    matchMode: z.enum(['skillId', 'tab']),
    skillId: z.string().optional(),
    tab: z.string().optional(),
    mod: z.enum(['resShred', 'dmgBonus', 'amplify', 'defIgnore', 'defShred', 'dmgVuln', 'critRate', 'critDmg']),
    value: z.number(),
  }).strict(),
])

// full manual buffs schema
export const manualBuffsSchema = z.object({
  quick: manualQuickBuffsSchema,
  modifiers: z.array(manualModifierSchema),
}).strict()