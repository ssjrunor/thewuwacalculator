/*
  Author: Runor Ewhro
  description: verifies joint echo and sonata selection when either image match
               is uncertain.
*/

import { describe, expect, it } from 'vitest'
import type { EchoDef } from '@/domain/entities/catalog'
import { artAgrees, clearSet, pickByAgreement, pickEchoAndSet } from '@/engine/echoParser/echoPick'

const catalog = [
  { name: 'Mining Drone', cost: 1, sets: [25, 26] },
  { name: 'Flora Drone', cost: 1, sets: [29] },
  { name: 'Violet-Feathered Heron', cost: 3, sets: [2, 3] },
  { name: 'Reminiscence: Kronaclaw', cost: 3, sets: [27, 28] },
  { name: 'Lorelei', cost: 4, sets: [12] },
] as EchoDef[]

const setIds = { Halo: 25, Rite: 26, Pact: 29, Moonlit: 2, Void: 3, Trail: 27, Chroma: 28, Midnight: 12 }

describe('echo and set pick', () => {
  it('selects clear art when the set glyph is misread', () => {
    const pick = pickEchoAndSet(
      [{ key: 'Mining Drone', score: 1500 }, { key: 'Flora Drone', score: 2400 }],
      [{ name: 'Pact', score: 4600 }, { name: 'Halo', score: 4900 }, { name: 'Rite', score: 5000 }],
      catalog,
      setIds,
      1,
    )
    expect(pick).toEqual({ echoName: 'Mining Drone', setName: 'Halo', cost: 1 })
  })

  it('selects a clear set glyph when echo art is ambiguous', () => {
    const pick = pickEchoAndSet(
      [{ key: 'Violet-Feathered Heron', score: 3000 }, { key: 'Reminiscence: Kronaclaw', score: 3300 }],
      [{ name: 'Trail', score: 3700 }, { name: 'Moonlit', score: 4500 }],
      catalog,
      setIds,
      3,
    )
    expect(pick?.echoName).toBe('Reminiscence: Kronaclaw')
    expect(pick?.setName).toBe('Trail')
  })

  it('caps set colour penalties when echo art has a clear match', () => {
    const pick = pickEchoAndSet(
      [{ key: 'Mining Drone', score: 1500 }, { key: 'Flora Drone', score: 4000 }],
      [{ name: 'Pact', score: 4600 }, { name: 'Halo', score: 104000 }],
      catalog,
      setIds,
      1,
    )
    expect(pick?.echoName).toBe('Mining Drone')
  })

  it('uses a read cost and infers cost from the selected echo when absent', () => {
    const echoes = [{ key: 'Lorelei', score: 1000 }, { key: 'Mining Drone', score: 1200 }]
    const sets = [{ name: 'Midnight', score: 4000 }, { name: 'Halo', score: 4100 }]
    expect(pickEchoAndSet(echoes, sets, catalog, setIds, 1)?.echoName).toBe('Mining Drone')
    expect(pickEchoAndSet(echoes, sets, catalog, setIds, null)).toEqual({
      echoName: 'Lorelei',
      setName: 'Midnight',
      cost: 4,
    })
  })

  it('requires a larger margin for phantom art', () => {
    const pick = pickEchoAndSet(
      [{ key: 'Violet-Feathered Heron@phantom', score: 3000 }, { key: 'Reminiscence: Kronaclaw', score: 3200 }],
      [{ name: 'Trail', score: 4000 }, { name: 'Moonlit', score: 4000 }],
      catalog,
      setIds,
      3,
    )
    expect(pick?.echoName).toBe('Reminiscence: Kronaclaw')
  })

  it('returns null without a set glyph or echo candidate', () => {
    expect(pickEchoAndSet([{ key: 'Lorelei', score: 1000 }], [], catalog, setIds, 4)).toBeNull()
    expect(pickEchoAndSet([{ key: 'Lorelei', score: 1000 }], [{ name: 'Midnight', score: 4000 }], catalog, setIds, 1)).toBeNull()
  })
})

describe('art agreement', () => {
  it('keeps a pick whose art agrees on every scale', () => {
    expect(artAgrees([{ lum: 0.38, edge: 0.1, hue: 0.08 }])).toBe(true)
  })

  it('drops a pick a missing echo would leave behind', () => {
    expect(artAgrees([{ lum: 0.08, edge: -0.015, hue: 0.3 }])).toBe(false)
    expect(artAgrees([{ lum: 0.4, edge: 0.14, hue: -0.16 }])).toBe(false)
  })

  it('keeps a pick when any form agrees, and drops one with no form', () => {
    expect(artAgrees([{ lum: 0.1, edge: 0, hue: 0 }, { lum: 0.6, edge: 0.3, hue: 0.5 }])).toBe(true)
    expect(artAgrees([])).toBe(false)
  })
})

describe('art rescue', () => {
  const fae = { name: 'Fae Ignis', cost: 1, sets: [30] } as EchoDef
  const chop = { name: 'Chop Chop: Headless', cost: 1, sets: [30] } as EchoDef
  const blade = { name: 'Twin Nova: Collapsar Blade', cost: 3, sets: [26] } as EchoDef

  it('takes the glyph set only when it leads the next mark clearly', () => {
    expect(clearSet([{ name: 'Eternal Radiance', score: 941 }, { name: 'Gusts of Welkin', score: 26558 }])).toBe('Eternal Radiance')
    expect(clearSet([{ name: 'Eternal Radiance', score: 941 }, { name: 'Gusts of Welkin', score: 1200 }])).toBeNull()
    expect(clearSet([])).toBeNull()
    // scores are distances: a perfect match (0) is the clearest glyph, and two perfect matches tie
    expect(clearSet([{ name: 'Eternal Radiance', score: 0 }, { name: 'Gusts of Welkin', score: 1200 }])).toBe('Eternal Radiance')
    expect(clearSet([{ name: 'Eternal Radiance', score: 0 }, { name: 'Gusts of Welkin', score: 0 }])).toBeNull()
  })

  it('names the one echo whose art agrees outright', () => {
    const pick = pickByAgreement([
      { echo: chop, forms: [{ lum: 0.05, edge: -0.01, hue: 0.56 }] },
      { echo: fae, forms: [{ lum: 0.61, edge: 0.42, hue: 0.98 }] },
    ], 'Eternal Radiance')
    expect(pick).toEqual({ echoName: 'Fae Ignis', setName: 'Eternal Radiance', cost: 1 })
  })

  it('never takes a recolour sibling that only clears the plain floor', () => {
    expect(pickByAgreement([{ echo: blade, forms: [{ lum: 0.32, edge: 0.15, hue: 0.39 }] }], 'Rite')).toBeNull()
  })

  it('leaves the slot when a second echo also agrees', () => {
    expect(pickByAgreement([
      { echo: fae, forms: [{ lum: 0.61, edge: 0.42, hue: 0.98 }] },
      { echo: chop, forms: [{ lum: 0.4, edge: 0.12, hue: 0.2 }] },
    ], 'Eternal Radiance')).toBeNull()
  })
})
