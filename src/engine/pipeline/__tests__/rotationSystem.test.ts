import { describe, expect, it } from 'vitest'
import type { ResonatorSeed } from '@/domain/entities/runtime'
import { createDefaultResonatorRuntime, makeDefaultEnemyProfile } from '@/domain/state/defaults'
import { getResonatorById } from '@/domain/services/catalogService'
import { runResonatorSimulation } from '@/engine/pipeline'

const seed: ResonatorSeed = {
  id: 'test-resonator',
  name: 'Test Resonator',
  profile: '/assets/resonators/profiles/test-resonator.webp',
  attribute: 'spectro',
  weaponType: 5,
  defaultWeaponId: null,
  baseStats: {
    hp: 1000,
    atk: 100,
    def: 100,
    critRate: 5,
    critDmg: 150,
    energyRegen: 100,
    healingBonus: 0,
    tuneBreakBoost: 0,
  },
  skills: [
    {
      id: 'test-skill',
      label: 'Test Skill',
      tab: 'normalAttack',
      skillType: ['basicAtk'],
      archetype: 'skillDamage',
      aggregationType: 'damage',
      element: 'spectro',
      multiplier: 1,
      flat: 0,
      scaling: {
        atk: 1,
        hp: 0,
        def: 0,
        energyRegen: 0,
      },
      levelSource: null,
      visible: true,
      hits: [
        {
          count: 1,
          multiplier: 1,
        },
        {
          count: 1,
          multiplier: 2,
        },
      ],
    },
  ],
  states: [],
  features: [
    {
      id: 'damage:test-skill',
      label: 'Test Skill',
      source: {
        type: 'resonator',
        id: 'test-resonator',
      },
      kind: 'skill',
      skillId: 'test-skill',
    },
    {
      id: 'damage:test-skill:hit:1',
      label: 'Test Skill-1',
      source: {
        type: 'resonator',
        id: 'test-resonator',
      },
      kind: 'skill',
      skillId: 'test-skill',
      variant: 'subHit',
      hitIndex: 0,
    },
  ],
  rotations: [
    {
      id: 'default',
      label: 'Default',
      source: {
        type: 'resonator',
        id: 'test-resonator',
      },
      items: [
        {
          id: 'set-buff',
          type: 'condition',
          changes: [
            {
              type: 'set',
              path: 'runtime.state.manualBuffs.quick.critRate',
              value: 100,
            },
          ],
        },
        {
          id: 'feature-main',
          type: 'feature',
          featureId: 'damage:test-skill',
          multiplier: 1,
          enabled: true,
        },
        {
          id: 'repeat-window',
          type: 'repeat',
          times: 2,
          items: [
            {
              id: 'repeat-feature',
              type: 'feature',
              featureId: 'damage:test-skill',
              multiplier: 1,
              enabled: true,
            },
          ],
        },
        {
          id: 'uptime-window',
          type: 'uptime',
          ratio: 0.5,
          items: [
            {
              id: 'uptime-feature',
              type: 'feature',
              featureId: 'damage:test-skill',
              multiplier: 1,
              enabled: true,
            },
          ],
        },
      ],
    },
  ],
}

const negativeEffectSeed: ResonatorSeed = {
  id: 'negative-effect-test-resonator',
  name: 'Negative Effect Test Resonator',
  profile: '/assets/resonators/profiles/negative-effect-test-resonator.webp',
  attribute: 'spectro',
  weaponType: 5,
  defaultWeaponId: null,
  baseStats: {
    hp: 1000,
    atk: 100,
    def: 100,
    critRate: 5,
    critDmg: 150,
    energyRegen: 100,
    healingBonus: 0,
    tuneBreakBoost: 0,
  },
  skills: [
    {
      id: 'test-frazzle',
      label: 'Test Frazzle',
      tab: 'negativeEffect',
      skillType: ['spectroFrazzle'],
      archetype: 'spectroFrazzle',
      aggregationType: 'damage',
      element: 'spectro',
      multiplier: 1,
      flat: 0,
      scaling: {
        atk: 0,
        hp: 0,
        def: 0,
        energyRegen: 0,
      },
      levelSource: null,
      visible: true,
      hits: [
        {
          count: 1,
          multiplier: 1,
        },
      ],
    },
  ],
  states: [],
  features: [
    {
      id: 'damage:test-frazzle',
      label: 'Test Frazzle',
      source: {
        type: 'resonator',
        id: 'negative-effect-test-resonator',
      },
      kind: 'skill',
      skillId: 'test-frazzle',
    },
  ],
  rotations: [],
}

