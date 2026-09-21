/*
  Author: Runor Ewhro
  Description: Verifies the sequence.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  collectRotationSubtrees,
  isRotationSequence,
  makeRotationRepeatMeta,
  type RotationSequenceNode,
} from '../sequence.ts'
import { ROT_BLOCK_COLORS } from '@/modules/simulation/surfaces/rotation/shared/containerMeta.ts'

type FeatureNode = Extract<RotationNode, { type: 'feature' }>

const feature = (id: string, resonatorId = 'res-a'): FeatureNode => ({
  id,
  type: 'feature',
  featureId: `feature:${id}`,
  resonatorId,
  enabled: true,
  multiplier: 1,
})

describe('rotation sequence boundary', () => {
  it('accepts active-resonator features and recursively nested numeric repeats', () => {
    const items: RotationNode[] = [{
      id: 'outer',
      type: 'repeat',
      times: 3,
      items: [feature('first'), {
        id: 'inner',
        type: 'repeat',
        times: 2,
        items: [feature('second')],
      }],
    }]

    expect(isRotationSequence(items, 'res-a')).toBe(true)
  })

  it.each([
    { id: 'condition', type: 'condition', changes: [] } satisfies RotationNode,
    { id: 'uptime', type: 'uptime', ratio: 0.5, items: [] } satisfies RotationNode,
    { id: 'note', type: 'note', text: 'advanced' } satisfies RotationNode,
    { id: 'loop', type: 'loop', kind: 'start', loopId: 'loop-a' } satisfies RotationNode,
    { ...feature('attached'), attached: { conditions: [], features: [feature('child')] } } satisfies RotationNode,
    { ...feature('other', 'res-b') } satisfies RotationNode,
  ])('rejects advanced authored data', (node) => {
    expect(isRotationSequence([node], 'res-a')).toBe(false)
  })

  it('collects a selected repeat once instead of also collecting selected descendants', () => {
    const child = feature('child') as RotationSequenceNode
    const sibling = feature('sibling') as RotationSequenceNode
    const repeat: RotationSequenceNode = {
      id: 'repeat',
      type: 'repeat',
      times: 2,
      items: [child],
    }

    expect(collectRotationSubtrees(
      [repeat, sibling],
      new Set(['repeat', 'child', 'sibling']),
    ).map((node) => node.id)).toEqual(['repeat', 'sibling'])
  })

  it('allocates repeat display metadata without consulting loop behavior', () => {
    const items: RotationSequenceNode[] = [{
      id: 'repeat',
      type: 'repeat',
      times: 2,
      label: 'Repeat',
      color: ROT_BLOCK_COLORS[0],
      items: [{
        id: 'nested',
        type: 'repeat',
        times: 2,
        label: 'Repeat 3',
        color: ROT_BLOCK_COLORS[2],
        items: [],
      }],
    }]

    expect(makeRotationRepeatMeta(items)).toEqual({
      label: 'Repeat 2',
      color: ROT_BLOCK_COLORS[1],
    })
  })
})
