import { describe, expect, it } from 'vitest'
import {
  buildTailComboIndexing,
  unrankCombinadic,
} from '@/engine/optimizer/combos/combinadic.ts'

describe('optimizer combinadic', () => {
  it('builds tail combinations excluding the selected main index', () => {
    const indexing = buildTailComboIndexing(6, 2)

    expect(indexing.comboN).toBe(5)
    expect(indexing.comboK).toBe(4)
    expect(indexing.totalCombos).toBe(5)

    const combos = Array.from({ length: indexing.totalCombos }, (_, rank) =>
      Array.from(unrankCombinadic(rank, indexing)),
    )

    expect(combos).toEqual([
      [0, 1, 3, 4],
      [0, 1, 3, 5],
      [0, 1, 4, 5],
      [0, 3, 4, 5],
      [1, 3, 4, 5],
    ])
  })
})
