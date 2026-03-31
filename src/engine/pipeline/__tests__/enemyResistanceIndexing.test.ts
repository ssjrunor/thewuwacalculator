import { describe, expect, it } from 'vitest'
import type { FinalStats, SkillDefinition } from '@/domain/entities/stats'
import { computeSkillDamage } from '@/engine/formulas/damage'
import type { EnemyProfile } from '@/domain/entities/appState'

function makeFinalStats(): FinalStats {
  return {
    atk: { base: 1000, final: 1000 },
    hp: { base: 1000, final: 1000 },
    def: { base: 1000, final: 1000 },
    attribute: {
      all: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      physical: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      glacio: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      fusion: { resShred: 20, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      electro: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      aero: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      spectro: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      havoc: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
    },
    skillType: {
      all: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      basicAtk: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      heavyAtk: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      resonanceSkill: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      resonanceLiberation: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      introSkill: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      outroSkill: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      echoSkill: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      coord: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      spectroFrazzle: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      aeroErosion: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      fusionBurst: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      healing: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      shield: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
      tuneRupture: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
    },
    flatDmg: 0,
    amplify: 0,
    critRate: 0,
    critDmg: 100,
    energyRegen: 100,
    healingBonus: 0,
    shieldBonus: 0,
    dmgBonus: 0,
    defIgnore: 0,
    defShred: 0,
    dmgVuln: 0,
    tuneBreakBoost: 0,
    fusionBurstMultiplier: 0,
    special: 0,
  }
}

const skill: SkillDefinition = {
  id: 'fusion-test',
  label: 'Fusion Test',
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

describe('enemy resistance indexing', () => {
  it('uses the skill element index in enemy.res and applies matching attribute res shred', () => {
    const enemyUsingFusionIndex: EnemyProfile = {
      id: 'enemy',
      level: 90,
      class: 0,
      toa: false,
      res: {
        0: 20,
        1: 60,
        2: 20,
        3: 20,
        4: 20,
        5: 20,
        6: 20,
      },
    }
    const enemyWithChangedGlacioOnly: EnemyProfile = {
      ...enemyUsingFusionIndex,
      res: {
        ...enemyUsingFusionIndex.res,
        1: 95,
      },
    }
    const enemyWithChangedFusion: EnemyProfile = {
      ...enemyUsingFusionIndex,
      res: {
        ...enemyUsingFusionIndex.res,
        2: 60,
      },
    }

    const baseline = computeSkillDamage(makeFinalStats(), skill, enemyUsingFusionIndex, 90)
    const changedGlacioOnly = computeSkillDamage(makeFinalStats(), skill, enemyWithChangedGlacioOnly, 90)
    const changedFusion = computeSkillDamage(makeFinalStats(), skill, enemyWithChangedFusion, 90)

    expect(baseline.normal).toBeGreaterThan(0)
    expect(changedGlacioOnly.normal).toBeCloseTo(baseline.normal)
    expect(changedFusion.normal).toBeLessThan(baseline.normal)
  })
})
