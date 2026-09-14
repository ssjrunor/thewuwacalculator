/*
  Author: Runor Ewhro
  Description: Verifies the clipboard.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type {
  EditorBlock,
  EditorCondition,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  canLiftNode,
  collectSubtrees,
  removeNodes,
  removeSubtrees,
} from '@/modules/simulation/features/rotation/program-editor/model/treeEdit.ts'

function step(id: string): EditorStep {
  return {
    type: 'step',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    index: 0,
    featureId: id,
    multiplier: 1,
    damageByRun: {},
    statsByRun: {},
    memberId: 'res-a',
    kindLabel: 'Skill',
    buffCount: 0,
  }
}

function condition(id: string): EditorCondition {
  return {
    type: 'condition',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    from: 'off',
    to: 'on',
    rising: true,
  }
}

function block(
  type: EditorBlock['type'],
  id: string,
  children: EditorBlock['children'],
  extra: Partial<EditorBlock> = {},
): EditorBlock {
  return {
    type,
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    runs: 1,
    nodeCount: children.length,
    children,
    ...extra,
  }
}

function section(children: EditorSection['children']): EditorSection[] {
  return [{ id: 'main', title: 'Main', meta: '', children }]
}

function idsOf(sections: EditorSection[]): string[] {
  const out: string[] = []
  const walk = (list: EditorSection['children']) => {
    for (const node of list) {
      out.push(node.id)
      if ('children' in node) {
        walk(node.children)
      }
    }
  }

  for (const entry of sections) {
    walk(entry.children)
  }

  return out
}

describe('editor clipboard targets', () => {
  it('collects in tree order and drops nodes the collected blocks already carry', () => {
    const loop = block('loop', 'loop', [step('inside'), condition('also-inside')], {
      loopId: 'loop-a',
    })
    const sections = section([step('before'), loop, step('after')])

    expect(
      collectSubtrees(sections, new Set(['after', 'inside', 'loop', 'before'])).map((node) => node.id),
    ).toEqual(['before', 'loop', 'after'])
  })

  it('takes a nested pick when its own block was not picked', () => {
    const loop = block('loop', 'loop', [step('inside')], { loopId: 'loop-a' })

    expect(
      collectSubtrees(section([loop]), new Set(['inside'])).map((node) => node.id),
    ).toEqual(['inside'])
  })

  it('refuses to lift a loop drawn in segments, whose body is split across them', () => {
    const whole = block('loop', 'whole', [step('a')], { loopId: 'loop-a' })
    const tail = block('loop', 'tail', [step('b')], { loopId: 'loop-b', wrap: 'tail' })

    expect(canLiftNode(whole)).toBe(true)
    expect(canLiftNode(step('a'))).toBe(true)
    expect(canLiftNode(tail)).toBe(false)
  })

  it('takes a cut loop away with its body, where deleting it would unwrap and keep the body', () => {
    const loop = block('loop', 'loop', [step('inside')], { loopId: 'loop-a' })
    const sections = section([step('before'), loop])

    expect(idsOf(removeSubtrees(sections, ['loop']))).toEqual(['before'])
    expect(idsOf(removeNodes(sections, ['loop']))).toEqual(['before', 'inside'])
  })

  it('leaves nodes outside a cut loop unchanged', () => {
    const loop = block('loop', 'loop', [step('inside')], { loopId: 'loop-a' })
    const outside: EditorCondition = {
      ...condition('outside'),
      sourceNode: {
        type: 'condition',
        id: 'outside',
        changes: [{ type: 'set', path: 'runtime.outside', value: true }],
      },
    }

    const remaining = removeSubtrees(section([loop, outside]), ['loop'])
    const conditionNode = remaining[0]?.children[0]

    expect(conditionNode).toEqual(outside)
  })
})
