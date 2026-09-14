/*
  Author: Runor Ewhro
  Description: Protects the reading that decides which loop runs back around
               to its own start.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { findRotWrapLoop } from '@/domain/gameData/rotationLoops.ts'

const loopStart = (id: string, loopId: string): RotationNode =>
  ({ id, type: 'loop', kind: 'start', loopId, runs: 1 })

const loopEnd = (id: string, loopId: string): RotationNode =>
  ({ id, type: 'loop', kind: 'end', loopId })

const row = (id: string): RotationNode =>
  ({ id, type: 'feature', featureId: 'damage:test' })

describe('which loop runs back around to its own start', () => {
  it('reads a loop with its end below it as an ordinary loop', () => {
    expect(findRotWrapLoop([
      loopStart('start', 'loop-a'),
      row('inside'),
      loopEnd('end', 'loop-a'),
    ])).toBeNull()
  })

  it('reads a loop with no end at all as running back around', () => {
    const wrap = findRotWrapLoop([row('above'), loopStart('start', 'loop-a')])

    expect(wrap).toMatchObject({ startIndex: 1, endIndex: null })
  })

  it('reads a loop whose end stands above it as running back around', () => {
    const wrap = findRotWrapLoop([
      loopEnd('end', 'loop-a'),
      row('between'),
      loopStart('start', 'loop-a'),
    ])

    expect(wrap).toMatchObject({ startIndex: 2, endIndex: 0 })
  })

  /*
    a rotation can hold the same loop identity twice, and a later loop must
    still close at its own end rather than at the earlier one's.
  */
  it('does not pair a loop with an earlier loop of the same identity', () => {
    expect(findRotWrapLoop([
      loopStart('start-a', 'loop-a'),
      loopEnd('end-a', 'loop-a'),
      row('between'),
      loopStart('start-b', 'loop-a'),
      loopEnd('end-b', 'loop-a'),
    ])).toBeNull()
  })
})
