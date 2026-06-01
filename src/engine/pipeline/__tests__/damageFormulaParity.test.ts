import { describe, expect, it } from 'vitest'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { FeatureResult } from '@/domain/gameData/contracts'
import type { FinalStats, SkillDef } from '@/domain/entities/stats'
import { makeCombatState } from '@/domain/state/defaults'
import { calcSkillDamage } from '@/engine/formulas/damage'
import {
  formBrkd,
  fmtBreakdown,
} from '@/modules/calculator/features/results/lib/damageFormula'

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

const spectroFrazzleSkill: SkillDef = {
  id: 'spectro-frazzle',
  label: 'Spectro Frazzle',
  tab: 'negativeEffect',
  element: 'spectro',
  skillType: ['spectroFrazzle'],
  archetype: 'spectroFrazzle',
  aggregationType: 'damage',
  scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 0,
  flat: 0,
  hits: [{ count: 1, multiplier: 1 }],
}

const fusionBurstSkill: SkillDef = {
  id: 'fusion-burst',
  label: 'Fusion Burst',
  tab: 'negativeEffect',
  element: 'fusion',
  skillType: ['fusionBurst'],
  archetype: 'fusionBurst',
  aggregationType: 'damage',
  scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 0,
  flat: 0,
  hits: [{ count: 1, multiplier: 1 }],
}

const glacioChafeSkill: SkillDef = {
  id: 'glacio-chafe',
  label: 'Glacio Chafe',
  tab: 'negativeEffect',
  element: 'glacio',
  skillType: ['glacioChafe'],
  archetype: 'glacioChafe',
  aggregationType: 'damage',
  scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 0,
  flat: 0,
  hits: [{ count: 1, multiplier: 1 }],
}

const electroFlareSkill: SkillDef = {
  id: 'electro-flare',
  label: 'Electro Flare',
  tab: 'negativeEffect',
  element: 'electro',
  skillType: ['electroFlare'],
  archetype: 'electroFlare',
  aggregationType: 'damage',
  scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 0,
  flat: 0,
  hits: [{ count: 1, multiplier: 1 }],
}

