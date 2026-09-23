/*
  Author: Runor Ewhro
  Description: Verifies main-Echo candidate pruning preserves set coverage,
               stable dominance, required identities, and cost constraints.
*/

import { describe, expect, it } from 'vitest'
import { listChsByCos } from '@/data/catalog/echoCatalogService'
import { MAIN_BUFF_LEN } from '@/engine/optimizer/config/constants'
import { prepareMainEchoChoices } from '@/engine/evaluation/evaluation/echoDiscovery'
import type { MainEchoProfile } from '@/engine/evaluation/evaluation/stats'

function profile(id: string, sets: number[], buff: number, cost = 4): MainEchoProfile {
  const buffs = new Float32Array(MAIN_BUFF_LEN)
  buffs[0] = buff
  return {
    def: { ...listChsByCos(cost)[0], id, sets },
    buffs,
    relevant: buff !== 0,
    effectSig: buff === 0 ? 'neutral' : String(buff),
  }
}

const profiles = () => [
  profile('weak', [1, 2], 10),
  profile('strong-first', [1], 20),
  profile('strong-last', [1], 20),
  profile('neutral', [1, 2], 0),
  profile('three-cost', [2], 10, 3),
]

describe('prepared main Echo choices', () => {
  it('preserves set-specific dominance, collision order, neutral carriers and cost limits', () => {
    const select = prepareMainEchoChoices(profiles())
    const result = select([4, 3, 1], [{ setId: 1, pieces: 2 }, { setId: 2, pieces: 2 }])
    expect(result.map(({ echo }) => [echo.id, echo.set])).toEqual([
      ['weak', 2],
      ['strong-last', 1],
      ['neutral', 1],
      ['neutral', 2],
      ['three-cost', 2],
    ])
    expect(select([4, 1], []).map(({ echo }) => echo.id)).toEqual(['strong-last'])
    expect(select([1], [{ setId: 1, pieces: 5 }])).toEqual([])
    expect(select([4], [{ setId: 1, pieces: 5 }]).map(({ echo }) => echo.id))
      .toEqual(['strong-last', 'neutral'])
  })

  it('retains a required main Echo even when another Echo dominates it', () => {
    const select = prepareMainEchoChoices(profiles(), 'weak')
    expect(select([4], [{ setId: 1, pieces: 5 }]).map(({ echo }) => [echo.id, echo.set]))
      .toEqual([['weak', 1]])
    expect(select([4], []).map(({ echo }) => echo.id)).toEqual(['weak'])
    expect(select([3, 1], [])).toEqual([])
  })
})
