import { describe, expect, it } from 'vitest'
import {
  createNegativeEffectConfigDraft,
  serializeNegativeEffectConfigDraft,
} from '@/modules/calculator/model/negativeEffectConfig'

describe('negative effect config helpers', () => {
  it('seeds stacks from combat state when a feature node has no explicit override', () => {
    const draft = createNegativeEffectConfigDraft(
      {
        id: 'frazzle-default',
        type: 'feature',
        featureId: 'damage:test-frazzle',
      },
      7,
    )

    expect(draft.stacksInput).toBe('7')
    expect(draft.instancesInput).toBe('1')
    expect(draft.stableWidthInput).toBe('1')
    expect(draft.stacksTouched).toBe(false)
  })

  it('can serialize a new explicit stack override even when the node started on combat state defaults', () => {
    const config = serializeNegativeEffectConfigDraft({
      stacksInput: '9',
      instancesInput: '1',
      stableWidthInput: '1',
      stacksTouched: true,
      instancesTouched: false,
      stableWidthTouched: false,
    })

    expect(config).toEqual({
      negativeEffectStacks: 9,
    })
  })

  it('omits untouched stack overrides while still serializing valid series edits', () => {
    const config = serializeNegativeEffectConfigDraft({
      stacksInput: '12',
      instancesInput: '3',
      stableWidthInput: '2',
      stacksTouched: false,
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
      stacksInput: '',
      instancesInput: 'abc',
      stableWidthInput: '2',
      stacksTouched: true,
      instancesTouched: true,
      stableWidthTouched: false,
    })

    expect(config).toEqual({})
  })
})
