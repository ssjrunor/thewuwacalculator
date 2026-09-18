/*
  Author: Runor Ewhro
  Description: Verifies deferred configuration transactions independently of
               React surface timing.
*/

import { describe, expect, it, vi } from 'vitest'
import { createConfigurationTransaction } from '@/shared/ui/useConfigurationSession.ts'

describe('configuration transactions', () => {
  it('keeps canonical state unchanged until finish and replays edits in order', () => {
    let canonical = { count: 1, label: 'standing' }
    const commit = vi.fn((reducer: (current: typeof canonical) => typeof canonical) => {
      canonical = reducer(canonical)
    })
    const transaction = createConfigurationTransaction(canonical, commit)

    transaction.update((current) => ({ ...current, count: current.count + 2 }))
    transaction.update((current) => ({ ...current, label: `draft-${current.count}` }))

    expect(canonical).toEqual({ count: 1, label: 'standing' })
    expect(transaction.read()).toEqual({ count: 3, label: 'draft-3' })

    transaction.finish()

    expect(canonical).toEqual({ count: 3, label: 'draft-3' })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('rebases the composed edits onto the latest canonical value', () => {
    let canonical = { count: 2, retained: 'before' }
    const transaction = createConfigurationTransaction(canonical, (reducer) => {
      canonical = reducer(canonical)
    })

    transaction.update((current) => ({ ...current, count: current.count * 3 }))
    canonical = { count: 4, retained: 'external' }
    transaction.finish()

    expect(canonical).toEqual({ count: 12, retained: 'external' })
  })

  it('commits at most once and starts clean after reset', () => {
    const commits: number[] = []
    const transaction = createConfigurationTransaction(
      { count: 0 },
      (reducer) => commits.push(reducer({ count: 10 }).count),
    )

    transaction.update((current) => ({ count: current.count + 1 }))
    transaction.finish()
    transaction.finish()
    transaction.update((current) => ({ count: current.count + 100 }))

    expect(commits).toEqual([11])

    transaction.reset({ count: 5 })
    transaction.replace({ count: 8 })
    transaction.finish()

    expect(commits).toEqual([11, 8])
  })

  it('does not publish an untouched draft', () => {
    const commit = vi.fn()
    createConfigurationTransaction({ count: 1 }, commit).finish()
    expect(commit).not.toHaveBeenCalled()
  })
})
