/*
  Author: Runor Ewhro
  Description: Verifies loop meta logic and compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import {
  makeLoopColor,
  makeLoopInfo,
  ROT_LOOP_COLORS,
} from '@/modules/simulation/features/rotation/shared/loopMeta.ts'
import type { FeatureResult, RotationNode } from '@/domain/gameData/contracts.ts'

describe('the colour a new loop takes', () => {
  it('hands out the palette in order for a rotation built loop by loop', () => {
    const next = makeLoopColor([])

    expect([next(), next(), next()]).toEqual(ROT_LOOP_COLORS.slice(0, 3))
  })

  it('skips the colours the loops already standing there are using', () => {
    const next = makeLoopColor([ROT_LOOP_COLORS[0], ROT_LOOP_COLORS[1]])

    expect(next()).toBe(ROT_LOOP_COLORS[2])
  })

  /*
    the gap a deleted loop leaves is offered again before the palette starts
    over, so a new loop never takes the colour of one beside it while a colour
    nothing is using goes spare.
  */
  it('offers a freed colour back before it repeats one in use', () => {
    const next = makeLoopColor([ROT_LOOP_COLORS[0], ROT_LOOP_COLORS[2]])

    expect(next()).toBe(ROT_LOOP_COLORS[1])
  })

  it('ignores a loop with no colour of its own', () => {
    const next = makeLoopColor([null, undefined, ''])

    expect(next()).toBe(ROT_LOOP_COLORS[0])
  })

  it('comes round again once every colour is spoken for', () => {
    const next = makeLoopColor(ROT_LOOP_COLORS)

    expect([next(), next()]).toEqual([ROT_LOOP_COLORS[0], ROT_LOOP_COLORS[1]])
  })

  it('uses only damage outputs for loop totals', () => {
    const entry = (aggregationType: FeatureResult['aggregationType'], avg: number) => ({
      id: `${aggregationType}-${avg}`,
      resonatorId: 'test',
      resonatorName: 'Test',
      aggregationType,
      normal: avg,
      crit: avg,
      avg,
      loopRuns: { loop: 1 },
    }) as unknown as FeatureResult
    const items = [
      { id: 'start', type: 'loop', kind: 'start', loopId: 'loop', runs: 1 },
      { id: 'end', type: 'loop', kind: 'end', loopId: 'loop' },
    ] as RotationNode[]

    expect(makeLoopInfo(items, [entry('damage', 100), entry('healing', 50)]).loops[0]?.totals)
      .toEqual({ normal: 100, crit: 100, avg: 100 })
  })
})
