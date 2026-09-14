/*
  Author: Runor Ewhro
  Description: Verifies program run logic and compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { ResSeed } from '@/domain/entities/runtime.ts'
import type { FeatureResult, FeatDef, RotationNode } from '@/domain/gameData/contracts.ts'
import type { SkillDef } from '@/domain/entities/stats.ts'
import { makeEnemy, makeResRuntime } from '@/domain/state/defaults.ts'
import {
  buildRun,
  buildRotationSummary,
  displayedRunMs,
} from '@/modules/simulation/features/rotation/program-editor/simulation/runProgram.ts'
import { editorSectionsToRotation } from '@/modules/simulation/features/rotation/program-editor/model/toRotationNodes.ts'
import { findNode, setBlockExtent } from '@/modules/simulation/features/rotation/program-editor/model/treeEdit.ts'
import {
  applyRotationCleanup,
  planRotationCleanup,
} from '@/modules/simulation/features/rotation/program-editor/model/cleanup.ts'
import type { RotationMember } from '@/modules/simulation/features/rotation/shared/authoringTypes.ts'
import type { InspectEntry } from '@/engine/rotation/execute.ts'
import { mkPrepWork } from '@/engine/pipeline/preparedWorkspace.ts'
import { ROT_LOOP_COLORS } from '@/modules/simulation/features/rotation/shared/loopMeta.ts'
import { ACTIVE_RESONATOR_PATH } from '@/domain/gameData/rotationPaths.ts'

const seed: ResSeed = {
  id: 'rotation-editor-test',
  name: 'Rotation Editor Test',
  profile: '/assets/game/resonators/profiles/default.webp',
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
  skills: [{
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
    hits: [{ count: 1, multiplier: 1 }],
  }],
  states: [],
  features: [{
    id: 'damage:test-skill',
    label: 'Test Skill',
    source: { type: 'resonator', id: 'rotation-editor-test' },
    skillId: 'test-skill',
  }],
}

const items: RotationNode[] = [
  {
    id: 'loop-start',
    type: 'loop',
    kind: 'start',
    loopId: 'loop-a',
    runs: 2,
  },
  {
    id: 'add-atk',
    type: 'condition',
    changes: [{
      type: 'add',
      path: 'runtime.state.manualBuffs.quick.atk.percent',
      value: 10,
    }],
  },
  {
    id: 'damage',
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

describe('rotation editor engine round trips', () => {
  it('keeps a stale handoff authored while advancing from the engine\'s actual active state', () => {
    const runtime = makeResRuntime(seed)
    const staleHandoff: RotationNode = {
      id: 'stale-handoff',
      type: 'condition',
      changes: [{ type: 'set', path: ACTIVE_RESONATOR_PATH, value: 'missing-member' }],
    }
    runtime.rotation.program = [staleHandoff]
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]

    const result = buildRun({
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })
    const projected = findNode(result.sections, staleHandoff.id)

    expect(projected).toMatchObject({
      type: 'swap',
      from: seed.id,
      to: 'missing-member',
      gate: { kind: 'inert' },
      byRun: { 1: { from: seed.id, to: seed.id } },
    })
  })

  it.each([
    ['healing', 'var(--calc-support-healing-color)'],
    ['shield', 'var(--calc-support-shield-color)'],
  ] as const)('projects %s as the step\'s first-class support color', (aggregationType, color) => {
    const supportSeed: ResSeed = {
      ...seed,
      skills: (seed.skills ?? []).map((skill) => ({ ...skill, aggregationType })),
    }
    const runtime = makeResRuntime(supportSeed)
    runtime.rotation.program = [{
      id: 'support-step',
      type: 'feature',
      featureId: 'damage:test-skill',
      multiplier: 1,
    }]
    const members: RotationMember[] = [{
      id: supportSeed.id,
      name: supportSeed.name,
      profile: supportSeed.profile ?? '',
      attribute: supportSeed.attribute,
      runtime,
      skills: supportSeed.skills ?? [],
      features: supportSeed.features ?? [],
      states: supportSeed.states ?? [],
    }]

    const result = buildRun({
      runtime,
      seed: supportSeed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })
    const projected = findNode(result.sections, 'support-step')

    expect(projected?.type).toBe('step')
    if (projected?.type === 'step') {
      expect(projected.color).toBe(color)
      expect(projected.aggregationType).toBe(aggregationType)
    }
    expect(result.summary.total.avg).toBe(0)
    expect(result.summary.supportTotals[aggregationType]).toBeGreaterThan(0)
  })

  it('dates an exact result when its simulation finishes', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = items
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    const before = Date.now()

    const result = buildRun({
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })

    expect(result.ranAt).toBeGreaterThanOrEqual(before)
    expect(result.ranAt).toBeLessThanOrEqual(Date.now())
    expect(result.timing.prepareMs).toBeGreaterThanOrEqual(0)
    expect(result.timing.executeMs).toBeGreaterThanOrEqual(0)
    expect(result.timing.projectMs).toBeGreaterThanOrEqual(0)
    expect(result.timing.totalMs).toBeCloseTo(
      result.timing.prepareMs + result.timing.executeMs + result.timing.projectMs,
      8,
    )
    expect(result.timing.cacheHit).toBe(false)
    expect(displayedRunMs(result)).toBe(Math.round(result.timing.totalMs))
  })

  it('propagates prepared execution cache hits without charging kernel time', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = items
    const enemy = makeEnemy()
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    const prepWork = mkPrepWork({ runtime, seed, enemy })
    const input = {
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy,
      members,
      prepWork,
    }

    expect(buildRun(input).timing.cacheHit).toBe(false)
    const cached = buildRun(input)
    expect(cached.timing.cacheHit).toBe(true)
    expect(cached.timing.executeMs).toBe(0)
    expect(cached.timing.totalMs).toBeCloseTo(
      cached.timing.prepareMs + cached.timing.projectMs,
      8,
    )
  })

  it('retains standalone and owned notes without adding simulation entries', () => {
    const rotation: RotationNode[] = [
      { id: 'standalone-note', type: 'note', label: 'Plan', text: 'Display only' },
      {
        id: 'damage-with-note',
        type: 'feature',
        featureId: 'damage:test-skill',
        note: { id: 'owned-note', type: 'note', text: 'Use after setup' },
      },
    ]
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = rotation
    const runtimesById = { [runtime.id]: runtime }
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]

    const result = buildRun({
      runtime,
      seed,
      runtimesById,
      enemy: makeEnemy(),
      members,
    })

    expect(result.sections.flatMap((section) => section.children).map((node) => node.type))
      .toEqual(['note', 'step'])
    expect(findNode(result.sections, 'owned-note')).toMatchObject({
      type: 'note',
      text: 'Use after setup',
    })
    expect(result.summary.counts.entries).toBe(1)
    expect(editorSectionsToRotation(result.sections, rotation)[1]?.items).toEqual(rotation)
  })

  it('projects authored repeat and uptime display metadata', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = [
      {
        id: 'repeat-meta',
        type: 'repeat',
        label: 'Burst window',
        color: '#20bfb9',
        times: 2,
        items: [],
      },
      {
        id: 'uptime-meta',
        type: 'uptime',
        label: 'Buff window',
        color: '#f472b6',
        ratio: 0.5,
        items: [],
      },
    ]
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]

    const result = buildRun({
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })

    expect(findNode(result.sections, 'repeat-meta')).toMatchObject({
      label: 'Burst window',
      color: '#20bfb9',
    })
    expect(findNode(result.sections, 'uptime-meta')).toMatchObject({
      label: 'Buff window',
      color: '#f472b6',
    })
  })

  it('projects the exact condition and feature stream without replaying containers', () => {
    const path = 'runtime.state.manualBuffs.quick.atk.percent'
    const rotation: RotationNode[] = [
      {
        id: 'repeat',
        type: 'repeat',
        label: 'Two casts',
        times: 2,
        items: [
          {
            id: 'repeat-state',
            type: 'condition',
            label: 'Repeat state',
            changes: [{ type: 'add', path, value: 1 }],
          },
          { id: 'repeat-hit', type: 'feature', featureId: 'damage:test-skill' },
        ],
      },
      {
        id: 'attached-hit',
        type: 'feature',
        featureId: 'damage:test-skill',
        attached: {
          conditions: [{
            id: 'attached-state',
            type: 'condition',
            label: 'Attached state',
            changes: [{ type: 'add', path, value: 1 }],
          }],
          features: [],
        },
      },
      {
        id: 'fork-loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'fork-loop',
        label: 'Fork loop',
        runs: 2,
        passForks: { '2': [] },
      },
      { id: 'fork-hit', type: 'feature', featureId: 'damage:test-skill' },
      { id: 'fork-loop-end', type: 'loop', kind: 'end', loopId: 'fork-loop' },
    ]
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = rotation
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]

    const result = buildRun({
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })

    expect(result.flatRows.map((row) => row.kind === 'hit' ? row.step.id : row.writes[0]?.label))
      .toEqual([
        'Repeat state',
        'repeat-hit',
        'Repeat state',
        'repeat-hit',
        'Attached state',
        'attached-hit',
        'fork-hit',
      ])
    expect(result.flatRows.filter((row) => row.kind === 'hit' && row.step.id === 'repeat-hit'))
      .toHaveLength(2)
    expect(result.flatRows
      .filter((row) => row.kind === 'hit' && row.step.id === 'repeat-hit')
      .map((row) => row.copyNode?.type))
      .toEqual(['step', 'step'])
    const attachedState = result.flatRows.find((row) => (
      row.kind === 'state' && row.writes[0]?.label === 'Attached state'
    ))
    expect(attachedState?.copyNode).toMatchObject({
      type: 'condition',
      sourceNode: { type: 'condition' },
    })
    expect(result.flatRows.filter((row) => row.scope.some((scope) =>
      scope.kind === 'loop' && scope.run === 2))).toHaveLength(0)
    expect(result.flatRows.at(-1)?.scope).toMatchObject([{
      kind: 'loop',
      id: 'fork-loop',
      run: 1,
      runs: 2,
    }])

    const projectedRepeatHit = findNode(result.sections, 'repeat-hit')
    if (projectedRepeatHit?.type === 'step') projectedRepeatHit.label = 'Unrun edit'
    expect(result.flatRows.find((row) => row.kind === 'hit')?.kind === 'hit'
      ? result.flatRows.find((row) => row.kind === 'hit')?.step.label
      : null).not.toBe('Unrun edit')
  })

  it('uses engine loop context for wrapped rows instead of their visual nesting', () => {
    const rotation: RotationNode[] = [
      { id: 'before', type: 'feature', featureId: 'damage:test-skill' },
      { id: 'wrap-end', type: 'loop', kind: 'end', loopId: 'wrapped' },
      { id: 'between', type: 'feature', featureId: 'damage:test-skill' },
      {
        id: 'wrap-start',
        type: 'loop',
        kind: 'start',
        loopId: 'wrapped',
        label: 'Wrapped',
        runs: 2,
      },
      { id: 'after', type: 'feature', featureId: 'damage:test-skill' },
    ]
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = rotation
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    const result = buildRun({
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })
    const hits = result.flatRows.filter((row) => row.kind === 'hit')

    expect(hits.map((row) => row.step.id)).toEqual([
      'before',
      'between',
      'after',
      'before',
      'after',
      'before',
    ])
    expect(hits.map((row) => row.scope.find((scope) => scope.kind === 'loop')?.run ?? 0))
      .toEqual([0, 0, 1, 1, 2, 2])
  })

  it('projects the skill register from the evaluated feature result', () => {
    const rawSkill = seed.skills?.[0] as SkillDef
    const registerSeed: ResSeed = {
      ...seed,
      skills: [{
        ...rawSkill,
        multiplier: 999,
        flat: 7,
        scaling: { atk: 0, hp: 0, def: 0, energyRegen: 1 },
        hits: [{ count: 1, multiplier: 2 }],
      }],
    }
    const runtime = makeResRuntime(registerSeed)
    runtime.rotation.program = [{
      id: 'factor-step',
      type: 'feature',
      featureId: 'damage:test-skill',
      multiplier: 1,
    }]
    const members: RotationMember[] = [{
      id: registerSeed.id,
      name: registerSeed.name,
      profile: registerSeed.profile ?? '',
      attribute: registerSeed.attribute,
      runtime,
      skills: registerSeed.skills ?? [],
      features: registerSeed.features ?? [],
      states: registerSeed.states ?? [],
    }]

    const result = buildRun({
      runtime,
      seed: registerSeed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })
    const row = findNode(result.sections, 'factor-step')

    expect(row).toMatchObject({ type: 'step', multiplier: 1 })
    expect(row?.type === 'step' ? row.statsByRun[1] : null).toMatchObject({
      multiplier: 2,
      energyRegen: 112.8,
      flatDmg: 7,
    })
    expect(row?.type === 'step' ? row.statsByRun[1]?.atk : null).toBeGreaterThan(0)
  })

  it('aggregates skill-scoped factors while retaining the evaluated owner snapshot', () => {
    const baseSkill = seed.skills?.[0] as SkillDef
    const buffedSkill: SkillDef = {
      ...baseSkill,
      id: 'buffed-skill',
      label: 'Buffed Skill',
      skillBuffs: {
        critRate: 7,
        critDmg: 11,
        dmgBonus: 13,
        amplify: 17,
        defIgnore: 19,
        defShred: 23,
        dmgVuln: 29,
      },
    }
    const factorSeed: ResSeed = {
      ...seed,
      skills: [baseSkill, buffedSkill],
      features: [
        ...(seed.features ?? []),
        {
          id: 'damage:buffed-skill',
          label: buffedSkill.label,
          source: { type: 'resonator', id: seed.id },
          skillId: buffedSkill.id,
        },
      ],
    }
    const runtime = makeResRuntime(factorSeed)
    runtime.rotation.program = [
      { id: 'plain-step', type: 'feature', featureId: 'damage:test-skill' },
      { id: 'buffed-step', type: 'feature', featureId: 'damage:buffed-skill' },
    ]
    const members: RotationMember[] = [{
      id: factorSeed.id,
      name: factorSeed.name,
      profile: factorSeed.profile ?? '',
      attribute: factorSeed.attribute,
      runtime,
      skills: factorSeed.skills ?? [],
      features: factorSeed.features ?? [],
      states: factorSeed.states ?? [],
    }]
    const result = buildRun({
      runtime,
      seed: factorSeed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })
    const plain = findNode(result.sections, 'plain-step')
    const buffed = findNode(result.sections, 'buffed-step')

    if (plain?.type !== 'step' || buffed?.type !== 'step') {
      throw new Error('Expected both simulated feature steps in the page projection')
    }

    const plainStats = plain.statsByRun[1]
    const buffedStats = buffed.statsByRun[1]
    if (!plainStats || !buffedStats) {
      throw new Error('Expected evaluated register values for both feature steps')
    }

    expect(buffedStats.atk).toBe(plainStats.atk)
    expect(buffedStats.hp).toBe(plainStats.hp)
    expect(buffedStats.def).toBe(plainStats.def)
    expect(buffedStats.critRate).toBeCloseTo((plainStats.critRate ?? 0) + 7)
    expect(buffedStats.critDmg).toBeCloseTo((plainStats.critDmg ?? 0) + 11)
    expect(buffedStats.bonus).toBeCloseTo((plainStats.bonus ?? 0) + 13)
    expect(buffedStats.amplify).toBeCloseTo((plainStats.amplify ?? 0) + 17)
    expect(buffedStats.defIgnore).toBeCloseTo((plainStats.defIgnore ?? 0) + 19)
    expect(buffedStats.defShred).toBeCloseTo((plainStats.defShred ?? 0) + 23)
    expect(buffedStats.dmgVuln).toBeCloseTo((plainStats.dmgVuln ?? 0) + 29)
  })

  it('projects an echo attack with the echo as its visual row owner', () => {
    const echoId = '6000216'
    const skillId = `echo:${echoId}:skill:1`
    const featureId = `echo:${echoId}:feature:${skillId}`
    const echoSkill: SkillDef = {
      ...(seed.skills?.[0] as SkillDef),
      id: skillId,
      label: 'Forbidden Bastion',
      tab: 'echoAttacks',
      skillType: ['echoSkill'],
      element: 'glacio',
    }
    const echoFeature: FeatDef = {
      id: featureId,
      label: echoSkill.label,
      source: { type: 'echo', id: echoId },
      skillId,
    }
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = [{
      id: 'echo-step',
      type: 'feature',
      featureId,
      resonatorId: seed.id,
    }]
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: [...(seed.skills ?? []), echoSkill],
      features: [...(seed.features ?? []), echoFeature],
      states: seed.states ?? [],
    }]

    const result = buildRun({
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })
    const row = findNode(result.sections, 'echo-step')

    expect(row).toMatchObject({
      type: 'step',
      memberId: seed.id,
      owner: { kind: 'echo', echoId },
    })
  })

  it('keeps an attached feature multiplier editable while displaying the engine total', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = [{
      id: 'parent',
      type: 'feature',
      featureId: 'damage:test-skill',
      multiplier: 2,
      attached: {
        conditions: [],
        features: [{
          id: 'child',
          type: 'feature',
          featureId: 'damage:test-skill',
          multiplier: 3,
        }],
      },
    }]
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]

    const result = buildRun({
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })
    const parent = findNode(result.sections, 'parent')
    const child = parent?.type === 'step' ? parent.attached?.[0] : null

    expect(child?.multiplierByRun?.[1]).toBe(3)
    expect(child?.effectiveMultiplierByRun?.[1]).toBe(6)
  })

  it.each([
    {
      name: 'a no-end loop',
      rotation: [
        {
          id: 'before',
          type: 'feature' as const,
          featureId: 'damage:test-skill',
        },
        {
          id: 'loop-start',
          type: 'loop' as const,
          kind: 'start' as const,
          loopId: 'loop-a',
          runs: 2,
        },
        {
          id: 'after',
          type: 'feature' as const,
          featureId: 'damage:test-skill',
        },
      ],
    },
    {
      name: 'a wrap-end loop',
      rotation: [
        {
          id: 'before',
          type: 'feature' as const,
          featureId: 'damage:test-skill',
        },
        {
          id: 'loop-end',
          type: 'loop' as const,
          kind: 'end' as const,
          loopId: 'loop-a',
        },
        {
          id: 'between',
          type: 'feature' as const,
          featureId: 'damage:test-skill',
        },
        {
          id: 'loop-start',
          type: 'loop' as const,
          kind: 'start' as const,
          loopId: 'loop-a',
          runs: 2,
        },
        {
          id: 'after',
          type: 'feature' as const,
          featureId: 'damage:test-skill',
        },
      ],
    },
  ])('preserves $name when the page materializes its visual end marker', ({ rotation }) => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = rotation
    const runtimesById = { [runtime.id]: runtime }
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    const enemy = makeEnemy()
    const initial = buildRun({
      runtime,
      seed,
      runtimesById,
      enemy,
      members,
    })
    const sections = editorSectionsToRotation(initial.sections, rotation)
    const rerun = buildRun({
      runtime,
      seed,
      runtimesById,
      itemSections: sections,
      enemy,
      members,
    })

    expect(rerun.totals.avg).toBeCloseTo(initial.totals.avg)
  })

  it('preserves a loop end nested inside a block when the page projects its rails', () => {
    const rotation: RotationNode[] = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 2,
      },
      {
        id: 'repeat',
        type: 'repeat',
        times: 1,
        items: [
          {
            id: 'nested-target',
            type: 'feature',
            featureId: 'damage:test-skill',
          },
          {
            id: 'loop-end',
            type: 'loop',
            kind: 'end',
            loopId: 'loop-a',
          },
          {
            id: 'nested-after',
            type: 'feature',
            featureId: 'damage:test-skill',
          },
        ],
      },
      {
        id: 'root-after',
        type: 'feature',
        featureId: 'damage:test-skill',
      },
    ]
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = rotation
    const runtimesById = { [runtime.id]: runtime }
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    const projected = buildRun({
      runtime,
      seed,
      runtimesById,
      enemy: makeEnemy(),
      members,
    })
    const serialized = editorSectionsToRotation(projected.sections, rotation)
      .flatMap((section) => section.items)
    const repeat = serialized.find((node) => node.id === 'repeat')

    expect(serialized.map((node) => node.id)).toEqual([
      'loop-start',
      'repeat',
      'root-after',
    ])
    expect(repeat?.type === 'repeat'
      ? repeat.items.map((node) => node.id)
      : []).toEqual([
      'nested-target',
      'loop-end',
      'nested-after',
    ])
  })

  /*
    A loop closing inside a block is invisible to the walk, because the block
    keeps its own list. A loop closing inside another loop is not: both markers
    stand in the same list, so the walk has to leave the crossing alone rather
    than take the marker and drop the loop it was standing inside.
  */
  it('preserves a loop end inside a loop that starts after it', () => {
    const rotation: RotationNode[] = [
      { id: 'a-start', type: 'loop', kind: 'start', loopId: 'loop-a', runs: 2 },
      { id: 'a-row', type: 'feature', featureId: 'damage:test-skill' },
      { id: 'b-start', type: 'loop', kind: 'start', loopId: 'loop-b', runs: 3 },
      { id: 'b-row', type: 'feature', featureId: 'damage:test-skill' },
      { id: 'a-end', type: 'loop', kind: 'end', loopId: 'loop-a' },
      { id: 'b-after', type: 'feature', featureId: 'damage:test-skill' },
      { id: 'b-end', type: 'loop', kind: 'end', loopId: 'loop-b' },
      { id: 'root-after', type: 'feature', featureId: 'damage:test-skill' },
    ]
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = rotation
    const runtimesById = { [runtime.id]: runtime }
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    const projected = buildRun({
      runtime,
      seed,
      runtimesById,
      enemy: makeEnemy(),
      members,
    })

    // the loop is drawn in two pieces and the loop it crosses keeps its rows
    const main = projected.sections.find((section) => section.id === 'main')
    const [aStart, bLoop] = main?.children ?? []
    expect(aStart).toMatchObject({ type: 'loop', loopId: 'loop-a', wrap: 'tail' })
    expect(aStart.type === 'loop' ? aStart.children.map((node) => node.id) : [])
      .toEqual(['a-row'])
    expect(bLoop).toMatchObject({ type: 'loop', loopId: 'loop-b' })
    const bChildren = bLoop.type === 'loop' ? bLoop.children : []
    expect(bChildren[0]).toMatchObject({ type: 'loop', loopId: 'loop-a', wrap: 'head' })
    expect(bChildren.map((node) => node.id)[1]).toBe('b-after')

    expect(editorSectionsToRotation(projected.sections, rotation)
      .flatMap((section) => section.items)
      .map((node) => node.id)).toEqual([
      'a-start',
      'a-row',
      'b-start',
      'b-row',
      'a-end',
      'b-after',
      'b-end',
      'root-after',
    ])
  })


  /*
    the end a no-end loop is drawn with sits on its start, so giving it one is
    only moving that end off the start. what it leaves behind has to be an
    ordinary loop, the same as one written in the rotation pane: a pair of
    markers with a name, a colour and a pass count on the start.
  */
  it('gives a no-end loop a whole loop when its end is dragged', () => {
    const rotation: RotationNode[] = [
      { id: 'above', type: 'feature', featureId: 'damage:test-skill' },
      { id: 'loop-start', type: 'loop', kind: 'start', loopId: 'loop-a', runs: 2 },
      { id: 'inside', type: 'feature', featureId: 'damage:test-skill' },
      { id: 'after', type: 'feature', featureId: 'damage:test-skill' },
    ]
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = rotation
    const runtimesById = { [runtime.id]: runtime }
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    const projected = buildRun({
      runtime,
      seed,
      runtimesById,
      enemy: makeEnemy(),
      members,
    })

    // drawn in two pieces, because its end stands on its start
    const main = projected.sections.find((section) => section.id === 'main')
    expect(main?.children.map((node) => (node.type === 'loop' ? node.wrap : node.type)))
      .toEqual(['head', 'tail'])

    const dragged = setBlockExtent(projected.sections, 'loop-start', 'inside')
    const items = editorSectionsToRotation(dragged, rotation).flatMap((section) => section.items)

    expect(items.map((node) => node.id)).toEqual([
      'above',
      'loop-start',
      'inside',
      'loop-start:end',
      'after',
    ])
    const [start, end] = items.filter((node) => node.type === 'loop')
    expect(start).toMatchObject({
      type: 'loop',
      kind: 'start',
      loopId: 'loop-a',
      label: 'Loop',
      color: ROT_LOOP_COLORS[0],
      runs: 2,
    })
    expect(end).toMatchObject({ type: 'loop', kind: 'end', loopId: 'loop-a' })

    // and it stays that loop through the run that follows
    const rerun = buildRun({
      runtime,
      seed,
      runtimesById,
      itemSections: editorSectionsToRotation(dragged, rotation),
      enemy: makeEnemy(),
      members,
    })
    const rerunMain = rerun.sections.find((section) => section.id === 'main')
    const loop = rerunMain?.children.find((node) => node.type === 'loop')

    expect(rerunMain?.children.map((node) => node.id)).toEqual(['above', 'loop-start', 'after'])
    expect(loop).toMatchObject({ type: 'loop', label: 'Loop' })
    // one whole loop, not a piece of one
    expect(loop?.type === 'loop' ? loop.wrap : 'unset').toBeUndefined()
    expect(loop?.type === 'loop' ? loop.children.map((node) => node.id) : []).toEqual(['inside'])
  })

  it('keys nested rows to their nearest loop and averages enclosing runs', () => {
    const damageNode: RotationNode = {
      id: 'damage',
      type: 'feature',
      featureId: 'damage:test-skill',
    }
    const rotation: RotationNode[] = [
      {
        id: 'outer-start',
        type: 'loop',
        kind: 'start',
        loopId: 'outer-loop',
        runs: 2,
      },
      {
        id: 'inner-start',
        type: 'loop',
        kind: 'start',
        loopId: 'inner-loop',
        runs: 3,
        passForks: {
          '2': [damageNode, {
            id: 'gated-damage',
            type: 'feature',
            featureId: 'damage:test-skill',
          }],
        },
      },
      damageNode,
      {
        id: 'inner-end',
        type: 'loop',
        kind: 'end',
        loopId: 'inner-loop',
      },
      {
        id: 'outer-end',
        type: 'loop',
        kind: 'end',
        loopId: 'outer-loop',
      },
    ]
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = rotation
    const runtimesById = { [runtime.id]: runtime }
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    const result = buildRun({
      runtime,
      seed,
      runtimesById,
      enemy: makeEnemy(),
      members,
    })
    const damage = findNode(result.sections, 'damage')
    expect(damage?.type === 'step' ? Object.keys(damage.damageByRun).map(Number) : [])
      .toEqual([1, 2, 3])
    // The authored exact fork adds gated-damage only to inner pass 2.
    expect(findNode(result.sections, 'gated-damage')).toBeNull()
    const serialized = editorSectionsToRotation(result.sections, rotation)
      .flatMap((section) => section.items)
    const innerStart = serialized.find(
      (node) => node.type === 'loop' && node.kind === 'start' && node.loopId === 'inner-loop',
    )
    expect(innerStart?.type === 'loop' && innerStart.kind === 'start'
      ? innerStart.passForks?.['2']?.some((node) => node.id === 'gated-damage')
      : false).toBe(true)
  })

  it('states a loop both as one pass and as every pass it took', () => {
    const rotation: RotationNode[] = [
      {
        id: 'before',
        type: 'feature',
        featureId: 'damage:test-skill',
      },
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 3,
      },
      {
        id: 'inside',
        type: 'feature',
        featureId: 'damage:test-skill',
      },
      {
        id: 'loop-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = rotation
    const runtimesById = { [runtime.id]: runtime }
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]

    const result = buildRun({
      runtime,
      seed,
      runtimesById,
      enemy: makeEnemy(),
      members,
    })

    const before = findNode(result.sections, 'before')
    const inside = findNode(result.sections, 'inside')
    const outside = before?.type === 'step' ? before.damageByRun[1] ?? 0 : 0
    const passes = inside?.type === 'step' ? Object.values(inside.damageByRun) : []

    expect(passes).toHaveLength(3)

    // the row outside the loop is worth the same either way. the one inside is
    // worth the average of its three passes normalized, and all three in full
    const summed = passes.reduce((sum, amount) => sum + amount, 0)
    expect(result.totals.avg).toBeCloseTo(outside + summed / 3)
    expect(result.fullTotals.avg).toBeCloseTo(outside + summed)
    expect(result.fullTotals.avg).toBeGreaterThan(result.totals.avg)

    // each reading's groups add up to the total it was built against
    for (const summary of [result.summary, result.fullSummary]) {
      const resonators = summary.resonators.reduce((sum, group) => sum + group.avg, 0)
      expect(resonators).toBeCloseTo(summary.total.avg)
    }
    expect(result.summary.total.avg).toBeCloseTo(result.totals.avg)
    expect(result.fullSummary.total.avg).toBeCloseTo(result.fullTotals.avg)
  })

  it('reads the same either way when no loop is involved', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = items.filter((node) => node.type !== 'loop')
    const runtimesById = { [runtime.id]: runtime }
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]

    const result = buildRun({
      runtime,
      seed,
      runtimesById,
      enemy: makeEnemy(),
      members,
    })

    expect(result.fullTotals.avg).toBeCloseTo(result.totals.avg)
    expect(result.fullTotals.avg).toBeGreaterThan(0)
  })

  it('keeps additive writes and damage stable across repeated page runs', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = items
    const runtimesById = { [runtime.id]: runtime }
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    const enemy = makeEnemy()

    let result = buildRun({
      runtime,
      seed,
      runtimesById,
      enemy,
      members,
    })
    const expectedTotal = result.totals.avg

    for (let pass = 0; pass < 3; pass += 1) {
      const sections = editorSectionsToRotation(result.sections, items)
      const authoredCondition = sections
        .flatMap((section) => section.items)
        .find((node) => node.id === 'add-atk')

      expect(authoredCondition).toMatchObject({
        type: 'condition',
        changes: [{ type: 'add', value: 10 }],
      })

      result = buildRun({
        runtime,
        seed,
        runtimesById,
        itemSections: sections,
        enemy,
        members,
      })
      expect(result.totals.avg).toBeCloseTo(expectedTotal)
    }
  })

  it('builds each resonator breakdown against that resonator total', () => {
    const secondSeed: ResSeed = {
      ...seed,
      id: 'rotation-editor-test-two',
      name: 'Rotation Editor Test Two',
      attribute: 'fusion',
      skills: [{
        ...(seed.skills?.[0] as SkillDef),
        id: 'second-skill',
        label: 'Second Skill',
        element: 'fusion',
      }],
      features: [{
        id: 'damage:second-skill',
        label: 'Second Skill',
        source: { type: 'resonator', id: 'rotation-editor-test-two' },
        skillId: 'second-skill',
      }],
    }
    const runtime = makeResRuntime(seed)
    const secondRuntime = makeResRuntime(secondSeed)
    const rotation: RotationNode[] = [
      {
        id: 'first-damage',
        type: 'feature',
        featureId: 'damage:test-skill',
        resonatorId: seed.id,
      },
      {
        id: 'second-damage',
        type: 'feature',
        featureId: 'damage:second-skill',
      },
    ]
    const members: RotationMember[] = [
      {
        id: seed.id,
        name: seed.name,
        profile: seed.profile ?? '',
        attribute: seed.attribute,
        runtime,
        skills: seed.skills ?? [],
        features: seed.features ?? [],
        states: seed.states ?? [],
      },
      {
        id: secondSeed.id,
        name: secondSeed.name,
        profile: secondSeed.profile ?? '',
        attribute: secondSeed.attribute,
        runtime: secondRuntime,
        skills: secondSeed.skills ?? [],
        features: secondSeed.features ?? [],
        states: secondSeed.states ?? [],
      },
    ]
    const entries: InspectEntry[] = [
      {
        nodeId: 'first-damage',
        nodeType: 'feature',
        executed: true,
        activeResonatorId: seed.id,
        value: {
          kind: 'feature',
          ggrgType: 'damage',
          normal: 100,
          crit: 200,
          avg: 130,
        },
      },
      {
        nodeId: 'second-damage',
        nodeType: 'feature',
        executed: true,
        // The active resonator is not necessarily the feature owner. This is
        // how saved feature nodes without an explicit resonator are emitted.
        activeResonatorId: seed.id,
        value: {
          kind: 'feature',
          resonatorId: secondSeed.id,
          ggrgType: 'damage',
          normal: 300,
          crit: 600,
          avg: 390,
        },
      },
    ]
    const summary = buildRotationSummary({
      entries,
      items: rotation,
      members,
      runtime,
      totals: {
        normal: 400,
        crit: 800,
        avg: 520,
      },
    })

    expect(summary.resonators.map((group) => group.id).sort()).toEqual([
      secondSeed.id,
      seed.id,
    ].sort())
    expect(summary).not.toHaveProperty('peak')

    for (const resonator of summary.resonators) {
      const breakdown = summary.byResonator[resonator.id]
      expect(breakdown).toBeDefined()

      for (const groups of [
        breakdown.skillTypes,
        breakdown.talentNodes,
        breakdown.attributes,
      ]) {
        expect(groups.reduce((total, group) => total + group.avg, 0))
          .toBeCloseTo(resonator.avg)
        expect(groups.reduce((total, group) => total + group.sharePct, 0))
          .toBeCloseTo(100)
      }
    }

    const damageEntry = (
      nodeId: string,
      member: RotationMember,
      normal: number,
      crit: number,
      avg: number,
    ): FeatureResult => {
      const feature = member.features[0]!
      const skill = member.skills.find((candidate) => candidate.id === feature.skillId)!
      return {
        id: `${nodeId}:${feature.id}`,
        nodeId,
        resonatorId: member.id,
        resonatorName: member.name,
        feature,
        skill,
        archetype: skill.archetype,
        aggregationType: 'damage',
        multiplier: 1,
        weight: 1,
        normal,
        crit,
        avg,
        subHits: [],
      }
    }
    const withGeneratedFollowUp = buildRotationSummary({
      entries,
      damageEntries: [
        damageEntry('first-damage', members[0]!, 100, 200, 130),
        damageEntry('second-damage', members[1]!, 300, 600, 390),
        // Catalog follow-ups execute without being authored rotation nodes.
        damageEntry('generated-follow-up', members[1]!, 50, 100, 65),
      ],
      items: rotation,
      members,
      runtime,
      totals: { normal: 450, crit: 900, avg: 585 },
    })

    expect(withGeneratedFollowUp.resonators.reduce((total, group) => total + group.avg, 0))
      .toBeCloseTo(withGeneratedFollowUp.total.avg)
    expect(withGeneratedFollowUp.resonators.find((group) => group.id === secondSeed.id)?.avg)
      .toBeCloseTo(455)
  })

  it('labels history by section and by the specific loop pass', () => {
    const path = 'runtime.state.manualBuffs.quick.atk.percent'
    const rotation: RotationNode[] = [
      {
        id: 'opening-write',
        type: 'condition',
        editorSection: 'preamble',
        label: 'Opening',
        changes: [{ type: 'add', path, value: 1 }],
      },
      {
        id: 'main-write',
        type: 'condition',
        label: 'Main write',
        changes: [{ type: 'add', path, value: 1 }],
      },
      {
        id: 'opener-start',
        type: 'loop',
        kind: 'start',
        loopId: 'opener-loop',
        label: 'Opener',
        runs: 2,
      },
      {
        id: 'opener-write',
        type: 'condition',
        label: 'Opener write',
        changes: [{ type: 'add', path, value: 1 }],
      },
      {
        id: 'opener-end',
        type: 'loop',
        kind: 'end',
        loopId: 'opener-loop',
      },
      {
        id: 'burst-start',
        type: 'loop',
        kind: 'start',
        loopId: 'burst-loop',
        label: 'Burst',
        runs: 3,
      },
      {
        id: 'burst-write',
        type: 'condition',
        label: 'Burst write',
        changes: [{ type: 'add', path, value: 1 }],
      },
      {
        id: 'burst-end',
        type: 'loop',
        kind: 'end',
        loopId: 'burst-loop',
      },
    ]
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = rotation
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    const result = buildRun({
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })

    expect(result.sections.map((section) => section.children.map((node) => node.id)))
      .toEqual([
        ['opening-write'],
        ['main-write', 'opener-start', 'burst-start'],
      ])
    expect(result.history.get(path)?.map((entry) => entry.scope)).toEqual([
      { kind: 'section', sectionId: 'preamble', sectionLabel: 'Preamble' },
      { kind: 'section', sectionId: 'main', sectionLabel: 'Main' },
      {
        kind: 'loop',
        sectionId: 'main',
        sectionLabel: 'Main',
        loopId: 'opener-loop',
        loopLabel: 'Opener',
        run: 1,
        runs: 2,
      },
      {
        kind: 'loop',
        sectionId: 'main',
        sectionLabel: 'Main',
        loopId: 'opener-loop',
        loopLabel: 'Opener',
        run: 2,
        runs: 2,
      },
      {
        kind: 'loop',
        sectionId: 'main',
        sectionLabel: 'Main',
        loopId: 'burst-loop',
        loopLabel: 'Burst',
        run: 1,
        runs: 3,
      },
      {
        kind: 'loop',
        sectionId: 'main',
        sectionLabel: 'Main',
        loopId: 'burst-loop',
        loopLabel: 'Burst',
        run: 2,
        runs: 3,
      },
      {
        kind: 'loop',
        sectionId: 'main',
        sectionLabel: 'Main',
        loopId: 'burst-loop',
        loopLabel: 'Burst',
        run: 3,
        runs: 3,
      },
    ])
  })

  it('keeps condition history in simulation order across loop runs', () => {
    const path = 'runtime.state.manualBuffs.quick.atk.percent'
    const rotation: RotationNode[] = [
      {
        id: 'initial',
        type: 'condition',
        label: 'Initial',
        changes: [{ type: 'set', path, value: 0 }],
      },
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        label: 'Loop',
        runs: 2,
      },
      {
        id: 'first-gain',
        type: 'condition',
        label: 'First gain',
        changes: [{ type: 'add', path, value: 25 }],
      },
      {
        id: 'reset',
        type: 'condition',
        label: 'Reset',
        changes: [{ type: 'set', path, value: 0 }],
      },
      {
        id: 'second-gain',
        type: 'condition',
        label: 'Second gain',
        changes: [{ type: 'add', path, value: 25 }],
      },
      {
        id: 'loop-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = rotation
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    const result = buildRun({
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })

    expect(result.history.get(path)?.map((entry) => ({
      nodeId: entry.nodeId,
      run: entry.run,
      from: entry.from,
      to: entry.to,
    }))).toEqual([
      { nodeId: 'initial', run: 1, from: '0', to: '0' },
      { nodeId: 'first-gain', run: 1, from: '0', to: '25' },
      { nodeId: 'reset', run: 1, from: '25', to: '0' },
      { nodeId: 'second-gain', run: 1, from: '0', to: '25' },
      { nodeId: 'first-gain', run: 2, from: '25', to: '50' },
      { nodeId: 'reset', run: 2, from: '50', to: '0' },
      { nodeId: 'second-gain', run: 2, from: '0', to: '25' },
    ])
  })

  it('does not invent a prior state when the interpreter cannot read one', () => {
    const path = 'runtime.state.controls.__rotationEditorUnknownBefore'
    const rotation: RotationNode[] = [
      {
        id: 'first-write',
        type: 'condition',
        changes: [{ type: 'set', path, value: 1 }],
      },
      {
        id: 'second-write',
        type: 'condition',
        changes: [{ type: 'set', path, value: 2 }],
      },
    ]
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = rotation
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    const result = buildRun({
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })

    const history = result.history.get(path)
    expect(history).toHaveLength(2)
    expect(history?.[0]).toMatchObject({ nodeId: 'first-write', to: '1' })
    expect(history?.[0]).not.toHaveProperty('from')
    expect(history?.[1]).toMatchObject({ nodeId: 'second-write', from: '1', to: '2' })

    const first = findNode(result.sections, 'first-write')
    expect(first?.type).toBe('condition')
    expect(first).not.toHaveProperty('from')
  })

  it('keeps the complete nested loop tuple on every history write', () => {
    const path = 'runtime.state.manualBuffs.quick.atk.percent'
    const rotation: RotationNode[] = [
      {
        id: 'outer-start',
        type: 'loop',
        kind: 'start',
        loopId: 'outer',
        label: 'Outer',
        runs: 2,
      },
      {
        id: 'inner-start',
        type: 'loop',
        kind: 'start',
        loopId: 'inner',
        label: 'Inner',
        runs: 2,
      },
      {
        id: 'nested-write',
        type: 'condition',
        label: 'Nested write',
        changes: [{ type: 'add', path, value: 1 }],
      },
      {
        id: 'inner-end',
        type: 'loop',
        kind: 'end',
        loopId: 'inner',
      },
      {
        id: 'outer-end',
        type: 'loop',
        kind: 'end',
        loopId: 'outer',
      },
    ]
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = rotation
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    const result = buildRun({
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })

    // 2 outer passes x 2 inner passes; the inner body belongs to the inner
    // loop on every one of them, so no write lands under the outer loop alone
    const history = result.history.get(path)
    expect(history?.map((entry) => entry.loopRuns)).toEqual([
      { outer: 1, inner: 1 },
      { outer: 1, inner: 2 },
      { outer: 2, inner: 1 },
      { outer: 2, inner: 2 },
    ])
    expect(history?.map((entry) => entry.scope.kind === 'loop'
      ? [entry.scope.loopId, entry.scope.run]
      : [entry.scope.sectionId, 1]))
      .toEqual([
        ['inner', 1],
        ['inner', 2],
        ['inner', 1],
        ['inner', 2],
      ])
  })
})

