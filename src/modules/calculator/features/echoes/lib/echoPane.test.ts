import { describe, expect, it } from 'vitest'
import { makeEchoUid, type EchoInstance } from '@/domain/entities/runtime.ts'
import { cmptSetCnts } from '@/modules/calculator/features/echoes/lib/echoPane.ts'

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

describe('cmptSetCnts', () => {
  it('counts unique echo ids per set independently for the badge summary', () => {
    // hyvatia + glamoth on set 1 and the same two on set 2 -> 2pc + 2pc
    const counts = cmptSetCnts([
      echo('hyvatia', 1),
      echo('hyvatia', 2),
      echo('glamoth', 2),
      echo('glamoth', 1),
      null,
    ])

    expect(counts[1]).toBe(2)
    expect(counts[2]).toBe(2)
  })

  it('collapses a duplicate echo id within the same set', () => {
    const counts = cmptSetCnts([
      echo('hyvatia', 1),
      echo('hyvatia', 1),
      echo('glamoth', 1),
    ])

    expect(counts[1]).toBe(2)
  })
})
