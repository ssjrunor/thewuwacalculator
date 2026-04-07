import { describe, expect, it } from 'vitest'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { FinalStats, SkillDefinition } from '@/domain/entities/stats'
import { computeSkillDamage } from '@/engine/formulas/damage'

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
    tuneBreakBoost: 0,
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

const skill: SkillDefinition = {
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

const healingSkill: SkillDefinition = {
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

const shieldSkill: SkillDefinition = {
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

const tuneRuptureSkill: SkillDefinition = {
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

const spectroFrazzleSkill: SkillDefinition = {
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

const fusionBurstSkill: SkillDefinition = {
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

const glacioChafeSkill: SkillDefinition = {
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

const electroFlareSkill: SkillDefinition = {
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

const fixedDamageSkill: SkillDefinition = {
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

describe('damage formula parity', () => {
  it('applies skillType.all modifiers', () => {
    const baseline = computeSkillDamage(makeFinalStats(), skill, enemy, 90)
    const withGlobalSkillType = computeSkillDamage(
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
    const baseline = computeSkillDamage(makeFinalStats(), skill, enemy, 90)
    const withFlatDamage = computeSkillDamage(
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
    const baseline = computeSkillDamage(makeFinalStats(), skill, enemy, 90)
    const withTopAmplify = computeSkillDamage(
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
    const baseline = computeSkillDamage(makeFinalStats(), skill, enemy, 90)
    const withDefShred = computeSkillDamage(
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
    const baseline = computeSkillDamage(makeFinalStats(), fixedDamageSkill, enemy, 90)
    const withBuffs = computeSkillDamage(
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

    const result = computeSkillDamage(makeFinalStats(), skill, immuneEnemy, 90)
    expect(result.normal).toBe(0)
    expect(result.crit).toBe(0)
    expect(result.avg).toBe(0)
  })

  it('computes healing as a separate support outcome', () => {
    const result = computeSkillDamage(makeFinalStats(), healingSkill, enemy, 90)

    expect(result.normal).toBe(0)
    expect(result.crit).toBe(0)
    expect(result.avg).toBeGreaterThan(0)
  })

  it('computes shield as a separate support outcome', () => {
    const result = computeSkillDamage(makeFinalStats(), shieldSkill, enemy, 90)

    expect(result.normal).toBe(0)
    expect(result.crit).toBe(0)
    expect(result.avg).toBeGreaterThan(0)
  })

  it('computes tune rupture through the dedicated formula branch', () => {
    const result = computeSkillDamage(makeFinalStats(), tuneRuptureSkill, enemy, 90)

    expect(result.avg).toBeGreaterThan(0)
    expect(result.subHits).toHaveLength(2)
  })

  it('computes spectro frazzle from combat-state stacks', () => {
    const result = computeSkillDamage(makeFinalStats(), spectroFrazzleSkill, enemy, 90, { spectroFrazzle: 3 })

    expect(result.normal).toBeGreaterThan(0)
    expect(result.crit).toBe(result.normal)
    expect(result.avg).toBe(result.normal)
    expect(result.subHits).toHaveLength(1)
  })

  it('computes fusion burst from its base formula and dedicated multiplier', () => {
    const baseline = computeSkillDamage(makeFinalStats(), fusionBurstSkill, enemy, 90, { fusionBurst: 3 })
    const boosted = computeSkillDamage(
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
    const baseline = computeSkillDamage(makeFinalStats(), glacioChafeSkill, enemy, 90, { glacioChafe: 3 })
    const boosted = computeSkillDamage(
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

  it('lets negative effects use fixed crit scalars when present', () => {
    const critSkill: SkillDefinition = {
      ...fusionBurstSkill,
      negativeEffectCritRate: 0.8,
      negativeEffectCritDmg: 2.75,
    }

    const result = computeSkillDamage(makeFinalStats(), critSkill, enemy, 90, { fusionBurst: 3 })

    expect(result.crit).toBeGreaterThan(result.normal)
    expect(result.avg).toBeGreaterThan(result.normal)
  })

  it('computes electro flare damage from electro flare stacks', () => {
    const baseline = computeSkillDamage(makeFinalStats(), electroFlareSkill, enemy, 90, { electroFlare: 3 })
    const buffed = computeSkillDamage(
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
    const baseline = computeSkillDamage(makeFinalStats(), electroFlareSkill, enemy, 90, { electroFlare: 11 })
    const withElectroRage = computeSkillDamage(makeFinalStats(), electroFlareSkill, enemy, 90, { electroFlare: 11, electroRage: 2 })
    const gatedOff = computeSkillDamage(makeFinalStats(), electroFlareSkill, enemy, 90, { electroFlare: 10, electroRage: 2 })
    const buffed = computeSkillDamage(
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
})