/*
  What the sweep in the toolbar acts on. Every reading here comes from the
  run's own trace, so these pin the three answers it can give a row: it did
  something, it did nothing, or the run never got anything out of it.
*/
describe('what the last run leaves a row carrying', () => {
  const BUFF_PATH = 'runtime.state.manualBuffs.quick.atk.percent'

  function runFor(program: RotationNode[]) {
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = program
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]
    return buildRun({
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })
  }

  function gatesFor(program: RotationNode[]): Map<string, string | undefined> {
    const result = runFor(program)

    const gates = new Map<string, string | undefined>()
    for (const node of program) {
      const projected = findNode(result.sections, node.id)
      if (projected && projected.type !== 'note') gates.set(node.id, projected.gate?.kind)
    }
    return gates
  }

  it('marks a write inert only when the state already held what it writes', () => {
    const gates = gatesFor([
      { id: 'no-op', type: 'condition', changes: [{ type: 'set', path: BUFF_PATH, value: 0 }] },
      { id: 'raises', type: 'condition', changes: [{ type: 'set', path: BUFF_PATH, value: 10 }] },
      { id: 'repeats', type: 'condition', changes: [{ type: 'set', path: BUFF_PATH, value: 10 }] },
    ])

    expect(gates.get('no-op')).toBe('inert')
    expect(gates.get('raises')).toBeUndefined()
    /* the same write again, against the state the one before it left */
    expect(gates.get('repeats')).toBe('inert')
  })

  it('leaves a write alone when it is one of several the trace cannot separate', () => {
    const gates = gatesFor([
      {
        id: 'pair',
        type: 'condition',
        changes: [
          { type: 'set', path: BUFF_PATH, value: 0 },
          { type: 'set', path: 'runtime.state.manualBuffs.quick.atk.flat', value: 25 },
        ],
      },
    ])

    expect(gates.get('pair')).toBeUndefined()
  })

  it('marks a row dead when the run could not resolve what it names', () => {
    const gates = gatesFor([
      { id: 'unknown-feature', type: 'feature', featureId: 'damage:not-a-feature', multiplier: 1 },
      {
        id: 'off-team',
        type: 'condition',
        resonatorId: 'not-on-this-team',
        changes: [{ type: 'set', path: BUFF_PATH, value: 10 }],
      },
      { id: 'writes-nothing', type: 'condition', changes: [] },
      { id: 'real-feature', type: 'feature', featureId: 'damage:test-skill', multiplier: 1 },
    ])

    expect(gates.get('unknown-feature')).toBe('dead')
    expect(gates.get('off-team')).toBe('dead')
    expect(gates.get('writes-nothing')).toBe('dead')
    expect(gates.get('real-feature')).toBeUndefined()
  })

  it('hands the sweep a tree it can act on, end to end', () => {
    const runtime = makeResRuntime(seed)
    runtime.rotation.program = [
      { id: 'no-op', type: 'condition', changes: [{ type: 'set', path: BUFF_PATH, value: 0 }] },
      { id: 'unknown', type: 'feature', featureId: 'damage:not-a-feature', multiplier: 1 },
      { id: 'raises', type: 'condition', changes: [{ type: 'set', path: BUFF_PATH, value: 10 }] },
      { id: 'damage', type: 'feature', featureId: 'damage:test-skill', multiplier: 1 },
    ]
    const members: RotationMember[] = [{
      id: seed.id,
      name: seed.name,
      profile: seed.profile ?? '',
      attribute: seed.attribute,
      runtime,
      skills: seed.skills ?? [],
      features: seed.features ?? [],
      states: seed.states ?? [],
    }]

    const result = buildRun({
      runtime,
      seed,
      runtimesById: { [runtime.id]: runtime },
      enemy: makeEnemy(),
      members,
    })
    const plan = planRotationCleanup(result.sections)
    const swept = applyRotationCleanup(result.sections, plan)

    expect(plan.targets).toEqual([
      { id: 'no-op', reason: 'inert' },
      { id: 'unknown', reason: 'dead' },
    ])
    expect(findNode(swept, 'no-op')).toBeNull()
    expect(findNode(swept, 'unknown')).toBeNull()
    expect(findNode(swept, 'raises')).not.toBeNull()
    expect(findNode(swept, 'damage')).not.toBeNull()
  })

  it('keeps a write that changed the state on any one pass of a loop', () => {
    const program: RotationNode[] = [
      { id: 'loop-start', type: 'loop', kind: 'start', loopId: 'loop-a', runs: 2 },
      /* raises the state on pass one, and writes what it already holds on pass two */
      { id: 'once', type: 'condition', changes: [{ type: 'set', path: BUFF_PATH, value: 10 }] },
      { id: 'loop-end', type: 'loop', kind: 'end', loopId: 'loop-a' },
    ]
    const gates = gatesFor(program)
    const result = runFor(program)
    const projected = findNode(result.sections, 'once')

    expect(gates.get('once')).toBeUndefined()
    expect(projected?.type === 'condition' ? projected.gateByRun : undefined).toEqual({
      2: { kind: 'inert' },
    })
    expect(planRotationCleanup(result.sections).targets).toEqual([
      { id: 'once', reason: 'inert', loopId: 'loop-a', run: 2 },
    ])
  })
})
