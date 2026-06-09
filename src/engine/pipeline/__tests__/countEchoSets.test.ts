import { describe, expect, it } from 'vitest'
import type { EchoInstance } from '@/domain/entities/runtime'
import { makeEchoUid } from '@/domain/entities/runtime'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'

function echo(id: string, set: number): EchoInstance {
  return {
    uid: makeEchoUid(),
    id,
    set,
    mainEcho: false,
    mainStats: {
      primary: { key: 'critRate', value: 22 },
      secondary: { key: 'atkFlat', value: 150 },
    },
    substats: {},
  }
}

describe('countEchoSets', () => {
  it('counts unique echo ids per set independently', () => {
    // hyvatia + glamoth on set A and the same two echoes on set B -> 2pc + 2pc
    const counts = countEchoSets([
      echo('hyvatia', 1),
      echo('hyvatia', 2),
      echo('glamoth', 2),
      echo('glamoth', 1),
      null,
    ])

    expect(counts['1']).toBe(2)
    expect(counts['2']).toBe(2)
  })

  it('does not double-count a duplicate echo id within the same set', () => {
    const counts = countEchoSets([
      echo('hyvatia', 1),
      echo('hyvatia', 1),
      echo('glamoth', 1),
    ])

    // two hyvatia in set 1 collapse to one piece; glamoth adds the second
    expect(counts['1']).toBe(2)
  })

  it('ignores empty slots', () => {
    const counts = countEchoSets([null, echo('glamoth', 3), null])
    expect(counts['3']).toBe(1)
  })
})
