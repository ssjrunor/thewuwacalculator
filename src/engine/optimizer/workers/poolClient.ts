/*
  Author: Runor Ewhro
  Description: Lazily loads the optimizer worker pool while keeping cleanup
               synchronous and invalidating jobs cancelled during initialization.
*/

type Pool = typeof import('./pool.ts')
let loadedPool: Pool | null = null
let pendingPool: Promise<Pool> | null = null
let generation = 0

function loadPool(): Promise<Pool> {
  pendingPool ??= import('./pool.ts').then((pool) => {
    loadedPool = pool
    return pool
  }).catch((error) => {
    pendingPool = null
    throw error
  })
  return pendingPool
}

export function rstOptWrkrPo(): void {
  generation += 1
  loadedPool?.rstOptWrkrPo()
}

export function cnclActOptWr(): void {
  generation += 1
  loadedPool?.cnclActOptWr()
}

export async function runOptWithWr(...args: Parameters<Pool['runOptWithWr']>): ReturnType<Pool['runOptWithWr']> {
  const started = generation
  const pool = await loadPool()
  if (generation !== started || args[2]?.isCancelled?.()) return []
  return pool.runOptWithWr(...args)
}
