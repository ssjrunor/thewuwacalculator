/*
  Author: Runor Ewhro
  Description: Verifies the treeOps.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type {
  EditorBlock,
  EditorCondition,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  attachNote,
  cloneNode,
  detachNote,
  duplicateNodes,
  findNode,
  insertNode,
  isNodeEffectivelyDisabled,
  makeEmptyContainer,
  makeEmptyNote,
  makeNote,
  mapNode,
  moveInto,
  moveIntoMany,
  reinitializeBlock,
  relocateNode,
  removeLoopEnd,
  removeNodes,
  setAttachedMultiplier,
  setBlockExtent,
  setBlockValue,
  unwrapLoop,
  wrapNode,
  wrapNodes,
} from '@/modules/simulation/features/rotation/program-editor/model/treeEdit.ts'
import { editorSectionsToRotation } from '@/modules/simulation/features/rotation/program-editor/model/toRotationNodes.ts'
import { ROT_LOOP_COLORS } from '@/modules/simulation/features/rotation/shared/loopMeta.ts'
import { ROT_BLOCK_COLORS } from '@/modules/simulation/features/rotation/shared/containerMeta.ts'
import { ROT_NOTE_COLORS } from '@/modules/simulation/features/rotation/shared/noteMeta.ts'
import { checkoutLoopPassById } from '@/modules/simulation/features/rotation/program-editor/model/passCheckout.ts'

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
    path: `runtime.${id}`,
    from: 'off',
    to: 'on',
    writeValue: true,
    rising: true,
  }
}

function section(children: EditorSection['children']): EditorSection[] {
  return [{ id: 'main', title: 'Main', meta: '', children }]
}

describe('loop run counts', () => {
  it('discards removed copied forks so re-added runs inherit the new last run', () => {
    const copied: EditorBlock = {
      type: 'loop',
      id: 'copied-loop',
      loopId: 'copied-loop-frame',
      owner: { kind: 'member', memberId: 'former-resonator' },
      label: 'Copied loop',
      runs: 4,
      nodeCount: 1,
      passTemplate: [step('former-run-one')],
      passForks: {
        1: [step('edited-run-one')],
        2: [step('edited-run-two')],
        3: [step('former-run-three')],
        4: [step('former-run-four')],
      },
      checkedOutRun: 2,
      children: [step('edited-run-two')],
    }

    const reduced = setBlockValue(section([copied]), copied.id, 2)
    const reducedLoop = reduced[0]?.children[0]
    expect(reducedLoop?.type === 'loop' ? Object.keys(reducedLoop.passForks ?? {}) : null)
      .toEqual(['1', '2'])

    const expanded = setBlockValue(reduced, copied.id, 4)
    const runThree = checkoutLoopPassById(expanded, copied.loopId as string, 3)
    const runFour = checkoutLoopPassById(runThree, copied.loopId as string, 4)

    const runThreeLoop = runThree[0]?.children[0]
    const runFourLoop = runFour[0]?.children[0]
    expect(runThreeLoop?.type === 'loop' ? runThreeLoop.children.map((node) => node.id) : null)
      .toEqual(['edited-run-two'])
    expect(runFourLoop?.type === 'loop' ? runFourLoop.children.map((node) => node.id) : null)
      .toEqual(['edited-run-two'])
  })
})

describe('new empty containers', () => {
  it('uses the normal loop and repeat defaults before rows are added', () => {
    const loop = makeEmptyContainer(section([]), 'loop', 'res-a')
    const repeat = makeEmptyContainer(section([loop]), 'repeat', 'res-a')

    expect(loop).toMatchObject({
      type: 'loop',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Loop',
      color: ROT_LOOP_COLORS[0],
      runs: 1,
      nodeCount: 0,
      children: [],
    })
    expect(loop.loopId).toBeDefined()
    expect(repeat).toMatchObject({
      type: 'repeat',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Repeat',
      color: ROT_BLOCK_COLORS[0],
      runs: 1,
      nodeCount: 0,
      children: [],
    })
  })
})

describe('display-only notes', () => {
  it('instantiates with the next note label and colour', () => {
    const first = makeEmptyNote(section([]))
    const second = makeEmptyNote(section([
      first,
      {
        ...step('host'),
        attachedNote: makeNote('', {
          label: 'Note 2',
          color: ROT_NOTE_COLORS[1],
        }),
      },
    ]))

    expect(first).toMatchObject({
      type: 'note',
      label: 'Note',
      color: ROT_NOTE_COLORS[0],
      text: '',
    })
    expect(second).toMatchObject({
      type: 'note',
      label: 'Note 3',
      color: ROT_NOTE_COLORS[2],
      text: '',
    })
  })

  it('attaches at most one note and removes it without removing the host', () => {
    const initial = section([step('host')])
    const first = makeNote('First', { label: 'Timing' })
    const second = makeNote('Second')

    const attached = attachNote(initial, 'host', first)
    const unchanged = attachNote(attached, 'host', second)

    expect(unchanged).toBe(attached)
    expect(findNode(attached, first.id)).toEqual(first)
    expect(findNode(attached, second.id)).toBeNull()
    expect(editorSectionsToRotation(attached, [])[0]?.items[0])
      .toHaveProperty('note.text', 'First')

    const detached = detachNote(attached, 'host')
    expect(findNode(detached, 'host')).not.toBeNull()
    expect(findNode(detached, first.id)).toBeNull()
    expect(editorSectionsToRotation(detached, [])[0]?.items[0]).not.toHaveProperty('note')
  })

  it('mints note identities with standalone and host copies', () => {
    const standalone = makeNote('Standalone')
    const host = { ...step('host'), attachedNote: makeNote('Owned') }

    const noteCopy = cloneNode(standalone)
    const hostCopy = cloneNode(host)

    expect(noteCopy.id).not.toBe(standalone.id)
    expect(hostCopy.attachedNote?.id).not.toBe(host.attachedNote.id)
    expect(hostCopy.attachedNote?.text).toBe('Owned')
  })

  it('serializes generic updates to projected note fields', () => {
    const source = { id: 'note', type: 'note' as const, text: 'Before' }
    const sections = section([{
      ...source,
      sourceNode: source,
    }])

    const edited = mapNode(sections, source.id, (node) => (
      node.type === 'note' ? { ...node, text: 'After' } : node
    ))

    expect(editorSectionsToRotation(edited, [source])[0]?.items[0])
      .toEqual({ ...source, text: 'After' })
  })
})

describe('rotation editor tree moves', () => {
  it('does not delete a block when it is dropped into one of its descendants', () => {
    const inner: EditorBlock = {
      type: 'repeat',
      id: 'inner',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Inner',
      runs: 1,
      nodeCount: 1,
      children: [step('child')],
    }
    const outer: EditorBlock = {
      type: 'repeat',
      id: 'outer',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Outer',
      runs: 1,
      nodeCount: 1,
      children: [inner],
    }
    const original = section([outer])

    expect(moveInto(original, outer.id, inner.id)).toBe(original)
    expect(findNode(original, outer.id)).toBe(outer)
  })

  it('does not remove a feature when a setup branch rejects the drop', () => {
    const setup: EditorBlock = {
      type: 'setup',
      id: 'setup',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Setup',
      runs: 1,
      nodeCount: 1,
      children: [condition('condition')],
    }
    const uptime: EditorBlock = {
      type: 'uptime',
      id: 'uptime',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Uptime',
      runs: 1,
      ratio: 1,
      nodeCount: 1,
      children: [setup],
    }
    const feature = step('feature')
    const original = section([feature, uptime])

    expect(moveInto(original, feature.id, setup.id)).toBe(original)
    expect(findNode(original, feature.id)).toBe(feature)
  })

  it('keeps palette inserts, sibling moves, and wrappers out of setup branches', () => {
    const setupCondition = condition('setup-condition')
    const setup: EditorBlock = {
      type: 'setup',
      id: 'setup',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Setup',
      runs: 1,
      nodeCount: 1,
      children: [setupCondition],
    }
    const uptime: EditorBlock = {
      type: 'uptime',
      id: 'uptime',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Uptime',
      runs: 1,
      ratio: 1,
      nodeCount: 1,
      children: [setup],
    }
    const feature = step('feature')
    const original = section([feature, uptime])

    expect(relocateNode(original, feature.id, setupCondition.id, 'after')).toBe(original)
    expect(wrapNode(original, setupCondition.id, 'repeat')).toBe(original)

    const inserted = step('inserted')
    const withPaletteInsert = insertNode(original, inserted, setupCondition.id, 'main')
    expect((findNode(withPaletteInsert, setup.id) as EditorBlock).children).toEqual([setupCondition])
    expect(withPaletteInsert[0].children.at(-1)?.id).toBe(inserted.id)
  })

  it('keeps the tree intact when a stale relocate target no longer exists', () => {
    const original = section([step('a'), step('b')])

    expect(relocateNode(original, 'a', 'missing', 'after')).toBe(original)
    expect(original[0].children.map((node) => node.id)).toEqual(['a', 'b'])
  })

  it('allows a child to move to the end of its existing block', () => {
    const block: EditorBlock = {
      type: 'repeat',
      id: 'repeat',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Repeat',
      runs: 1,
      nodeCount: 2,
      children: [step('a'), step('b')],
    }
    const original = section([block])
    const moved = moveInto(original, 'a', block.id)
    const result = findNode(moved, block.id)

    expect(result?.type === 'repeat' ? result.children.map((node) => node.id) : []).toEqual(['b', 'a'])
  })

  it('persists section ownership when a node moves between sections', () => {
    const original: EditorSection[] = [
      { id: 'preamble', title: 'Preamble', meta: '', children: [step('setup')] },
      { id: 'main', title: 'Main', meta: '', children: [step('hit'), step('finish')] },
    ]
    const inPreamble = moveInto(original, 'hit', 'preamble')
    const preambleItems = editorSectionsToRotation(inPreamble, [])
      .flatMap((entry) => entry.items)

    expect(inPreamble[0]?.children.map((node) => node.id)).toEqual(['setup', 'hit'])
    expect(inPreamble[1]?.children.map((node) => node.id)).toEqual(['finish'])
    expect(preambleItems.find((node) => node.id === 'hit'))
      .toMatchObject({ editorSection: 'preamble' })

    const backInMain = moveInto(inPreamble, 'hit', 'main')
    const mainItems = editorSectionsToRotation(backInMain, [])
      .flatMap((entry) => entry.items)
    expect(mainItems.find((node) => node.id === 'hit')).not.toHaveProperty('editorSection')
  })

  it('moves a selection into an empty section in list order', () => {
    const original: EditorSection[] = [
      { id: 'preamble', title: 'Preamble', meta: '', children: [] },
      { id: 'main', title: 'Main', meta: '', children: [step('first'), step('middle'), step('last')] },
    ]

    const moved = moveIntoMany(original, new Set(['first', 'last']), 'preamble')

    expect(moved[0]?.children.map((node) => node.id)).toEqual(['first', 'last'])
    expect(moved[1]?.children.map((node) => node.id)).toEqual(['middle'])
  })

  it('removes loop markers without deleting either wrapped segment body', () => {
    const head: EditorBlock = {
      type: 'loop',
      id: 'loop:wrap',
      loopId: 'loop-a',
      wrap: 'head',
      wrapOf: 'loop',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Loop',
      runs: 2,
      nodeCount: 1,
      children: [step('head-child')],
    }
    const tail: EditorBlock = {
      type: 'loop',
      id: 'loop',
      loopId: 'loop-a',
      wrap: 'tail',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Loop',
      runs: 2,
      nodeCount: 1,
      children: [step('tail-child')],
    }
    const unwrapped = unwrapLoop(section([head, step('between'), tail]), 'loop-a')

    expect(unwrapped[0].children.map((node) => node.id)).toEqual([
      'head-child',
      'between',
      'tail-child',
    ])
  })

  it('bulk deletion unwraps selected loops and still removes selected body rows', () => {
    const loop: EditorBlock = {
      type: 'loop',
      id: 'loop',
      loopId: 'loop-a',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Loop',
      runs: 2,
      nodeCount: 2,
      children: [step('remove-me'), step('keep-me')],
    }
    const result = removeNodes(section([loop, step('after')]), [
      loop.id,
      'remove-me',
    ])

    expect(result[0].children.map((node) => node.id)).toEqual(['keep-me', 'after'])
  })

  it('wraps contiguous sibling selections as groups without double-wrapping descendants', () => {
    const parent: EditorBlock = {
      type: 'repeat',
      id: 'parent',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Parent',
      runs: 1,
      nodeCount: 1,
      children: [step('selected-child')],
    }
    const result = wrapNodes(
      section([step('a'), step('b'), step('gap'), parent]),
      new Set(['a', 'b', 'parent', 'selected-child']),
      'uptime',
    )
    const first = result[0].children[0]
    const last = result[0].children[2]

    expect(first.type).toBe('uptime')
    expect(first.type === 'uptime' ? first.children[0] : null).toMatchObject({
      type: 'setup',
      id: `${first.id}:setup`,
      children: [],
    })
    expect(first.type === 'uptime' ? first.children.slice(1).map((node) => node.id) : [])
      .toEqual(['a', 'b'])
    expect(result[0].children[1].id).toBe('gap')
    expect(last.type).toBe('uptime')
    expect(last.type === 'uptime' ? last.children.at(-1)?.id : null).toBe('parent')
    expect(findNode(result, 'selected-child')?.id).toBe('selected-child')
  })

  it('keeps an insertion after a wrapped tail inside that loop segment', () => {
    const tail: EditorBlock = {
      type: 'loop',
      id: 'loop',
      loopId: 'loop-a',
      wrap: 'tail',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Loop',
      runs: 2,
      nodeCount: 1,
      children: [step('existing')],
    }
    const inserted = step('inserted')
    const result = insertNode(section([tail]), inserted, tail.id, 'main')
    const resultTail = findNode(result, tail.id)

    expect(result[0].children.map((node) => node.id)).toEqual([tail.id])
    expect(resultTail?.type === 'loop'
      ? resultTail.children.map((node) => node.id)
      : []).toEqual(['existing', 'inserted'])
  })

  it('moves a loop end above its start as a wrap without moving the body rows', () => {
    const loop: EditorBlock = {
      type: 'loop',
      id: 'loop-start',
      loopId: 'loop-a',
      sourceNode: {
        type: 'loop',
        kind: 'start',
        id: 'loop-start',
        loopId: 'loop-a',
        runs: 2,
      },
      sourceEndNode: {
        type: 'loop',
        kind: 'end',
        id: 'loop-end',
        loopId: 'loop-a',
      },
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Loop',
      runs: 2,
      nodeCount: 1,
      children: [step('inside')],
    }
    const moved = setBlockExtent(
      section([step('before'), loop, step('after')]),
      loop.id,
      'before',
    )

    const [head, tail] = moved[0].children.filter(
      (node): node is EditorBlock => node.type === 'loop',
    )
    expect(head).toMatchObject({ wrap: 'head', loopId: 'loop-a' })
    expect(head.children.map((node) => node.id)).toEqual(['before'])
    expect(tail).toMatchObject({ id: 'loop-start', wrap: 'tail', loopId: 'loop-a' })
    expect(tail.children.map((node) => node.id)).toEqual(['inside', 'after'])

    expect(editorSectionsToRotation(moved, [])[0].items.map((node) => node.id)).toEqual([
      'before',
      'loop-end',
      'loop-start',
      'inside',
      'after',
    ])
  })

  it('places a loop end inside a nested block without swallowing the rest of that block', () => {
    const repeat: EditorBlock = {
      type: 'repeat',
      id: 'repeat',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Repeat',
      runs: 2,
      nodeCount: 2,
      children: [step('nested-target'), step('nested-after')],
    }
    const loop: EditorBlock = {
      type: 'loop',
      id: 'loop-start',
      loopId: 'loop-a',
      sourceNode: {
        type: 'loop',
        kind: 'start',
        id: 'loop-start',
        loopId: 'loop-a',
        runs: 2,
      },
      sourceEndNode: {
        type: 'loop',
        kind: 'end',
        id: 'loop-end',
        loopId: 'loop-a',
      },
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Loop',
      runs: 2,
      nodeCount: 3,
      children: [step('before-block'), repeat, step('after-block')],
    }
    const moved = setBlockExtent(section([loop]), loop.id, 'nested-target')
    const movedRepeat = findNode(moved, repeat.id)

    expect(moved[0].children.map((node) => node.id)).toEqual([
      'loop-start',
      'repeat',
      'after-block',
    ])
    expect(findNode(moved, loop.id)).toMatchObject({
      type: 'loop',
      wrap: 'tail',
      children: [{ id: 'before-block' }],
    })
    expect(movedRepeat?.type === 'repeat'
      ? movedRepeat.children.map((node) => [node.type, node.id])
      : []).toEqual([
      ['loop', 'loop-start:segment:1'],
      ['step', 'nested-after'],
    ])
    expect(movedRepeat?.type === 'repeat' && movedRepeat.children[0]?.type === 'loop'
      ? movedRepeat.children[0].children.map((node) => node.id)
      : []).toEqual(['nested-target'])

    const serialized = editorSectionsToRotation(moved, [])[0].items
    const serializedRepeat = serialized.find((node) => node.id === repeat.id)
    expect(serialized.map((node) => node.id)).toEqual([
      'loop-start',
      'before-block',
      'repeat',
      'after-block',
    ])
    expect(serializedRepeat?.type === 'repeat'
      ? serializedRepeat.items.map((node) => node.id)
      : []).toEqual([
      'nested-target',
      'loop-end',
      'nested-after',
    ])
  })

  it('places a loop end in an empty nested block through its body drop zone', () => {
    const repeat: EditorBlock = {
      type: 'repeat',
      id: 'empty-repeat',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Repeat',
      runs: 2,
      nodeCount: 0,
      children: [],
    }
    const loop: EditorBlock = {
      type: 'loop',
      id: 'loop-start',
      loopId: 'loop-a',
      sourceNode: {
        type: 'loop',
        kind: 'start',
        id: 'loop-start',
        loopId: 'loop-a',
        runs: 2,
      },
      sourceEndNode: {
        type: 'loop',
        kind: 'end',
        id: 'loop-end',
        loopId: 'loop-a',
      },
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Loop',
      runs: 2,
      nodeCount: 1,
      children: [step('inside')],
    }

    const moved = setBlockExtent(
      section([loop, repeat, step('after')]),
      loop.id,
      repeat.id,
      'inside',
    )
    const movedRepeat = findNode(moved, repeat.id)

    expect(findNode(moved, loop.id)).toMatchObject({
      type: 'loop',
      loopSegment: 'start',
      wrap: 'tail',
      children: [{ id: 'inside' }],
    })
    expect(movedRepeat?.type === 'repeat' ? movedRepeat.children : []).toMatchObject([{
      type: 'loop',
      loopSegment: 'end',
      wrap: 'head',
      children: [],
    }])

    const serialized = editorSectionsToRotation(moved, [])[0].items
    const serializedRepeat = serialized.find((node) => node.id === repeat.id)
    expect(serializedRepeat?.type === 'repeat' ? serializedRepeat.items : []).toMatchObject([{
      type: 'loop',
      kind: 'end',
      loopId: 'loop-a',
    }])
  })

  it('disables a loop marker without disabling its once-through body', () => {
    const loopChild = step('loop-child')
    const disabledLoop: EditorBlock = {
      type: 'loop',
      id: 'loop',
      loopId: 'loop-a',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Loop',
      runs: 2,
      disabled: true,
      nodeCount: 1,
      children: [loopChild],
    }
    const repeatChild = step('repeat-child')
    const disabledRepeat: EditorBlock = {
      type: 'repeat',
      id: 'repeat',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Repeat',
      runs: 2,
      disabled: true,
      nodeCount: 1,
      children: [repeatChild],
    }
    const sections = section([disabledLoop, disabledRepeat])

    expect(isNodeEffectivelyDisabled(sections, disabledLoop.id)).toBe(true)
    expect(isNodeEffectivelyDisabled(sections, loopChild.id)).toBe(false)
    expect(isNodeEffectivelyDisabled(sections, repeatChild.id)).toBe(true)
  })

})

describe('attached feature edits', () => {
  it('edits the attached node in the checked-out body directly', () => {
    const child = { ...step('child'), multiplier: 2 }
    const parent: EditorStep = {
      ...step('parent'),
      attached: [child],
    }

    const result = setAttachedMultiplier(section([parent]), parent.id, child.id, 4)
    const editedParent = findNode(result, parent.id)
    const editedChild = editedParent?.type === 'step' ? editedParent.attached?.[0] : null

    expect(editedChild?.multiplier).toBe(4)
  })
})

/*
  a loop written with a start and no end runs on round to its own start again,
  so its end is drawn where the start is: the rows above the marker are the
  last of the body, held in a segment that closes there. giving such a loop an
  end is only moving that end off the start, which is the same gesture every
  other block's closing edge takes.
*/
describe('a loop that ends where it starts', () => {
  const start = {
    type: 'loop' as const,
    kind: 'start' as const,
    id: 'loop-start',
    loopId: 'loop-a',
    runs: 2,
  }

  function segment(
    id: string,
    wrap: 'head' | 'tail',
    children: EditorBlock['children'],
  ): EditorBlock {
    return {
      type: 'loop',
      id,
      sourceNode: start,
      loopId: 'loop-a',
      wrap,
      ...(wrap === 'head' ? { wrapOf: start.id } : {}),
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Loop',
      runs: 2,
      nodeCount: children.length,
      children,
    }
  }

  /** the marker with one row above it and two below, as the page draws it */
  function noEndLoop(): EditorSection[] {
    return section([
      segment('loop-start:wrap', 'head', [step('above')]),
      segment(start.id, 'tail', [step('inside'), step('after')]),
    ])
  }

  it('takes an end wherever it is dropped, letting the rows above the start go', () => {
    const moved = setBlockExtent(noEndLoop(), start.id, 'inside')
    const loop = findNode(moved, start.id)

    expect(moved[0].children.map((node) => node.id)).toEqual(['above', start.id, 'after'])
    expect(loop).toMatchObject({ type: 'loop', loopSegment: 'both', wrap: undefined })
    expect(loop?.type === 'loop' ? loop.children.map((node) => node.id) : []).toEqual(['inside'])

    expect(editorSectionsToRotation(moved, [])[0].items.map((node) => node.id)).toEqual([
      'above',
      'loop-start',
      'inside',
      'loop-start:end',
      'after',
    ])
  })

  /*
    written out, the end it already had is the marker standing before the
    start, so the loop it round trips through is the same loop drawn the same
    way rather than one that lost a body.
  */
  it('writes the end it is drawn with before its start until one is placed', () => {
    expect(editorSectionsToRotation(noEndLoop(), [])[0].items.map((node) => node.id)).toEqual([
      'above',
      'loop-start:end',
      'loop-start',
      'inside',
      'after',
    ])
  })

  it('keeps the end where the closing segment stops when it is dropped back on it', () => {
    const moved = setBlockExtent(noEndLoop(), start.id, 'loop-start:wrap', 'inside')
    const [head, tail] = moved[0].children.filter(
      (node): node is EditorBlock => node.type === 'loop',
    )

    expect(head).toMatchObject({ loopSegment: 'end', wrap: 'head' })
    expect(head.children.map((node) => node.id)).toEqual(['above'])
    expect(tail).toMatchObject({ id: start.id, loopSegment: 'start', wrap: 'tail' })
    expect(tail.children.map((node) => node.id)).toEqual(['inside', 'after'])
  })

  it('places the end inside a loop that starts outside it', () => {
    const other: EditorBlock = {
      type: 'loop',
      id: 'other-start',
      loopId: 'loop-b',
      sourceNode: {
        type: 'loop',
        kind: 'start',
        id: 'other-start',
        loopId: 'loop-b',
        runs: 3,
      },
      sourceEndNode: { type: 'loop', kind: 'end', id: 'other-end', loopId: 'loop-b' },
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Other',
      runs: 3,
      nodeCount: 2,
      children: [step('b-1'), step('b-2')],
    }
    const moved = setBlockExtent(
      section([other, segment(start.id, 'tail', [step('inside')])]),
      start.id,
      'b-1',
    )
    const movedOther = findNode(moved, other.id)

    expect(movedOther?.type === 'loop'
      ? movedOther.children.map((node) => [node.type, node.id])
      : []).toEqual([
      ['loop', 'loop-start:segment:1'],
      ['step', 'b-2'],
    ])
    expect(findNode(moved, start.id)).toMatchObject({ loopSegment: 'start', wrap: 'tail' })

    // the two loops cross rather than nest: each marker keeps its own place
    expect(editorSectionsToRotation(moved, [])[0].items.map((node) => node.id)).toEqual([
      'other-start',
      'b-1',
      'loop-start:end',
      'b-2',
      'other-end',
      'loop-start',
      'inside',
    ])
  })
})

