import { describe, expect, it } from 'vitest'
import type { ResMenuEnt } from '@/domain/entities/resonator'
import {
  getRecs,
  orderRecs,
} from '@/modules/calculator/features/resonator/lib/recommendations'

function makeResonator(id: string): ResMenuEnt {
  return {
    id,
    displayName: id,
    rarity: 5,
    attribute: 'aero',
    weaponType: 1,
    profile: `/assets/${id}.webp`,
  }
}

describe('resonator picker recommendations', () => {
  const resonators = ['a', 'b', 'c', 'd', 'e'].map(makeResonator)

  it('preserves input order when recommended menu items are disabled', () => {
    expect(orderRecs(resonators, false, ['d', 'b'], ['c'], { c: 7 })).toEqual(resonators)
  })

  it('orders up to two frequent entries before up to two last-active entries', () => {
    expect(orderRecs(resonators, true, ['d', 'b'], ['c', 'e'], { c: 7, e: 5 }).map((entry) => entry.id))
      .toEqual(['c', 'e', 'd', 'b', 'a'])
  })

  it('keeps overlapping recent and frequent labels on the same item without backfill replacement', () => {
    expect(orderRecs(resonators, true, ['c'], ['c', 'd', 'e'], { c: 7, d: 6, e: 5 }).map((entry) => entry.id))
      .toEqual(['c', 'd', 'a', 'b', 'e'])
    expect(getRecs('c', ['c'], ['c', 'd', 'e'], { c: 7, d: 6, e: 5 })).toEqual([
      {
        kind: 'frequent',
        label: 'Active 7 times',
      },
      {
        kind: 'last-active',
        label: 'Last active',
      },
    ])
  })

  it('only recommends frequent entries when the recorded count is at least five', () => {
    expect(orderRecs(resonators, true, [], ['d', 'e'], { d: 4, e: 5 }).map((entry) => entry.id))
      .toEqual(['e', 'a', 'b', 'c', 'd'])
    expect(getRecs('d', [], ['d'], { d: 4 })).toEqual([])
    expect(getRecs('e', [], ['e'], { e: 5 })).toEqual([
      {
        kind: 'frequent',
        label: 'Active 5 times',
      },
    ])
  })

  it('does not add filtered-out recommended entries back into the result', () => {
    const filtered = resonators.filter((entry) => entry.id !== 'd')

    expect(orderRecs(filtered, true, ['d', 'b'], ['c'], { c: 7 }).map((entry) => entry.id))
      .toEqual(['c', 'b', 'a', 'e'])
  })
})
