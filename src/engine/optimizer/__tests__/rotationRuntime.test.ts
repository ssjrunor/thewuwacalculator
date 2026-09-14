/*
  Author: Runor Ewhro
  Description: Verifies the rotationRuntime.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { stripRotLoops } from '@/engine/optimizer/rotation/runtime.ts'

describe('optimizer rotation runtime', () => {
  it('strips loop markers recursively without dropping authored nodes', () => {
    const parent: RotationNode = {
      id: 'parent', type: 'feature', featureId: 'parent-skill',
      attached: {
        conditions: [{ id: 'attached-condition', type: 'condition', changes: [] }],
        features: [{ id: 'attached-feature', type: 'feature', featureId: 'child-skill' }],
      },
    }
    const items: RotationNode[] = [
      { id: 'start', type: 'loop', kind: 'start', loopId: 'loop', runs: 2 },
      {
        id: 'repeat', type: 'repeat', times: 2,
        items: [parent, { id: 'nested-end', type: 'loop', kind: 'end', loopId: 'nested' }],
      },
      { id: 'end', type: 'loop', kind: 'end', loopId: 'loop' },
    ]

    const [repeat] = stripRotLoops(items)

    expect(repeat?.type).toBe('repeat')
    if (!repeat || repeat.type !== 'repeat') throw new Error('missing repeat')
    const [clonedParent] = repeat.items
    if (!clonedParent || clonedParent.type !== 'feature') throw new Error('missing parent')

    expect(repeat.items).toHaveLength(1)
    expect(clonedParent.attached?.conditions[0]?.id).toBe('attached-condition')
    expect(clonedParent.attached?.features[0]?.featureId).toBe('child-skill')
  })
})
