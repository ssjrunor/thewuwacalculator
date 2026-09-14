/*
  Author: Runor Ewhro
  Description: Verifies pass checkout logic and compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type {
  EditorBlock,
  EditorNode,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  checkinAllLoopPasses,
  checkinLoopBlock,
  checkoutLoopBlock,
  checkoutLoopPassById,
  removeFromCheckedOutPass,
  resolveEditorPassBody,
  seedLoopPassState,
} from '@/modules/simulation/features/rotation/program-editor/model/passCheckout.ts'

function step(id: string, label = id): EditorStep {
  return {
    type: 'step',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label,
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

function loop(children: EditorNode[], runs = 3): EditorBlock {
  return seedLoopPassState({
    type: 'loop',
    id: 'loop',
    loopId: 'loop-a',
    owner: { kind: 'member', memberId: 'res-a' },
    label: 'Loop',
    runs,
    nodeCount: children.length,
    children,
  })
}

function sections(block: EditorBlock): EditorSection[] {
  return [{ id: 'main', title: 'Main', meta: '', children: [block] }]
}

describe('pass checkout', () => {
  it('inherits an edited pass until a later pass diverges', () => {
    const body = [step('a'), step('b')]
    let block = loop(body, 4)

    block = checkoutLoopBlock(block, 2)
    expect(block.checkedOutRun).toBe(2)
    expect(block.children.map((node) => node.id)).toEqual(['a', 'b'])
    expect(block.passForks).toBeUndefined()

    // delete only on pass 2
    block = {
      ...block,
      children: block.children.filter((node) => node.id !== 'b'),
      nodeCount: 1,
    }
    block = checkinLoopBlock(block)
    expect(block.passForks?.[2]?.map((node) => node.id)).toEqual(['a'])

    block = checkoutLoopBlock(block, 1)
    expect(block.children.map((node) => node.id)).toEqual(['a', 'b'])

    block = checkoutLoopBlock(block, 3)
    // pass 3 has no body of its own, so it starts from the last run
    expect(block.children.map((node) => node.id)).toEqual(['a'])
    block = checkinLoopBlock(block)
    expect(block.passForks?.[3]).toBeUndefined()

    // restoring the original shape is itself a transition away from run 2
    block = {
      ...block,
      children: [step('a'), step('b')],
      nodeCount: 2,
    }
    block = checkinLoopBlock(block)
    expect(block.passForks?.[3]?.map((node) => node.id)).toEqual(['a', 'b'])

    block = checkoutLoopBlock(block, 4)
    expect(block.children.map((node) => node.id)).toEqual(['a', 'b'])
  })

  it('does not clone a loop that is already checked in', () => {
    const seeded = sections(loop([step('a'), step('b')]))
    const first = checkinAllLoopPasses(seeded)
    const second = checkinAllLoopPasses(first)

    expect(second).toBe(first)
    expect(second[0]?.children[0]).toBe(first[0]?.children[0])
  })

  it('resolves an unforked run from the nearest preceding fork', () => {
    const template = [step('a'), step('b')]
    const forks = {
      2: [step('a'), step('c')],
      5: [step('a'), step('d')],
    }
    expect(resolveEditorPassBody(template, forks, 4).map((node) => node.id))
      .toEqual(['a', 'c'])
    expect(resolveEditorPassBody(template, forks, 2).map((node) => node.id))
      .toEqual(['a', 'c'])
    expect(resolveEditorPassBody(template, forks, 1).map((node) => node.id))
      .toEqual(['a', 'b'])
    expect(resolveEditorPassBody(template, forks, 8).map((node) => node.id))
      .toEqual(['a', 'd'])
  })

  it('switches a loop in a section tree by id', () => {
    const tree = sections(loop([step('a'), step('b')]))
    const onRun2 = checkoutLoopPassById(tree, 'loop-a', 2)
    const loopBlock = onRun2[0].children[0]
    expect(loopBlock?.type).toBe('loop')
    if (loopBlock?.type !== 'loop') {
      return
    }
    expect(loopBlock.checkedOutRun).toBe(2)

    // delete only from the checked-out pass (seeds + forks immediately)
    const deleted = removeFromCheckedOutPass(onRun2, 'loop-a', 'b')
    const afterCheckin = checkoutLoopPassById(deleted, 'loop-a', 1)
    const back = afterCheckin[0].children[0]
    expect(back?.type === 'loop' ? back.children.map((node) => node.id) : null)
      .toEqual(['a', 'b'])
    const again2 = checkoutLoopPassById(afterCheckin, 'loop-a', 2)
    const pass2 = again2[0].children[0]
    expect(pass2?.type === 'loop' ? pass2.children.map((node) => node.id) : null)
      .toEqual(['a'])
  })

  it('carries a first-run edit into later unforked passes', () => {
    // passTemplate must be captured before the delete, even if the user never
    // left run 1 — otherwise the only body is wiped for every pass.
    const tree = sections(loop([step('a'), step('b'), step('c')]))
    const deleted = removeFromCheckedOutPass(tree, 'loop-a', 'b')
    const run1 = deleted[0].children[0]
    expect(run1?.type === 'loop' ? run1.children.map((n) => n.id) : null)
      .toEqual(['a', 'c'])
    expect(run1?.type === 'loop' ? run1.passTemplate?.map((n) => n.id) : null)
      .toEqual(['a', 'b', 'c'])
    expect(run1?.type === 'loop' ? run1.passForks?.[1]?.map((n) => n.id) : null)
      .toEqual(['a', 'c'])

    const run2 = checkoutLoopPassById(deleted, 'loop-a', 2)[0].children[0]
    expect(run2?.type === 'loop' ? run2.children.map((n) => n.id) : null)
      .toEqual(['a', 'c'])
  })

  it('forks a pass when only an owned note differs', () => {
    let block = checkoutLoopBlock(loop([step('a')]), 2)
    const child = block.children[0]
    if (!child || child.type !== 'step') {
      return
    }
    block = {
      ...block,
      children: [{
        ...child,
        attachedNote: { id: 'note-a', type: 'note', text: 'Run 2 timing' },
        noteEdited: true,
      }],
    }

    const checked = checkinLoopBlock(block)

    expect(checked.passForks?.[2]?.[0]).toHaveProperty(
      'attachedNote.text',
      'Run 2 timing',
    )
    expect(checked.passTemplate?.[0]).not.toHaveProperty('attachedNote')
  })

  it('forks standalone note edits without changing the shared template', () => {
    let block = checkoutLoopBlock(loop([
      { id: 'note-a', type: 'note', label: 'Before', text: 'Shared timing' },
      step('a'),
    ]), 3)
    block = {
      ...block,
      children: block.children.map((node) => (
        node.type === 'note' ? { ...node, label: 'Run three' } : node
      )),
    }

    const checked = checkinLoopBlock(block)

    expect(checked.passForks?.[3]?.[0]).toMatchObject({
      type: 'note',
      label: 'Run three',
      text: 'Shared timing',
    })
    expect(checked.passTemplate?.[0]).toMatchObject({
      type: 'note',
      label: 'Before',
      text: 'Shared timing',
    })
  })
})
