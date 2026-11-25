/*
  Author: Runor Ewhro
  description: paces heavy background work per thread. boards in one isolate
               share its thread (every board in local dev, and any a deployed
               runtime colocates), so their heavy steps (entry rebuilds,
               backfills, packing, pruning) run one at a time and wait while the
               API worker in the same isolate serves a request, and each is
               followed by an equal idle stretch, which leaves requests at least
               half the thread. store.ts bounds each step in rows; this file
               bounds their spacing.
*/

/** the least time between two heavy steps of one isolate, whatever the last one took. */
export const HEAVY_GAP_MS = 250
/** retry delay for a board that found a request in progress. */
const BUSY_RETRY_MS = 500

const thread = { requests: 0, heavy: false, freeAt: 0 }

/** a request the API worker is serving: heavy steps in this isolate wait until none is. */
export async function serving<T>(work: () => Promise<T>): Promise<T> {
  thread.requests += 1
  try {
    return await work()
  } finally {
    thread.requests -= 1
  }
}

/** how long until this isolate may run a heavy step: 0 for now. */
export function heavyWait(now: number): number {
  if (thread.heavy || thread.requests > 0) return BUSY_RETRY_MS
  return Math.max(0, thread.freeAt - now)
}

/**
 * runs one heavy step on this isolate's turn (heavyWait is 0) and returns false without running it otherwise; the
 * thread then stays free of heavy work for as long as the step took. workerd's clock does not advance during
 * synchronous work, so the step's length is read after a timer lets the clock catch up.
 */
export async function heavyStep(now: number, step: () => void): Promise<boolean> {
  if (heavyWait(now) > 0) return false
  thread.heavy = true
  const started = Date.now()
  try {
    step()
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const ended = Date.now()
    thread.freeAt = ended + Math.max(HEAVY_GAP_MS, ended - started)
    thread.heavy = false
  }
  return true
}

/** what /healthz reports: requests being served, whether a heavy step runs, and how long until the next may. */
export function paceState(now: number) {
  return { requests: thread.requests, heavy: thread.heavy, heavyWaitMs: heavyWait(now) }
}

/** tests: the thread as new. */
export function resetPace(): void {
  thread.requests = 0
  thread.heavy = false
  thread.freeAt = 0
}
