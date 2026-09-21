/*
  Author: Runor Ewhro
  Description: Verifies the relocateNodes.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type {
  EditorBlock,
  EditorNode,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import {
  collectHeldIds,
  relocateNodes,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/treeEdit.ts'

function step(id: string): EditorStep {
  return {
    type: 'step',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    index: 0,
    memberId: 'res-a',
    kindLabel: 'skill',
    multiplier: 1,
    damageByRun: {},
    statsByRun: {},
    buffCount: 0,
  }
}

function block(id: string, children: EditorNode[]): EditorBlock {
  return {
    type: 'repeat',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    runs: 2,
    nodeCount: children.length,
    children,
  }
}

function sections(children: EditorNode[]): EditorSection[] {
  return [{ id: 'main', title: 'Main', meta: '', children }]
}

const ids = (list: EditorSection[]) => list[0]!.children.map((node) => node.id)

describe('moving a selection as one', () => {
  it('lands scattered rows together in list order', () => {
    const next = relocateNodes(
      sections([step('a'), step('b'), step('c'), step('d'), step('e')]),
      new Set(['b', 'd']),
      'e',
      'after',
    )

    expect(ids(next)).toEqual(['a', 'c', 'e', 'b', 'd'])
  })

  it('keeps list order whatever order the ids arrive in', () => {
    const next = relocateNodes(
      sections([step('a'), step('b'), step('c'), step('d')]),
      new Set(['c', 'a']),
      'd',
      'after',
    )

    expect(ids(next)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('drops the set before the target when that is the edge', () => {
    const next = relocateNodes(
      sections([step('a'), step('b'), step('c'), step('d')]),
      new Set(['c', 'd']),
      'a',
      'before',
    )

    expect(ids(next)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('carries a picked block whole, and never its children twice', () => {
    const next = relocateNodes(
      sections([step('a'), block('loop', [step('x'), step('y')]), step('z')]),
      new Set(['loop', 'x', 'z']),
      'a',
      'before',
    )

    expect(ids(next)).toEqual(['loop', 'z', 'a'])
    expect((next[0]!.children[0] as EditorBlock).children.map((node) => node.id))
      .toEqual(['x', 'y'])
  })

  it('refuses a target sitting inside a block it is holding', () => {
    const before = sections([step('a'), block('loop', [step('x')]), step('b')])
    expect(relocateNodes(before, new Set(['loop', 'b']), 'x', 'after')).toBe(before)
  })

  it('refuses a target that is one of the rows in hand', () => {
    const before = sections([step('a'), step('b'), step('c')])
    expect(relocateNodes(before, new Set(['a', 'b']), 'b', 'after')).toBe(before)
  })

  it('names every row a selection would carry, children included', () => {
    const held = collectHeldIds(
      sections([step('a'), block('loop', [step('x'), block('inner', [step('y')])])]),
      new Set(['loop']),
    )

    expect([...held].sort()).toEqual(['inner', 'loop', 'x', 'y'])
  })
})
