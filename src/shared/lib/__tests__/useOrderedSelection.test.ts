/*
  Author: Runor Ewhro
  Description: Verifies the useOrderedSelection.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import { shortcutTargetIds } from '@/shared/lib/useOrderedSelection.ts'

const available = new Set(['a', 'b', 'c'])

describe('what a clipboard shortcut acts on', () => {
  it('acts on the selection while selection mode is on', () => {
    expect(shortcutTargetIds(true, ['a', 'b'], ['c'], available)).toEqual(['a', 'b'])
  })

  it('leaves selection mode with nothing picked alone', () => {
    expect(shortcutTargetIds(true, [], ['c'], available)).toEqual([])
  })

  it('falls back to the tracked entry outside selection mode', () => {
    expect(shortcutTargetIds(false, [], ['b'], available)).toEqual(['b'])
  })

  it('drops a tracked entry the surface does not offer', () => {
    expect(shortcutTargetIds(false, [], ['live'], available)).toEqual([])
  })

  it('keeps the old do-nothing answer when nothing is tracked', () => {
    expect(shortcutTargetIds(false, [], undefined, available)).toEqual([])
  })
})