describe('the colour a wrapped loop takes', () => {
  it('gives each loop the next colour nothing else is using', () => {
    const first = wrapNode(section([step('a'), step('b')]), 'a', 'loop')
    const firstLoop = first[0].children[0]
    expect(firstLoop.type === 'loop' ? firstLoop.color : null).toBe(ROT_LOOP_COLORS[0])

    const second = wrapNode(first, 'b', 'loop')
    const secondLoop = second[0].children[1]
    expect(secondLoop.type === 'loop' ? secondLoop.color : null).toBe(ROT_LOOP_COLORS[1])
  })

  it('keeps two loops wrapped in one go apart from each other', () => {
    const wrapped = wrapNodes(
      section([step('a'), step('gap'), step('b')]),
      new Set(['a', 'b']),
      'loop',
    )
    const colors = wrapped[0].children
      .filter((node): node is EditorBlock => node.type === 'loop')
      .map((node) => node.color)

    expect(colors).toEqual([ROT_LOOP_COLORS[0], ROT_LOOP_COLORS[1]])
  })

  it('gives repeat and uptime blocks their own generated labels and colours', () => {
    const withRepeat = wrapNode(section([step('a'), step('b')]), 'a', 'repeat')
    const repeat = withRepeat[0].children[0]

    expect(repeat).toMatchObject({
      type: 'repeat',
      label: 'Repeat',
      color: ROT_BLOCK_COLORS[0],
    })

    const withUptime = wrapNode(withRepeat, 'b', 'uptime')
    const uptime = withUptime[0].children[1]

    expect(uptime).toMatchObject({
      type: 'uptime',
      label: 'Uptime',
      color: ROT_BLOCK_COLORS[1],
    })
    expect(uptime.type === 'uptime' ? uptime.children[0] : null).toMatchObject({
      type: 'setup',
      id: `${uptime.id}:setup`,
      children: [],
    })
  })
})

