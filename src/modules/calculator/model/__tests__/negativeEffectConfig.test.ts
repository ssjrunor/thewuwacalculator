import { describe, expect, it } from 'vitest'
import {
  makeNegDraft,
  saveNegDraft,
} from '@/modules/calculator/model/negativeEffectConfig'

describe('negative effect config helpers', () => {
  it('seeds series fields from the feature node', () => {
    const draft = makeNegDraft(
      {
        id: 'frazzle-default',
        type: 'feature',
        featureId: 'damage:test-frazzle',
        negativeEffectInstances: 4,
        negativeEffectStableWidth: 2,
      },
    )

    expect(draft.instanceInput).toBe('4')
    expect(draft.stableInput).toBe('2')
    expect(draft.instanceTouched).toBe(false)
    expect(draft.stableTouched).toBe(false)
  })

  it('does not serialize stack overrides', () => {
    const config = saveNegDraft({
      instanceInput: '1',
      stableInput: '1',
      instanceTouched: false,
      stableTouched: false,
    })

    expect(config).toEqual({})
  })

  it('serializes valid series edits', () => {
    const config = saveNegDraft({
      instanceInput: '3',
      stableInput: '2',
      instanceTouched: true,
      stableTouched: true,
    })

    expect(config).toEqual({
      negEfxNstn: 3,
      negEfxStblo2: 2,
    })
  })

  it('drops invalid edits instead of overwriting saved values', () => {
    const config = saveNegDraft({
      instanceInput: 'abc',
      stableInput: '2',
      instanceTouched: true,
      stableTouched: false,
    })

    expect(config).toEqual({})
  })
})
