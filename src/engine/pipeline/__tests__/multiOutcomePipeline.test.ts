import { describe, expect, it } from 'vitest'
import type { ResonatorSeed } from '@/domain/entities/runtime'
import { createDefaultResonatorRuntime, makeDefaultEnemyProfile } from '@/domain/state/defaults'
import { runResonatorSimulation } from '@/engine/pipeline'

const seed: ResonatorSeed = {
  id: 'multi-outcome-test',
  name: 'Multi Outcome Test',
  profile: '/assets/resonators/profiles/multi-outcome-test.webp',
  attribute: 'spectro',
  weaponType: 5,
  defaultWeaponId: null,
  baseStats: {
    hp: 2000,
    atk: 500,
    def: 200,
    critRate: 5,
    critDmg: 150,
    energyRegen: 100,
    healingBonus: 0,
    tuneBreakBoost: 0,
  },
  skills: [
    {
      id: 'damage-skill',
      label: 'Damage Skill',
      tab: 'normalAttack',
      skillType: ['basicAtk'],
      archetype: 'skillDamage',
      aggregationType: 'damage',
      element: 'spectro',
      multiplier: 1,
      flat: 0,
      scaling: { atk: 1, hp: 0, def: 0, energyRegen: 0 },
      levelSource: null,
      visible: true,
      hits: [{ count: 1, multiplier: 1 }],
    },
    {
      id: 'healing-skill',
      label: 'Healing Skill',
      tab: 'resonanceSkill',
      skillType: ['healing'],
      archetype: 'healing',
      aggregationType: 'healing',
      element: 'spectro',
      multiplier: 0.25,
      flat: 100,
      scaling: { atk: 1, hp: 0, def: 0, energyRegen: 0 },
      levelSource: null,
      visible: true,
      hits: [],
    },
    {
      id: 'shield-skill',
      label: 'Shield Skill',
      tab: 'forteCircuit',
      skillType: ['shield'],
      archetype: 'shield',
      aggregationType: 'shield',
      element: 'spectro',
      multiplier: 0.15,
      flat: 150,
      scaling: { atk: 0, hp: 1, def: 0, energyRegen: 0 },
      levelSource: null,
      visible: true,
      hits: [],
    },
    {
      id: 'tune-rupture-skill',
      label: 'Tune Rupture',
      tab: 'tuneBreak',
      skillType: ['tuneRupture'],
      archetype: 'tuneRupture',
      aggregationType: 'damage',
      element: 'physical',
      multiplier: 16,
      flat: 0,
      scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
      tuneRuptureCritRate: 0,
      tuneRuptureCritDmg: 1,
      levelSource: null,
      visible: true,
      hits: [{ count: 1, multiplier: 16 }],
    },
    {
      id: 'frazzle-skill',
      label: 'Spectro Frazzle',
      tab: 'negativeEffect',
      skillType: ['spectroFrazzle'],
      archetype: 'spectroFrazzle',
      aggregationType: 'damage',
      element: 'spectro',
      multiplier: 1,
      flat: 0,
      scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
      levelSource: null,
      visible: true,
      hits: [{ count: 1, multiplier: 1 }],
    },
    {
      id: 'fusion-burst-skill',
      label: 'Fusion Burst',
      tab: 'negativeEffect',
      skillType: ['fusionBurst'],
      archetype: 'fusionBurst',
      aggregationType: 'damage',
      element: 'fusion',
      multiplier: 1,
      flat: 0,
      scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
      levelSource: null,
      visible: true,
      hits: [{ count: 1, multiplier: 1 }],
    },
  ],
  states: [],
  features: [
    {
      id: 'feature:damage-skill',
      label: 'Damage Skill',
      source: { type: 'resonator', id: 'multi-outcome-test' },
      kind: 'skill',
      skillId: 'damage-skill',
    },
    {
      id: 'feature:healing-skill',
      label: 'Healing Skill',
      source: { type: 'resonator', id: 'multi-outcome-test' },
      kind: 'skill',
      skillId: 'healing-skill',
    },
    {
      id: 'feature:shield-skill',
      label: 'Shield Skill',
      source: { type: 'resonator', id: 'multi-outcome-test' },
      kind: 'skill',
      skillId: 'shield-skill',
    },
    {
      id: 'feature:tune-rupture-skill',
      label: 'Tune Rupture',
      source: { type: 'resonator', id: 'multi-outcome-test' },
      kind: 'skill',
      skillId: 'tune-rupture-skill',
    },
    {
      id: 'feature:frazzle-skill',
      label: 'Spectro Frazzle',
      source: { type: 'resonator', id: 'multi-outcome-test' },
      kind: 'skill',
      skillId: 'frazzle-skill',
    },
    {
      id: 'feature:fusion-burst-skill',
      label: 'Fusion Burst',
      source: { type: 'resonator', id: 'multi-outcome-test' },
      kind: 'skill',
      skillId: 'fusion-burst-skill',
    },
  ],
  rotations: [
    {
      id: 'default',
      label: 'Default',
      source: { type: 'resonator', id: 'multi-outcome-test' },
      items: [
        { id: 'damage', type: 'feature', featureId: 'feature:damage-skill', enabled: true },
        { id: 'healing', type: 'feature', featureId: 'feature:healing-skill', enabled: true },
        { id: 'shield', type: 'feature', featureId: 'feature:shield-skill', enabled: true },
        { id: 'tune', type: 'feature', featureId: 'feature:tune-rupture-skill', enabled: true },
        { id: 'frazzle', type: 'feature', featureId: 'feature:frazzle-skill', enabled: true },
        { id: 'fusion-burst', type: 'feature', featureId: 'feature:fusion-burst-skill', enabled: true },
      ],
    },
  ],
}

describe('multi-outcome pipeline', () => {
  it('keeps damage, healing, and shield in separate aggregation buckets', () => {
    const runtime = createDefaultResonatorRuntime(seed)
    runtime.state.combat.spectroFrazzle = 3
    runtime.state.combat.fusionBurst = 3
    const result = runResonatorSimulation(runtime, seed, makeDefaultEnemyProfile())

    expect(result.perSkill.map((entry) => entry.archetype)).toEqual([
      'skillDamage',
      'healing',
      'shield',
      'tuneRupture',
      'spectroFrazzle',
      'fusionBurst',
    ])

    expect(result.totalsByAggregation.damage.avg).toBeGreaterThan(0)
    expect(result.totalsByAggregation.healing.avg).toBeGreaterThan(0)
    expect(result.totalsByAggregation.shield.avg).toBeGreaterThan(0)
    expect(result.total.avg).toBeCloseTo(result.totalsByAggregation.damage.avg)
    expect(result.perSkill.find((entry) => entry.archetype === 'healing')?.avg).toBeGreaterThan(0)
    expect(result.perSkill.find((entry) => entry.archetype === 'shield')?.avg).toBeGreaterThan(0)
    expect(result.perSkill.find((entry) => entry.archetype === 'fusionBurst')?.avg).toBeGreaterThan(0)
  })
})
