/*
  Author: Runor Ewhro
  Description: Verifies the toRotationNodes.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  extractLoopTemplateBody,
  readPassForks,
  resolveLoopPassBody,
} from '@/domain/gameData/loopPasses.ts'
import type {
  EditorBlock,
  EditorNode,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import {
  applyConditionChanges,
  applyFeatureConditionChanges,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/nodeAuthoring.ts'
import {
  editorNodesToRotation,
  editorSectionsToRotation,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/toRotationNodes.ts'
import { splitEditorSections } from '@/modules/simulation/surfaces/rotation/program-editor/model/sections.ts'
import {
  cloneNode,
  makeCondition,
  makeStep,
  setBlockValue,
  setCondAction,
  setCondValue,
  setHandoffTo,
  wrapNodes,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/treeEdit.ts'
import { makeBlockNode } from '@/modules/simulation/surfaces/rotation/shared/nodeTools.ts'

/** Resolve a loop's pass body from serialized items (template + lazy forks). */
function passBody(items: RotationNode[], run: number): RotationNode[] {
  const startIndex = items.findIndex(
    (node) => node.type === 'loop' && node.kind === 'start',
  )
  const start = items[startIndex]
  if (!start || start.type !== 'loop' || start.kind !== 'start') {
    return []
  }
  const { body } = extractLoopTemplateBody(items, startIndex)
  return resolveLoopPassBody(body, readPassForks(start), run)
}

function passNode(
  items: RotationNode[],
  run: number,
  id: string,
): RotationNode | undefined {
  return passBody(items, run).find((node) => node.id === id)
}

function sectionsWith(...children: EditorNode[]): EditorSection[] {
  return [{ id: 'main', title: 'Main', meta: '', children }]
}

function loopWith(child: EditorNode): EditorBlock {
  const start: Extract<RotationNode, { type: 'loop'; kind: 'start' }> = {
    type: 'loop',
    kind: 'start',
    id: 'loop-start',
    loopId: 'loop-a',
    runs: 3,
  }
  return {
    type: 'loop',
    id: start.id,
    sourceNode: start,
    sourceEndNode: { type: 'loop', kind: 'end', id: 'loop-end', loopId: 'loop-a' },
    loopId: 'loop-a',
    owner: { kind: 'member', memberId: 'res-a' },
    label: 'Loop',
    runs: 3,
    nodeCount: 1,
    children: [child],
  }
}

