/*
  Author: Runor Ewhro
  Description: Verifies canonical node construction, preamble generation,
               attachments, feature replacement, and authored state writes.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode, SourceState } from '@/domain/gameData/contracts.ts'
import type {
  EditorSection,
  EditorStep,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  applyConditionChanges,
  applyFeatureConditionChanges,
  attachedWritesOf,
  buildPreambleEntries,
  makeConditionNode,
  makePaletteNode,
  removeAttachedWrite,
  setAttachedWriteAction,
  setAttachedWriteValue,
} from '@/modules/simulation/features/rotation/program-editor/model/nodeAuthoring.ts'
import {
  prepareSavedRotationBatch,
  runPreparedSavedRotationBatch,
  runSavedRotation,
  runSavedRotationBatch,
  runStoredRotation,
  savedRotationSimulationKey,
  savedRotationSummary,
} from '@/modules/simulation/features/rotation/program-editor/simulation/simulation.ts'
import { editorSectionsToRotation } from '@/modules/simulation/features/rotation/program-editor/model/toRotationNodes.ts'
import { findNode } from '@/modules/simulation/features/rotation/program-editor/model/treeEdit.ts'
import type { CondChoice } from '@/modules/simulation/features/rotation/shared/authoringTypes.ts'
import {
  DEF_RES_ID,
  makeEnemy,
  makeResProfile,
  makeResRuntime,
  makeScenarioFromProfiles,
} from '@/domain/state/defaults.ts'
import type { ResSeed } from '@/domain/entities/runtime.ts'
import { makeSavedRotation } from '@/domain/entities/inventoryStorage.ts'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { listFeatsFor } from '@/domain/services/gameDataService.ts'
import { ACTIVE_RESONATOR_PATH } from '@/domain/gameData/rotationPaths.ts'
import { presentRotMembers } from '@/modules/simulation/features/rotation/shared/catalog.ts'

function conditionChoice(changeTarget: 'enemy' | 'rotation'): CondChoice {
  const state: SourceState = {
    id: `${changeTarget}-state`,
    label: 'Exposed',
    source: { type: changeTarget === 'enemy' ? 'enemy' : 'resonator', id: changeTarget },
    ownerKey: changeTarget,
    controlKey: 'exposed',
    path: `${changeTarget}.exposed`,
    kind: 'toggle',
    defaultValue: true,
  }
  return {
    id: `${changeTarget}:exposed`,
    resonatorId: 'res-a',
    resName: 'Resonator A',
    sourceName: changeTarget === 'enemy' ? 'Enemy' : 'Rotation',
    label: 'Exposed',
    state,
    changeTarget,
  }
}

function savedScenario(seed: ResSeed, items: RotationNode[]) {
  const profile = makeResProfile(seed, { maxed: true })
  const scenario = makeScenarioFromProfiles({ [seed.id]: profile }, null, 0, seed.id)
  scenario.program.program = items
  return scenario
}

describe('rotation editor palette node construction', () => {
  it.each(['enemy', 'rotation'] as const)(
    'uses the pane condition contract for %s state drops',
    (changeTarget) => {
      const choice = conditionChoice(changeTarget)
      const clicked = makeConditionNode(choice)
      const dropped = makePaletteNode({
        kind: 'condition',
        label: 'Browser-only label',
        choiceId: choice.id,
      }, 'res-a', [choice])

      expect(dropped?.type).toBe('condition')
      expect(clicked.type).toBe('condition')
      if (!dropped || dropped.type !== 'condition' || clicked.type !== 'condition') {
        return
      }

      for (const node of [clicked, dropped]) {
        expect(node).toMatchObject({
          label: choice.label,
          path: choice.state.path,
          writeValue: true,
          change: {
            type: 'set',
            path: choice.state.path,
            value: true,
          },
          sourceNode: {
            type: 'condition',
            enabled: true,
            label: choice.label,
            changes: [{
              type: 'set',
              path: choice.state.path,
              value: true,
            }],
          },
        })
        expect(node.change).not.toHaveProperty('resonatorId')
        expect(node.sourceNode?.type).toBe('condition')
        if (node.sourceNode?.type === 'condition') {
          expect(node.sourceNode.resonatorId).toBeUndefined()
        }
      }

      const [serialized] = editorSectionsToRotation([{
        id: 'main',
        title: 'Main',
        meta: '',
        children: [dropped],
      }], [])
      const [rotationNode] = serialized.items
      expect(rotationNode).toMatchObject({
        type: 'condition',
        label: choice.label,
        changes: [{
          type: 'set',
          path: choice.state.path,
          value: true,
        }],
      })
      expect('enabled' in rotationNode ? rotationNode.enabled : undefined).not.toBe(false)
      if (rotationNode.type === 'condition') {
        expect(rotationNode.resonatorId).toBeUndefined()
        expect(rotationNode.changes[0]).not.toHaveProperty('resonatorId')
      }
    },
  )

  it('uses the normal feature builder for feature drops', () => {
    const dropped = makePaletteNode({
      kind: 'step',
      label: 'Skill',
      featureId: 'skill-a',
      resonatorId: 'res-a',
      tab: 'resonanceSkill',
      color: 'var(--calc-support-healing-color)',
      aggregationType: 'healing',
    }, 'fallback', [])

    expect(dropped).toMatchObject({
      type: 'step',
      label: 'Skill',
      featureId: 'skill-a',
      memberId: 'res-a',
      owner: { kind: 'member', memberId: 'res-a' },
      kindLabel: 'resonanceSkill',
      color: 'var(--calc-support-healing-color)',
      aggregationType: 'healing',
    })
  })

  it('keeps echo attacks attributed to their resonator while showing the echo on the row', () => {
    const dropped = makePaletteNode({
      kind: 'step',
      label: 'Echo Skill',
      featureId: 'echo:6000216:feature:echo:6000216:skill:1',
      resonatorId: 'res-a',
      tab: 'echoAttacks',
      echoId: '6000216',
    }, 'fallback', [])

    expect(dropped).toMatchObject({
      type: 'step',
      memberId: 'res-a',
      owner: { kind: 'echo', echoId: '6000216' },
    })
  })

  it('rejects a stale condition drag instead of creating a partial node', () => {
    expect(makePaletteNode({
      kind: 'condition',
      label: 'Missing',
      choiceId: 'missing',
    }, 'res-a', [])).toBeNull()
  })

  it('authors the active-resonator state directly as a handoff before running', () => {
    const choice: CondChoice = {
      id: 'rotation:active-resonator',
      resonatorId: 'rotation',
      resName: 'Rotation',
      sourceName: 'Overrides',
      label: 'Active Resonator',
      changeTarget: 'rotation',
      state: {
        id: 'rotation:active-resonator',
        label: 'Active Resonator',
        source: { type: 'resonator', id: 'res-a' },
        ownerKey: 'rotation:active',
        controlKey: 'rotation.activeResonatorId',
        path: ACTIVE_RESONATOR_PATH,
        kind: 'select',
        options: [
          { id: 'res-a', label: 'Resonator A' },
          { id: 'res-b', label: 'Resonator B' },
        ],
        defaultValue: 'res-b',
      },
    }

    const clicked = makeConditionNode(choice, 'res-a', 'res-b', 'res-c')
    const dropped = makePaletteNode({
      kind: 'condition',
      label: choice.label,
      choiceId: choice.id,
    }, 'res-a', [choice], () => 'res-b', () => 'res-c')

    expect(clicked).toMatchObject({ type: 'swap', from: 'res-c', to: 'res-b' })
    expect(dropped).toMatchObject({ type: 'swap', from: 'res-c', to: 'res-b' })

    if (!dropped) {
      throw new Error('Expected the active-resonator palette node')
    }
    const [serialized] = editorSectionsToRotation([{
      id: 'main',
      title: 'Main',
      meta: '',
      children: [dropped],
    }], [])
    expect(serialized.items[0]).toMatchObject({
      type: 'condition',
      changes: [{ type: 'set', path: ACTIVE_RESONATOR_PATH, value: 'res-b' }],
    })
  })

  it('keeps an edited handoff canonical before the next run', () => {
    const result = applyConditionChanges(
      [{
        id: 'main',
        title: 'Main',
        meta: '',
        children: [{ type: 'swap', id: 'swap-1', from: 'res-a', to: 'res-b' }],
      }],
      'swap-1',
      [{ type: 'set', path: ACTIVE_RESONATOR_PATH, value: 'res-c' }],
      { condChoices: [], focusedId: 'res-b', fallbackResId: 'res-b' },
    )

    expect(findNode(result.sections, 'swap-1')).toMatchObject({
      type: 'swap',
      id: 'swap-1',
      from: 'res-a',
      to: 'res-c',
    })
  })

  it('normalizes a generated preamble to one final handoff', () => {
    const entries = buildPreambleEntries({
      condChoices: [],
      existing: [
        {
          type: 'condition',
          id: 'legacy-active',
          owner: { kind: 'member', memberId: 'res-a' },
          label: 'Active Resonator',
          path: ACTIVE_RESONATOR_PATH,
          to: 'res-b',
          rising: true,
          change: { type: 'set', path: ACTIVE_RESONATOR_PATH, value: 'res-b' },
        },
        { type: 'swap', id: 'existing-handoff', from: 'res-b', to: 'res-c' },
      ],
      activeId: 'res-a',
      startId: 'res-c',
    })

    expect(entries).toEqual([
      { type: 'swap', id: 'existing-handoff', from: 'res-a', to: 'res-c' },
    ])
  })
})

function memberChoice(
  key: string,
  label: string,
  state: Pick<SourceState, 'kind' | 'min' | 'max' | 'defaultValue'>,
): CondChoice {
  return {
    id: `res-a:${key}`,
    resonatorId: 'res-a',
    resName: 'Resonator A',
    sourceName: 'Forte',
    label,
    state: {
      id: key,
      label,
      source: { type: 'resonator', id: 'res-a' },
      ownerKey: 'res-a',
      controlKey: key,
      path: `runtime.res-a.${key}`,
      ...state,
    },
  }
}

const AMPLIFIED = memberChoice('amplified', 'Amplified', { kind: 'toggle', defaultValue: true })
const STACKS = memberChoice('stacks', 'Stacks', { kind: 'stack', min: 0, max: 5 })
const ATTACHED_CHOICES = [AMPLIFIED, STACKS]

function stepWithWrites(): EditorStep {
  return {
    type: 'step',
    id: 'step-1',
    owner: { kind: 'member', memberId: 'res-a' },
    label: 'Skill',
    index: 0,
    featureId: 'skill-a',
    multiplier: 1,
    damageByRun: {},
    statsByRun: {},
    memberId: 'res-a',
    kindLabel: 'Skill',
    buffCount: 0,
    changes: [
      { type: 'set', path: AMPLIFIED.state.path, value: true, resonatorId: 'res-a' },
      { type: 'set', path: STACKS.state.path, value: 3, resonatorId: 'res-a' },
    ],
    // what the last run reported, which any edit here invalidates
    writesByRun: { 1: [{ id: 'step-1:w0', label: 'Amplified', value: 'on', rising: true }] },
  }
}

function sectionsWithStep(step: EditorStep): EditorSection[] {
  return [{ id: 'main', title: 'Main', meta: '', children: [step] }]
}

function editedStep(sections: EditorSection[]): EditorStep {
  const node = findNode(sections, 'step-1')
  if (node?.type !== 'step') {
    throw new Error('the step went missing')
  }
  return node
}

describe('writes attached to a step', () => {
  it('names each authored change from the catalog and states its value in display form', () => {
    expect(attachedWritesOf(stepWithWrites(), ATTACHED_CHOICES)).toEqual([
      {
        index: 0,
        label: 'Amplified',
        sourceName: 'Forte',
        state: AMPLIFIED.state,
        value: 'on',
        action: 'set',
        rising: true,
      },
      {
        index: 1,
        label: 'Stacks',
        sourceName: 'Forte',
        state: STACKS.state,
        value: '3',
        action: 'set',
        rising: true,
      },
    ])
  })

  it('parses an edited value back against the state it writes, leaving the others alone', () => {
    const edited = setAttachedWriteValue(
      sectionsWithStep(stepWithWrites()),
      'step-1',
      0,
      'off',
      ATTACHED_CHOICES,
    )

    expect(editedStep(edited).changes).toEqual([
      { type: 'set', path: AMPLIFIED.state.path, value: false, resonatorId: 'res-a' },
      { type: 'set', path: STACKS.state.path, value: 3, resonatorId: 'res-a' },
    ])
  })

  it('keeps the value when a numeric write is switched to adding', () => {
    const edited = setAttachedWriteAction(
      sectionsWithStep(stepWithWrites()),
      'step-1',
      1,
      'add',
      ATTACHED_CHOICES,
    )

    expect(editedStep(edited).changes?.[1]).toEqual({
      type: 'add',
      path: STACKS.state.path,
      value: 3,
      resonatorId: 'res-a',
    })
  })

  it('edits attached writes directly after loop passes are checked out', () => {
    const edited = setAttachedWriteValue(
      sectionsWithStep(stepWithWrites()),
      'step-1',
      0,
      'off',
      ATTACHED_CHOICES,
    )
    const step = editedStep(edited)

    expect(step.changes?.[0]).toMatchObject({
      type: 'set',
      value: false,
    })
    expect(attachedWritesOf(step, ATTACHED_CHOICES)[0]?.value).toBe('off')
  })

  it('refuses to add to a state that cannot be incremented', () => {
    const edited = setAttachedWriteAction(
      sectionsWithStep(stepWithWrites()),
      'step-1',
      0,
      'add',
      ATTACHED_CHOICES,
    )

    expect(editedStep(edited).changes?.[0]).toMatchObject({ type: 'set', value: true })
  })

  it('drops only the write that was removed', () => {
    const edited = removeAttachedWrite(
      sectionsWithStep(stepWithWrites()),
      'step-1',
      0,
      ATTACHED_CHOICES,
    )

    expect(attachedWritesOf(editedStep(edited), ATTACHED_CHOICES).map((write) => write.label))
      .toEqual(['Stacks'])
  })

  it('drops an attached write from the authored node', () => {
    const edited = removeAttachedWrite(
      sectionsWithStep(stepWithWrites()),
      'step-1',
      0,
      ATTACHED_CHOICES,
    )
    const step = editedStep(edited)

    expect(attachedWritesOf(step, ATTACHED_CHOICES).map((write) => write.label))
      .toEqual(['Stacks'])
  })

  it('holds edited writes as authored so the rows show them before the next run', () => {
    const edited = applyFeatureConditionChanges(
      sectionsWithStep(stepWithWrites()),
      'step-1',
      [{ type: 'add', path: STACKS.state.path, value: 2, resonatorId: 'res-a' }],
      ATTACHED_CHOICES,
    )
    const step = editedStep(edited)

    expect(step.writesByRun).toBeUndefined()
    expect(step.pendingWrites).toEqual([
      { id: 'step-1:w0', label: 'Stacks', value: '+2', rising: true },
    ])
  })
})

describe('saved rotation inspection', () => {
  it('can refresh the standing last-run program instead of a changed persisted program', () => {
    const seed = seedRsntById[DEF_RES_ID]
    const feature = seed ? listFeatsFor('resonator', seed.id)[0] : undefined
    expect(seed).toBeDefined()
    expect(feature).toBeDefined()
    if (!seed || !feature) return

    const runtime = makeResRuntime(seed)
    runtime.rotation.program = [{
      id: 'persisted-feature',
      type: 'feature',
      featureId: feature.id,
    }]
    const result = runStoredRotation({
      runtime,
      runtimesById: { [runtime.id]: runtime },
      targetSelections: {},
      enemy: makeEnemy(),
      members: presentRotMembers(runtime),
      items: [{
        id: 'standing-feature',
        type: 'feature',
        featureId: feature.id,
      }],
    })

    expect(result && findNode(result.sections, 'standing-feature')).toBeTruthy()
    expect(result && findNode(result.sections, 'persisted-feature')).toBeNull()
  })

  it('rebuilds saved nodes from their detached profile snapshot', () => {
    const seed = seedRsntById[DEF_RES_ID]
    const feature = seed ? listFeatsFor('resonator', seed.id)[0] : undefined
    expect(seed).toBeDefined()
    expect(feature).toBeDefined()
    if (!seed || !feature) return

    const items: RotationNode[] = [{
      id: 'saved-feature',
      type: 'feature',
      featureId: feature.id,
      multiplier: 1,
    }]
    const scenario = savedScenario(seed, items)
    const entry = makeSavedRotation({
      name: 'Detached run',
      scenario,
    })

    const result = runSavedRotation({ entry })

    expect(result).not.toBeNull()
    expect(result && findNode(result.sections, 'saved-feature')).toMatchObject({
      type: 'step',
      sourceNode: { id: 'saved-feature' },
    })
    expect(scenario.program.program).toEqual(items)
  })

  it('recalculates every canonical entry from its scenario', () => {
    const seed = seedRsntById[DEF_RES_ID]
    expect(seed).toBeDefined()
    if (!seed) return

    const entry = makeSavedRotation({
      name: 'Legacy run',
      scenario: savedScenario(seed, []),
    })

    expect(runSavedRotation({ entry })).not.toBeNull()
  })

  it('batches saved runs against their scenario target without persisted output', async () => {
    const seed = seedRsntById[DEF_RES_ID]
    const feature = seed ? listFeatsFor('resonator', seed.id)[0] : undefined
    expect(seed).toBeDefined()
    expect(feature).toBeDefined()
    if (!seed || !feature) return

    const entry = makeSavedRotation({
      name: 'Recalculated run',
      scenario: savedScenario(seed, [{ id: 'feature', type: 'feature', featureId: feature.id }]),
    })
    const changedEntry = {
      ...entry,
      scenario: {
        ...entry.scenario,
        target: { ...entry.scenario.target, level: entry.scenario.target.level + 1 },
      },
    }

    const results = await runSavedRotationBatch([entry])
    const run = results.get(entry.id)

    expect(run).toBeTruthy()
    expect(run).not.toHaveProperty('sections')
    expect(run && savedRotationSummary(run).total.avg).not.toBe(1)
    expect(savedRotationSimulationKey(changedEntry)).not.toBe(savedRotationSimulationKey(entry))
  })

  it('reuses one set of saved-rotation keys for batch identity and execution', async () => {
    const seed = seedRsntById[DEF_RES_ID]
    expect(seed).toBeDefined()
    if (!seed) return

    const entry = makeSavedRotation({
      name: 'Prepared batch run',
      scenario: savedScenario(seed, []),
    })
    const batch = prepareSavedRotationBatch([entry])

    expect(batch.key).toBe(batch.jobs[0]?.key)
    expect((await runPreparedSavedRotationBatch(batch)).has(entry.id)).toBe(true)
  })

  it('projects saved loop summaries using the selected damage basis', async () => {
    const seed = seedRsntById[DEF_RES_ID]
    const feature = seed ? listFeatsFor('resonator', seed.id)[0] : undefined
    expect(seed).toBeDefined()
    expect(feature).toBeDefined()
    if (!seed || !feature) return

    const loopId = 'saved-loop'
    const items: RotationNode[] = [
      { id: 'loop-start', type: 'loop', kind: 'start', loopId, runs: 2 },
      { id: 'loop-feature', type: 'feature', featureId: feature.id },
      { id: 'loop-end', type: 'loop', kind: 'end', loopId },
    ]
    const entry = makeSavedRotation({
      name: 'Looped run',
      scenario: savedScenario(seed, items),
    })
    const run = runSavedRotation({ entry })
    expect(run).toBeTruthy()
    if (!run) return

    const average = savedRotationSummary(run, 'avg')
    const full = savedRotationSummary(run, 'full')

    expect(average.total.avg).toBeCloseTo(run.summary.total.avg)
    expect(full.total.avg).toBeCloseTo(run.fullSummary.total.avg)
    expect(full.total.avg).toBeCloseTo(average.total.avg * 2)
    expect((full.members ?? []).reduce((sum, member) => sum + member.contribution.avg, 0))
      .toBeCloseTo(full.total.avg)

    const compact = (await runSavedRotationBatch([entry])).get(entry.id)
    expect(compact).toBeTruthy()
    if (!compact) return
    expect(savedRotationSummary(compact, 'avg').total.avg).toBeCloseTo(average.total.avg)
    expect(savedRotationSummary(compact, 'full').total.avg).toBeCloseTo(full.total.avg)
  })
})
