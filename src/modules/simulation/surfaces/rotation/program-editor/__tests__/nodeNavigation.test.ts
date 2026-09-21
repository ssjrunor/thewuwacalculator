/*
  Author: Runor Ewhro
  Description: Verifies the nodeNavigation.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type {
  EditorBlock,
  EditorCondition,
  EditorNode,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import {
  findFeatureOccurrences,
  findRotationNode,
  findRotationNodeLocation,
  findRotationNodes,
  loopRunsForRotationNodeTarget,
  openRotationNodeLocation,
  prepareRotationNodeNavigation,
} from '@/modules/simulation/surfaces/rotation/program-editor/interaction/nodeNavigation.ts'

function step(id: string): EditorStep {
  return {
    type: 'step',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    index: 0,
    multiplier: 1,
    damageByRun: { 1: 1 },
    statsByRun: {},
    memberId: 'res-a',
    kindLabel: 'Skill',
    buffCount: 0,
  }
}

function condition(id: string, sourceIcon?: string): EditorCondition {
  return {
    type: 'condition',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    sourceIcon,
    sourceName: sourceIcon ? 'Shared source' : undefined,
    from: 'off',
    to: 'on',
    rising: true,
  }
}

function loop(id: string, runs: number, children: EditorNode[]): EditorBlock {
  return {
    type: 'loop',
    id: `${id}-start`,
    loopId: id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    runs,
    nodeCount: children.length,
    children,
  }
}

describe('rotation editor node navigation', () => {
  it('finds structural and compact-row folds that hide a nested node', () => {
    const target = condition('target')
    const sections: EditorSection[] = [{
      id: 'main',
      title: 'Main',
      meta: '',
      children: [
        loop('outer', 3, [
          loop('inner', 4, [
            step('run-head'),
            target,
            step('run-tail'),
          ]),
        ]),
      ],
    }]

    const location = findRotationNodeLocation(sections, target.id)

    expect(location).toMatchObject({
      node: target,
      sectionId: 'main',
      blockIds: ['outer-start', 'inner-start'],
      loopIds: ['outer', 'inner'],
    })
    expect(location?.revealIds).toEqual([
      'main',
      'outer-start',
      'inner-start',
      'run-head',
    ])

    const shut = new Set(['main', 'outer-start', 'inner-start', 'run-head', 'unrelated'])
    expect([
      ...openRotationNodeLocation(shut, location!),
    ]).toEqual(['unrelated'])
  })

  it('finds the source head hiding a compact condition row', () => {
    const target = condition('state-b', '/source.webp')
    const sections: EditorSection[] = [{
      id: 'preamble',
      title: 'Preamble',
      meta: '',
      children: [
        condition('state-a', '/source.webp'),
        target,
      ],
    }]

    expect(findRotationNodeLocation(sections, target.id)?.revealIds)
      .toEqual(['preamble', 'state-a'])
  })

  it('locates an owned note at its host execution position', () => {
    const host = {
      ...step('host'),
      attachedNote: { id: 'owned-note', type: 'note' as const, text: 'Timing' },
    }
    const sections: EditorSection[] = [{
      id: 'main',
      title: 'Main',
      meta: '',
      children: [loop('outer', 3, [host])],
    }]

    expect(findRotationNodeLocation(sections, 'owned-note')).toMatchObject({
      node: host.attachedNote,
      sectionId: 'main',
      blockIds: ['outer-start'],
      loopIds: ['outer'],
    })
  })

  it('restores the target tuple without changing sibling loop views', () => {
    const target = step('target')
    const sections: EditorSection[] = [{
      id: 'main',
      title: 'Main',
      meta: '',
      children: [
        loop('outer', 3, [loop('inner', 4, [target])]),
        loop('sibling', 2, [step('sibling-step')]),
      ],
    }]
    const location = findRotationNodeLocation(sections, target.id)

    expect(loopRunsForRotationNodeTarget(
      sections,
      { outer: 3, inner: 4, sibling: 2, stale: 9 },
      {
        nodeId: target.id,
        loopRuns: { outer: 1, inner: 1, sibling: 1 },
      },
      location,
    )).toEqual({
      outer: 1,
      inner: 1,
      sibling: 2,
    })
  })

  it('derives feature occurrences from authored nodes and nested loop views', () => {
    const direct = {
      ...step('direct'),
      featureId: 'feature-a',
      label: 'Shared feature',
    }
    const nested = {
      ...step('nested'),
      featureId: 'feature-a',
      label: 'Shared feature',
      disabled: true,
    }
    const repeat: EditorBlock = {
      type: 'repeat',
      id: 'repeat',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Repeat',
      runs: 3,
      nodeCount: 1,
      children: [direct],
    }
    const sections: EditorSection[] = [{
      id: 'main',
      title: 'Main',
      meta: '',
      children: [
        repeat,
        loop('outer', 2, [loop('inner', 2, [nested])]),
        { ...step('other'), featureId: 'feature-b' },
      ],
    }]

    expect(findFeatureOccurrences(sections, 'feature-a')).toEqual([
      {
        nodeId: 'direct',
        label: 'Shared feature',
        loopRuns: {},
        scope: { kind: 'section', sectionId: 'main', sectionLabel: 'Main' },
        scopeLabel: 'Main',
      },
      {
        nodeId: 'nested',
        label: 'Shared feature',
        loopRuns: { outer: 1, inner: 1 },
        scope: {
          kind: 'loop',
          sectionId: 'main',
          sectionLabel: 'Main',
          loopId: 'inner',
          loopLabel: 'inner',
          run: 1,
          runs: 2,
        },
        scopeLabel: 'outer . run 1 of 2 / inner . run 1 of 2',
      },
      {
        nodeId: 'nested',
        label: 'Shared feature',
        loopRuns: { outer: 1, inner: 2 },
        scope: {
          kind: 'loop',
          sectionId: 'main',
          sectionLabel: 'Main',
          loopId: 'inner',
          loopLabel: 'inner',
          run: 2,
          runs: 2,
        },
        scopeLabel: 'outer . run 1 of 2 / inner . run 2 of 2',
      },
      {
        nodeId: 'nested',
        label: 'Shared feature',
        loopRuns: { outer: 2, inner: 1 },
        scope: {
          kind: 'loop',
          sectionId: 'main',
          sectionLabel: 'Main',
          loopId: 'inner',
          loopLabel: 'inner',
          run: 1,
          runs: 2,
        },
        scopeLabel: 'outer . run 2 of 2 / inner . run 1 of 2',
      },
      {
        nodeId: 'nested',
        label: 'Shared feature',
        loopRuns: { outer: 2, inner: 2 },
        scope: {
          kind: 'loop',
          sectionId: 'main',
          sectionLabel: 'Main',
          loopId: 'inner',
          loopLabel: 'inner',
          run: 2,
          runs: 2,
        },
        scopeLabel: 'outer . run 2 of 2 / inner . run 2 of 2',
      },
    ])
  })

  it('finds rows by label and evaluated skill metadata in ranked order', () => {
    const exact = {
      ...step('exact'),
      label: 'Moonlit Strike',
      featureId: 'damage:moonlit',
      skillTypeLabel: 'Resonance Skill',
      talentNodeLabel: 'Forte Circuit',
    }
    const partial = { ...step('partial'), label: 'Moonlit Strike Follow-up' }
    const sections: EditorSection[] = [{
      id: 'main', title: 'Main', meta: '', children: [partial, exact],
    }]

    expect(findRotationNodes(sections, 'moonlit strike').map((result) => result.node.id))
      .toEqual(['exact', 'partial'])
    expect(findRotationNodes(sections, 'forte circuit')[0]).toMatchObject({
      node: exact,
      target: { nodeId: 'exact' },
      sectionId: 'main',
      scopeLabel: 'Main',
    })
  })

  it('returns exact loop targets and prefers the currently viewed occurrence', () => {
    const shared = { ...step('shared'), label: 'Shared Hit' }
    const sections: EditorSection[] = [{
      id: 'main',
      title: 'Main',
      meta: '',
      children: [loop('outer', 3, [shared])],
    }]

    expect(findRotationNodes(sections, 'Shared Hit').map((result) => result.target.loopRuns))
      .toEqual([{ outer: 1 }, { outer: 2 }, { outer: 3 }])
    expect(findRotationNode(sections, 'Shared Hit', { outer: 3 })?.target.loopRuns)
      .toEqual({ outer: 3 })
  })

  it('checks out the requested run when the search target is the loop itself', () => {
    const sections: EditorSection[] = [{
      id: 'main',
      title: 'Main',
      meta: '',
      children: [loop('cycle', 3, [step('hit')])],
    }]
    const target = { nodeId: 'cycle-start', loopRuns: { cycle: 3 } }

    expect(loopRunsForRotationNodeTarget(sections, { cycle: 1 }, target))
      .toEqual({ cycle: 3 })
    const navigation = prepareRotationNodeNavigation({
      sections,
      runsByLoopId: { cycle: 1 },
      shutIds: new Set(),
      target,
    })
    expect(navigation).toMatchObject({
      selectedId: 'cycle-start',
      runsByLoopId: { cycle: 3 },
    })
    expect(navigation?.sections[0].children[0]).toMatchObject({
      type: 'loop',
      checkedOutRun: 3,
    })
  })

  it('finds and prepares a node that exists only in a loop pass fork', () => {
    const common = { ...step('common'), label: 'Common Hit' }
    const forkOnly = { ...step('fork-only'), label: 'Fork Finisher' }
    const block: EditorBlock = {
      ...loop('cycle', 3, [common]),
      checkedOutRun: 1,
      passTemplate: [common],
      passForks: { 2: [common, forkOnly] },
    }
    const sections: EditorSection[] = [{
      id: 'main', title: 'Main', meta: '', children: [block],
    }]
    const match = findRotationNode(sections, 'Fork Finisher')

    expect(match?.target).toEqual({ nodeId: 'fork-only', loopRuns: { cycle: 2 } })

    const navigation = prepareRotationNodeNavigation({
      sections,
      runsByLoopId: { cycle: 1 },
      shutIds: new Set(['main', 'cycle-start']),
      target: match!.target,
      revealToken: 4,
    })
    const checkedOut = navigation?.sections[0].children[0]
    expect(navigation).toMatchObject({
      runsByLoopId: { cycle: 2 },
      selectedId: 'fork-only',
      revealRequest: { nodeId: 'fork-only', token: 5 },
    })
    expect(checkedOut?.type === 'loop' ? checkedOut.children.map((node) => node.id) : [])
      .toEqual(['common', 'fork-only'])
    expect([...(navigation?.shutIds ?? [])]).toEqual([])
  })

  it('searches an owned note but targets its selectable host row', () => {
    const host = {
      ...step('host'),
      attachedNote: {
        id: 'owned-note',
        type: 'note' as const,
        label: 'Timing note',
        text: 'Wait for the outro.',
      },
    }
    const sections: EditorSection[] = [{
      id: 'main', title: 'Main', meta: '', children: [host],
    }]

    expect(findRotationNode(sections, 'outro')).toMatchObject({
      node: host.attachedNote,
      target: { nodeId: 'host' },
      label: 'Timing note',
      kind: 'note',
    })
  })
})