describe('reinitializing a block type', () => {
  it('keeps the frame and body while starting every block setting over', () => {
    const setup: EditorBlock = {
      type: 'setup',
      id: 'window:setup',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Setup',
      runs: 1,
      nodeCount: 1,
      children: [condition('setup-condition')],
    }
    const body = step('body')
    const original: EditorBlock = {
      type: 'uptime',
      id: 'window',
      sourceNode: {
        type: 'uptime',
        id: 'window',
        ratio: 0.25,
        items: [],
      },
      owner: { kind: 'member', memberId: 'res-a' },
      ownerEdited: true,
      label: 'Burst window',
      color: '#d8963f',
      runs: 6,
      ratio: 0.25,
      ratioByRun: { 1: 0.25, 2: 0.5 },
      valueEdited: true,
      disabled: true,
      nodeCount: 2,
      children: [setup, body],
    }

    const asRepeat = reinitializeBlock(section([original]), original.id, 'repeat')
    const repeat = findNode(asRepeat, original.id)

    expect(repeat).toMatchObject({
      type: 'repeat',
      id: original.id,
      label: original.label,
      color: original.color,
      runs: 1,
      nodeCount: 1,
      children: [body],
      sourceNode: { type: 'repeat', times: 1, items: [], enabled: true },
    })
    expect(repeat).not.toHaveProperty('ratio')
    expect(repeat).not.toHaveProperty('disabled')
    expect(repeat).not.toHaveProperty('ownerEdited')
    expect(repeat).not.toHaveProperty('valueEdited')
    expect(reinitializeBlock(asRepeat, original.id, 'repeat')).toBe(asRepeat)

    const asUptime = reinitializeBlock(asRepeat, original.id, 'uptime')
    const uptime = findNode(asUptime, original.id)
    expect(uptime).toMatchObject({
      type: 'uptime',
      id: original.id,
      label: original.label,
      color: original.color,
      runs: 1,
      ratio: 1,
      nodeCount: 2,
      sourceNode: { type: 'uptime', ratio: 1, setup: [], items: [], enabled: true },
    })
    expect(uptime?.type === 'uptime' ? uptime.children[0] : null).toMatchObject({
      type: 'setup',
      id: `${original.id}:setup`,
      children: [],
    })
    expect(uptime?.type === 'uptime' ? uptime.children[1] : null).toBe(body)

    const [serialized] = editorSectionsToRotation(asUptime, [original.sourceNode!])[0].items
    expect(serialized).toMatchObject({
      type: 'uptime',
      id: original.id,
      label: original.label,
      color: original.color,
      ratio: 1,
      setup: [],
      items: [{ id: body.id }],
      enabled: true,
    })
    expect(serialized).not.toHaveProperty('resonatorId')
    expect(serialized).not.toHaveProperty('when')
  })
})

