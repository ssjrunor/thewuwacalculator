/*
  Author: Runor Ewhro
  Description: builds throttled optimizer progress snapshots so long-running
               search jobs can report elapsed time, speed, and remaining work.
*/

import type { OptPrgr } from '@/engine/optimizer/types.ts'

const PRGRUPDNTRVM = 80

// compute one progress snapshot from current counters and elapsed time
export function mkOptPrgr(
    total: number,
    processed: number,
    startedAt: number,
): OptPrgr {
  const now = performance.now()
  const elapsedMs = now - startedAt
  const progress = total > 0 ? Math.min(1, processed / total) : 0
  const speed = elapsedMs > 0 ? (processed / elapsedMs) * 1000 : 0
  const remainingMs =
      speed > 0 && processed < total
          ? ((total - processed) / speed) * 1000
          : (processed >= total ? 0 : Infinity)

  return {
    progress,
    elapsedMs,
    remainingMs,
    processed: total > 0 ? Math.min(processed, total) : processed,
    speed,
    total,
  }
}

// create a mutable tracker that batch loops can feed as work completes
export function mkOptPrgrTrc(
    total: number,
    hooks: {
      onProgress?: (progress: OptPrgr) => void
      onProcessed?: (prcsDlt: number) => void
    } = {},
): {
  onProcessed: (prcsDlt: number) => void
  emit: (force?: boolean) => void
} {
  const startedAt = performance.now()
  let processed = 0
  let lastPrgrAt = startedAt

  const emit = (force = false) => {
    if (!hooks.onProgress) {
      return
    }

    const now = performance.now()
    if (!force && now - lastPrgrAt < PRGRUPDNTRVM) {
      return
    }

    lastPrgrAt = now
    hooks.onProgress(mkOptPrgr(total, processed, startedAt))
  }

  return {
    onProcessed(prcsDlt: number) {
      processed += prcsDlt
      hooks.onProcessed?.(prcsDlt)
      emit()
    },
    emit,
  }
}
