/*
  Author: Runor Ewhro
  Description: Verifies the readNode.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type {
  EditorBlock,
  EditorCondition,
  EditorMember,
  EditorNode,
  EditorNote,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import { resolveReadNode } from '@/modules/simulation/features/rotation/program-editor/presentation/readNode.ts'
import { EMPTY_STATS } from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'

function step(id: string, damage = 100, index = 0): EditorStep {
  return {
    type: 'step',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    index,
    multiplier: 1,
    damageByRun: { 1: damage, 2: damage * 2 },
    statsByRun: {
      1: { ...EMPTY_STATS, atk: 1000, critRate: 0.6 },
      2: { ...EMPTY_STATS, atk: 1200, critRate: 0.6 },
    },
    memberId: 'res-a',
    kindLabel: 'Skill',
    buffCount: 0,
  }
}

function loop(id: string, runs: number, children: EditorNode[]): EditorBlock {
  return {
    type: 'loop',
    id: `${id}-start`,
    loopId: id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: 'Opener',
    runs,
    nodeCount: children.length,
    children,
  }
}

function condition(id: string): EditorCondition {
  return {
    type: 'condition',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: 'Molten Rift',
    to: '3',
    from: '2',
    rising: true,
    path: 'res-a.molten',
    sourceName: 'Changli S1',
    byRun: { 2: { from: '1', to: '2', rising: true } },
  } as EditorCondition
}

function note(id: string): EditorNote {
  return {
    type: 'note',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: 'Swap timing',
    text: 'hold the outro',
  } as EditorNote
}

const members: EditorMember[] = [
  {
    id: 'res-a',
    name: 'Changli',
    attribute: 'fusion',
    profile: '',
  } as EditorMember,
]

const noBuffs = () => []

function read(id: string, sections: EditorSection[], runs: Record<string, number> = {}) {
  return resolveReadNode({
    id,
    sections,
    members,
    result: null,
    runsByLoopId: runs,
    totalAvg: 400,
    buffsFor: noBuffs,
  })
}

describe('read node', () => {
  it('reads a step against the run its loop is showing', () => {
    const inner = step('inner', 100)
    const sections: EditorSection[] = [
      { id: 'main', title: 'Main', meta: '', children: [loop('loop-a', 3, [inner])] },
    ]

    const first = read('inner', sections, { 'loop-a': 1 })
    const second = read('inner', sections, { 'loop-a': 2 })

    expect(first?.run).toBe(1)
    expect(first?.figure).toBe(100)
    expect(first?.share).toBe(25)
    expect(second?.run).toBe(2)
    expect(second?.figure).toBe(200)
    expect(second?.kindLabel).toBe('step')
  })

  it('uses a support step\'s first-class color instead of its element', () => {
    const support = step('support')
    support.element = 'fusion'
    support.color = 'var(--calc-support-healing-color)'
    const sections: EditorSection[] = [
      { id: 'main', title: 'Main', meta: '', children: [support] },
    ]

    expect(read('support', sections)).toMatchObject({
      accent: 'var(--calc-support-healing-color)',
      element: 'fusion',
    })
  })

  it('takes a condition value from the run being read', () => {
    const sections: EditorSection[] = [
      { id: 'main', title: 'Main', meta: '', children: [loop('loop-a', 3, [condition('cond')])] },
    ]

    expect(read('cond', sections, { 'loop-a': 1 })?.write).toEqual({
      from: '2',
      to: '3',
      rising: true,
    })
    expect(read('cond', sections, { 'loop-a': 2 })?.write).toEqual({
      from: '1',
      to: '2',
      rising: true,
    })
  })

  it('gives a loop its per-run average and its contents', () => {
    const sections: EditorSection[] = [
      {
        id: 'main',
        title: 'Main',
        meta: '',
        children: [loop('loop-a', 2, [step('inner', 100), condition('cond')])],
      },
    ]

    const block = read('loop-a-start', sections, { 'loop-a': 1 })

    expect(block?.kindLabel).toBe('loop')
    expect(block?.blockSteps).toBe(1)
    expect(block?.items.map((item) => item.label)).toEqual(['inner', 'Molten Rift'])
    expect(block?.items[1]?.note).toBe('3')
  })

  it('counts a note\'s words and deals nothing', () => {
    const sections: EditorSection[] = [
      { id: 'main', title: 'Main', meta: '', children: [note('note-a')] },
    ]

    const read1 = read('note-a', sections)

    expect(read1?.kindLabel).toBe('note')
    expect(read1?.words).toBe(3)
    expect(read1?.figure).toBe(0)
  })

  it('returns nothing for a node that is not in the rotation', () => {
    expect(read('gone', [{ id: 'main', title: 'Main', meta: '', children: [] }])).toBeNull()
  })
})
