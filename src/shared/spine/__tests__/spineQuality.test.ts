/*
  Author: Runor Ewhro
  description: keeps display derivatives separate from full-resolution export assets.
*/

import { describe, expect, it } from 'vitest'
import { spineDisplayTextureUrl } from '../spineQuality.ts'
import { spineBaseUrl, spineSetupUrl } from '../spineManifest.ts'

describe('Spine display and export asset contracts', () => {
  it.each(['portrait', 'luckdraw'] as const)('separates %s display and export images', (variant) => {
    expect(spineSetupUrl('1506', variant)).toBe(`/assets/game/resonators/spine/setup/display/${variant}/1506.webp`)
    expect(spineSetupUrl('1506', variant, 'export')).toBe(`/assets/game/resonators/spine/setup/${variant}/1506.webp`)
    expect(spineDisplayTextureUrl(spineBaseUrl('1506', variant), 'texture-1.webp'))
      .toBe(`/assets/game/resonators/spine/${variant}/1506/display/texture-1.webp`)
  })
})
