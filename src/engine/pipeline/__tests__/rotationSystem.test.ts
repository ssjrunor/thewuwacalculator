import { describe, expect, it } from 'vitest'
import { makeEchoUid, type ResSeed } from '@/domain/entities/runtime'
import { makeResRuntime, makeEnemy } from '@/domain/state/defaults'
import { getResonatorById } from '@/domain/services/catalogService'
import { nspcResRot, runResSmlt } from '@/engine/pipeline'

function makeMainEcho(id: string, set = 4) {
  return {
    uid: makeEchoUid(),
    id,
    set,
    mainEcho: true,
    mainStats: {
      primary: { key: 'critRate', value: 22 },
      secondary: { key: 'atkFlat', value: 150 },
    },
    substats: {},
  }
}

const seed: ResSeed = {
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

const negativeEffectSeed = getResonatorById('1501') as ResSeed

const spectroFrazzleFeatureId = 'damage:1501:negative-effect:spectro-frazzle'

describe('rotation system', () => {
  it('executes condition, repeat, and uptime blocks through the feature pipeline', () => {
    const runtime = makeResRuntime(seed)
    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.rotations.personal.entries).toHaveLength(4)
    expect(result.perSkill).toHaveLength(4)
    expect(result.perSkill[0]?.avg).toBeGreaterThan(0)
    expect(result.perSkill[3]?.avg).toBeCloseTo((result.perSkill[0]?.avg ?? 0) * 0.5)
    expect(result.total.avg).toBeCloseTo((result.perSkill[0]?.avg ?? 0) * 3.5)
    expect(runtime.state.manualBuffs.quick.critRate).toBe(0)
  })

  it('applies formula stat conditions only to later feature rows', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.personalItems = [
      {
        id: 'feature-before',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'set-flat-dmg',
        type: 'condition',
        changes: [{
          type: 'set',
          path: 'runtime.rotation.formula.flatDmg',
          value: 100,
        }],
      },
      {
        id: 'feature-after-set',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'add-flat-dmg',
        type: 'condition',
        changes: [{
          type: 'add',
          path: 'runtime.rotation.formula.flatDmg',
          value: 100,
        }],
      },
      {
        id: 'feature-after-add',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.perSkill).toHaveLength(3)
    expect(result.perSkill[1]?.avg).toBeGreaterThan(result.perSkill[0]?.avg ?? 0)
    expect(result.perSkill[2]?.avg).toBeGreaterThan(result.perSkill[1]?.avg ?? 0)
  })

  it('runs loop segments and tags loop totals by loop id', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.personalItems = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        label: 'Loop A',
        runs: 3,
      },
      {
        id: 'loop-feature',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
      },
      {
        id: 'loop-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
      {
        id: 'after-loop',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.perSkill).toHaveLength(4)
    expect(result.perSkill.filter((entry) => entry.nodeId === 'loop-feature')).toHaveLength(3)
    expect(result.perSkill.filter((entry) => entry.loopRuns?.['loop-a'] != null)).toHaveLength(3)
    expect(result.perSkill.filter((entry) => entry.loopRunCounts?.['loop-a'] === 3)).toHaveLength(3)
    expect(result.perSkill.find((entry) => entry.nodeId === 'after-loop')?.loopRuns?.['loop-a']).toBeUndefined()

    const loopEntry = result.perSkill.find((entry) => entry.nodeId === 'loop-feature')
    const afterLoopEntry = result.perSkill.find((entry) => entry.nodeId === 'after-loop')
    expect(result.total.avg).toBeCloseTo((loopEntry?.avg ?? 0) + (afterLoopEntry?.avg ?? 0))
  })

  it('emits inspection snapshots for conditions, blocks, and features across loop iterations', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.personalItems = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        label: 'Loop A',
        runs: 2,
      },
      {
        id: 'loop-condition',
        type: 'condition',
        changes: [
          {
            type: 'set',
            path: 'runtime.state.manualBuffs.quick.critRate',
            value: 25,
          },
        ],
      },
      {
        id: 'loop-repeat',
        type: 'repeat',
        times: 3,
        items: [],
      },
      {
        id: 'loop-uptime',
        type: 'uptime',
        ratio: 0.5,
        items: [],
      },
      {
        id: 'loop-feature',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'loop-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]

    const inspection = nspcResRot(runtime, seed, makeEnemy())
    const entries = inspection.rotations.personal.entries

    expect(entries.filter((entry) => entry.nodeId === 'loop-condition')).toMatchObject([
      {
        executed: true,
        loopRuns: { 'loop-a': 1 },
        value: { kind: 'condition', value: 25 },
      },
      {
        executed: true,
        loopRuns: { 'loop-a': 2 },
        value: { kind: 'condition', value: 25 },
      },
    ])
    expect(entries.filter((entry) => entry.nodeId === 'loop-repeat')).toMatchObject([
      { value: { kind: 'repeat', times: 3 } },
      { value: { kind: 'repeat', times: 3 } },
    ])
    expect(entries.filter((entry) => entry.nodeId === 'loop-uptime')).toMatchObject([
      { value: { kind: 'uptime', ratio: 0.5 } },
      { value: { kind: 'uptime', ratio: 0.5 } },
    ])
    expect(entries.filter((entry) => entry.nodeId === 'loop-feature')).toHaveLength(2)
    expect(entries.filter((entry) => entry.nodeId === 'loop-feature').every((entry) => entry.value?.kind === 'feature')).toBe(true)
  })

  it('applies when loop-run rules to rotation nodes', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.personalItems = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 3,
      },
      {
        id: 'only-second-run',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        when: {
          loops: [
            {
              loopId: 'loop-a',
              runs: [2],
            },
          ],
        },
      },
      {
        id: 'loop-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.perSkill).toHaveLength(1)
    expect(result.perSkill[0]?.nodeId).toBe('only-second-run')
    expect(result.perSkill[0]?.loopRuns?.['loop-a']).toBe(2)
  })

  it('wraps a no-end loop back to its own start and ignores foreign ends', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.personalItems = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 1,
      },
      {
        id: 'loop-feature-a',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
      },
      {
        id: 'foreign-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-b',
      },
      {
        id: 'loop-feature-b',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.perSkill.map((entry) => entry.nodeId)).toEqual(['loop-feature-a', 'loop-feature-b'])
    expect(result.perSkill.every((entry) => entry.loopRuns?.['loop-a'] === 1)).toBe(true)
  })

  it('wraps to a linked end that appears before the loop start', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.personalItems = [
      {
        id: 'before-end',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'loop-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 1,
        enabled: true,
      },
      {
        id: 'after-start',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.perSkill.map((entry) => entry.nodeId)).toEqual(['before-end', 'after-start', 'before-end'])
    expect(result.perSkill[0]?.loopRuns?.['loop-a']).toBeUndefined()
    expect(result.perSkill[1]?.loopRuns?.['loop-a']).toBe(1)
    expect(result.perSkill[2]?.loopRuns?.['loop-a']).toBe(1)
  })

  it('pushes and pops arbitrary nested loop starts in stack order', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.personalItems = [
      {
        id: 'loop-a-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 1,
        enabled: true,
      },
      {
        id: 'a-before-b',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'loop-b-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-b',
        runs: 1,
        enabled: true,
      },
      {
        id: 'b-before-c',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'loop-c-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-c',
        runs: 1,
        enabled: true,
      },
      {
        id: 'c-body',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'loop-c-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-c',
      },
      {
        id: 'b-after-c',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'loop-b-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-b',
      },
      {
        id: 'a-after-b',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'loop-a-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.perSkill.map((entry) => entry.nodeId)).toEqual([
      'a-before-b',
      'b-before-c',
      'c-body',
      'c-body',
      'b-after-c',
      'b-before-c',
      'c-body',
      'c-body',
      'b-after-c',
      'a-after-b',
    ])
    expect(result.perSkill[0]?.loopRuns).toEqual({ 'loop-a': 1 })
    expect(result.perSkill[1]?.loopRuns).toEqual({ 'loop-a': 1, 'loop-b': 1 })
    expect(result.perSkill[2]?.loopRuns).toEqual({ 'loop-a': 1, 'loop-b': 1, 'loop-c': 1 })
    expect(result.perSkill[3]?.loopRuns).toEqual({ 'loop-a': 1, 'loop-b': 1 })
    expect(result.perSkill[4]?.loopRuns).toEqual({ 'loop-a': 1, 'loop-b': 1 })
    expect(result.perSkill[5]?.loopRuns).toEqual({ 'loop-a': 1 })
    expect(result.perSkill[6]?.loopRuns).toEqual({ 'loop-a': 1, 'loop-c': 1 })
    expect(result.perSkill[7]?.loopRuns).toEqual({ 'loop-a': 1 })
    expect(result.perSkill[8]?.loopRuns).toEqual({ 'loop-a': 1 })
    expect(result.perSkill[9]?.loopRuns).toEqual({ 'loop-a': 1 })
  })

  it('lets nested loops run beyond the active parent boundary before returning', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.personalItems = [
      {
        id: 'loop-a-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 1,
        enabled: true,
      },
      {
        id: 'a-before-b',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'loop-b-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-b',
        runs: 1,
        enabled: true,
      },
      {
        id: 'inside-a-and-b',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'loop-a-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
      {
        id: 'outside-a-inside-b',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'loop-b-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-b',
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.perSkill.map((entry) => entry.nodeId)).toEqual([
      'a-before-b',
      'inside-a-and-b',
      'outside-a-inside-b',
      'inside-a-and-b',
      'outside-a-inside-b',
    ])
    expect(result.perSkill[1]?.loopRuns).toEqual({ 'loop-a': 1, 'loop-b': 1 })
    expect(result.perSkill[2]?.loopRuns).toEqual({ 'loop-a': 1, 'loop-b': 1 })
    expect(result.perSkill[3]?.loopRuns).toEqual({ 'loop-a': 1 })
    expect(result.perSkill[4]?.loopRuns).toBeUndefined()
  })

  it('does not re-enter an already active loop start cycle', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.personalItems = [
      {
        id: 'loop-a-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 1,
        enabled: true,
      },
      {
        id: 'loop-b-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-b',
        runs: 1,
        enabled: true,
      },
      {
        id: 'shared-body',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.perSkill.map((entry) => entry.nodeId)).toEqual(['shared-body', 'shared-body'])
    expect(result.perSkill[0]?.loopRuns).toEqual({ 'loop-a': 1, 'loop-b': 1 })
    expect(result.perSkill[1]?.loopRuns).toEqual({ 'loop-a': 1 })
  })

  it('can execute a sub-hit feature as an individual rotation item', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.personalItems = [
      {
        id: 'sub-hit-feature',
        type: 'feature',
        featureId: 'damage:test-skill:hit:1',
        multiplier: 1,
        enabled: true,
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.perSkill).toHaveLength(1)
    expect(result.perSkill[0]?.feature.variant).toBe('subHit')
    expect(result.perSkill[0]?.skill.label).toBe('Test Skill-1')
    expect(result.perSkill[0]?.subHits).toHaveLength(1)
    expect(result.perSkill[0]?.subHits[0]?.multiplier).toBe(1)
  })

  it('supports routing target selection changes inside rotation condition steps', () => {
    const runtime = makeResRuntime(seed)
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

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.perSkill).toHaveLength(1)
    expect(result.perSkill[0]?.avg).toBeGreaterThan(0)
  })

  it('supports enemy status changes inside rotation condition steps', () => {
    const conditionalSeed: ResSeed = {
      ...seed,
      features: (seed.features ?? []).map((feature) =>
        feature.id === 'damage:test-skill'
          ? {
              ...feature,
              condition: {
                type: 'gte' as const,
                path: 'enemy.status.tuneStrain',
                value: 4,
              },
            }
          : feature,
      ),
    }

    const blockedRuntime = makeResRuntime(conditionalSeed)
    blockedRuntime.rotation.personalItems = [
      {
        id: 'feature-main',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
    ]

    const blockedResult = runResSmlt(blockedRuntime, conditionalSeed, makeEnemy())
    expect(blockedResult.perSkill).toHaveLength(0)

    const runtime = makeResRuntime(conditionalSeed)
    runtime.rotation.personalItems = [
      {
        id: 'set-tune-strain',
        type: 'condition',
        changes: [
          {
            type: 'set',
            path: 'enemy.status.tuneStrain',
            value: 4,
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

    const result = runResSmlt(runtime, conditionalSeed, makeEnemy())

    expect(result.perSkill).toHaveLength(1)
    expect(result.perSkill[0]?.avg).toBeGreaterThan(0)
  })

  it('uses attached enemy combat status changes for negative-effect feature stacks', () => {
    const baselineRuntime = makeResRuntime(negativeEffectSeed)
    baselineRuntime.rotation.personalItems = [
      {
        id: 'frazzle-baseline',
        type: 'feature',
        featureId: spectroFrazzleFeatureId,
        multiplier: 1,
        negativeEffectStacks: 1,
        enabled: true,
      },
    ]
    const baselineResult = runResSmlt(baselineRuntime, negativeEffectSeed, makeEnemy())

    const runtime = makeResRuntime(negativeEffectSeed)
    runtime.rotation.personalItems = [
      {
        id: 'frazzle-feature',
        type: 'feature',
        featureId: spectroFrazzleFeatureId,
        multiplier: 1,
        negativeEffectStacks: 1,
        changes: [
          {
            type: 'set',
            path: 'enemy.combat.spectroFrazzle',
            value: 3,
          },
        ],
        enabled: true,
      },
    ]

    const result = runResSmlt(runtime, negativeEffectSeed, makeEnemy())

    expect(result.perSkill).toHaveLength(1)
    expect(result.perSkill[0]?.avg).toBeGreaterThan(baselineResult.perSkill[0]?.avg ?? 0)
    expect(runtime.state.combat.spectroFrazzle).toBe(0)
  })

  it('applies formula MV conditions to negative-effect features', () => {
    const baselineRuntime = makeResRuntime(negativeEffectSeed)
    baselineRuntime.rotation.personalItems = [
      {
        id: 'frazzle-baseline',
        type: 'feature',
        featureId: spectroFrazzleFeatureId,
        multiplier: 1,
        negativeEffectStacks: 1,
        enabled: true,
      },
    ]

    const runtime = makeResRuntime(negativeEffectSeed)
    runtime.rotation.personalItems = [
      {
        id: 'scale-mv',
        type: 'condition',
        changes: [{
          type: 'set',
          path: 'runtime.rotation.formula.mvScale',
          value: 100,
        }],
      },
      {
        id: 'frazzle-scaled',
        type: 'feature',
        featureId: spectroFrazzleFeatureId,
        multiplier: 1,
        negativeEffectStacks: 1,
        enabled: true,
      },
    ]

    const baselineResult = runResSmlt(baselineRuntime, negativeEffectSeed, makeEnemy())
    const result = runResSmlt(runtime, negativeEffectSeed, makeEnemy())

    expect(result.perSkill).toHaveLength(1)
    expect(result.perSkill[0]?.avg).toBeGreaterThan(baselineResult.perSkill[0]?.avg ?? 0)
  })

  it('can execute teammate features with the teammate runtime instead of the active runtime', () => {
    const activeSeed = getResonatorById('1506')
    const teammateSeed = getResonatorById('1412')

    expect(activeSeed).toBeTruthy()
    expect(teammateSeed).toBeTruthy()

    if (!activeSeed || !teammateSeed || teammateSeed.features.length === 0) {
      return
    }

    const activeRuntime = makeResRuntime(activeSeed)
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

    const lowLevelTeammate = makeResRuntime(teammateSeed)
    lowLevelTeammate.base.level = 1

    const highLevelTeammate = makeResRuntime(teammateSeed)
    highLevelTeammate.base.level = 90

    const lowLevelResult = runResSmlt(activeRuntime, activeSeed, makeEnemy(), {
      [teammateSeed.id]: lowLevelTeammate,
    })
    const highLevelResult = runResSmlt(activeRuntime, activeSeed, makeEnemy(), {
      [teammateSeed.id]: highLevelTeammate,
    })

    expect(lowLevelResult.rotations.team.entries[0]?.resonatorId).toBe(teammateSeed.id)
    expect(lowLevelResult.rotations.team.entries[0]?.resonatorName).toBe(teammateSeed.name)
    expect(highLevelResult.rotations.team.total.avg).toBeGreaterThan(lowLevelResult.rotations.team.total.avg)
  })

  it('can switch the active resonator for active-targeted rotation effects', () => {
    const sourceSeed = getResonatorById('1506')
    const defaultTargetSeed = getResonatorById('1208')
    const switchedTargetSeed = getResonatorById('1412')

    expect(sourceSeed).toBeTruthy()
    expect(defaultTargetSeed).toBeTruthy()
    expect(switchedTargetSeed).toBeTruthy()

    if (!sourceSeed || !defaultTargetSeed || !switchedTargetSeed || switchedTargetSeed.features.length === 0) {
      return
    }

    const makeSourceRuntime = (switchActive: boolean) => {
      const sourceRuntime = makeResRuntime(sourceSeed)
      sourceRuntime.build.team = [sourceSeed.id, defaultTargetSeed.id, switchedTargetSeed.id]
      sourceRuntime.build.echoes[0] = makeMainEcho('6000052')
      sourceRuntime.state.controls['echo:6000052:main:active'] = true
      sourceRuntime.rotation.view = 'team'
      sourceRuntime.rotation.teamItems = [
        ...(switchActive
          ? [{
            id: 'switch-active',
            type: 'condition' as const,
            changes: [{
              type: 'set' as const,
              path: 'runtime.rotation.activeResonatorId',
              value: switchedTargetSeed.id,
            }],
            enabled: true,
          }]
          : []),
        {
          id: 'switched-target-feature',
          type: 'feature' as const,
          resonatorId: switchedTargetSeed.id,
          featureId: switchedTargetSeed.features[0].id,
          multiplier: 1,
          enabled: true,
        },
      ]

      return sourceRuntime
    }

    const team: [string, string, string] = [sourceSeed.id, defaultTargetSeed.id, switchedTargetSeed.id]
    const defaultTargetRuntime = makeResRuntime(defaultTargetSeed)
    defaultTargetRuntime.build.team = [...team]
    const switchedTargetRuntime = makeResRuntime(switchedTargetSeed)
    switchedTargetRuntime.build.team = [...team]
    const teammateRuntimes = {
      [defaultTargetSeed.id]: defaultTargetRuntime,
      [switchedTargetSeed.id]: switchedTargetRuntime,
    }

    const baselineResult = runResSmlt(makeSourceRuntime(false), sourceSeed, makeEnemy(), teammateRuntimes)
    const switchedResult = runResSmlt(makeSourceRuntime(true), sourceSeed, makeEnemy(), teammateRuntimes)

    expect(baselineResult.rotations.team.entries[0]?.resonatorId).toBe(switchedTargetSeed.id)
    expect(switchedResult.rotations.team.entries[0]?.resonatorId).toBe(switchedTargetSeed.id)
    expect(switchedResult.rotations.team.total.avg).toBeGreaterThan(baselineResult.rotations.team.total.avg)
  })

  it('supports per-entry negative effect stack overrides on feature nodes', () => {
    const runtime = makeResRuntime(negativeEffectSeed)
    runtime.state.combat.spectroFrazzle = 1
    runtime.rotation.personalItems = [
      {
        id: 'frazzle-default',
        type: 'feature',
        featureId: spectroFrazzleFeatureId,
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'frazzle-override',
        type: 'feature',
        featureId: spectroFrazzleFeatureId,
        multiplier: 1,
        negativeEffectStacks: 3,
        enabled: true,
      },
    ]

    const result = runResSmlt(runtime, negativeEffectSeed, makeEnemy())

    expect(result.perSkill).toHaveLength(2)
    expect(result.perSkill[0]?.avg).toBeGreaterThan(0)
    expect(result.perSkill[1]?.avg).toBeGreaterThan(result.perSkill[0]?.avg ?? 0)
  })

  it('supports negative effect series spread on feature nodes', () => {
    const seriesRuntime = makeResRuntime(negativeEffectSeed)
    seriesRuntime.rotation.personalItems = [
      {
        id: 'frazzle-series',
        type: 'feature',
        featureId: spectroFrazzleFeatureId,
        multiplier: 1,
        negativeEffectStacks: 10,
        negativeEffectInstances: 5,
        negativeEffectStableWidth: 2,
        enabled: true,
      },
    ]

    const manualRuntime = makeResRuntime(negativeEffectSeed)
    manualRuntime.rotation.personalItems = [10, 10, 9, 9, 8].map((stacks, index) => ({
      id: `frazzle-manual:${index}`,
      type: 'feature' as const,
      featureId: spectroFrazzleFeatureId,
      multiplier: 1,
      negativeEffectStacks: stacks,
      enabled: true,
    }))

    const seriesResult = runResSmlt(seriesRuntime, negativeEffectSeed, makeEnemy())
    const manualResult = runResSmlt(manualRuntime, negativeEffectSeed, makeEnemy())

    expect(seriesResult.perSkill).toHaveLength(1)
    expect(manualResult.perSkill).toHaveLength(5)
    expect(seriesResult.total.avg).toBeCloseTo(manualResult.total.avg)
    expect(seriesResult.total.normal).toBeCloseTo(manualResult.total.normal)
  })
})
