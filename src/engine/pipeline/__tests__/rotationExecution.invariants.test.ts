/*
  Author: Runor Ewhro
  Description: verifies rotation execution semantics for conditions, repeats,
               uptime blocks, formula-stat changes, loop iteration metadata,
               and loop edge cases.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { ResSeed } from '@/domain/entities/runtime'
import { makeResRuntime, makeEnemy } from '@/domain/state/defaults'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { listResFeats, listResSkll } from '@/domain/services/gameDataService'
import {
  inspectResRotation,
  prepareResSimulation,
  runDetailedResRotation,
  runResSmlt,
} from '@/engine/pipeline'
import {
  executeRotationProgram,
  executeRotationScore,
  prepareRunEnv,
  prepareRotationProgram,
} from '@/engine/rotation/execute.ts'
import {
  mkPrepWork,
  runPrepWorkDetailedProgram,
  runPrepWorkDetailedProgramTimed,
  runPrepWorkDetailedStoredProgram,
} from '@/engine/pipeline/preparedWorkspace.ts'
import { recordRotationTape, replayTape } from '@/engine/rotation/experimental/tape.ts'

const seed: ResSeed = {
  // compact resonator fixture with one two-hit damage skill and one default
  // rotation, enough to isolate rotation control-flow from generated data drift
  id: 'test-resonator',
  name: 'Test Resonator',
  profile: '/assets/game/resonators/profiles/test-resonator.webp',
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
      skillId: 'test-skill',
    },
    {
      id: 'damage:test-skill:hit:1',
      label: 'Test Skill-1',
      source: {
        type: 'resonator',
        id: 'test-resonator',
      },
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
  it('executes explicit prepared programs through the same path as the runtime wrapper', () => {
    const runtime = makeResRuntime(seed)
    const enemy = makeEnemy()
    const { context } = prepareResSimulation(runtime, seed, enemy)
    const prepared = prepareRotationProgram(runtime.rotation.sequence)
    const direct = executeRotationProgram(
      prepareRunEnv(context, seed),
      prepared,
    )
    const wrapped = runResSmlt(runtime, seed, enemy).rotation.sequence.entries

    expect(Object.isFrozen(prepared)).toBe(true)
    expect(Object.isFrozen(prepared.items)).toBe(true)
    expect(prepared.items).not.toBe(runtime.rotation.sequence)
    expect(direct.entries.map((entry) => ({
      id: entry.id,
      normal: entry.normal,
      crit: entry.crit,
      avg: entry.avg,
      weight: entry.weight,
    }))).toEqual(wrapped.map((entry) => ({
      id: entry.id,
      normal: entry.normal,
      crit: entry.crit,
      avg: entry.avg,
      weight: entry.weight,
    })))
  })

  it('keeps rowless numeric execution exactly aligned with captured feature rows', () => {
    const runtime = makeResRuntime(seed)
    const enemy = makeEnemy()
    const { context } = prepareResSimulation(runtime, seed, enemy)
    const environment = prepareRunEnv(context, seed)
    const prepared = prepareRotationProgram(runtime.rotation.sequence)
    const captured = executeRotationProgram(environment, prepared, { detail: 'summary' })
    const numeric = executeRotationScore(environment, prepared)
    const capturedTotals = captured.entries.reduce(
      (total, entry) => ({
        normal: total.normal + entry.normal,
        crit: total.crit + entry.crit,
        avg: total.avg + entry.avg,
      }),
      { normal: 0, crit: 0, avg: 0 },
    )

    expect(numeric.total).toEqual(capturedTotals)
    expect(numeric.resonators).toEqual([{
      id: runtime.id,
      ...capturedTotals,
    }])
    expect(numeric.metrics).toMatchObject({
      numericForks: 1,
      numericCheckpoints: 1,
      graphMaterializations: 0,
      scalarFeatures: 4,
      capturedEntries: 0,
    })
    expect(captured.metrics.capturedEntries).toBe(4)
  })

  it.each(['healing', 'shield'] as const)(
    'keeps %s output out of the rowless damage score',
    (aggregationType) => {
      const supportSeed: ResSeed = {
        ...seed,
        skills: (seed.skills ?? []).map((skill) => ({ ...skill, aggregationType })),
      }
      const runtime = makeResRuntime(supportSeed)
      const { context } = prepareResSimulation(runtime, supportSeed, makeEnemy())
      const program = prepareRotationProgram(runtime.rotation.sequence)
      const captured = executeRotationProgram(prepareRunEnv(context, supportSeed), program, {
        detail: 'summary',
      })
      const score = executeRotationScore(
        prepareRunEnv(context, supportSeed),
        program,
        { aggregationType: 'damage' },
      )

      expect(captured.entries.some((entry) => entry.avg > 0)).toBe(true)
      expect(score.total).toEqual({ normal: 0, crit: 0, avg: 0 })
      expect(score.normalizedTotal).toEqual({ normal: 0, crit: 0, avg: 0 })
      expect(score.resonators).toEqual([{
        id: runtime.id,
        normal: 0,
        crit: 0,
        avg: 0,
      }])
    },
  )

  it('accumulates normalized and full loop score vectors in the same rowless pass', () => {
    const runtime = makeResRuntime(seed)
    const { context } = prepareResSimulation(runtime, seed, makeEnemy())
    const score = executeRotationScore(
      prepareRunEnv(context, seed),
      prepareRotationProgram([
        { id: 'loop-start', type: 'loop', kind: 'start', loopId: 'twice', runs: 2 },
        { id: 'hit', type: 'feature', featureId: 'damage:test-skill' },
        { id: 'loop-end', type: 'loop', kind: 'end', loopId: 'twice' },
      ]),
    )

    expect(score.total.avg).toBeCloseTo(score.normalizedTotal.avg * 2)
    expect(score.resonators[0]?.avg).toBeCloseTo((score.normalizedResonators[0]?.avg ?? 0) * 2)
  })

  it('replays a genuinely different stat plane when rotation topology is unchanged', () => {
    const enemy = makeEnemy()
    const baseRuntime = makeResRuntime(seed)
    const variantRuntime = makeResRuntime(seed)
    variantRuntime.state.manualBuffs.quick.atk.flat += 250
    const program = prepareRotationProgram([
      { id: 'hit', type: 'feature', featureId: 'damage:test-skill' },
    ])
    const baseContext = prepareResSimulation(baseRuntime, seed, enemy).context
    const variantContext = prepareResSimulation(variantRuntime, seed, enemy).context
    const baseTape = recordRotationTape(prepareRunEnv(baseContext, seed), program)
    const variantTape = recordRotationTape(prepareRunEnv(variantContext, seed), program)
    const direct = executeRotationScore(prepareRunEnv(variantContext, seed), program)
    const replayed = replayTape(baseTape, { planes: variantTape.planes })

    expect(replayed.total.avg).toBeCloseTo(direct.total.avg)
    expect(replayed.normalizedTotal.avg).toBeCloseTo(direct.normalizedTotal.avg)
  })

  it('updates numeric lanes without rebuilding or memoizing combat contexts', () => {
    const runtime = makeResRuntime(seed)
    const enemy = makeEnemy()
    const { context } = prepareResSimulation(runtime, seed, enemy)
    const environment = prepareRunEnv(context, seed)
    const hit = (id: string): RotationNode => ({
      id,
      type: 'feature',
      featureId: 'damage:test-skill',
    })
    const setCrit = (id: string, value: number): RotationNode => ({
      id,
      type: 'condition',
      changes: [{
        type: 'set',
        path: 'runtime.state.manualBuffs.quick.critRate',
        value,
      }],
    })
    const program = prepareRotationProgram([
      setCrit('crit-on-1', 100),
      hit('hit-1'),
      setCrit('crit-off', 0),
      hit('hit-2'),
      setCrit('crit-on-2', 100),
      hit('hit-3'),
    ])

    executeRotationScore(environment, program)

    expect(environment.kernelMetrics.scalarFeatures).toBe(3)
    expect(environment.numericBase.program.laneIds).toEqual([runtime.id])
  })

  it('reuses detailed prepared-program executions', () => {
    const runtime = makeResRuntime(seed)
    const workspace = mkPrepWork({ runtime, seed, enemy: makeEnemy() })
    const environment = workspace.rotNvrn
    expect(environment).toBeTruthy()
    if (!environment) return

    const first = runPrepWorkDetailedProgramTimed(workspace, runtime.rotation.program)
    const second = runPrepWorkDetailedProgramTimed(workspace, runtime.rotation.program)
    expect(first?.cacheHit).toBe(false)
    expect(second?.cacheHit).toBe(true)
    expect(second?.prepareMs).toBe(0)
    expect(second?.executeMs).toBe(0)
    expect(second?.result).toBe(first?.result)
    expect(runPrepWorkDetailedProgram(workspace, runtime.rotation.program)).toBe(first?.result)
  })

  it('keeps main-only prepared fields lazy until a consumer reads them', () => {
    const runtime = makeResRuntime(seed)
    const workspace = mkPrepWork({ runtime, seed, enemy: makeEnemy() })

    expect(Object.getOwnPropertyDescriptor(workspace, 'directOutput')?.get).toBeTypeOf('function')
    expect(Object.getOwnPropertyDescriptor(workspace, 'visSkll')?.get).toBeTypeOf('function')
    expect(workspace.rotNvrn).toBeTruthy()
  })

  it('uses one cached canonical execution for interleaved stored editor sections', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = [
      { id: 'main-hit', type: 'feature', featureId: 'damage:test-skill' },
      {
        id: 'preamble-buff',
        type: 'condition',
        editorSection: 'preamble',
        changes: [{
          type: 'set',
          path: 'runtime.state.manualBuffs.quick.critRate',
          value: 100,
        }],
      },
    ]
    const workspace = mkPrepWork({ runtime, seed, enemy: makeEnemy() })

    const first = runPrepWorkDetailedStoredProgram(workspace, runtime.rotation.program)
    const second = runPrepWorkDetailedStoredProgram(workspace, runtime.rotation.program)
    const explicitlyOrdered = runDetailedResRotation(runtime, seed, workspace.enemy, {}, {}, {
      items: [runtime.rotation.program[1]!, runtime.rotation.program[0]!],
      includeSnapshots: true,
    })

    expect(second).toBe(first)
    expect(first?.entries.map((entry) => entry.avg)).toEqual(
      explicitlyOrdered.entries.map((entry) => entry.avg),
    )
  })

  it('shares inspection snapshots until the execution overlay changes', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
      { id: 'first', type: 'feature', featureId: 'damage:test-skill' },
      { id: 'second', type: 'feature', featureId: 'damage:test-skill' },
      {
        id: 'write',
        type: 'condition',
        changes: [{
          type: 'set',
          path: 'runtime.rotation.formula.flatDmg',
          value: 10,
        }],
      },
      { id: 'third', type: 'feature', featureId: 'damage:test-skill' },
    ]

    const inspection = runDetailedResRotation(runtime, seed, makeEnemy(), {}, {}, {
      includeSnapshots: true,
    }).inspection
    const first = inspection.find((entry) => entry.nodeId === 'first')
    const second = inspection.find((entry) => entry.nodeId === 'second')
    const third = inspection.find((entry) => entry.nodeId === 'third')

    expect(first?.runtimeById).toBe(second?.runtimeById)
    expect(first?.selectedTargetsByRuntimeId).toBe(second?.selectedTargetsByRuntimeId)
    expect(third?.runtimeById).not.toBe(second?.runtimeById)
  })

  it('executes condition, repeat, and uptime blocks through the feature pipeline', () => {
    // this combines the common block types so total output proves the walker
    // executes nested features and restores temporary condition state afterwards
    const runtime = makeResRuntime(seed)
    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.rotation.sequence.entries).toHaveLength(4)
    expect(result.perSkill).toHaveLength(4)
    expect(result.perSkill[0]?.avg).toBeGreaterThan(0)
    expect(result.perSkill[3]?.avg).toBeCloseTo(result.perSkill[0]?.avg ?? 0)
    expect(result.total.avg).toBeCloseTo((result.perSkill[0]?.avg ?? 0) * 4)
    expect(runtime.state.manualBuffs.quick.critRate).toBe(0)
  })

  it('keeps sequence and advanced program damage available as independent results', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [{
      id: 'sequence-feature',
      type: 'feature',
      featureId: 'damage:test-skill',
      multiplier: 1,
      enabled: true,
    }]
    runtime.rotation.program = [{
      id: 'program-feature',
      type: 'feature',
      featureId: 'damage:test-skill',
      multiplier: 3,
      enabled: true,
    }]

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.rotation.sequence.entries.map((entry) => entry.nodeId))
      .toEqual(['sequence-feature'])
    expect(result.rotation.program.entries.map((entry) => entry.nodeId))
      .toEqual(['program-feature'])
    expect(result.rotation.program.total.avg)
      .toBeCloseTo(result.rotation.sequence.total.avg * 3)
    expect(result.perSkill).toBe(result.rotation.sequence.entries)
  })

  it('applies formula stat conditions only to later feature rows', () => {
    // rotation formula stats are row-scoped mutations, so earlier rows must not
    // be retroactively affected by later set/add condition nodes
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
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

  it('stops iterative condition additions at the authored state maximum', () => {
    const controlKey = 'resonator:test-resonator:bounded:stacks'
    const path = `runtime.state.controls.${controlKey}`
    const boundedSeed: ResSeed = {
      ...seed,
      states: [{
        id: 'bounded-stacks',
        label: 'Bounded Stacks',
        source: { type: 'resonator', id: seed.id },
        ownerKey: 'resonator:test-resonator:bounded',
        controlKey,
        path,
        kind: 'stack',
        defaultValue: 0,
        min: 0,
        max: 50,
        maxValue: 50,
      }],
    }
    const runtime = makeResRuntime(boundedSeed)
    runtime.rotation.sequence = [1, 2, 3].map((index) => ({
      id: `add-bounded-${index}`,
      type: 'condition' as const,
      changes: [{
        type: 'add' as const,
        path,
        value: 25,
      }],
    }))

    const inspection = inspectResRotation(runtime, boundedSeed, makeEnemy())
    const values = inspection.map((entry) => (
      entry.value?.kind === 'condition' ? entry.value.value : undefined
    ))

    expect(values).toEqual([25, 50, 50])
  })

  it('resolves an empty select condition write to the authored default', () => {
    const selectSeed = getResSeedBy('1210')
    expect(selectSeed).toBeTruthy()
    if (!selectSeed) return

    const path = 'runtime.state.controls.inherent:1210:lvl70:stacks'
    const runtime = makeResRuntime(selectSeed)
    runtime.rotation.sequence = [{
      id: 'set-empty-mode-stacks',
      type: 'condition',
      changes: [{ type: 'set', path, value: '' }],
    }]

    const { context } = prepareResSimulation(runtime, selectSeed, makeEnemy())
    const prepared = prepareRunEnv(context, selectSeed)
    expect(prepared.stateDefsByResonator['1210']?.[path]).toMatchObject({
      kind: 'select',
      defaultValue: '0',
    })

    const inspection = inspectResRotation(runtime, selectSeed, makeEnemy())

    expect(inspection[0]?.value).toMatchObject({
      kind: 'condition',
      value: 0,
    })
  })

  it('displays and applies numeric select condition writes', () => {
    const selectSeed = getResSeedBy('1306')
    const feature = listResFeats('1306').find((entry) => entry.variant !== 'subHit')
    expect(selectSeed).toBeTruthy()
    expect(feature).toBeTruthy()
    if (!selectSeed || !feature) return

    const path = 'runtime.state.controls.resonator:1306:crown_of_wills:stacks'
    const runtime = makeResRuntime(selectSeed)
    runtime.rotation.sequence = [
      {
        id: 'feature-before-crown',
        type: 'feature',
        featureId: feature.id,
      },
      {
        id: 'set-crown',
        type: 'condition',
        changes: [{ type: 'set', path, value: '1' }],
      },
      {
        id: 'feature-after-crown',
        type: 'feature',
        featureId: feature.id,
      },
    ]

    const inspection = inspectResRotation(runtime, selectSeed, makeEnemy())
    const write = inspection.find((entry) => entry.nodeId === 'set-crown')
    expect(write?.value).toMatchObject({ kind: 'condition', value: 1 })

    const result = runResSmlt(runtime, selectSeed, makeEnemy())
    const before = result.perSkill.find((entry) => entry.nodeId === 'feature-before-crown')
    const after = result.perSkill.find((entry) => entry.nodeId === 'feature-after-crown')
    expect(after?.avg ?? 0).toBeGreaterThan(before?.avg ?? 0)
  })

  it('reports enemy combat writes from the mirrored runtime state', () => {
    const runtime = makeResRuntime(seed)
    runtime.state.combat.havocBane = 6
    runtime.rotation.sequence = [
      {
        id: 'reset-havoc-bane',
        type: 'condition',
        changes: [{
          type: 'set',
          path: 'enemy.combat.havocBane',
          value: 0,
        }],
      },
      {
        id: 'feature-after-reset',
        type: 'feature',
        featureId: 'damage:test-skill',
      },
      {
        id: 'add-havoc-bane',
        type: 'condition',
        changes: [{
          type: 'add',
          path: 'enemy.combat.havocBane',
          value: 1,
        }],
      },
      {
        id: 'feature-after-add',
        type: 'feature',
        featureId: 'damage:test-skill',
      },
    ]

    const entries = inspectResRotation(runtime, seed, makeEnemy())
    const conditions = entries.flatMap((entry) => (
      entry.value?.kind === 'condition'
        ? [{ before: entry.value.before, value: entry.value.value }]
        : []
    ))
    const defShred = entries.flatMap((entry) => (
      entry.value?.kind === 'feature'
        ? [entry.value.effectiveStats?.defShred]
        : []
    ))

    expect(conditions).toEqual([
      { before: 6, value: 0 },
      { before: 0, value: 1 },
    ])
    expect(defShred).toEqual([0, 2])
  })

  it('scopes attached feature condition effects to the parent group only', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
      {
        id: 'feature-before-attached',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'feature-with-attached',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
        // legacy changes still normalize into attached.conditions
        changes: [{
          type: 'set',
          path: 'runtime.rotation.formula.flatDmg',
          value: 100,
        }],
      },
      {
        id: 'feature-after-attached',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())
    const before = result.perSkill.find((entry) => entry.nodeId === 'feature-before-attached')?.avg ?? 0
    const attached = result.perSkill.find((entry) => entry.nodeId === 'feature-with-attached')?.avg ?? 0
    const after = result.perSkill.find((entry) => entry.nodeId === 'feature-after-attached')?.avg ?? 0

    expect(result.perSkill).toHaveLength(3)
    expect(attached).toBeGreaterThan(before)
    expect(after).toBeCloseTo(before)
  })

  it('applies attached conditions to the parent and sibling attached features', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
      {
        id: 'parent',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
        attached: {
          conditions: [{
            id: 'parent:cond',
            type: 'condition',
            changes: [{
              type: 'set',
              path: 'runtime.rotation.formula.flatDmg',
              value: 100,
            }],
          }],
          features: [{
            id: 'child',
            type: 'feature',
            featureId: 'damage:test-skill',
            multiplier: 1,
            enabled: true,
          }],
        },
      },
      {
        id: 'after',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())
    const parent = result.perSkill.find((entry) => entry.nodeId === 'parent')?.avg ?? 0
    const child = result.perSkill.find((entry) => entry.nodeId === 'child')?.avg ?? 0
    const after = result.perSkill.find((entry) => entry.nodeId === 'after')?.avg ?? 0

    expect(result.perSkill).toHaveLength(3)
    expect(parent).toBeGreaterThan(0)
    expect(child).toBeCloseTo(parent)
    expect(after).toBeLessThan(parent)
  })

  it('uses parent attached combat writes for an attached negative-effect feature', () => {
    const negativeSeed = getResSeedBy('1109')
    expect(negativeSeed).toBeTruthy()
    if (!negativeSeed) {
      return
    }
    const negativeSkill = listResSkll(negativeSeed.id)
      .find((skill) => skill.archetype === 'glacioChafe')
    const negativeFeature = listResFeats(negativeSeed.id)
      .find((feature) => feature.skillId === negativeSkill?.id)
    expect(negativeFeature).toBeTruthy()
    if (!negativeFeature) {
      return
    }

    const makeRuntime = (stacks: number, attached: boolean) => {
      const runtime = makeResRuntime(negativeSeed)
      runtime.base.level = 90
      runtime.rotation.sequence = attached
        ? [{
          id: 'parent',
          type: 'feature',
          featureId: negativeFeature.id,
          attached: {
            conditions: [{
              id: 'set-chafe',
              type: 'condition',
              changes: [{
                type: 'set',
                path: 'runtime.state.combat.glacioChafe',
                value: stacks,
              }],
            }],
            features: [{
              id: 'attached-chafe',
              type: 'feature',
              featureId: negativeFeature.id,
              negativeEffectStacks: 1,
            }],
          },
        }]
        : [{
          id: 'baseline-chafe',
          type: 'feature',
          featureId: negativeFeature.id,
          negativeEffectStacks: stacks,
        }]
      return runtime
    }

    const attached = runResSmlt(makeRuntime(10, true), negativeSeed, makeEnemy())
      .perSkill.find((entry) => entry.nodeId === 'attached-chafe')?.avg ?? 0
    const oneStack = runResSmlt(makeRuntime(1, false), negativeSeed, makeEnemy())
      .perSkill.find((entry) => entry.nodeId === 'baseline-chafe')?.avg ?? 0
    const tenStacks = runResSmlt(makeRuntime(10, false), negativeSeed, makeEnemy())
      .perSkill.find((entry) => entry.nodeId === 'baseline-chafe')?.avg ?? 0

    expect(attached).toBeGreaterThan(oneStack)
    expect(attached).toBeCloseTo(tenStacks)
  })

  it('keeps an attached child stack override when the parent write targets another resonator', () => {
    const parentSeed = getResSeedBy('1109')
    const childSeed = getResSeedBy('1105')
    expect(parentSeed).toBeTruthy()
    expect(childSeed).toBeTruthy()
    if (!parentSeed || !childSeed) {
      return
    }

    const parentFeature = listResFeats(parentSeed.id)[0]
    const childSkill = listResSkll(childSeed.id)
      .find((skill) => skill.archetype === 'glacioChafe')
    const childFeature = listResFeats(childSeed.id)
      .find((feature) => feature.skillId === childSkill?.id)
    expect(parentFeature).toBeTruthy()
    expect(childFeature).toBeTruthy()
    if (!parentFeature || !childFeature) {
      return
    }

    const makeTeam = () => {
      const parent = makeResRuntime(parentSeed)
      const child = makeResRuntime(childSeed)
      const team = [parentSeed.id, childSeed.id, null] as const
      parent.build.team = [...team]
      child.build.team = [...team]
      return { parent, child }
    }

    const attachedTeam = makeTeam()
    attachedTeam.parent.rotation.sequence = [{
      id: 'parent',
      type: 'feature',
      featureId: parentFeature.id,
      attached: {
        conditions: [{
          id: 'set-parent-chafe',
          type: 'condition',
          changes: [{
            type: 'set',
            path: 'runtime.state.combat.glacioChafe',
            value: 10,
          }],
        }],
        features: [{
          id: 'child-chafe',
          type: 'feature',
          resonatorId: childSeed.id,
          featureId: childFeature.id,
          negativeEffectStacks: 1,
        }],
      },
    }]
    const attached = runResSmlt(
      attachedTeam.parent,
      parentSeed,
      makeEnemy(),
      { [childSeed.id]: attachedTeam.child },
    ).perSkill.find((entry) => entry.nodeId === 'child-chafe')?.avg ?? 0

    const directTeam = makeTeam()
    directTeam.parent.rotation.sequence = [{
      id: 'direct-child-chafe',
      type: 'feature',
      resonatorId: childSeed.id,
      featureId: childFeature.id,
      negativeEffectStacks: 1,
    }]
    const direct = runResSmlt(
      directTeam.parent,
      parentSeed,
      makeEnemy(),
      { [childSeed.id]: directTeam.child },
    ).perSkill.find((entry) => entry.nodeId === 'direct-child-chafe')?.avg ?? 0

    expect(attached).toBeGreaterThan(0)
    expect(attached).toBeCloseTo(direct)
  })

  it('scales attached feature multipliers by the parent multiplier', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
      {
        id: 'parent-x2',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 2,
        enabled: true,
        attached: {
          conditions: [],
          features: [{
            id: 'child-x3',
            type: 'feature',
            featureId: 'damage:test-skill',
            multiplier: 3,
            enabled: true,
          }],
        },
      },
      {
        id: 'baseline-x6',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 6,
        enabled: true,
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())
    const child = result.perSkill.find((entry) => entry.nodeId === 'child-x3')
    const baseline = result.perSkill.find((entry) => entry.nodeId === 'baseline-x6')

    expect(child?.multiplier).toBe(6)
    expect(baseline?.multiplier).toBe(6)
    expect(child?.avg).toBeCloseTo(baseline?.avg ?? 0)
  })

  it('executes an attached feature normally after its parent leaves a loop', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
      { id: 'loop-start', type: 'loop', kind: 'start', loopId: 'loop-a', runs: 2 },
      { id: 'loop-end', type: 'loop', kind: 'end', loopId: 'loop-a' },
      {
        id: 'parent-outside-loop',
        type: 'feature',
        featureId: 'damage:test-skill',
        attached: {
          conditions: [],
          features: [{
            id: 'child-outside-loop',
            type: 'feature',
            featureId: 'damage:test-skill',
          }],
        },
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.perSkill.map((entry) => entry.nodeId)).toEqual([
      'parent-outside-loop',
      'child-outside-loop',
    ])
  })

  it('scales uptime setup condition effects for body feature rows', () => {
    // uptime setup is an averaged precondition: numeric `set` changes scale the
    // delta from the current value before body features run, rather than
    // multiplying the body damage result itself.
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
      {
        id: 'set-base-flat-dmg',
        type: 'condition',
        changes: [{
          type: 'set',
          path: 'runtime.rotation.formula.flatDmg',
          value: 20,
        }],
      },
      {
        id: 'feature-before-uptime',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'uptime-window',
        type: 'uptime',
        ratio: 0.5,
        setup: [
          {
            id: 'set-uptime-flat-dmg',
            type: 'condition',
            changes: [{
              type: 'set',
              path: 'runtime.rotation.formula.flatDmg',
              value: 100,
            }],
          },
        ],
        items: [
          {
            id: 'feature-during-uptime',
            type: 'feature',
            featureId: 'damage:test-skill',
            multiplier: 1,
            enabled: true,
          },
        ],
      },
      {
        id: 'feature-after-uptime',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
    ]
    const fullRuntime = makeResRuntime(seed)
    fullRuntime.rotation.sequence = [
      {
        id: 'set-full-flat-dmg',
        type: 'condition',
        changes: [{
          type: 'set',
          path: 'runtime.rotation.formula.flatDmg',
          value: 100,
        }],
      },
      {
        id: 'feature-full',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())
    const fullResult = runResSmlt(fullRuntime, seed, makeEnemy())
    const before = result.perSkill.find((entry) => entry.nodeId === 'feature-before-uptime')?.avg ?? 0
    const during = result.perSkill.find((entry) => entry.nodeId === 'feature-during-uptime')?.avg ?? 0
    const after = result.perSkill.find((entry) => entry.nodeId === 'feature-after-uptime')?.avg ?? 0
    const full = fullResult.perSkill.find((entry) => entry.nodeId === 'feature-full')?.avg ?? 0

    expect(after).toBeCloseTo(before)
    expect(during).toBeCloseTo(before + (full - before) * 0.5)
  })

  it('runs uptime body nodes at zero uptime without setup condition effects', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
      {
        id: 'feature-before-uptime',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
        enabled: true,
      },
      {
        id: 'uptime-window',
        type: 'uptime',
        ratio: 0,
        setup: [
          {
            id: 'set-uptime-flat-dmg',
            type: 'condition',
            changes: [{
              type: 'set',
              path: 'runtime.rotation.formula.flatDmg',
              value: 100,
            }],
          },
        ],
        items: [
          {
            id: 'feature-during-uptime',
            type: 'feature',
            featureId: 'damage:test-skill',
            multiplier: 1,
            enabled: true,
          },
        ],
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())
    const before = result.perSkill.find((entry) => entry.nodeId === 'feature-before-uptime')?.avg ?? 0
    const during = result.perSkill.find((entry) => entry.nodeId === 'feature-during-uptime')?.avg ?? 0

    expect(result.perSkill).toHaveLength(2)
    expect(during).toBeCloseTo(before)
  })

  it('scales data effects gated by uptime setup marker conditions', () => {
    const mornye = getResSeedBy('1209')
    expect(mornye).toBeTruthy()
    if (!mornye) {
      return
    }

    const makeMornyeRuntime = (ratio: number | null) => {
      const runtime = makeResRuntime(mornye)
      runtime.state.manualBuffs.quick.energyRegen = 160
      runtime.rotation.sequence = ratio == null
        ? [
          {
            id: 'marker-body',
            type: 'feature',
            featureId: 'damage:1209001',
            multiplier: 1,
            enabled: true,
          },
        ]
        : [
          {
            id: 'marker-uptime',
            type: 'uptime',
            ratio,
            setup: [
              {
                id: 'interfered-marker',
                type: 'condition',
                changes: [{
                  type: 'toggle',
                  path: 'runtime.state.controls.resonator:1209:interfered_marker:active',
                  value: true,
                  resonatorId: '1209',
                }],
              },
            ],
            items: [
              {
                id: 'marker-body',
                type: 'feature',
                featureId: 'damage:1209001',
                multiplier: 1,
                enabled: true,
              },
            ],
          },
        ]

      return runtime
    }

    const base = runResSmlt(makeMornyeRuntime(null), mornye, makeEnemy()).perSkill[0]?.avg ?? 0
    const full = runResSmlt(makeMornyeRuntime(1), mornye, makeEnemy()).perSkill[0]?.avg ?? 0
    const partial = runResSmlt(makeMornyeRuntime(0.99), mornye, makeEnemy()).perSkill[0]?.avg ?? 0

    expect(full).toBeGreaterThan(base)
    expect(partial).toBeGreaterThan(base)
    expect(partial).toBeCloseTo(base + (full - base) * 0.99)
  })

  it('scales table-based stack effects from uptime setup conditions', () => {
    const iuno = getResSeedBy('1410')
    expect(iuno).toBeTruthy()
    if (!iuno) {
      return
    }

    const makeIunoRuntime = (ratio: number | null) => {
      const runtime = makeResRuntime(iuno)
      runtime.rotation.sequence = ratio == null
        ? [
          {
            id: 'wan-light-body',
            type: 'feature',
            featureId: 'damage:1410001',
            multiplier: 1,
            enabled: true,
          },
        ]
        : [
          {
            id: 'wan-light-uptime',
            type: 'uptime',
            ratio,
            setup: [
              {
                id: 'wan-light-stacks',
                type: 'condition',
                changes: [{
                  type: 'set',
                  path: 'runtime.state.controls.resonator:1410:wan_light:stacks',
                  value: 10,
                  resonatorId: '1410',
                }],
              },
            ],
            items: [
              {
                id: 'wan-light-body',
                type: 'feature',
                featureId: 'damage:1410001',
                multiplier: 1,
                enabled: true,
              },
            ],
          },
        ]

      return runtime
    }

    const base = runResSmlt(makeIunoRuntime(null), iuno, makeEnemy()).perSkill[0]?.avg ?? 0
    const full = runResSmlt(makeIunoRuntime(1), iuno, makeEnemy()).perSkill[0]?.avg ?? 0
    const partial = runResSmlt(makeIunoRuntime(0.59), iuno, makeEnemy()).perSkill[0]?.avg ?? 0

    expect(full).toBeGreaterThan(base)
    expect(partial).toBeGreaterThan(base)
    expect(partial).toBeCloseTo(base + (full - base) * 0.59)
  })

  it('runs loop segments and tags loop totals by loop id', () => {
    // loop metadata is used by inspectors and summaries; only rows emitted
    // inside the loop should carry run tags and run-count totals
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
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
    runtime.rotation.sequence = [
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

    const entries = inspectResRotation(runtime, seed, makeEnemy())

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

  it('executes a fork body from its pass through the remaining runs', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 3,
        passForks: {
          '2': [{
            id: 'only-second-run',
            type: 'feature',
            featureId: 'damage:test-skill',
            multiplier: 1,
          }],
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

    expect(result.perSkill).toHaveLength(2)
    expect(result.perSkill.every((entry) => entry.nodeId === 'only-second-run')).toBe(true)
    expect(result.perSkill.map((entry) => entry.loopRuns?.['loop-a'])).toEqual([2, 3])
  })

  it('treats nodes after a loop as ordinary authored nodes', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 3,
      },
      {
        id: 'loop-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
      {
        id: 'outside-loop',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
      },
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.perSkill).toHaveLength(1)
    expect(result.perSkill[0]?.nodeId).toBe('outside-loop')
    expect(result.perSkill[0]?.multiplier).toBe(1)
    expect(result.perSkill[0]?.loopRuns).toBeUndefined()
  })

  it('falls through a disabled loop marker and runs its body once', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 3,
        enabled: false,
      },
      {
        id: 'body',
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
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())

    expect(result.perSkill).toHaveLength(1)
    expect(result.perSkill[0]?.nodeId).toBe('body')
    expect(result.perSkill[0]?.loopRuns).toBeUndefined()
  })

  it('executes changed node values from an exact pass fork', () => {
    const runtime = makeResRuntime(seed)
    const repeatFeature: RotationNode = {
      id: 'repeat-feature', type: 'feature', featureId: 'damage:test-skill', multiplier: 1,
    }
    const uptimeFeature: RotationNode = {
      id: 'uptime-feature', type: 'feature', featureId: 'damage:test-skill', multiplier: 1,
    }
    const runTwo: RotationNode[] = [
      {
        id: 'loop-condition', type: 'condition',
        changes: [{
          type: 'set', path: 'runtime.state.manualBuffs.quick.critRate', value: 50,
        }],
      },
      {
        id: 'loop-feature', type: 'feature', featureId: 'damage:test-skill', multiplier: 3,
      },
      { id: 'loop-repeat', type: 'repeat', times: 2, items: [repeatFeature] },
      { id: 'loop-uptime', type: 'uptime', ratio: 0.75, items: [uptimeFeature] },
    ]
    runtime.rotation.sequence = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 2,
        passForks: { '2': runTwo },
      },
      {
        id: 'loop-condition',
        type: 'condition',
        changes: [
          {
            type: 'set',
            path: 'runtime.state.manualBuffs.quick.critRate',
            value: 0,
          },
        ],
      },
      {
        id: 'loop-feature',
        type: 'feature',
        featureId: 'damage:test-skill',
        multiplier: 1,
      },
      {
        id: 'loop-repeat',
        type: 'repeat',
        times: 1,
        items: [repeatFeature],
      },
      {
        id: 'loop-uptime',
        type: 'uptime',
        ratio: 0.25,
        items: [uptimeFeature],
      },
      {
        id: 'loop-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]

    const simulation = runResSmlt(runtime, seed, makeEnemy())
    const entries = inspectResRotation(runtime, seed, makeEnemy())

    expect(simulation.perSkill.filter((entry) => entry.nodeId === 'loop-feature').map((entry) => entry.multiplier)).toEqual([1, 3])
    expect(entries.filter((entry) => entry.nodeId === 'loop-condition').map((entry) => entry.value)).toMatchObject([
      { kind: 'condition', value: 0 },
      { kind: 'condition', value: 50 },
    ])
    expect(entries.filter((entry) => entry.nodeId === 'loop-repeat').map((entry) => entry.value)).toMatchObject([
      { kind: 'repeat', times: 1 },
      { kind: 'repeat', times: 2 },
    ])
    expect(entries.filter((entry) => entry.nodeId === 'loop-uptime').map((entry) => entry.value)).toMatchObject([
      { kind: 'uptime', ratio: 0.25 },
      { kind: 'uptime', ratio: 0.75 },
    ])
    expect(simulation.perSkill.filter((entry) => entry.nodeId === 'repeat-feature')).toHaveLength(3)
  })

  it('wraps a no-end loop back to its own start and ignores foreign ends', () => {
    // incomplete loop markup is tolerated by wrapping locally; unrelated end
    // markers should not terminate the active loop stack
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
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

  it('executes no-end loop fork bodies inside nested blocks', () => {
    const runtime = makeResRuntime(seed)
    const repeatNode: RotationNode = {
      id: 'repeat',
      type: 'repeat',
      times: 1,
      items: [{ id: 'repeat-feature', type: 'feature', featureId: 'damage:test-skill' }],
    }
    runtime.rotation.sequence = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 2,
        passForks: {
          '2': [{ ...repeatNode, times: 2 }],
        },
      },
      {
        id: 'run-1-only',
        type: 'feature',
        featureId: 'damage:test-skill',
      },
      repeatNode,
    ]

    const result = runResSmlt(runtime, seed, makeEnemy())
    const gated = result.perSkill.filter((entry) => entry.nodeId === 'run-1-only')
    const repeatedRows = result.perSkill.filter((entry) => entry.nodeId === 'repeat-feature')

    expect(gated).toHaveLength(1)
    expect(gated[0]?.loopRuns).toEqual({ 'loop-a': 1 })
    expect(repeatedRows.map((entry) => entry.loopRuns?.['loop-a']))
      .toEqual([1, 2, 2])
  })

  it('wraps to a linked end that appears before the loop start', () => {
    // users can place loop markers around existing nodes, so a start may link
    // to an earlier end and intentionally replay the wrapped segment
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
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
    runtime.rotation.sequence = [
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

    // every loop runs once, so each body is entered exactly once and the
    // enclosing loop resumes after the nested end marker rather than back
    // inside the nested body
    expect(result.perSkill.map((entry) => entry.nodeId)).toEqual([
      'a-before-b',
      'b-before-c',
      'c-body',
      'b-after-c',
      'a-after-b',
    ])
    expect(result.perSkill[0]?.loopRuns).toEqual({ 'loop-a': 1 })
    expect(result.perSkill[1]?.loopRuns).toEqual({ 'loop-a': 1, 'loop-b': 1 })
    expect(result.perSkill[2]?.loopRuns).toEqual({ 'loop-a': 1, 'loop-b': 1, 'loop-c': 1 })
    expect(result.perSkill[3]?.loopRuns).toEqual({ 'loop-a': 1, 'loop-b': 1 })
    expect(result.perSkill[4]?.loopRuns).toEqual({ 'loop-a': 1 })
  })

  it('lets a nested loop own rows past the parent end marker without replaying them', () => {
    /*
      A loop is a call, so the child owns everything up to its own end marker
      even when that reaches past the parent's. The parent resumes after the
      child's end, which here is the end of the list, so each row runs once.
    */
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
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
    ])
    expect(result.perSkill[0]?.loopRuns).toEqual({ 'loop-a': 1 })
    expect(result.perSkill[1]?.loopRuns).toEqual({ 'loop-a': 1, 'loop-b': 1 })
    // still inside loop-b even though it sits past loop-a's end marker
    expect(result.perSkill[2]?.loopRuns).toEqual({ 'loop-a': 1, 'loop-b': 1 })
  })

  it('does not re-enter an already active loop start cycle', () => {
    // loops without end markers can share the same trailing body; the walker
    // must not recursively restart a loop that is already on the active stack
    const runtime = makeResRuntime(seed)
    runtime.rotation.sequence = [
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
    runtime.rotation.sequence = [
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
    runtime.rotation.sequence = [
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
    // Mornye's Decoupling is a shipped post-stat effect whose value reads the
    // enemy Tune Strain register. This observes the write through production
    // effect math instead of a synthetic catalog feature gate.
    const conditionalSeed = getResSeedBy('1209')
    const feature = listResFeats('1209').find((entry) => entry.variant !== 'subHit')
    expect(conditionalSeed).toBeTruthy()
    expect(feature).toBeTruthy()
    if (!conditionalSeed || !feature) return

    const runtime = makeResRuntime(conditionalSeed)
    runtime.state.controls['resonator:1209:decoupling:active'] = true
    runtime.rotation.sequence = [
      {
        id: 'feature-before-status',
        type: 'feature',
        featureId: feature.id,
      },
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
        id: 'feature-after-status',
        type: 'feature',
        featureId: feature.id,
      },
    ]

    const inspection = inspectResRotation(runtime, conditionalSeed, makeEnemy())
    const writeInspection = inspection.find((entry) => entry.nodeId === 'set-tune-strain')
    expect(writeInspection?.value).toMatchObject({ kind: 'condition' })

    const result = runResSmlt(runtime, conditionalSeed, makeEnemy())
    const before = result.perSkill.find((entry) => entry.nodeId === 'feature-before-status')
    const after = result.perSkill.find((entry) => entry.nodeId === 'feature-after-status')

    expect(result.perSkill).toHaveLength(2)
    expect(after?.effectiveStats?.finalDmg ?? 0)
      .toBeGreaterThan(before?.effectiveStats?.finalDmg ?? 0)
    expect(after?.avg ?? 0).toBeGreaterThan(before?.avg ?? 0)
  })

  it('persists uptime body condition changes for following loop entries', () => {
    const conditionalSeed = getResSeedBy('1209')
    const feature = listResFeats('1209').find((entry) => entry.variant !== 'subHit')
    expect(conditionalSeed).toBeTruthy()
    expect(feature).toBeTruthy()
    if (!conditionalSeed || !feature) return

    const runtime = makeResRuntime(conditionalSeed)
    runtime.state.controls['resonator:1209:decoupling:active'] = true
    const uptime: RotationNode = {
      id: 'uptime-window',
      type: 'uptime',
      ratio: 1,
      items: [{
        id: 'set-tune-strain-in-body',
        type: 'condition',
        changes: [{ type: 'set', path: 'enemy.status.tuneStrain', value: 1 }],
      }],
    }
    runtime.rotation.sequence = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 2,
        passForks: {
          '2': [uptime, {
            id: 'feature-after-uptime',
            type: 'feature',
            featureId: feature.id,
          }],
        },
      },
      uptime,
      {
        id: 'loop-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]

    const result = runResSmlt(runtime, conditionalSeed, makeEnemy())

    expect(result.perSkill).toHaveLength(1)
    expect(result.perSkill[0]?.nodeId).toBe('feature-after-uptime')
    expect(result.perSkill[0]?.effectiveStats?.finalDmg ?? 0).toBeGreaterThan(0)
    expect(result.perSkill[0]?.avg).toBeGreaterThan(0)
  })
})
