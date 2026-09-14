/*
  Author: Runor Ewhro
  Description: Verifies the simulationBatch.test behavior and its compatibility invariants.
*/

import { describe, expect, it, vi } from 'vitest'
import {
  SimulationBatchRunner,
  stableSimulationKey,
} from '@/engine/pipeline/simulationBatch.ts'

describe('simulation batch runner', () => {
  it('uses structural keys independent of object property order', () => {
    expect(stableSimulationKey({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(stableSimulationKey({ a: { c: 3, d: 4 }, b: 2 }))
  })

  it('deduplicates matching work in-flight and across later batches', async () => {
    let executions = 0
    const runner = new SimulationBatchRunner<{ value: number }, number>(
      ({ value }) => {
        executions += 1
        return value * 2
      },
      2,
    )
    const jobs = [
      { id: 'first', key: 'same', input: { value: 3 } },
      { id: 'second', key: 'same', input: { value: 3 } },
    ]

    const first = await runner.run(jobs)
    const second = await runner.run(jobs)

    expect([...first.values()]).toEqual([6, 6])
    expect([...second.values()]).toEqual([6, 6])
    expect(executions).toBe(1)
  })

  it('does not schedule host yields for an already asynchronous executor', async () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    try {
      const runner = new SimulationBatchRunner<{ value: number }, number>(
        async ({ value }) => value,
        4,
        8,
        { yieldBeforeExecute: false },
      )
      const results = await runner.run([
        { id: 'first', key: 'first', input: { value: 1 } },
        { id: 'second', key: 'second', input: { value: 2 } },
      ])

      expect([...results.values()]).toEqual([1, 2])
      expect(timeout).not.toHaveBeenCalled()
    } finally {
      timeout.mockRestore()
    }
  })
})
