/*
  Author: Runor Ewhro
  Description: Verifies flat rows logic and compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import {
  countFlatSelectedEntries,
  flatClipboardNodes,
  resolveFlatRowTarget,
  type FlatRow,
} from '@/modules/simulation/features/rotation/program-editor/presentation/flatRows.ts'

const stateRow = (
  key: string,
  nodeId: string,
  loopRuns?: Record<string, number>,
): Extract<FlatRow, { kind: 'state' }> => ({
  kind: 'state',
  key,
  writes: [],
  scope: [],
  target: { nodeId, ...(loopRuns ? { loopRuns } : {}) },
})

describe('flat selection target', () => {
  const rows = [
    stateRow('a1', 'a', { loop_1: 1 }),
    stateRow('a2', 'a', { loop_1: 2 }),
    stateRow('c', 'c'),
  ]

  it('keeps a node and resolves its currently checked-out occurrence', () => {
    expect(resolveFlatRowTarget(rows, 'a', ['a', 'b', 'c'], { loop_1: 2 }))
      .toEqual({ nodeId: 'a', loopRuns: { loop_1: 2 } })
  })

  it('walks forward and wraps to the next authored node that executed', () => {
    expect(resolveFlatRowTarget(rows, 'b', ['a', 'b', 'c'], {}))
      .toEqual({ nodeId: 'c' })
    expect(resolveFlatRowTarget(rows, 'c', ['c', 'd', 'a', 'b'], { loop_1: 1 }))
      .toEqual({ nodeId: 'c' })
    expect(resolveFlatRowTarget(rows, 'd', ['c', 'd', 'a', 'b'], { loop_1: 1 }))
      .toEqual({ nodeId: 'a', loopRuns: { loop_1: 1 } })
  })

  it('counts every painted occurrence selected by a shared node id', () => {
    const write = {
      id: 'write',
      label: 'State',
      rising: true,
      value: 'on',
    }
    const rows: FlatRow[] = [
      { ...stateRow('a1', 'a'), writes: [{ ...write, id: 'write-1' }] },
      { ...stateRow('a2', 'a'), writes: [{ ...write, id: 'write-2' }] },
      { ...stateRow('b', 'b'), writes: [{ ...write, id: 'write-3' }] },
    ]

    expect(countFlatSelectedEntries(rows, new Set(['a']))).toEqual({
      entries: 2,
      hits: 0,
      states: 2,
    })
  })

  it('copies selected execution entries in paint order, including repeated runs', () => {
    const condition = {
      type: 'condition' as const,
      id: 'a',
      owner: { kind: 'member' as const, memberId: 'res-a' },
      label: 'State',
      to: 'on',
      rising: true,
    }
    const write = { id: 'write', label: 'State', rising: true, value: 'on' }
    const rows: FlatRow[] = [
      { ...stateRow('a1', 'a'), writes: [{ ...write, id: 'write-1' }], copyNode: condition },
      { ...stateRow('b', 'b'), writes: [{ ...write, id: 'write-2' }] },
      { ...stateRow('a2', 'a'), writes: [{ ...write, id: 'write-3' }], copyNode: condition },
    ]

    expect(flatClipboardNodes(rows, new Set(['a']))).toEqual([condition, condition])
  })
})
