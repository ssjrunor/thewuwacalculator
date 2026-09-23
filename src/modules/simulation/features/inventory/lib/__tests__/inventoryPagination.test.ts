/*
  Author: Runor Ewhro
  Description: Verifies grouped inventory pagination preserves source ordering,
               counts, page bounds, and stale-page clamping.
*/

import { describe, expect, it } from 'vitest'
import { paginateInventoryGroups } from '../inventory.ts'

describe('inventory pagination', () => {
  it('bounds rendered entries while preserving group order and full counts', () => {
    const groups = [
      { id: 'a', entries: Array.from({ length: 40 }, (_, index) => `a-${index}`) },
      { id: 'b', entries: Array.from({ length: 40 }, (_, index) => `b-${index}`) },
    ]

    const page = paginateInventoryGroups(groups, 1, 48)

    expect(page.page).toBe(1)
    expect(page.pageCount).toBe(2)
    expect(page.start).toBe(48)
    expect(page.end).toBe(80)
    expect(page.groups).toEqual([{
      id: 'b',
      entries: Array.from({ length: 32 }, (_, index) => `b-${index + 8}`),
      totalEntries: 40,
    }])
  })

  it('clamps a stale page after filtering removes entries', () => {
    const page = paginateInventoryGroups([{ id: 'a', entries: ['only'] }], 9, 48)

    expect(page.page).toBe(0)
    expect(page.pageCount).toBe(1)
    expect(page.groups[0]?.entries).toEqual(['only'])
  })
})
