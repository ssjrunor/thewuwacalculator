/*
  Author: Runor Ewhro
  Description: The surface sampler ignores transparent setup pixels and keeps
               the resulting card tint dark enough for readable text.
*/

import { describe, expect, it } from 'vitest'
import { surfaceFromPortraitPixels } from '../portraitSurface.ts'

describe('surfaceFromPortraitPixels', () => {
  it('uses visible portrait pixels rather than transparent canvas space', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 0,
      0, 0, 255, 255,
    ])
    expect(surfaceFromPortraitPixels(pixels)).toBe('#080b6a')
  })

  it('has no color to apply for an empty transparent setup image', () => {
    expect(surfaceFromPortraitPixels(new Uint8ClampedArray([0, 0, 0, 0]))).toBeNull()
  })
})
