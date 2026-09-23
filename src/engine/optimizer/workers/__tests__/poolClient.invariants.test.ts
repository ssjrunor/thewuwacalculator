/*
  Author: Runor Ewhro
  Description: Verifies optimizer pool cleanup remains lazy and invalidates jobs
               cancelled while the search engine is loading.
*/

import { afterEach, expect, it, vi } from 'vitest'
import type { PrepOptPay } from '@/engine/optimizer/types.ts'

afterEach(() => {
  vi.doUnmock('../pool.ts')
  vi.resetModules()
})

it('does not import the search engine when an unused pool is cancelled or reset', async () => {
  vi.resetModules()
  const load = vi.fn(() => ({
    runOptWithWr: vi.fn(), rstOptWrkrPo: vi.fn(), cnclActOptWr: vi.fn(),
  }))
  vi.doMock('../pool.ts', load)
  const client = await import('../poolClient.ts')
  client.cnclActOptWr()
  client.rstOptWrkrPo()
  expect(load).not.toHaveBeenCalled()
})

it('does not start a search cancelled while the engine is loading', async () => {
  vi.resetModules()
  let release!: () => void
  const ready = new Promise<void>((resolve) => { release = resolve })
  const run = vi.fn().mockResolvedValue([])
  vi.doMock('../pool.ts', async () => {
    await ready
    return { runOptWithWr: run, rstOptWrkrPo: vi.fn(), cnclActOptWr: vi.fn() }
  })
  const client = await import('../poolClient.ts')
  const job = client.runOptWithWr({} as PrepOptPay, 'cpu')
  client.cnclActOptWr()
  release()
  await expect(job).resolves.toEqual([])
  expect(run).not.toHaveBeenCalled()

  const payload = {} as PrepOptPay
  await client.runOptWithWr(payload, 'cpu')
  expect(run).toHaveBeenCalledWith(payload, 'cpu')
})
