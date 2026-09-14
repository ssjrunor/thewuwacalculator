/*
  Author: Runor Ewhro
  Description: Verifies the nodeTools.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { FeatureResult, RotationNode } from '@/domain/gameData/contracts.ts'
import { getNodeTotals } from '@/modules/simulation/features/rotation/shared/nodeTools.ts'

function output(
  id: string,
  aggregationType: FeatureResult['aggregationType'],
  avg: number,
): FeatureResult {
  return {
    id,
    resonatorId: 'test',
    resonatorName: 'Test',
    aggregationType,
    normal: avg,
    crit: avg,
    avg,
  } as unknown as FeatureResult
}

describe('rotation node totals', () => {
  it('keeps a support feature visible but excludes it from its block total', () => {
    const support = { id: 'support', type: 'feature' } as RotationNode
    const damage = { id: 'damage', type: 'feature' } as RotationNode
    const block = {
      id: 'block',
      type: 'repeat',
      items: [support, damage],
    } as RotationNode
    const resultMap = new Map([
      ['support', [output('healing', 'healing', 50)]],
      ['damage', [output('damage', 'damage', 100)]],
    ])

    expect(getNodeTotals(support, resultMap).avg).toBe(50)
    expect(getNodeTotals(block, resultMap)).toMatchObject({ normal: 100, crit: 100, avg: 100 })
  })
})
