/*
  Author: Runor Ewhro
  Description: Describes what a build-card read is doing while it runs, so the
               import surface can report real progress instead of a spinner.
*/

export type ReadStage = 'catalog' | 'worker' | 'slots' | 'head' | 'match'

export interface ReadProgress {
  stage: ReadStage
  /** units finished in this stage */
  done: number
  /** units this stage will do */
  total: number
  /** index into getCardReadAreas() for the region being sampled */
  area?: number
  /** what is loading, when a stage has more than one kind of work */
  note?: string
}

export type ReadProgressFn = (progress: ReadProgress) => void

export interface ReadOptions {
  onProgress?: ReadProgressFn
  signal?: AbortSignal
}

export const READ_CANCELLED = 'read_cancelled'

// share of a cold read spent in each stage, measured on the sample card
export const STAGE_SHARE: Record<ReadStage, number> = {
  catalog: 0.06,
  worker: 0.06,
  slots: 0.6,
  head: 0.27,
  match: 0.01,
}

const STAGE_ORDER: ReadStage[] = ['catalog', 'worker', 'slots', 'head', 'match']

// monotonic 0..1 estimate, so the meter never walks backwards between stages
export function getReadFraction({ stage, done, total }: ReadProgress): number {
  let base = 0
  for (const key of STAGE_ORDER) {
    if (key === stage) break
    base += STAGE_SHARE[key]
  }
  const within = total > 0 ? Math.min(1, done / total) : 0
  return Math.min(1, base + STAGE_SHARE[stage] * within)
}

export function thrwIfAbrtd(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error(READ_CANCELLED)
}
