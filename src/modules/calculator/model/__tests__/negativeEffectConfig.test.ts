import { describe, expect, it } from 'vitest'
import {
  createNegativeEffectConfigDraft,
  serializeNegativeEffectConfigDraft,
} from '@/modules/calculator/model/negativeEffectConfig'

describe('negative effect config helpers', () => {
  it('seeds series fields from the feature node', () => {
    const draft = createNegativeEffectConfigDraft(
      {
        id: 'frazzle-default',
        type: 'feature',
        featureId: 'damage:test-frazzle',
        negativeEffectInstances: 4,
        negativeEffectStableWidth: 2,
      },
    )

    expect(draft.instancesInput).toBe('4')
    expect(draft.stableWidthInput).toBe('2')
    expect(draft.instancesTouched).toBe(false)
    expect(draft.stableWidthTouched).toBe(false)
  })

  it('does not serialize stack overrides', () => {
    const config = serializeNegativeEffectConfigDraft({
      instancesInput: '1',
      stableWidthInput: '1',
      instancesTouched: false,
      stableWidthTouched: false,
    })

    expect(config).toEqual({})
  })

  it('serializes valid series edits', () => {
    const config = serializeNegativeEffectConfigDraft({
      instancesInput: '3',
      stableWidthInput: '2',
      instancesTouched: true,
      stableWidthTouched: true,
    })

    expect(config).toEqual({
      negativeEffectInstances: 3,
      negativeEffectStableWidth: 2,
    })
  })

  it('drops invalid edits instead of overwriting saved values', () => {
    const config = serializeNegativeEffectConfigDraft({
      instancesInput: 'abc',
      stableWidthInput: '2',
      instancesTouched: true,
      stableWidthTouched: false,
    })

    expect(config).toEqual({})
  })
})