describe('copying a loop', () => {
  const original: EditorBlock = {
    type: 'loop',
    id: 'loop-start',
    loopId: 'loop-a',
    sourceNode: {
      type: 'loop',
      kind: 'start',
      id: 'loop-start',
      loopId: 'loop-a',
      runs: 2,
    },
    owner: { kind: 'member', memberId: 'res-a' },
    label: 'Loop',
    runs: 2,
    color: ROT_LOOP_COLORS[0],
    nodeCount: 1,
    children: [{
      ...step('inside'),
      sourceNode: { type: 'feature', id: 'inside', featureId: 'inside' },
    }],
  }

  /*
    two loops written with one identity read as one loop closing before it
    opens, which is a different rotation from the one that was copied.
  */
  it('gives the copy a loop of its own', () => {
    const copy = cloneNode(original)

    expect(copy.type).toBe('loop')
    if (copy.type !== 'loop') {
      return
    }
    expect(copy.id).not.toBe(original.id)
    expect(copy.loopId).toBeDefined()
    expect(copy.loopId).not.toBe(original.loopId)
    // the markers it was drawn from belong to the loop it was copied from
    expect(copy.sourceNode).toBeUndefined()
    expect(copy.sourceEndNode).toBeUndefined()
  })

  it('arrives whole, never as a piece of the loop it came from', () => {
    const copy = cloneNode({ ...original, wrap: 'tail', loopSegment: 'start' })

    expect(copy.type === 'loop' ? copy.wrap : 'unset').toBeUndefined()
    expect(copy.type === 'loop' ? copy.loopSegment : 'unset').toBeUndefined()
  })

  it('writes the two loops as two pairs of markers', () => {
    const pasted = section([original, cloneNode(original)])
    const serialized = editorSectionsToRotation(pasted, [])[0].items
    const loopIds = serialized.flatMap((node) =>
      node.type === 'loop' ? [`${node.kind}:${node.loopId}`] : [])

    expect(loopIds).toHaveLength(4)
    expect(new Set(loopIds).size).toBe(4)
  })
})

