/*
  Author: Runor Ewhro
  Description: Verifies the rotationSequence.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { mkSqnc } from '@/modules/simulation/modulation/lib/rotationSequence.ts'

describe('rotation action sequence', () => {
  it('projects attached feature hits immediately after their parent with the effective multiplier', () => {
    const items: RotationNode[] = [
      { id: 'loop-start', type: 'loop', kind: 'start', loopId: 'loop-a', runs: 2 },
      {
        id: 'parent',
        type: 'feature',
        featureId: 'parent-skill',
        multiplier: 2,
        attached: {
          conditions: [{
            id: 'parent-state',
            type: 'condition',
            changes: [{ type: 'set', path: 'runtime.foo.enabled', value: true }],
          }],
          features: [{
            id: 'child',
            type: 'feature',
            featureId: 'child-skill',
            multiplier: 3,
          }],
        },
      },
      { id: 'loop-end', type: 'loop', kind: 'end', loopId: 'loop-a' },
    ]

    const sequence = mkSqnc({ items })
    const actions = sequence.actions

    expect(actions.map((action) => action.key)).toEqual([
      'parent:parent-skill',
      'child:child-skill',
    ])
    expect(actions.map((action) => action.multiplier)).toEqual([2, 6])
    expect(actions[0]?.rules).toEqual([
      { type: 'change', change: { type: 'set', path: 'runtime.foo.enabled', value: true } },
    ])
    expect(actions[1]?.rules).toEqual([])
  })
})
