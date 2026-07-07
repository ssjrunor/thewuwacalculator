/*
  Author: Runor Ewhro
  Description: verifies rotation execution semantics for conditions, repeats,
               uptime blocks, formula-stat changes, loop iteration metadata,
               and loop edge cases.
*/

import { describe, expect, it } from 'vitest'
import type { ResSeed } from '@/domain/entities/runtime'
import { makeResRuntime, makeEnemy } from '@/domain/state/defaults'
import { nspcResRot, runResSmlt } from '@/engine/pipeline'

const seed: ResSeed = {
  // compact resonator fixture with one two-hit damage skill and one default
  // rotation, enough to isolate rotation control-flow from generated data drift
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

describe('rotation execution invariants', () => {
  it('executes condition, repeat, and uptime blocks through the feature pipeline', () => {
    // this combines the common block types so total weighting proves the walker
    // executes nested features and restores temporary condition state afterwards
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
    // rotation formula stats are row-scoped mutations, so earlier rows must not
    // be retroactively affected by later set/add condition nodes
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
    // loop metadata is used by inspectors and summaries; only rows emitted
    // inside the loop should carry run tags and run-count totals
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
    // inspection mode has to record non-damage nodes too so the editor can show
    // what each loop iteration executed even when a block has no child damage
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
    // loop-run predicates filter individual node executions without changing
    // the surrounding loop traversal or run counter
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
    // incomplete loop markup is tolerated by wrapping locally; unrelated end
    // markers should not terminate the active loop stack
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
    // users can place loop markers around existing nodes, so a start may link
    // to an earlier end and intentionally replay the wrapped segment
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
    // nested loops must unwind like a stack or child loop metadata leaks into
    // sibling rows after the child end marker
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
    // a child loop can own rows that are textually past the parent end marker;
    // traversal must finish that child before returning to normal sequence flow
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
    // loops without end markers can share the same trailing body; the walker
    // must not recursively restart a loop that is already on the active stack
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
    // sub-hit feature ids are materialized as standalone features so rotations
    // can score one hit from a multi-hit skill without duplicating skill data
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
    // routing paths live outside ordinary stats but still need the same
    // condition-step writer so scripted rotations can retarget later features
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
    // enemy state mutations must be visible to feature conditions that run after
    // the condition node, and invisible when no condition node applied them
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
})
