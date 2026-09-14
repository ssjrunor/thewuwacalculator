/*
  Author: Runor Ewhro
  Description: Verifies the rotationTotals.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { FeatureResult } from '@/domain/gameData/contracts.ts'
import {
  indexLoopDamageByRun,
  summarizeRotationEntries,
  sumRotTtls,
} from '@/engine/pipeline/rotationTotals.ts'

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
    loopRuns: { loop: 1 },
    loopRunCounts: { loop: 2 },
  } as unknown as FeatureResult
}

describe('rotation damage totals', () => {
  it('keeps healing and shield outputs as entries without making them totals', () => {
    const damage = output('damage', 'damage', 100)
    const healing = output('healing', 'healing', 50)
    const shield = output('shield', 'shield', 25)
    const entries = [damage, healing, shield]

    expect(sumRotTtls(entries)).toEqual({ normal: 50, crit: 50, avg: 50 })
    expect(summarizeRotationEntries(entries)).toEqual({
      entries,
      total: { normal: 50, crit: 50, avg: 50 },
      totalsByGroup: {
        damage: { normal: 50, crit: 50, avg: 50 },
        healing: { normal: 25, crit: 25, avg: 25 },
        shield: { normal: 12.5, crit: 12.5, avg: 12.5 },
      },
    })
    expect(indexLoopDamageByRun(entries).get('loop')).toEqual({ 1: 100 })
  })
})