describe('taking a loop end away', () => {
  function bounded(): EditorSection[] {
    return section([
      step('above'),
      {
        type: 'loop',
        id: 'loop-start',
        loopId: 'loop-a',
        sourceNode: {
          type: 'loop',
          kind: 'start',
          id: 'loop-start',
          loopId: 'loop-a',
          runs: 2,
        },
        sourceEndNode: { type: 'loop', kind: 'end', id: 'loop-end', loopId: 'loop-a' },
        owner: { kind: 'member', memberId: 'res-a' },
        label: 'Loop',
        runs: 2,
        color: ROT_LOOP_COLORS[0],
        nodeCount: 1,
        children: [step('inside')],
      },
      step('after'),
    ])
  }

  /*
    the end does not vanish: the loop still stops somewhere, and where it stops
    is the row above its own start. so it is drawn in the two pieces a loop
    that runs back around is drawn in.
  */
  it('leaves the loop running back around to its own start', () => {
    const opened = removeLoopEnd(bounded(), 'loop-a')
    const [head, tail] = opened[0].children.filter(
      (node): node is EditorBlock => node.type === 'loop',
    )

    expect(head).toMatchObject({ wrap: 'head', noEnd: true })
    expect(head.children.map((node) => node.id)).toEqual(['above'])
    expect(tail).toMatchObject({ id: 'loop-start', wrap: 'tail', noEnd: true })
    expect(tail.children.map((node) => node.id)).toEqual(['inside', 'after'])
  })

  it('writes it out with no end marker at all', () => {
    const items = editorSectionsToRotation(removeLoopEnd(bounded(), 'loop-a'), [])[0].items

    expect(items.map((node) => node.id)).toEqual(['above', 'loop-start', 'inside', 'after'])
    expect(items.filter((node) => node.type === 'loop')).toHaveLength(1)
  })

  it('gives the end back when it is dragged somewhere again', () => {
    const opened = removeLoopEnd(bounded(), 'loop-a')
    const closed = setBlockExtent(opened, 'loop-start', 'inside')
    const items = editorSectionsToRotation(closed, [])[0].items

    expect(findNode(closed, 'loop-start')).toMatchObject({ noEnd: undefined })
    expect(items.map((node) => node.id)).toEqual([
      'above',
      'loop-start',
      'inside',
      'loop-start:end',
      'after',
    ])
  })
})

