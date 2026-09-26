/*
  Author: Runor Ewhro
  Description: Card files preserve an explicit Surface override while null keeps
               the portrait-derived default available after import.
*/

import { describe, expect, it } from 'vitest'
import { DEF_SHOWCASE_CARD_STYLE, DEF_SHOWCASE_HIDE } from '@/domain/entities/preferences.ts'
import { buildCardExport, parseCardImport } from '../cardTransfer.ts'

describe('showcase surface transfer', () => {
  it('retains a manual surface override in color and full-card exports', () => {
    const style = { ...DEF_SHOWCASE_CARD_STYLE, surface: '#123456' }
    for (const group of ['color', 'all'] as const) {
      const exported = JSON.parse(buildCardExport(group, style, DEF_SHOWCASE_HIDE).raw) as {
        style?: Record<string, unknown>
        data?: Record<string, unknown>
      }
      expect(exported.style?.surface ?? exported.data?.surface).toBe('#123456')
    }
  })

  it('restores a saved override while null remains the derived default', () => {
    const raw = JSON.stringify({
      app: 'thewuwacalculator',
      kind: 'card-all',
      style: { accent: '#abcdef', surface: '#123456' },
      hidden: {},
    })
    expect(parseCardImport('old-card.json', raw).stylePatch).toEqual({ accent: '#abcdef', surface: '#123456' })
    const defaults = buildCardExport('color', DEF_SHOWCASE_CARD_STYLE, DEF_SHOWCASE_HIDE)
    expect(parseCardImport(defaults.filename, defaults.raw).stylePatch?.surface).toBeNull()
  })
})
