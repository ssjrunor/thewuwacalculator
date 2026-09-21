/*
  Author: Runor Ewhro
  Description: Verifies authored and default Off-Tune cooldown landings in
               execution order, including loop-boundary behavior.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  makeOffTuneSealState,
  planOffTuneSeal,
  startOffTuneSeal,
  stepOffTuneSeal,
  type OffTuneSealState,
} from '@/engine/rotation/offTuneSeal.ts'

type FeatureNode = Extract<RotationNode, { type: 'feature' }>

const feature = (id: string, extra: Partial<FeatureNode> = {}): FeatureNode => ({
  id,
  type: 'feature',
  featureId: extra.featureId ?? `f:${id}`,
  ...extra,
})

const isBreak = (node: FeatureNode) => node.featureId === 'f:break'
const plan = (items: RotationNode[]) => planOffTuneSeal(items, isBreak)

function afterBreak(items: RotationNode[], breakId = 'break'): OffTuneSealState {
  return startOffTuneSeal(makeOffTuneSealState(plan(items)), breakId)
}

describe('Off-Tune seal execution', () => {
  it('holds three executed features after an unmarked break, so the fourth counts', () => {
    const items = [
      feature('break', { featureId: 'f:break' }),
      feature('b'),
      feature('c'),
      feature('d'),
      feature('e'),
      feature('f'),
    ]
    let state = afterBreak(items)

    for (const id of ['b', 'c', 'd']) {
      const step = stepOffTuneSeal(state, feature(id))
      expect(step.sealed).toBe(true)
      expect(step.afterBreak).toBe(true)
      state = step.state
    }

    const landing = stepOffTuneSeal(state, feature('e'))
    expect(landing.sealed).toBe(false)
    expect(landing.resume).toBe('default')
    expect(landing.afterBreak).toBe(true)

    const settled = stepOffTuneSeal(landing.state, feature('f'))
    expect(settled.afterBreak).toBe(false)
    expect(settled.resume).toBeNull()
  })

  it('stops at an authored mark before the default landing', () => {
    const items = [
      feature('break', { featureId: 'f:break' }),
      feature('b', { offTuneResume: true }),
      feature('c'),
    ]
    const landing = stepOffTuneSeal(afterBreak(items), items[1] as FeatureNode)

    expect(landing.sealed).toBe(false)
    expect(landing.resume).toBe('mark')
    expect(landing.state.active).toBe(false)
  })

  it('waits past the default when an authored mark is further down', () => {
    const items = [
      feature('break', { featureId: 'f:break' }),
      feature('b'),
      feature('c'),
      feature('d'),
      feature('e'),
      feature('f', { offTuneResume: true }),
    ]
    let state = afterBreak(items)

    for (const item of items.slice(1, 5) as FeatureNode[]) {
      const step = stepOffTuneSeal(state, item)
      expect(step.sealed).toBe(true)
      state = step.state
    }

    expect(stepOffTuneSeal(state, items[5] as FeatureNode).resume).toBe('mark')
  })

  it('associates each authored landing with its preceding break', () => {
    const result = plan([
      feature('break1', { featureId: 'f:break' }),
      feature('a'),
      feature('break2', { featureId: 'f:break' }),
      feature('b'),
      feature('c', { offTuneResume: true }),
    ])

    expect([...result.waitsForMarkedResume]).toEqual(['break2'])
  })

  it('carries the default cooldown across loop-pass document boundaries', () => {
    const items = [
      feature('a'),
      feature('b'),
      feature('break', { featureId: 'f:break' }),
    ]
    let state = afterBreak(items)

    // The next pass returns to nodes which sit before the break in the document.
    for (const id of ['a', 'b', 'a']) {
      const step = stepOffTuneSeal(state, feature(id))
      expect(step.sealed).toBe(true)
      state = step.state
    }

    expect(stepOffTuneSeal(state, feature('b')).resume).toBe('default')
  })

  it('walks nested repeat and uptime bodies when locating authored marks', () => {
    const result = plan([
      feature('break', { featureId: 'f:break' }),
      {
        id: 'block',
        type: 'repeat',
        times: 5,
        items: [{
          id: 'window',
          type: 'uptime',
          ratio: 0.5,
          items: [feature('landing', { offTuneResume: true })],
        }],
      },
    ])

    expect(result.waitsForMarkedResume.has('break')).toBe(true)
  })

  it('leaves a program with no break inactive', () => {
    const result = plan([feature('a'), feature('b', { offTuneResume: true })])
    const state = makeOffTuneSealState(result)

    expect(result.waitsForMarkedResume.size).toBe(0)
    expect(stepOffTuneSeal(state, feature('a')).afterBreak).toBe(false)
  })
})