describe('editorSectionsToRotation', () => {
  it('serializes clipboard fragments as ordinary feature and condition nodes', () => {
    const feature: Extract<RotationNode, { type: 'feature' }> = {
      type: 'feature',
      id: 'hit',
      featureId: 'damage:test',
      resonatorId: 'res-a',
    }
    const condition: Extract<RotationNode, { type: 'condition' }> = {
      type: 'condition',
      id: 'state',
      resonatorId: 'res-a',
      changes: [{ type: 'add', path: 'runtime.foo.stack', value: 1 }],
    }
    const nodes: EditorNode[] = [{
      type: 'step',
      id: feature.id,
      sourceNode: feature,
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Hit',
      featureId: feature.featureId,
      memberId: 'res-a',
      index: 0,
      kindLabel: 'Skill',
      buffCount: 0,
      multiplier: 1,
      damageByRun: { 1: 0 },
      statsByRun: {},
    }, {
      type: 'condition',
      id: condition.id,
      sourceNode: condition,
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Stack',
      path: condition.changes[0].path,
      change: condition.changes[0],
      writeValue: condition.changes[0].value,
      to: '1',
      rising: true,
    }]

    expect(editorNodesToRotation(nodes, [])).toEqual([feature, condition])

    const repeated = editorNodesToRotation([
      cloneNode(nodes[1]),
      cloneNode(nodes[1]),
    ], [])
    expect(repeated.map((node) => node.type)).toEqual(['condition', 'condition'])
    expect(repeated[0]?.id).not.toBe(repeated[1]?.id)
  })

  it('marks preamble roots while keeping the engine and pane sequence flat', () => {
    const preamble: EditorSection = {
      id: 'preamble',
      title: 'Preamble',
      meta: '',
      children: [{
        type: 'condition',
        id: 'opening',
        owner: { kind: 'member', memberId: 'res-a' },
        label: 'Opening state',
        path: 'runtime.foo.opening',
        from: '',
        to: 'on',
        writeValue: true,
        rising: true,
        change: { type: 'set', path: 'runtime.foo.opening', value: true },
      }],
    }
    const main = sectionsWith({
      type: 'condition',
      id: 'main',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Main state',
      path: 'runtime.foo.main',
      from: '',
      to: 'on',
      writeValue: true,
      rising: true,
      change: { type: 'set', path: 'runtime.foo.main', value: true },
    })[0]

    const serialized = editorSectionsToRotation([preamble, main], [])
    const flat = serialized.flatMap((section) => section.items)

    expect(flat.map((node) => node.id)).toEqual(['opening', 'main'])
    expect(flat[0]?.editorSection).toBe('preamble')
    expect(flat[1]).not.toHaveProperty('editorSection')
    expect(splitEditorSections(flat).map((section) => section.items.map((node) => node.id)))
      .toEqual([['opening'], ['main']])
  })

  it('preserves authored additive condition values across display-state round trips', () => {
    const originalItems: RotationNode[] = [
      {
        type: 'condition',
        id: 'cond-add',
        changes: [{ type: 'add', path: 'runtime.foo.stack', value: 1 }],
      },
    ]
    const sections = sectionsWith({
      type: 'condition',
      id: 'cond-add',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Stack',
      path: 'runtime.foo.stack',
      from: '2',
      to: '3',
      writeValue: 1,
      rising: true,
      change: { type: 'add', path: 'runtime.foo.stack', value: 1 },
      byRun: {
        1: { from: '2', to: '3', writeValue: 1, rising: true },
        2: { from: '3', to: '4', writeValue: 1, rising: true },
      },
    })

    const [section] = editorSectionsToRotation(sections, originalItems)
    const [node] = section.items

    expect(node).toMatchObject({
      type: 'condition',
      id: 'cond-add',
      changes: [{ type: 'add', path: 'runtime.foo.stack', value: 1 }],
    })
    expect(node).not.toHaveProperty('when')
  })

  it('edits the condition in the currently authored body', () => {
    const source: Extract<RotationNode, { type: 'condition' }> = {
      type: 'condition',
      id: 'cond',
      changes: [{ type: 'add', path: 'runtime.foo.stack', value: 1 }],
    }
    const condition: EditorNode = {
      type: 'condition',
      id: source.id,
      sourceNode: source,
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Stack',
      path: 'runtime.foo.stack',
      from: '0',
      to: '1',
      writeValue: 1,
      rising: true,
      change: source.changes[0],
    }
    const edited = setCondValue(sectionsWith(loopWith(condition)), condition.id, '4')
    const items = editorSectionsToRotation(edited, [])[0].items
    const loopStart = items[0]

    expect(loopStart).toMatchObject({ type: 'loop', kind: 'start', loopId: 'loop-a' })
    const run1 = passNode(items, 1, 'cond')
    const run2 = passNode(items, 2, 'cond')
    expect(run1?.type === 'condition' ? run1.changes[0].value : null).toBe(4)
    expect(run2?.type === 'condition' ? run2.changes[0].value : null).toBe(4)
    expect(run1).not.toHaveProperty('when')
  })

  it('edits a numeric condition verb on the authored node', () => {
    const source: Extract<RotationNode, { type: 'condition' }> = {
      type: 'condition',
      id: 'cond-action',
      changes: [{ type: 'set', path: 'runtime.foo.stack', value: 2 }],
    }
    const condition: EditorNode = {
      type: 'condition',
      id: source.id,
      sourceNode: source,
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Stack',
      path: 'runtime.foo.stack',
      state: {
        id: 'stack',
        label: 'Stack',
        source: { type: 'resonator', id: 'res-a' },
        ownerKey: 'res-a',
        controlKey: 'stack',
        path: 'runtime.foo.stack',
        kind: 'stack',
      },
      from: '0',
      to: '2',
      writeValue: 2,
      writeAction: 'set',
      rising: true,
      change: source.changes[0],
    }

    const runEdited = setCondAction(
      sectionsWith(loopWith(condition)),
      condition.id,
      'add',
    )
    const runItems = editorSectionsToRotation(runEdited, [])[0].items
    const run1 = passNode(runItems, 1, condition.id)
    const run2 = passNode(runItems, 2, condition.id)
    expect(run1?.type === 'condition' ? run1.changes[0] : null).toEqual({
      type: 'add',
      path: 'runtime.foo.stack',
      value: 2,
    })
    expect(run2?.type === 'condition' ? run2.changes[0] : null).toMatchObject({
      type: 'add',
      path: 'runtime.foo.stack',
      value: 2,
    })

    const authored = setCondAction(runEdited, condition.id, 'add')
    const authoredItems = editorSectionsToRotation(authored, [])[0].items
    const authoredCondition = passNode(authoredItems, 1, condition.id)
    expect(authoredCondition).toMatchObject({
      type: 'condition',
      changes: [{ type: 'add', path: 'runtime.foo.stack', value: 2 }],
    })
    expect(authoredCondition).not.toHaveProperty('when')
  })

  it('preserves omitted ownership, optional toggle values, and exact numeric precision', () => {
    const toggle: Extract<RotationNode, { type: 'condition' }> = {
      type: 'condition',
      id: 'toggle',
      changes: [{ type: 'toggle', path: 'runtime.foo.enabled' }],
    }
    const editorToggle: EditorNode = {
      type: 'condition',
      id: toggle.id,
      sourceNode: toggle,
      owner: { kind: 'member', memberId: 'display-owner' },
      label: 'Toggle',
      path: toggle.changes[0].path,
      from: 'off',
      to: 'on',
      writeValue: undefined,
      rising: true,
      change: toggle.changes[0],
    }
    const precise: Extract<RotationNode, { type: 'condition' }> = {
      type: 'condition',
      id: 'precise',
      changes: [{ type: 'add', path: 'runtime.foo.value', value: 0.123456789 }],
    }
    const result = editorSectionsToRotation(sectionsWith(
      editorToggle,
      {
        type: 'condition',
        id: precise.id,
        sourceNode: precise,
        owner: { kind: 'member', memberId: 'display-owner' },
        label: 'Precise',
        path: precise.changes[0].path,
        from: '0',
        to: '0.12',
        writeValue: 0.123456789,
        rising: true,
        change: precise.changes[0],
      },
    ), [])[0].items

    expect(result).toEqual([toggle, precise])
    expect(result[0]).not.toHaveProperty('resonatorId')

    const [editedToggle] = editorSectionsToRotation(
      setCondValue(sectionsWith(editorToggle), toggle.id, 'off'),
      [],
    )[0].items
    expect(editedToggle).toEqual({
      ...toggle,
      changes: [{ ...toggle.changes[0], value: false }],
    })
  })

  it('preserves formula-valued repeat and uptime settings until the user edits them', () => {
    const repeat: Extract<RotationNode, { type: 'repeat' }> = {
      type: 'repeat',
      id: 'repeat',
      times: { type: 'read', path: 'runtime.foo.times', default: 2 },
      items: [],
    }
    const uptime: Extract<RotationNode, { type: 'uptime' }> = {
      type: 'uptime',
      id: 'uptime',
      ratio: { type: 'const', value: 0.75 },
      items: [],
    }
    const items = editorSectionsToRotation(sectionsWith(
      {
        type: 'repeat',
        id: repeat.id,
        sourceNode: repeat,
        owner: { kind: 'member', memberId: 'res-a' },
        label: 'Repeat',
        runs: 2,
        nodeCount: 0,
        children: [],
      },
      {
        type: 'uptime',
        id: uptime.id,
        sourceNode: uptime,
        owner: { kind: 'member', memberId: 'res-a' },
        label: 'Uptime',
        runs: 1,
        ratio: 0.75,
        nodeCount: 0,
        children: [],
      },
    ), [])[0].items

    expect(items).toEqual([repeat, uptime])
  })

  it('writes repeat and uptime edits to the authored loop body', () => {
    const repeat: Extract<RotationNode, { type: 'repeat' }> = {
      type: 'repeat',
      id: 'repeat',
      times: 2,
      items: [],
    }
    const uptime: Extract<RotationNode, { type: 'uptime' }> = {
      type: 'uptime',
      id: 'uptime',
      ratio: 0.5,
      items: [],
    }
    const loop = loopWith({
      type: 'repeat',
      id: repeat.id,
      sourceNode: repeat,
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Repeat',
      runs: 2,
      nodeCount: 0,
      children: [],
    })
    loop.children.push({
      type: 'uptime',
      id: uptime.id,
      sourceNode: uptime,
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Uptime',
      runs: 1,
      ratio: 0.5,
      nodeCount: 0,
      children: [],
    })
    loop.nodeCount = loop.children.length

    const repeatEdited = setBlockValue(sectionsWith(loop), repeat.id, 4)
    const edited = setBlockValue(repeatEdited, uptime.id, 75)
    const items = editorSectionsToRotation(edited, [])[0].items

    const run1Repeat = passNode(items, 1, 'repeat')
    const run2Repeat = passNode(items, 2, 'repeat')
    const run1Uptime = passNode(items, 1, 'uptime')
    const run2Uptime = passNode(items, 2, 'uptime')

    expect(run1Repeat?.type === 'repeat' ? run1Repeat.times : null).toBe(4)
    expect(run2Repeat?.type === 'repeat' ? run2Repeat.times : null).toBe(4)
    expect(run1Uptime?.type === 'uptime' ? run1Uptime.ratio : null).toBe(0.75)
    expect(run2Uptime?.type === 'uptime' ? run2Uptime.ratio : null).toBe(0.75)
  })

  it('binds a crossed block edit to the free loop that reaches its header', () => {
    const start: Extract<RotationNode, { type: 'loop'; kind: 'start' }> = {
      type: 'loop',
      kind: 'start',
      id: 'free-loop-start',
      loopId: 'free-loop',
      runs: 3,
    }
    const end: Extract<RotationNode, { type: 'loop'; kind: 'end' }> = {
      type: 'loop',
      kind: 'end',
      id: 'free-loop-end',
      loopId: 'free-loop',
    }
    const startSegment: EditorBlock = {
      type: 'loop',
      id: start.id,
      sourceNode: start,
      sourceEndNode: end,
      loopId: start.loopId,
      loopSegment: 'start',
      wrap: 'tail',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Free loop',
      runs: 3,
      nodeCount: 0,
      children: [],
    }
    const endSegment: EditorBlock = {
      ...startSegment,
      id: `${start.id}:segment:1`,
      loopSegment: 'end',
      wrap: 'head',
      wrapOf: start.id,
    }
    const source: Extract<RotationNode, { type: 'repeat' }> = {
      type: 'repeat',
      id: 'crossed-repeat',
      times: 2,
      items: [],
    }
    const repeat: EditorBlock = {
      type: 'repeat',
      id: source.id,
      sourceNode: source,
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Repeat',
      runs: 2,
      nodeCount: 1,
      children: [endSegment],
    }

    const edited = setBlockValue(sectionsWith(startSegment, repeat), repeat.id, 4)
    const items = editorSectionsToRotation(edited, [start, end, source])[0].items
    const serializedStart = items[0]

    expect(serializedStart).toMatchObject({
      type: 'loop',
      kind: 'start',
      loopId: start.loopId,
    })
    const serializedRepeat = items.find((node) => node.type === 'repeat')
    expect(serializedStart?.type === 'loop' && serializedStart.kind === 'start'
      ? serializedStart.passForks
      : null).toBeUndefined()
    expect(serializedRepeat?.type === 'repeat' ? serializedRepeat.times : null).toBe(4)
    expect(serializedRepeat).not.toHaveProperty('when')
  })

  it('writes negative-effect series config onto the feature node when edited', () => {
    const source: Extract<RotationNode, { type: 'feature' }> = {
      type: 'feature',
      id: 'dot',
      featureId: 'skill:chafe',
      negativeEffectStacks: 4,
      negativeEffectInstances: 2,
    }
    const step: EditorStep = {
      type: 'step',
      id: source.id,
      sourceNode: source,
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Glacio Chafe',
      index: 0,
      featureId: source.featureId,
      multiplier: 1,
      damageByRun: {},
      statsByRun: {},
      memberId: 'res-a',
      kindLabel: 'negativeEffect',
      buffCount: 0,
      negEffect: true,
      negativeEffectInstances: 8,
      negativeEffectStableWidth: 2,
      negSeriesEdited: true,
    }
    const [feature] = editorSectionsToRotation(sectionsWith(step), [source])[0].items

    expect(feature).toMatchObject({
      type: 'feature',
      featureId: 'skill:chafe',
      negativeEffectInstances: 8,
      negativeEffectStableWidth: 2,
    })
    expect(feature).not.toHaveProperty('negativeEffectStacks')
  })

  it('omits default series values of 1 so the authored payload stays sparse', () => {
    const step: EditorStep = {
      type: 'step',
      id: 'dot',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Glacio Chafe',
      index: 0,
      featureId: 'skill:chafe',
      multiplier: 1,
      damageByRun: {},
      statsByRun: {},
      memberId: 'res-a',
      kindLabel: 'negativeEffect',
      buffCount: 0,
      negEffect: true,
      negativeEffectInstances: 1,
      negativeEffectStableWidth: 1,
      negSeriesEdited: true,
    }
    const [feature] = editorSectionsToRotation(sectionsWith(step), [])[0].items

    expect(feature).toMatchObject({ type: 'feature', featureId: 'skill:chafe' })
    expect(feature).not.toHaveProperty('negativeEffectInstances')
    expect(feature).not.toHaveProperty('negativeEffectStableWidth')
  })

  it('removes attached feature changes when the condition editor clears them', () => {
    const source: Extract<RotationNode, { type: 'feature' }> = {
      type: 'feature',
      id: 'feature',
      featureId: 'skill-a',
      changes: [{ type: 'set', path: 'runtime.foo.enabled', value: true }],
    }
    const step: EditorStep = {
      type: 'step',
      id: source.id,
      sourceNode: source,
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Skill',
      index: 0,
      featureId: source.featureId,
      changes: source.changes,
      multiplier: 1,
      damageByRun: {},
      statsByRun: {},
      memberId: 'res-a',
      kindLabel: 'Skill',
      buffCount: 0,
    }
    const edited = applyFeatureConditionChanges(sectionsWith(step), step.id, [], [])
    const [feature] = editorSectionsToRotation(edited, [])[0].items

    expect(feature).toMatchObject({ type: 'feature', featureId: 'skill-a' })
    expect(feature).not.toHaveProperty('changes')
  })

  it('keeps untouched attachment metadata when an attached feature changes', () => {
    const attachedCondition: Extract<RotationNode, { type: 'condition' }> = {
      type: 'condition',
      id: 'attached-condition',
      label: 'Scoped state',
      enabled: false,
      changes: [{ type: 'set', path: 'runtime.foo.enabled', value: true }],
    }
    const attachedFeature: Extract<RotationNode, { type: 'feature' }> = {
      type: 'feature',
      id: 'attached-feature',
      featureId: 'skill-child',
      multiplier: 2,
      negativeEffectInstances: 3,
    }
    const source: Extract<RotationNode, { type: 'feature' }> = {
      type: 'feature',
      id: 'parent',
      featureId: 'skill-parent',
      attached: {
        conditions: [attachedCondition],
        features: [attachedFeature],
      },
    }
    const child: EditorStep = {
      ...makeStep('Child', 'res-a'),
      id: attachedFeature.id,
      featureId: attachedFeature.featureId,
      sourceNode: attachedFeature,
      multiplier: 4,
      multiplierEdited: true,
    }
    const parent: EditorStep = {
      ...makeStep('Parent', 'res-a'),
      id: source.id,
      featureId: source.featureId,
      sourceNode: source,
      attached: [child],
      attachedEdited: true,
    }

    const [serialized] = editorSectionsToRotation(sectionsWith(parent), [source])[0].items
    if (serialized?.type !== 'feature') {
      throw new Error('Expected feature serialization')
    }
    const [condition] = serialized.attached?.conditions ?? []
    const [feature] = serialized.attached?.features ?? []

    expect(condition).toMatchObject({
      id: attachedCondition.id,
      label: attachedCondition.label,
      enabled: false,
      changes: attachedCondition.changes,
    })
    expect(condition).not.toHaveProperty('when')
    expect(feature).toMatchObject({
      id: attachedFeature.id,
      featureId: attachedFeature.featureId,
      multiplier: 4,
      negativeEffectInstances: 3,
    })
    expect(feature).not.toHaveProperty('when')
    expect(feature).not.toHaveProperty('resonatorId')
  })

  it('keeps every condition row added by the edit modal after recompiling', () => {
    const source: Extract<RotationNode, { type: 'condition' }> = {
      type: 'condition',
      id: 'condition',
      changes: [{ type: 'set', path: 'runtime.foo.one', value: 1 }],
    }
    const edited = applyConditionChanges(
      sectionsWith({
        type: 'condition',
        id: source.id,
        sourceNode: source,
        owner: { kind: 'member', memberId: 'res-a' },
        label: 'One',
        path: source.changes[0].path,
        from: '0',
        to: '1',
        writeValue: 1,
        rising: true,
        change: source.changes[0],
      }),
      source.id,
      [
        { type: 'set', path: 'runtime.foo.one', value: 2 },
        { type: 'add', path: 'runtime.foo.two', value: 3 },
      ],
      {
        condChoices: [],
        focusedId: 'res-a',
        fallbackResId: 'res-a',
      },
    )
    const items = editorSectionsToRotation(edited.sections, [source])[0].items

    expect(items).toHaveLength(2)
    expect(items.map((node) => node.type === 'condition' ? node.changes[0] : null))
      .toEqual([
        { type: 'set', path: 'runtime.foo.one', value: 2 },
        { type: 'add', path: 'runtime.foo.two', value: 3 },
      ])
  })
  it('leaves an untouched handoff exactly as it was authored', () => {
    const source: Extract<RotationNode, { type: 'condition' }> = {
      type: 'condition',
      id: 'swap-1',
      label: 'Active Resonator',
      changes: [{ type: 'set', path: 'runtime.rotation.activeResonatorId', value: 'res-b' }],
    }
    const items = editorSectionsToRotation(
      sectionsWith({ type: 'swap', id: source.id, from: 'res-a', to: 'res-b', sourceNode: source }),
      [source],
    )[0].items

    expect(items).toEqual([source])
  })

  it('rewrites only the active-resonator change when the handoff is retargeted', () => {
    const source: Extract<RotationNode, { type: 'condition' }> = {
      type: 'condition',
      id: 'swap-1',
      changes: [
        { type: 'set', path: 'runtime.rotation.activeResonatorId', value: 'res-b' },
        { type: 'add', path: 'runtime.foo.stacks', value: 2 },
      ],
    }
    const edited = setHandoffTo(
      sectionsWith({ type: 'swap', id: source.id, from: 'res-a', to: 'res-b', sourceNode: source }),
      source.id,
      'res-c',
    )
    const items = editorSectionsToRotation(edited, [source])[0].items
    const node = items[0]

    expect(node.type === 'condition' ? node.changes : []).toEqual([
      { type: 'set', path: 'runtime.rotation.activeResonatorId', value: 'res-c' },
      { type: 'add', path: 'runtime.foo.stacks', value: 2 },
    ])
  })

  it('retargets the handoff in the authored loop body', () => {
    const source: Extract<RotationNode, { type: 'condition' }> = {
      type: 'condition',
      id: 'swap-1',
      changes: [{ type: 'set', path: 'runtime.rotation.activeResonatorId', value: 'res-b' }],
    }
    const edited = setHandoffTo(
      sectionsWith(loopWith({
        type: 'swap',
        id: source.id,
        from: 'res-a',
        to: 'res-b',
        sourceNode: source,
      })),
      source.id,
      'res-c',
    )
    const items = editorSectionsToRotation(edited, [source])[0].items
    const run1 = passNode(items, 1, source.id)
    const run2 = passNode(items, 2, source.id)

    expect(run1?.type === 'condition' ? run1.changes[0].value : null).toBe('res-c')
    expect(run2?.type === 'condition' ? run2.changes[0].value : null).toBe('res-c')
    expect(run2).not.toHaveProperty('when')
  })
})

