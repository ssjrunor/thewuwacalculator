/*
  Author: Runor Ewhro
  Description: verifies shared damage math and formatted formula breakdowns for
               ordinary damage, fixed damage, support outputs, tune rupture,
               and hack branches.
*/

import { describe, expect, it } from 'vitest'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { FeatureResult } from '@/domain/gameData/contracts'
import type { FinalStats, SkillDef } from '@/domain/entities/stats'
import { makeCombatState } from '@/domain/state/defaults'
import { calcSkillDamage } from '@/engine/formulas/damage'
import { formBrkd, fmtBreakdown } from '@/modules/calculator/features/results/lib/damageFormula'

function makeBuff() {
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

function makeNegativeEffectBuff() {
  return {
    critRate: 0,
    critDmg: 0,
    multiplier: 0,
  }
}

function makeFinalStats(overrides: Partial<FinalStats> = {}): FinalStats {
  // start with a fully populated stats tree so each test can override only the
  // branch being asserted without relying on undefined defaults in damage math
  return {
    atk: { base: 1000, final: 1000 },
    hp: { base: 1000, final: 1000 },
    def: { base: 1000, final: 1000 },
    attribute: {
      all: makeBuff(),
      physical: makeBuff(),
      glacio: makeBuff(),
      fusion: makeBuff(),
      electro: makeBuff(),
      aero: makeBuff(),
      spectro: makeBuff(),
      havoc: makeBuff(),
    },
    skillType: {
      all: makeBuff(),
      basicAtk: makeBuff(),
      heavyAtk: makeBuff(),
      resonanceSkill: makeBuff(),
      resonanceLiberation: makeBuff(),
      introSkill: makeBuff(),
      outroSkill: makeBuff(),
      echoSkill: makeBuff(),
      coord: makeBuff(),
      spectroFrazzle: makeBuff(),
      aeroErosion: makeBuff(),
      fusionBurst: makeBuff(),
      havocBane: makeBuff(),
      glacioChafe: makeBuff(),
      electroFlare: makeBuff(),
      healing: makeBuff(),
      shield: makeBuff(),
      tuneRupture: makeBuff(),
      hack: makeBuff(),
    },
    negativeEffect: {
      spectroFrazzle: makeNegativeEffectBuff(),
      aeroErosion: makeNegativeEffectBuff(),
      fusionBurst: makeNegativeEffectBuff(),
      havocBane: makeNegativeEffectBuff(),
      glacioChafe: makeNegativeEffectBuff(),
      electroFlare: makeNegativeEffectBuff(),
    },
    flatDmg: 0,
    amplify: 0,
    critRate: 5,
    critDmg: 150,
    energyRegen: 100,
    healingBonus: 0,
    shieldBonus: 0,
    dmgBonus: 0,
    defIgnore: 0,
    defShred: 0,
    dmgVuln: 0,
    tbb: 0,
    special: 0,
    ...overrides,
  }
}

const enemy: EnemyProfile = {
  id: 'enemy',
  level: 90,
  class: 0,
  toa: false,
  res: {
    0: 20,
    1: 20,
    2: 20,
    3: 20,
    4: 20,
    5: 20,
    6: 20,
  },
}

const skill: SkillDef = {
  id: 'skill',
  label: 'Skill',
  tab: 'resonanceSkill',
  element: 'fusion',
  skillType: ['resonanceSkill'],
  archetype: 'skillDamage',
  aggregationType: 'damage',
  scaling: { atk: 1, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 1,
  flat: 0,
  hits: [{ count: 1, multiplier: 1 }],
}

const fixedDamageSkill: SkillDef = {
  ...skill,
  id: 'fixed-damage-skill',
  label: 'Fixed Damage Skill',
  skillType: ['basicAtk'],
  fixedDmg: 666,
}

const healingSkill: SkillDef = {
  id: 'healing-skill',
  label: 'Healing Skill',
  tab: 'resonanceSkill',
  element: 'spectro',
  skillType: ['healing'],
  archetype: 'healing',
  aggregationType: 'healing',
  scaling: { atk: 1, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 0.25,
  flat: 100,
  hits: [],
}

const shieldSkill: SkillDef = {
  id: 'shield-skill',
  label: 'Shield Skill',
  tab: 'forteCircuit',
  element: 'spectro',
  skillType: ['shield'],
  archetype: 'shield',
  aggregationType: 'shield',
  scaling: { atk: 0, hp: 1, def: 0, energyRegen: 0 },
  multiplier: 0.1,
  flat: 300,
  hits: [],
}

const tuneRuptureSkill: SkillDef = {
  id: 'tune-rupture',
  label: 'Tune Rupture',
  tab: 'tuneBreak',
  element: 'physical',
  skillType: ['tuneRupture'],
  archetype: 'tuneRupture',
  aggregationType: 'damage',
  scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 0,
  flat: 0,
  tuneRuptureCritRate: 0,
  tuneRuptureCritDmg: 1,
  hits: [
    { count: 4, multiplier: 1 },
    { count: 1, multiplier: 12 },
  ],
}

const hackSkill: SkillDef = {
  id: 'hack-damage',
  label: 'Hack Damage',
  tab: 'forteCircuit',
  element: 'spectro',
  skillType: ['hack'],
  archetype: 'hack',
  aggregationType: 'damage',
  scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 2,
  flat: 0,
  hits: [{ count: 1, multiplier: 2 }],
}

function makeFeatureResult(
  skillDefinition: SkillDef,
  result = calcSkillDamage(makeFinalStats(), skillDefinition, enemy, 90),
): FeatureResult {
  // formula rendering consumes feature rows rather than raw skill definitions,
  // so the fixture mirrors the pipeline object shape with a supplied result
  return {
    id: skillDefinition.id,
    resonatorId: 'resonator',
    resonatorName: 'Resonator',
    feature: {
      id: skillDefinition.id,
      label: skillDefinition.label,
      source: { type: 'resonator', id: 'resonator' },
      kind: 'skill',
      skillId: skillDefinition.id,
    },
    skill: skillDefinition,
    archetype: skillDefinition.archetype,
    aggregationType: skillDefinition.aggregationType,
    multiplier: skillDefinition.multiplier,
    weight: 1,
    normal: result.normal,
    crit: result.crit,
    avg: result.avg,
    subHits: result.subHits,
  }
}

describe('damage formula invariants', () => {
  it('applies shared damage modifiers before final output', () => {
    const baseline = calcSkillDamage(makeFinalStats(), skill, enemy, 90)
    const buffed = calcSkillDamage(
      makeFinalStats({
        flatDmg: 500,
        amplify: 25,
        skillType: {
          ...makeFinalStats().skillType,
          all: {
            ...makeBuff(),
            dmgBonus: 25,
          },
          resonanceSkill: {
            ...makeBuff(),
            defShred: 20,
          },
        },
      }),
      skill,
      enemy,
      90,
    )

    expect(buffed.normal).toBeGreaterThan(baseline.normal)
    expect(buffed.crit).toBeGreaterThan(baseline.crit)
    expect(buffed.avg).toBeGreaterThan(baseline.avg)
  })

  it('keeps fixed damage isolated from ordinary damage buffs', () => {
    // fixed damage is an override branch, not a normal skill damage branch, so
    // it must ignore crit, amplify, flat damage, and skill-type bonuses
    const baseline = calcSkillDamage(makeFinalStats(), fixedDamageSkill, enemy, 90)
    const withBuffs = calcSkillDamage(
      makeFinalStats({
        flatDmg: 500,
        amplify: 25,
        dmgBonus: 40,
        skillType: {
          ...makeFinalStats().skillType,
          basicAtk: {
            ...makeBuff(),
            amplify: 50,
            dmgBonus: 60,
            critRate: 100,
            critDmg: 300,
          },
        },
      }),
      fixedDamageSkill,
      enemy,
      90,
    )

    expect(baseline.normal).toBe(666)
    expect(withBuffs.normal).toBe(666)
    expect(withBuffs.crit).toBe(666)
    expect(withBuffs.avg).toBe(666)
  })

  it('treats 100 base resistance as immunity', () => {
    const immuneEnemy: EnemyProfile = {
      ...enemy,
      res: {
        ...enemy.res,
        2: 100,
      },
    }

    const result = calcSkillDamage(makeFinalStats(), skill, immuneEnemy, 90)
    expect(result.normal).toBe(0)
    expect(result.crit).toBe(0)
    expect(result.avg).toBe(0)
  })

  it('computes healing and shield as support outcomes', () => {
    const healing = calcSkillDamage(makeFinalStats(), healingSkill, enemy, 90)
    const shield = calcSkillDamage(makeFinalStats(), shieldSkill, enemy, 90)

    expect(healing.normal).toBe(0)
    expect(healing.crit).toBe(0)
    expect(healing.avg).toBeGreaterThan(0)
    expect(shield.normal).toBe(0)
    expect(shield.crit).toBe(0)
    expect(shield.avg).toBeGreaterThan(0)
  })

  it('computes tune rupture and hack through their dedicated branches', () => {
    // tune rupture and hack both reuse damage output fields, but each takes its
    // multiplier from different stat channels and must stay separately testable
    const tuneResult = calcSkillDamage(makeFinalStats({ tbb: 40 }), tuneRuptureSkill, enemy, 90)
    const baseHack = calcSkillDamage(makeFinalStats(), hackSkill, enemy, 90)
    const buffedHack = calcSkillDamage(
      makeFinalStats({
        tbb: 999,
        skillType: {
          ...makeFinalStats().skillType,
          hack: { ...makeBuff(), dmgBonus: 25 },
        },
      }),
      hackSkill,
      enemy,
      90,
    )

    expect(tuneResult.avg).toBeGreaterThan(0)
    expect(tuneResult.subHits).toHaveLength(2)
    expect(baseHack.avg).toBeGreaterThan(0)
    expect(buffedHack.avg).toBeGreaterThan(baseHack.avg)
  })

  it('builds a compact direct-damage formula breakdown', () => {
    const finalStats = makeFinalStats({
      amplify: 25,
      dmgBonus: 40,
      dmgVuln: 15,
      special: 10,
      skillType: {
        ...makeFinalStats().skillType,
        resonanceSkill: {
          ...makeBuff(),
          critRate: 70,
          critDmg: 80,
        },
      },
    })
    const result = calcSkillDamage(finalStats, skill, enemy, 90)
    const breakdown = formBrkd(makeFeatureResult(skill, result), finalStats, enemy, 90, makeCombatState())
    const text = fmtBreakdown(breakdown)

    expect(breakdown.title).toBe('Skill DMG')
    expect(breakdown.sections.map((section) => section.label)).toEqual(['core', 'enemy', 'mods'])
    expect(text).toContain('// Skill DMG')
    expect(text).toContain('out.normal =')
    expect(text).toContain('mod.dmgBonus =')
    expect(text).toContain('crit.rate =')
  })

  it('builds tune rupture and hack breakdowns without duplicated output', () => {
    // the text formatter should expose the special branch math while still
    // emitting one final output assignment per breakdown
    const tuneStats = makeFinalStats({ tbb: 40 })
    const tuneResult = calcSkillDamage(tuneStats, tuneRuptureSkill, enemy, 90)
    const tuneBreakdown = formBrkd(
      makeFeatureResult(tuneRuptureSkill, tuneResult),
      tuneStats,
      enemy,
      90,
      makeCombatState(),
    )

    const hackStats = makeFinalStats({ tbb: 40 })
    const hackResult = calcSkillDamage(hackStats, hackSkill, enemy, 90)
    const hackBreakdown = formBrkd(
      makeFeatureResult(hackSkill, hackResult),
      hackStats,
      enemy,
      90,
      makeCombatState(),
    )

    expect(tuneBreakdown.sections.flatMap((section) => section.lines).join('\n')).toContain('core.tuneAmp')
    expect(hackBreakdown.sections.flatMap((section) => section.lines).join('\n')).toContain('core.hackAmp')
    expect(fmtBreakdown(hackBreakdown)).toContain('mod.tuneBoost')
    expect(fmtBreakdown(tuneBreakdown).split('\n').filter((line) => line.startsWith('out.normal ='))).toHaveLength(1)
  })
})