const fixedDamageSkill: SkillDef = {
  id: 'fixed-damage-skill',
  label: 'Fixed Damage Skill',
  tab: 'forteCircuit',
  element: 'fusion',
  skillType: ['basicAtk'],
  archetype: 'skillDamage',
  aggregationType: 'damage',
  scaling: { atk: 1, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 1,
  flat: 0,
  fixedDmg: 666,
  hits: [{ count: 1, multiplier: 1 }],
}

function makeFeatureResult(
  skillDefinition: SkillDef,
  result = calcSkillDamage(makeFinalStats(), skillDefinition, enemy, 90),
): FeatureResult {
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

describe('damage formula parity', () => {
  it('applies skillType.all modifiers', () => {
    const baseline = calcSkillDamage(makeFinalStats(), skill, enemy, 90)
    const withGlobalSkillType = calcSkillDamage(
      makeFinalStats({
        skillType: {
          ...makeFinalStats().skillType,
          all: {
            ...makeBuff(),
            dmgBonus: 25,
          },
        },
      }),
      skill,
      enemy,
      90,
    )

    expect(withGlobalSkillType.normal).toBeGreaterThan(baseline.normal)
  })

  it('applies flat damage before multipliers', () => {
    const baseline = calcSkillDamage(makeFinalStats(), skill, enemy, 90)
    const withFlatDamage = calcSkillDamage(
      makeFinalStats({
        flatDmg: 500,
      }),
      skill,
      enemy,
      90,
    )

    expect(withFlatDamage.normal).toBeGreaterThan(baseline.normal)
  })

  it('applies top-level amplify as a global damage multiplier', () => {
    const baseline = calcSkillDamage(makeFinalStats(), skill, enemy, 90)
    const withTopAmplify = calcSkillDamage(
      makeFinalStats({
        amplify: 25,
      }),
      skill,
      enemy,
      90,
    )

    expect(withTopAmplify.normal).toBeGreaterThan(baseline.normal)
  })

  it('applies def shred in defense reduction', () => {
    const baseline = calcSkillDamage(makeFinalStats(), skill, enemy, 90)
    const withDefShred = calcSkillDamage(
      makeFinalStats({
        skillType: {
          ...makeFinalStats().skillType,
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

    expect(withDefShred.normal).toBeGreaterThan(baseline.normal)
  })

  it('keeps fixed damage isolated from ordinary damage buffs', () => {
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
    expect(baseline.crit).toBe(666)
    expect(baseline.avg).toBe(666)
    expect(withBuffs.normal).toBe(666)
    expect(withBuffs.crit).toBe(666)
    expect(withBuffs.avg).toBe(666)
  })

  it('treats 100 base resistance as immunity like the original calculator', () => {
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

  it('computes healing as a separate support outcome', () => {
    const result = calcSkillDamage(makeFinalStats(), healingSkill, enemy, 90)

    expect(result.normal).toBe(0)
    expect(result.crit).toBe(0)
    expect(result.avg).toBeGreaterThan(0)
  })

  it('computes shield as a separate support outcome', () => {
    const result = calcSkillDamage(makeFinalStats(), shieldSkill, enemy, 90)

    expect(result.normal).toBe(0)
    expect(result.crit).toBe(0)
    expect(result.avg).toBeGreaterThan(0)
  })

  it('computes tune rupture through the dedicated formula branch', () => {
    const result = calcSkillDamage(makeFinalStats(), tuneRuptureSkill, enemy, 90)

    expect(result.avg).toBeGreaterThan(0)
    expect(result.subHits).toHaveLength(2)
  })

  it('computes hack damage through the level-scaled branch without tune rupture buffs', () => {
    const baseStats = makeFinalStats({
      skillType: {
        ...makeFinalStats().skillType,
        hack: { ...makeBuff(), dmgBonus: 25 },
      },
    })
    const tuneBuffedStats = makeFinalStats({
      tbb: 999,
      skillType: {
        ...makeFinalStats().skillType,
        hack: { ...makeBuff(), dmgBonus: 25 },
        tuneRupture: { ...makeBuff(), dmgBonus: 999 },
      },
    })
    const scaledHackSkill = {
      ...hackSkill,
      multiplier: hackSkill.multiplier * 1.5,
      hits: hackSkill.hits.map((hit) => ({ ...hit, multiplier: hit.multiplier * 1.5 })),
    }

    const base = calcSkillDamage(baseStats, hackSkill, enemy, 90)
    const tuneBuffed = calcSkillDamage(tuneBuffedStats, hackSkill, enemy, 90)
    const scaled = calcSkillDamage(baseStats, scaledHackSkill, enemy, 90)

    expect(base.avg).toBeGreaterThan(0)
    expect(tuneBuffed.avg).toBeCloseTo(base.avg, 6)
    expect(scaled.avg).toBeCloseTo(base.avg * 1.5, 6)
  })

  it('computes spectro frazzle from combat-state stacks', () => {
    const result = calcSkillDamage(makeFinalStats(), spectroFrazzleSkill, enemy, 90, { spctFrzz: 3 })

    expect(result.normal).toBeGreaterThan(0)
    expect(result.crit).toBe(result.normal)
    expect(result.avg).toBe(result.normal)
    expect(result.subHits).toHaveLength(1)
  })

  it('computes fusion burst from its base formula and dedicated multiplier', () => {
    const baseline = calcSkillDamage(makeFinalStats(), fusionBurstSkill, enemy, 90, { fusionBurst: 3 })
    const boosted = calcSkillDamage(
      makeFinalStats({
        negativeEffect: {
          ...makeFinalStats().negativeEffect,
          fusionBurst: {
            ...makeNegativeEffectBuff(),
            multiplier: 2,
          },
        },
      }),
      fusionBurstSkill,
      enemy,
      90,
      { fusionBurst: 3 },
    )

    expect(baseline.normal).toBeGreaterThan(0)
    expect(baseline.crit).toBe(baseline.normal)
    expect(baseline.avg).toBe(baseline.normal)
    expect(baseline.subHits).toHaveLength(1)
    expect(boosted.normal).toBeGreaterThan(baseline.normal)
  })

  it('computes glacio chafe from its level-and-stack base formula', () => {
    const baseline = calcSkillDamage(makeFinalStats(), glacioChafeSkill, enemy, 90, { glacioChafe: 3 })
    const boosted = calcSkillDamage(
      makeFinalStats({
        skillType: {
          ...makeFinalStats().skillType,
          glacioChafe: {
            ...makeBuff(),
            dmgBonus: 50,
          },
        },
      }),
      glacioChafeSkill,
      enemy,
      90,
      { glacioChafe: 3 },
    )

    expect(baseline.avg).toBeGreaterThan(0)
    expect(boosted.avg).toBeGreaterThan(baseline.avg)
  })

  it('uses fixed mv when a glacio-chafe negative effect provides one', () => {
    const glacioBiteSkill: SkillDef = {
      ...glacioChafeSkill,
      id: 'glacio-bite',
      label: 'Glacio Bite',
      fixedMv: 10200,
    }

    const fixedMvResult = calcSkillDamage(makeFinalStats(), glacioBiteSkill, enemy, 90, { glacioChafe: 10 })
    const stackScaledResult = calcSkillDamage(makeFinalStats(), glacioChafeSkill, enemy, 90, { glacioChafe: 10 })

    expect(fixedMvResult.avg).toBeGreaterThan(0)
    expect(fixedMvResult.avg).toBeLessThan(stackScaledResult.avg)
  })

  it('lets negative effects use fixed crit scalars when present', () => {
    const critSkill: SkillDef = {
      ...fusionBurstSkill,
      negativeEffectCritRate: 0.8,
      negativeEffectCritDmg: 2.75,
    }

    const result = calcSkillDamage(makeFinalStats(), critSkill, enemy, 90, { fusionBurst: 3 })

    expect(result.crit).toBeGreaterThan(result.normal)
    expect(result.avg).toBeGreaterThan(result.normal)
  })

  it('computes electro flare damage from electro flare stacks', () => {
    const baseline = calcSkillDamage(makeFinalStats(), electroFlareSkill, enemy, 90, { electroFlare: 3 })
    const buffed = calcSkillDamage(
      makeFinalStats({
        amplify: 10,
        dmgVuln: 9,
        special: 20,
        skillType: {
          ...makeFinalStats().skillType,
          electroFlare: {
            ...makeBuff(),
            amplify: 18,
            dmgBonus: 24,
          },
        },
      }),
      electroFlareSkill,
      enemy,
      90,
      { electroFlare: 3 },
    )

    expect(baseline.avg).toBeGreaterThan(0)
    expect(buffed.avg).toBeGreaterThan(baseline.avg)
  })

  it('adds electro rage damage into electro flare only when electro flare is above its default cap', () => {
    const baseline = calcSkillDamage(makeFinalStats(), electroFlareSkill, enemy, 90, { electroFlare: 11 })
    const withElectroRage = calcSkillDamage(makeFinalStats(), electroFlareSkill, enemy, 90, { electroFlare: 11, electroRage: 2 })
    const gatedOff = calcSkillDamage(makeFinalStats(), electroFlareSkill, enemy, 90, { electroFlare: 10, electroRage: 2 })
    const buffed = calcSkillDamage(
      makeFinalStats({
        amplify: 10,
        dmgVuln: 9,
        special: 20,
        skillType: {
          ...makeFinalStats().skillType,
          electroFlare: {
            ...makeBuff(),
            amplify: 18,
            dmgBonus: 24,
          },
        },
      }),
      electroFlareSkill,
      enemy,
      90,
      { electroFlare: 11, electroRage: 2 },
    )

    expect(baseline.avg).toBeGreaterThan(0)
    expect(withElectroRage.avg).toBeGreaterThan(baseline.avg)
    expect(gatedOff.avg).toBeLessThan(withElectroRage.avg)
    expect(buffed.avg).toBeGreaterThan(withElectroRage.avg)
  })

  it('builds a compact direct damage formula breakdown', () => {
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

  it('builds negative-effect and tune rupture formula breakdowns without duplicated output', () => {
    const glacioBiteSkill: SkillDef = {
      ...glacioChafeSkill,
      id: 'glacio-bite',
      label: 'Glacio Bite',
      fixedMv: 10200,
    }
    const combatState = { ...makeCombatState(), glacioChafe: 10 }
    const glacioResult = calcSkillDamage(makeFinalStats(), glacioBiteSkill, enemy, 90, combatState)
    const glacioBreakdown = formBrkd(
      makeFeatureResult(glacioBiteSkill, glacioResult),
      makeFinalStats(),
      enemy,
      90,
      combatState,
    )
    const tuneResult = calcSkillDamage(makeFinalStats({ tbb: 40 }), tuneRuptureSkill, enemy, 90)
    const tuneBreakdown = formBrkd(
      makeFeatureResult(tuneRuptureSkill, tuneResult),
      makeFinalStats({ tbb: 40 }),
      enemy,
      90,
      makeCombatState(),
    )
    const hackResult = calcSkillDamage(makeFinalStats({ tbb: 40 }), hackSkill, enemy, 90)
    const hackBreakdown = formBrkd(
      makeFeatureResult(hackSkill, hackResult),
      makeFinalStats({ tbb: 40 }),
      enemy,
      90,
      makeCombatState(),
    )

    expect(glacioBreakdown.title).toBe('Glacio Bite DMG')
    expect(glacioBreakdown.sections.map((section) => section.label)).toEqual(['core', 'enemy', 'mods'])
    expect(tuneBreakdown.sections.flatMap((section) => section.lines).join('\n')).toContain('core.tuneAmp')
    expect(hackBreakdown.sections.flatMap((section) => section.lines).join('\n')).toContain('core.hackAmp')
    expect(fmtBreakdown(hackBreakdown)).not.toContain('mod.tuneBoost')
    expect(tuneBreakdown.equation).not.toContain('x x')
    expect(fmtBreakdown(tuneBreakdown).split('\n').filter((line) => line.startsWith('out.normal ='))).toHaveLength(1)
  })
})