/*
  The page and the pane are two ways of writing the same rotation, so a node
  added on one has to come out the shape the other adds it in. Run-specific
  edits live in the enclosing loop's exact pass fork.
*/
describe('nodes the page adds match the ones the pane adds', () => {
  it('names its nodes the way a rotation names them', () => {
    const added = makeStep('Skill', 'res-a')
    const condition = makeCondition('Amplified', 'res-a')
    const loop = wrapNodes(sectionsWith(added), new Set([added.id]), 'loop')[0].children[0]

    expect(added.id.startsWith('rotation:feature:')).toBe(true)
    expect(condition.id.startsWith('rotation:condition:')).toBe(true)
    expect(loop.id.startsWith('rotation:loop-start:')).toBe(true)
    expect(loop.type === 'loop' && loop.loopId?.startsWith('rotation:loop:')).toBe(true)
    // and never twice the same, whatever session either of them opened in
    expect(makeStep('Skill', 'res-a').id).not.toBe(added.id)
  })

  it('writes a step it added as the pane writes a feature', () => {
    const added = { ...makeStep('Skill', 'res-a'), featureId: 'damage:skill' }
    const [item] = editorSectionsToRotation(sectionsWith(added), [])[0].items

    expect(item).toEqual({
      id: added.id,
      type: 'feature',
      featureId: 'damage:skill',
      resonatorId: 'res-a',
      multiplier: 1,
      enabled: true,
    })
  })

  it.each(['repeat', 'uptime'] as const)('writes a %s it added as the pane writes one', (type) => {
    const added = makeStep('Skill', 'res-a')
    const wrapped = wrapNodes(sectionsWith(added), new Set([added.id]), type)
    const [item] = editorSectionsToRotation(wrapped, [])[0].items
    const reference = makeBlockNode(type)

    expect(item.type).toBe(type)
    expect(Object.keys(item).sort()).toEqual(
      [...new Set([
        ...Object.keys(reference),
        'resonatorId',
        ...(type === 'repeat' ? ['setup'] : []),
      ])].sort(),
    )
    expect(item).toMatchObject({ enabled: true })
  })

  /*
    a node says whether it is on the way it already said it. the page only
    writes the field when it is the one saying something.
  */
  it.each([
    { name: 'left off a node that never carried it', enabled: undefined, expected: undefined },
    { name: 'kept on a node the pane wrote', enabled: true, expected: true },
  ])('has enabled $name', ({ enabled, expected }) => {
    const source: RotationNode = {
      id: 'step',
      type: 'feature',
      featureId: 'damage:skill',
      ...(enabled === undefined ? {} : { enabled }),
    }
    const step: EditorStep = {
      ...makeStep('Skill', 'res-a'),
      id: 'step',
      featureId: 'damage:skill',
      sourceNode: source,
    }
    const [item] = editorSectionsToRotation(sectionsWith(step), [source])[0].items

    expect('enabled' in item ? item.enabled : undefined).toBe(expected)
  })

  it('says so when the page turns a node off and on again', () => {
    const source: RotationNode = { id: 'step', type: 'feature', featureId: 'damage:skill' }
    const base: EditorStep = {
      ...makeStep('Skill', 'res-a'),
      id: 'step',
      featureId: 'damage:skill',
      sourceNode: source,
    }

    const [off] = editorSectionsToRotation(
      sectionsWith({ ...base, disabled: true }),
      [source],
    )[0].items
    expect(off).toMatchObject({ enabled: false })

    const [on] = editorSectionsToRotation(
      sectionsWith({ ...base, sourceNode: { ...source, enabled: false } }),
      [source],
    )[0].items
    expect(on).toMatchObject({ enabled: true })
  })
})
