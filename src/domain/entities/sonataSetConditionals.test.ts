/*
  Author: Runor Ewhro
  Description: Verifies Sonata set-conditional disabled overrides used by
               suggestions and optimizer filters.
*/

import { describe, expect, it } from 'vitest'
import {
  cloneSntSet,
  DEF_SET_COND,
  getSntSetOn,
  withSntSet,
} from './sonataSetConditionals'

describe('sonata set conditionals', () => {
  it('enables newer catalog set parts by default', () => {
    const newer = [
      [30, 'snowfall'],
      [30, 'snowfallCrit'],
      [30, 'snowfallOutro'],
      [31, 'reelOfSplicedMemories5pc'],
    ] as const

    for (const [setId, partKey] of newer) {
      expect(getSntSetOn(DEF_SET_COND, setId, partKey)).toBe(true)
    }
  })

  it('stores only disabled overrides when toggling from defaults', () => {
    const disabled = withSntSet(DEF_SET_COND, [
      { setId: 30, partKey: 'snowfall', checked: false },
    ])

    expect(disabled).toEqual({
      version: 1,
      encoding: 'off-v1',
      off: { 30: ['snowfall'] },
    })
    expect(getSntSetOn(disabled, 30, 'snowfall')).toBe(false)

    const reenabled = withSntSet(disabled, [
      { setId: 30, partKey: 'snowfall', checked: true },
    ])

    expect(reenabled.off).toEqual({})
    expect(getSntSetOn(reenabled, 30, 'snowfall')).toBe(true)
  })

  it('keeps disabled defaults when cloned', () => {
    const disabled = withSntSet(DEF_SET_COND, [
      { setId: 1, partKey: 'frost5pc', checked: false },
    ])

    expect(cloneSntSet(disabled).off).toEqual({ 1: ['frost5pc'] })
  })
})
