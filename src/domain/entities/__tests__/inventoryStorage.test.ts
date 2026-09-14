/*
  Author: Runor Ewhro
  Description: Verifies the inventoryStorage.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { cloneRotationNodes } from '@/domain/entities/inventoryStorage.ts'

describe('cloneRotationNodes', () => {
  it('clones canonical loop forks with fresh loop and node identities', () => {
    const items: RotationNode[] = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 3,
        passForks: {
          '2': [{ id: 'fork-feature', type: 'feature', featureId: 'feature-a' }],
        },
      },
      { id: 'feature', type: 'feature', featureId: 'feature-a' },
      {
        id: 'loop-end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]

    const cloned = cloneRotationNodes(items, { freshIds: true })
    const start = cloned[0]
    const feature = cloned[1]
    const end = cloned[2]

    expect(start.type).toBe('loop')
    expect(end.type).toBe('loop')
    if (start.type !== 'loop' || end.type !== 'loop' || feature.type !== 'feature') {
      return
    }

    expect(start.loopId).not.toBe('loop-a')
    expect(end.loopId).toBe(start.loopId)
    expect(start.kind).toBe('start')
    if (start.kind !== 'start') return
    expect(start.passForks?.['2']?.[0]?.id).not.toBe('fork-feature')
    expect(start.passForks?.['2']?.[0]?.type).toBe('feature')
    expect(feature.id).not.toBe('feature')
  })

  it('gives attached feature children fresh ids inside fork bodies', () => {
    const items: RotationNode[] = [
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 2,
        passForks: { '2': [{
          id: 'parent',
          type: 'feature',
          featureId: 'feature-a',
          attached: { conditions: [], features: [{
            id: 'child',
            type: 'feature',
            featureId: 'feature-b',
          }] },
        }] },
      },
      { id: 'loop-end', type: 'loop', kind: 'end', loopId: 'loop-a' },
    ]

    const cloned = cloneRotationNodes(items, { freshIds: true })
    const start = cloned[0]
    if (start?.type !== 'loop' || start.kind !== 'start') {
      return
    }
    const parent = start.passForks?.['2']?.[0]
    if (parent?.type !== 'feature') return
    const child = parent.attached?.features[0]

    expect(parent.id).not.toBe('parent')
    expect(child?.id).not.toBe('child')
    expect(child?.featureId).toBe('feature-b')
  })

  it('gives standalone and owned notes fresh identities with the copied document', () => {
    const items: RotationNode[] = [
      { id: 'standalone-note', type: 'note', text: 'Standalone' },
      {
        id: 'feature',
        type: 'feature',
        featureId: 'feature-a',
        note: { id: 'owned-note', type: 'note', text: 'Owned' },
      },
    ]

    const cloned = cloneRotationNodes(items, { freshIds: true })
    const note = cloned[0]
    const feature = cloned[1]

    expect(note?.id).not.toBe('standalone-note')
    expect(feature?.id).not.toBe('feature')
    expect(feature?.type === 'feature' ? feature.note?.id : null).not.toBe('owned-note')
    expect(feature?.type === 'feature' ? feature.note?.text : null).toBe('Owned')
  })
})
