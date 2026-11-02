/*
  Author: Runor Ewhro
  description: preserves compatibility redirects for retired URLs.
*/

import { describe, expect, it } from 'vitest'
import {
  LEGACY_CALCULATOR_ALIAS,
  LEGACY_PROGRESSION_ALIAS,
  resolveLegacyRoute,
} from '@/shared/lib/appRoutes'

describe('legacy URL compatibility', () => {
  it('maps compatibility URLs to their intended destination', () => {
    expect(resolveLegacyRoute('/home')).toBe('/')
    expect(resolveLegacyRoute(LEGACY_PROGRESSION_ALIAS)).toBe('/modulation')
    expect(resolveLegacyRoute('/calculator/optimizer')).toBe('/optimizer')
    expect(resolveLegacyRoute('/calculator/benchmark/report')).toBe('/modulation/report')
    expect(resolveLegacyRoute('/calculator/rotation')).toBe('/rotation')
    expect(resolveLegacyRoute(LEGACY_CALCULATOR_ALIAS)).toBe('/modulation')
    expect(resolveLegacyRoute('/legacy-optimizer')).toBeNull()
  })
})
