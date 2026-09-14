/*
  Author: Runor Ewhro
  Description: Verifies the history.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type {
  EditorBlock,
  EditorCondition,
  EditorNode,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  captureRotationEditSnapshot,
  commitRotationEdit,
  emptyRotationEditHistory,
  PAGE_EDIT_HISTORY_LIMIT,
  redoRotationEdit,
  refreshRotationHistoryCursor,
  restoreRotationEditSnapshot,
  rotationEditRanAt,
  rotationEditHistoryCursor,
  rotationNodeSignatures,
  rotationSimulationKey,
  rotationStaleNodeIds,
  undoRotationEdit,
} from '@/modules/simulation/features/rotation/program-editor/interaction/history.ts'
import {
  checkoutLoopPassById,
  seedLoopPassState,
  updateCheckedOutLoopChildren,
} from '@/modules/simulation/features/rotation/program-editor/model/passCheckout.ts'

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

function condition(value = 1): EditorCondition {
  return {
    type: 'condition',
    id: 'condition-a',
    owner: { kind: 'member', memberId: 'res-a' },
    label: 'Meter',
    path: 'runtime.foo.meter',
    to: String(value),
    writeValue: value,
    writeAction: 'set',
    writeEdited: true,
    rising: true,
    change: { type: 'set', path: 'runtime.foo.meter', value },
  }
}

function section(...children: EditorNode[]): EditorSection[] {
  return [{ id: 'main', title: 'Main', meta: '', children }]
}

function splitSections(
  preamble: EditorNode[],
  main: EditorNode[],
): EditorSection[] {
  return [
    { id: 'preamble', title: 'Preamble', meta: '', children: preamble },
    { id: 'main', title: 'Main', meta: '', children: main },
  ]
}

function loop(children: EditorNode[]): EditorBlock {
  return seedLoopPassState({
    type: 'loop',
    id: 'loop-start',
    loopId: 'loop-a',
    owner: { kind: 'member', memberId: 'res-a' },
    label: 'Cycle',
    color: '#44aaaa',
    runs: 3,
    nodeCount: children.length,
    children,
  })
}

describe('rotation editor local history', () => {
  it('undoes and redoes an authored snapshot independently of persistence', () => {
    const before = section(condition(1))
    const after = section(condition(3))
    const entry = {
      label: 'Set meter',
      before: captureRotationEditSnapshot(before, {}),
      after: captureRotationEditSnapshot(after, {}),
    }
    const committed = commitRotationEdit(emptyRotationEditHistory(), entry)

    const undone = undoRotationEdit(committed)
    expect(undone.history.past).toHaveLength(0)
    expect(restoreRotationEditSnapshot(undone.snapshot!).sections[0].children[0])
      .toMatchObject({ writeValue: 1 })

    const redone = redoRotationEdit(undone.history)
    expect(redone.history.future).toHaveLength(0)
    expect(restoreRotationEditSnapshot(redone.snapshot!).sections[0].children[0])
      .toMatchObject({ writeValue: 3 })
  })

  it('drops the oldest edits once the page history cap is reached', () => {
    let history = emptyRotationEditHistory()
    for (let value = 0; value < PAGE_EDIT_HISTORY_LIMIT + 5; value += 1) {
      history = commitRotationEdit(history, {
        label: `Set ${value}`,
        before: captureRotationEditSnapshot(section(condition(value)), {}),
        after: captureRotationEditSnapshot(section(condition(value + 1)), {}),
      })
    }

    expect(history.past).toHaveLength(PAGE_EDIT_HISTORY_LIMIT)
    expect(history.past[0]?.label).toBe('Set 5')
  })

  it('shares the snapshot where consecutive history entries meet', () => {
    const first = commitRotationEdit(emptyRotationEditHistory(), {
      label: 'First',
      before: captureRotationEditSnapshot(section(condition(1)), {}),
      after: captureRotationEditSnapshot(section(condition(2)), {}),
    })
    const cursor = rotationEditHistoryCursor(first)
    const second = commitRotationEdit(first, {
      label: 'Second',
      before: cursor!,
      after: captureRotationEditSnapshot(section(condition(3)), {}),
    })

    expect(undoRotationEdit(second).snapshot).toBe(cursor)
  })

  it('restores the pass that owned a loop-specific edit', () => {
    const before = section(loop([step('hit')]))
    const runTwo = checkoutLoopPassById(before, 'loop-a', 2)
    const after = updateCheckedOutLoopChildren(runTwo, 'loop-a', (children) => [
      ...children,
      { type: 'note', id: 'note-a', text: 'Run two only' },
    ])
    const snapshot = captureRotationEditSnapshot(after, { 'loop-a': 2 })
    const restored = restoreRotationEditSnapshot(snapshot)
    const restoredLoop = restored.sections[0].children[0]

    expect(restored.runsByLoopId).toEqual({ 'loop-a': 2 })
    expect(restoredLoop?.type === 'loop' ? restoredLoop.checkedOutRun : null).toBe(2)
    expect(restoredLoop?.type === 'loop'
      ? restoredLoop.children.map((node) => node.id)
      : []).toEqual(['hit', 'note-a'])
  })

  it('restores the run date owned by each undo and redo state', () => {
    const firstKey = rotationSimulationKey(section(condition(1)), [])
    const secondKey = rotationSimulationKey(section(condition(2)), [])
    const edited = commitRotationEdit(emptyRotationEditHistory(), {
      label: 'Set meter',
      before: captureRotationEditSnapshot(section(condition(1)), {}, firstKey, 1_000),
      after: captureRotationEditSnapshot(section(condition(2)), {}, secondKey, null),
    })
    const ran = refreshRotationHistoryCursor(
      edited,
      captureRotationEditSnapshot(section(condition(2)), {}, secondKey, 2_000),
    )

    const undone = undoRotationEdit(ran)
    expect(restoreRotationEditSnapshot(undone.snapshot!).lastRanAt).toBe(1_000)

    const redone = redoRotationEdit(undone.history)
    expect(restoreRotationEditSnapshot(redone.snapshot!).lastRanAt).toBe(2_000)
  })
})

describe('rotation simulation key', () => {
  it('ignores standalone and attached notes plus presentation metadata', () => {
    const baseStep = step('hit')
    const before = section(baseStep)
    const after = section(
      {
        ...baseStep,
        label: 'Renamed display row',
        attachedNote: {
          type: 'note',
          id: 'attached-note',
          label: 'Timing',
          color: '#ff00ff',
          text: 'Delay here',
        },
        noteEdited: true,
      },
      { type: 'note', id: 'standalone-note', text: 'Section marker' },
    )

    expect(rotationSimulationKey(after, []))
      .toBe(rotationSimulationKey(before, []))
  })

  it('ignores a note-only pass fork but detects an executable pass edit', () => {
    const before = section(loop([step('hit')]))
    const runTwo = checkoutLoopPassById(before, 'loop-a', 2)
    const noted = updateCheckedOutLoopChildren(runTwo, 'loop-a', (children) => [
      ...children,
      { type: 'note', id: 'note-a', text: 'Run two only' },
    ])
    const changed = updateCheckedOutLoopChildren(runTwo, 'loop-a', (children) => [
      ...children,
      condition(2),
    ])

    expect(rotationSimulationKey(noted, [])).toBe(rotationSimulationKey(before, []))
    expect(rotationSimulationKey(changed, [])).not.toBe(rotationSimulationKey(before, []))
  })

  it('keeps a later fork that returns an inherited pass to the template', () => {
    const inherited = loop([step('base')])
    inherited.passForks = { 2: [step('changed')] }
    const restored = loop([step('base')])
    restored.passForks = {
      2: [step('changed')],
      3: [step('base')],
    }

    expect(rotationSimulationKey(section(restored), []))
      .not.toBe(rotationSimulationKey(section(inherited), []))
  })

  it('detects authored condition changes', () => {
    expect(rotationSimulationKey(section(condition(2)), []))
      .not.toBe(rotationSimulationKey(section(condition(1)), []))
  })

  it('detects when a node moves between executable sections', () => {
    const hit = step('hit')
    const inMain = splitSections([], [hit])
    const inPreamble = splitSections([hit], [])

    expect(rotationSimulationKey(inPreamble, []))
      .not.toBe(rotationSimulationKey(inMain, []))
  })

  it('matches a pre-checked-in tree without checking in again', () => {
    const tree = section(loop([step('hit')]))
    expect(rotationSimulationKey(tree, [], { checkedIn: true }))
      .toBe(rotationSimulationKey(tree, []))
  })

  it('can carry a cached simulation key on a snapshot', () => {
    const key = rotationSimulationKey(section(condition(1)), [])
    const snapshot = captureRotationEditSnapshot(section(condition(1)), {}, key)
    expect(snapshot.simulationKey).toBe(key)
  })

  it('keeps a run date for presentation-equivalent edits and clears it for execution edits', () => {
    expect(rotationEditRanAt('same', 'same', 1_000)).toBe(1_000)
    expect(rotationEditRanAt('before', 'after', 1_000)).toBeNull()
  })
})

describe('stale rotation nodes', () => {
  const staleBetween = (
    before: EditorSection[],
    after: EditorSection[],
  ): string[] => [...rotationStaleNodeIds(
    rotationNodeSignatures(after, []),
    rotationNodeSignatures(before, []),
  )].sort()

  it('marks nothing while the tree still matches the last run', () => {
    const tree = section(step('first'), condition(1), step('second'))
    expect(staleBetween(tree, tree)).toEqual([])
  })

  it('marks the edited node and leaves its neighbours alone', () => {
    const before = section(step('first'), condition(1), step('second'))
    const after = section(step('first'), condition(2), step('second'))

    expect(staleBetween(before, after)).toEqual(['condition-a'])
  })

  it('marks a node the last run never saw', () => {
    const before = section(step('first'))
    const after = section(step('first'), step('added'))

    expect(staleBetween(before, after)).toEqual(['added'])
  })

  it('marks nothing for a note-only edit, the way the run key does not move', () => {
    const baseStep = step('hit')
    const before = section(baseStep)
    const after = section(
      {
        ...baseStep,
        label: 'Renamed display row',
        attachedNote: { type: 'note', id: 'attached-note', text: 'Delay here' },
        noteEdited: true,
      },
      { type: 'note', id: 'standalone-note', text: 'Section marker' },
    )

    expect(rotationSimulationKey(after, [])).toBe(rotationSimulationKey(before, []))
    expect(staleBetween(before, after)).toEqual([])
  })

  it('marks a row inside a loop rather than the block around it', () => {
    const before = section(loop([step('hit'), condition(1)]))
    const after = section(loop([step('hit'), condition(2)]))

    expect(staleBetween(before, after)).toEqual(['condition-a'])
  })

  it('marks the loop itself when the loop is what changed', () => {
    const before = section(loop([step('hit')]))
    const spun = loop([step('hit')])
    spun.runs = 4
    const after = section(spun)

    expect(staleBetween(before, after)).toEqual(['loop-start'])
  })

  it('marks an edit made to one pass of a loop', () => {
    const before = section(loop([step('hit')]))
    const after = updateCheckedOutLoopChildren(
      checkoutLoopPassById(before, 'loop-a', 2),
      'loop-a',
      (children) => [...children, condition(2)],
    )

    expect(rotationNodeSignatures(before, []).has('condition-a')).toBe(false)
    expect(staleBetween(before, after)).toContain('condition-a')
  })

  it('marks a node moved between sections, which is a change to what it is', () => {
    const hit = step('hit')
    const inMain = splitSections([], [hit])
    const inPreamble = splitSections([hit], [])

    expect(staleBetween(inMain, inPreamble)).toEqual(['hit'])
  })

  /* the honest limit of reading one node at a time: reordering arms Run
     because the tree reads differently, but no node reads differently, so the
     band's count is the only place that can say so */
  it('leaves a reorder inside one section to the count on the band', () => {
    const before = section(step('first'), step('second'))
    const after = section(step('second'), step('first'))

    expect(rotationSimulationKey(after, []))
      .not.toBe(rotationSimulationKey(before, []))
    expect(staleBetween(before, after)).toEqual([])
  })
})