describe('duplicating rows on the page', () => {
  it('stands a copy of every named row directly after it', () => {
    const duplicated = duplicateNodes(
      section([step('a'), step('b'), step('c')]),
      new Set(['a', 'c']),
    )
    const ids = duplicated[0].children.map((node) => node.id)

    expect(ids).toHaveLength(5)
    expect([ids[0], ids[2], ids[3]]).toEqual(['a', 'b', 'c'])
    expect(ids[1]).not.toBe('a')
    expect(ids[4]).not.toBe('c')
  })

  it('gives a copied loop an identity of its own', () => {
    const loop: EditorBlock = {
      type: 'loop',
      id: 'loop-start',
      loopId: 'loop-a',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Loop',
      runs: 2,
      nodeCount: 1,
      children: [step('inside')],
    }
    const duplicated = duplicateNodes(section([loop]), new Set(['loop-start']))
    const [first, copy] = duplicated[0].children.filter(
      (node): node is EditorBlock => node.type === 'loop',
    )

    expect(copy.id).not.toBe(first.id)
    expect(copy.loopId).not.toBe(first.loopId)
    expect(copy.children.map((node) => node.id)).toHaveLength(1)
    expect(copy.children[0].id).not.toBe('inside')
  })

  it('gives attached feature children fresh ids when copying a parent step', () => {
    const childSource = {
      type: 'feature' as const,
      id: 'child',
      featureId: 'child-skill',
    }
    const child: EditorStep = {
      ...step('child'),
      featureId: childSource.featureId,
      sourceNode: childSource,
    }
    const parentSource = {
      type: 'feature' as const,
      id: 'parent',
      featureId: 'parent-skill',
      attached: { conditions: [], features: [childSource] },
    }
    const parent: EditorStep = {
      ...step('parent'),
      featureId: parentSource.featureId,
      sourceNode: parentSource,
      attached: [child],
    }

    const copy = cloneNode(parent)

    expect(copy.type).toBe('step')
    if (copy.type !== 'step') {
      return
    }
    expect(copy.id).not.toBe(parent.id)
    expect(copy.attachedEdited).toBe(true)
    expect(copy.attached?.[0]?.id).not.toBe(child.id)
    expect(copy.attached?.[0]?.sourceNode).toMatchObject({ featureId: 'child-skill' })
  })

  it('leaves a piece of a loop drawn in segments where it is', () => {
    const tail: EditorBlock = {
      type: 'loop',
      id: 'loop-start',
      loopId: 'loop-a',
      wrap: 'tail',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Loop',
      runs: 2,
      nodeCount: 1,
      children: [step('inside')],
    }
    const sections = section([tail])

    expect(duplicateNodes(sections, new Set(['loop-start']))).toBe(sections)
  })

  it('leaves the tree alone when nothing is named', () => {
    const sections = section([step('a')])

    expect(duplicateNodes(sections, new Set())).toBe(sections)
  })
})