describe('rotation system', () => {
  it('executes condition, repeat, and uptime blocks through the feature pipeline', () => {
    const runtime = createDefaultResonatorRuntime(seed)
    const result = runResonatorSimulation(runtime, seed, makeDefaultEnemyProfile())

    expect(result.rotations.personal.entries).toHaveLength(4)
    expect(result.perSkill).toHaveLength(4)
    expect(result.perSkill[0]?.avg).toBeGreaterThan(0)
    expect(result.perSkill[3]?.avg).toBeCloseTo((result.perSkill[0]?.avg ?? 0) * 0.5)
    expect(result.total.avg).toBeCloseTo((result.perSkill[0]?.avg ?? 0) * 3.5)
    expect(runtime.state.manualBuffs.quick.critRate).toBe(0)
  })

  it('can execute a sub-hit feature as an individual rotation item', () => {
    const runtime = createDefaultResonatorRuntime(seed)
    runtime.rotation.personalItems = [
      {
        id: 'sub-hit-feature',
        type: 'feature',
        featureId: 'damage:test-skill:hit:1',
        multiplier: 1,
        enabled: true,
      },
    ]

    const result = runResonatorSimulation(runtime, seed, makeDefaultEnemyProfile())

    expect(result.perSkill).toHaveLength(1)
    expect(result.perSkill[0]?.feature.variant).toBe('subHit')
    expect(result.perSkill[0]?.skill.label).toBe('Test Skill-1')
    expect(result.perSkill[0]?.subHits).toHaveLength(1)
    expect(result.perSkill[0]?.subHits[0]?.multiplier).toBe(1)
  })

  it('supports routing target selection changes inside rotation condition steps', () => {
    const runtime = createDefaultResonatorRuntime(seed)
    runtime.rotation.personalItems = [
      {
        id: 'set-routing-target',
        type: 'condition',
        resonatorId: seed.id,
        changes: [
          {
            type: 'set',
            path: 'runtime.routing.selectedTargetsByOwnerKey.test-owner',
            value: seed.id,
            resonatorId: seed.id,
          },
        ],
      },
      {
        id: 'feature-main',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
    ]

    const result = runResonatorSimulation(runtime, seed, makeDefaultEnemyProfile())

    expect(result.perSkill).toHaveLength(1)
    expect(result.perSkill[0]?.avg).toBeGreaterThan(0)
  })

  it('can execute teammate features with the teammate runtime instead of the active runtime', () => {
    const activeSeed = getResonatorById('1506')
    const teammateSeed = getResonatorById('1412')

    expect(activeSeed).toBeTruthy()
    expect(teammateSeed).toBeTruthy()

    if (!activeSeed || !teammateSeed || teammateSeed.features.length === 0) {
      return
    }

    const activeRuntime = createDefaultResonatorRuntime(activeSeed)
    activeRuntime.build.team = [activeSeed.id, teammateSeed.id, null]
    activeRuntime.rotation.view = 'team'
    activeRuntime.rotation.teamItems = [
      {
        id: 'team-feature',
        type: 'feature',
        resonatorId: teammateSeed.id,
        featureId: teammateSeed.features[0].id,
        multiplier: 1,
        enabled: true,
      },
    ]

    const lowLevelTeammate = createDefaultResonatorRuntime(teammateSeed)
    lowLevelTeammate.base.level = 1

    const highLevelTeammate = createDefaultResonatorRuntime(teammateSeed)
    highLevelTeammate.base.level = 90

    const lowLevelResult = runResonatorSimulation(activeRuntime, activeSeed, makeDefaultEnemyProfile(), {
      [teammateSeed.id]: lowLevelTeammate,
    })
    const highLevelResult = runResonatorSimulation(activeRuntime, activeSeed, makeDefaultEnemyProfile(), {
      [teammateSeed.id]: highLevelTeammate,
    })

    expect(lowLevelResult.rotations.team.entries[0]?.resonatorId).toBe(teammateSeed.id)
    expect(lowLevelResult.rotations.team.entries[0]?.resonatorName).toBe(teammateSeed.name)
    expect(highLevelResult.rotations.team.total.avg).toBeGreaterThan(lowLevelResult.rotations.team.total.avg)
  })

  it('supports per-entry negative effect stack overrides on feature nodes', () => {
    const runtime = createDefaultResonatorRuntime(negativeEffectSeed)
    runtime.state.combat.spectroFrazzle = 1
    runtime.rotation.personalItems = [
      {
        id: 'frazzle-default',
        type: 'feature',
        featureId: 'damage:test-frazzle',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'frazzle-override',
        type: 'feature',
        featureId: 'damage:test-frazzle',
        multiplier: 1,
        negativeEffectStacks: 3,
        enabled: true,
      },
    ]

    const result = runResonatorSimulation(runtime, negativeEffectSeed, makeDefaultEnemyProfile())

    expect(result.perSkill).toHaveLength(2)
    expect(result.perSkill[0]?.avg).toBeGreaterThan(0)
    expect(result.perSkill[1]?.avg).toBeGreaterThan(result.perSkill[0]?.avg ?? 0)
  })

  it('supports negative effect series spread on feature nodes', () => {
    const seriesRuntime = createDefaultResonatorRuntime(negativeEffectSeed)
    seriesRuntime.rotation.personalItems = [
      {
        id: 'frazzle-series',
        type: 'feature',
        featureId: 'damage:test-frazzle',
        multiplier: 1,
        negativeEffectStacks: 10,
        negativeEffectInstances: 5,
        negativeEffectStableWidth: 2,
        enabled: true,
      },
    ]

    const manualRuntime = createDefaultResonatorRuntime(negativeEffectSeed)
    manualRuntime.rotation.personalItems = [10, 10, 9, 9, 8].map((stacks, index) => ({
      id: `frazzle-manual:${index}`,
      type: 'feature' as const,
      featureId: 'damage:test-frazzle',
      multiplier: 1,
      negativeEffectStacks: stacks,
      enabled: true,
    }))

    const seriesResult = runResonatorSimulation(seriesRuntime, negativeEffectSeed, makeDefaultEnemyProfile())
    const manualResult = runResonatorSimulation(manualRuntime, negativeEffectSeed, makeDefaultEnemyProfile())

    expect(seriesResult.perSkill).toHaveLength(1)
    expect(manualResult.perSkill).toHaveLength(5)
    expect(seriesResult.total.avg).toBeCloseTo(manualResult.total.avg)
    expect(seriesResult.total.normal).toBeCloseTo(manualResult.total.normal)
  })
})
