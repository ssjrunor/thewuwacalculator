/*
  Author: Runor Ewhro
  description: verifies that displayed contribution filters ownership and averages nested loop passes.
*/

import { describe, expect, it } from 'vitest'
import type { FeatureResult } from '@/domain/gameData/contracts'
import { scoredContribution } from '../execute'

function row(resonatorId: string, avg: number, loops?: Record<string, number>, tab = 'basicAttack'): FeatureResult {
  return { resonatorId, aggregationType: 'damage', avg, normal: avg, crit: avg, loopRunCounts: loops,
    skill: { id: 'hit', label: 'Hit', tab, skillType: ['basicAtk'] } } as FeatureResult
}

describe('displayed scoring contribution', () => {
  it('excludes teammates and shared Tune Break while normalizing each loop independently', () => {
    const result = scoredContribution([
      row('1512', 10), row('1512', 100, { main: 2 }), row('1512', 100, { main: 2 }),
      row('1512', 600, { main: 2, nested: 3 }), row('1512', 900, {}, 'tuneBreak'), row('1311', 5000),
    ], '1512')
    expect(result.damage).toBe(210)
    expect(result.features).toEqual([expect.objectContaining({ resonatorId: '1512', damage: 210, sharePct: 100 })])
  })

  it('matches Rover forms by canonical identity', () => {
    expect(scoredContribution([row('1502', 80, { main: 4 }), row('1501', 5), row('1311', 1000)], '1501').damage).toBe(25)
  })
})
