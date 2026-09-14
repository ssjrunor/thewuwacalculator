/*
  Author: Runor Ewhro
  Description: Verifies the rotationAttached.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  attachedConditionChanges,
  featureWithAttachedConditions,
  normalizeFeatureAttachments,
  stripFeatureAttachments,
} from '@/domain/gameData/rotationAttached.ts'

const feature = (
  overrides: Partial<Extract<RotationNode, { type: 'feature' }>> = {},
): Extract<RotationNode, { type: 'feature' }> => ({
  id: 'parent',
  type: 'feature',
  featureId: 'damage:test',
  ...overrides,
})

describe('feature attachments', () => {
  it('folds legacy changes into attached.conditions', () => {
    const next = normalizeFeatureAttachments(feature({
      changes: [
        { type: 'set', path: 'runtime.foo.enabled', value: true },
        { type: 'add', path: 'runtime.foo.stacks', value: 1 },
      ],
    }))

    expect(next.changes).toBeUndefined()
    expect(next.attached?.conditions).toHaveLength(2)
    expect(next.attached?.conditions[0]).toMatchObject({
      type: 'condition',
      changes: [{ type: 'set', path: 'runtime.foo.enabled', value: true }],
    })
    expect(next.attached?.features).toEqual([])
  })

  it('strips nested attach on child features', () => {
    const next = normalizeFeatureAttachments(feature({
      attached: {
        conditions: [],
        features: [
          feature({
            id: 'child',
            changes: [{ type: 'set', path: 'runtime.bar', value: 1 }],
            attached: {
              conditions: [{
                id: 'nested',
                type: 'condition',
                changes: [{ type: 'set', path: 'runtime.nested', value: true }],
              }],
              features: [],
            },
          }),
        ],
      },
    }))

    const child = next.attached?.features[0]
    expect(child?.id).toBe('child')
    expect(child?.attached).toBeUndefined()
    expect(child?.changes).toBeUndefined()
  })

  it('writes conditions from the UI save helper and keeps sibling features', () => {
    const withFeature = feature({
      attached: {
        conditions: [],
        features: [feature({ id: 'child', featureId: 'damage:child' })],
      },
    })
    const next = featureWithAttachedConditions(withFeature, [
      { type: 'set', path: 'runtime.foo.enabled', value: true },
    ])

    expect(next.attached?.conditions).toHaveLength(1)
    expect(next.attached?.features).toHaveLength(1)
    expect(next.attached?.features[0].id).toBe('child')
    expect(attachedConditionChanges(next)).toEqual([
      { type: 'set', path: 'runtime.foo.enabled', value: true },
    ])
  })

  it('can read only enabled attached condition writes for execution projections', () => {
    const next = feature({
      attached: {
        conditions: [
          {
            id: 'enabled',
            type: 'condition',
            changes: [{ type: 'set', path: 'runtime.foo.enabled', value: true }],
          },
          {
            id: 'disabled',
            type: 'condition',
            enabled: false,
            changes: [{ type: 'set', path: 'runtime.foo.disabled', value: true }],
          },
        ],
        features: [],
      },
    })

    expect(attachedConditionChanges(next)).toHaveLength(2)
    expect(attachedConditionChanges(next, { enabledOnly: true })).toEqual([
      { type: 'set', path: 'runtime.foo.enabled', value: true },
    ])
  })

  it('stripFeatureAttachments drops both attached and legacy changes', () => {
    const stripped = stripFeatureAttachments(feature({
      changes: [{ type: 'set', path: 'runtime.foo', value: 1 }],
      attached: {
        conditions: [{
          id: 'c',
          type: 'condition',
          changes: [{ type: 'set', path: 'runtime.bar', value: true }],
        }],
        features: [],
      },
    }))
    expect(stripped.changes).toBeUndefined()
    expect(stripped.attached).toBeUndefined()
  })
})
