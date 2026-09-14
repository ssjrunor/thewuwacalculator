/*
  Author: Runor Ewhro
  Description: Verifies the loopPasses.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  migrateLegacyRotationItems,
  resolveLoopPassBody,
  rotationBodiesEqual,
} from '@/domain/gameData/loopPasses.ts'

function legacy(items: unknown[]): RotationNode[] {
  return items as RotationNode[]
}

function feature(
  id: string,
  options: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, type: 'feature', featureId: id, ...options }
}

function startOf(items: RotationNode[], loopId: string) {
  return items.find((node): node is Extract<RotationNode, { type: 'loop'; kind: 'start' }> =>
    node.type === 'loop' && node.kind === 'start' && node.loopId === loopId)
}

function containsLegacyWhen(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsLegacyWhen)
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Object.prototype.hasOwnProperty.call(record, 'when')
    || Object.values(record).some(containsLegacyWhen)
}

describe('loop pass bodies', () => {
  it('inherits the nearest preceding fork until a later run replaces it', () => {
    const template = legacy([feature('a'), feature('b')])
    const forks = {
      '2': legacy([feature('a'), feature('c')]),
      '5': legacy([feature('a'), feature('d')]),
    }
    expect(resolveLoopPassBody(template, forks, 1)).toBe(template)
    expect(resolveLoopPassBody(template, forks, 2)).toBe(forks['2'])
    expect(resolveLoopPassBody(template, forks, 4)).toBe(forks['2'])
    expect(resolveLoopPassBody(template, forks, 5)).toBe(forks['5'])
    expect(resolveLoopPassBody(template, forks, 8)).toBe(forks['5'])
  })

  it('migrates bounded rules into transition forks, including a return body', () => {
    const migrated = migrateLegacyRotationItems(legacy([
      { id: 'start', type: 'loop', kind: 'start', loopId: 'loop-a', runs: 3 },
      feature('always'),
      feature('run-1-only', {
        when: { loops: [{ loopId: 'loop-a', runs: [1] }] },
      }),
      feature('scaled', {
        multiplier: 1,
        when: { overrides: [{ runs: { 'loop-a': 2 }, multiplier: 3 }] },
      }),
      { id: 'end', type: 'loop', kind: 'end', loopId: 'loop-a' },
    ]))

    const start = startOf(migrated, 'loop-a')
    expect(start?.passForks?.['2']?.map((node) => node.id))
      .toEqual(['always', 'scaled'])
    const scaled = start?.passForks?.['2']?.find((node) => node.id === 'scaled')
    expect(scaled?.type === 'feature' ? scaled.multiplier : null).toBe(3)
    expect(start?.passForks?.['3']?.map((node) => node.id))
      .toEqual(['always', 'scaled'])
    const restored = start?.passForks?.['3']?.find((node) => node.id === 'scaled')
    expect(restored?.type === 'feature' ? restored.multiplier : null).toBe(1)
    expect(containsLegacyWhen(migrated)).toBe(false)
  })

  it('waits for all nested loop coordinates before materializing an override', () => {
    const migrated = migrateLegacyRotationItems(legacy([
      { id: 'outer-start', type: 'loop', kind: 'start', loopId: 'outer', runs: 2 },
      { id: 'inner-start', type: 'loop', kind: 'start', loopId: 'inner', runs: 2 },
      feature('hit', {
        multiplier: 1,
        when: { overrides: [{ runs: { outer: 2, inner: 2 }, multiplier: 4 }] },
      }),
      { id: 'inner-end', type: 'loop', kind: 'end', loopId: 'inner' },
      { id: 'outer-end', type: 'loop', kind: 'end', loopId: 'outer' },
    ]))
    const outer = startOf(migrated, 'outer')
    const outerRun2 = outer?.passForks?.['2']
    const inner = outerRun2?.find((node) =>
      node.type === 'loop' && node.kind === 'start' && node.loopId === 'inner')
    const hit = inner?.type === 'loop' && inner.kind === 'start'
      ? inner.passForks?.['2']?.find((node) => node.id === 'hit')
      : undefined
    expect(hit?.type === 'feature' ? hit.multiplier : null).toBe(4)
    expect(containsLegacyWhen(migrated)).toBe(false)
  })

  it('migrates wrap-around run rules into circular pass forks', () => {
    const migrated = migrateLegacyRotationItems(legacy([
      feature('head', { when: { loops: [{ loopId: 'wrap', runs: [2] }] } }),
      { id: 'end', type: 'loop', kind: 'end', loopId: 'wrap' },
      { id: 'start', type: 'loop', kind: 'start', loopId: 'wrap', runs: 2 },
      feature('tail', { when: { loops: [{ loopId: 'wrap', runs: [2] }] } }),
    ]))
    const start = startOf(migrated, 'wrap')
    expect(start?.passForks?.['1']).toEqual([])
    expect(start?.passForks?.['2']?.map((node) => node.id)).toEqual(['tail', 'head'])
    expect(containsLegacyWhen(migrated)).toBe(false)
  })

  it('migrates no-end rules without leaving an execution-time adapter', () => {
    const migrated = migrateLegacyRotationItems(legacy([
      { id: 'start', type: 'loop', kind: 'start', loopId: 'free', runs: 2 },
      feature('run-1-only', {
        when: { loops: [{ loopId: 'free', runs: [1] }] },
      }),
      {
        id: 'repeat',
        type: 'repeat',
        times: 1,
        when: { overrides: [{ runs: { free: 2 }, times: 2 }] },
        items: [feature('hit')],
      },
    ]))
    const start = startOf(migrated, 'free')
    const run2 = start?.passForks?.['2']
    const repeat = run2?.find((node) => node.id === 'repeat')
    expect(run2?.map((node) => node.id)).toEqual(['repeat'])
    expect(repeat?.type === 'repeat' ? repeat.times : null).toBe(2)
    expect(containsLegacyWhen(migrated)).toBe(false)
  })

  it('is idempotent after the one-time migration', () => {
    const once = migrateLegacyRotationItems(legacy([
      { id: 'start', type: 'loop', kind: 'start', loopId: 'loop-a', runs: 2 },
      feature('run-2-only', {
        when: { loops: [{ loopId: 'loop-a', runs: [2] }] },
      }),
      { id: 'end', type: 'loop', kind: 'end', loopId: 'loop-a' },
    ]))
    const twice = migrateLegacyRotationItems(once)
    expect(rotationBodiesEqual(once, twice)).toBe(true)
  })

  it('removes legacy fields from end markers and nested fork bodies', () => {
    const migrated = migrateLegacyRotationItems(legacy([
      {
        id: 'start', type: 'loop', kind: 'start', loopId: 'loop-a', runs: 2,
        passForks: {
          '2': [feature('forked', {
            when: { condition: { type: 'always' } },
          })],
        },
      },
      {
        id: 'end', type: 'loop', kind: 'end', loopId: 'loop-a',
        when: { loops: [{ loopId: 'loop-a', runs: [1] }] },
      },
    ]))

    expect(containsLegacyWhen(migrated)).toBe(false)
  })
})
