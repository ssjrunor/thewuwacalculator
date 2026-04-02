import type { OptimizerProgress } from '@/engine/optimizer/types.ts'

const PROGRESS_UPDATE_INTERVAL_MS = 80

export function buildOptimizerProgress(
    total: number,
    processed: number,
    startedAt: number,
): OptimizerProgress {
  const now = performance.now()
  const elapsedMs = now - startedAt
  const progress = total > 0 ? processed / total : 0
  const speed = elapsedMs > 0 ? (processed / elapsedMs) * 1000 : 0
  const remainingMs =
      speed > 0 && processed < total
          ? ((total - processed) / speed) * 1000
          : (processed >= total ? 0 : Infinity)

  return {
    progress,
    elapsedMs,
    remainingMs,
    processed,
    speed,
  }
}

export function createOptimizerProgressTracker(
    total: number,
    hooks: {
      onProgress?: (progress: OptimizerProgress) => void
      onProcessed?: (processedDelta: number) => void
    } = {},
): {
  onProcessed: (processedDelta: number) => void
  emit: (force?: boolean) => void
} {
  const startedAt = performance.now()
  let processed = 0
  let lastProgressAt = startedAt

  const emit = (force = false) => {
    if (!hooks.onProgress) {
      return
    }

    const now = performance.now()
    if (!force && now - lastProgressAt < PROGRESS_UPDATE_INTERVAL_MS) {
      return
    }

    lastProgressAt = now
    hooks.onProgress(buildOptimizerProgress(total, processed, startedAt))
  }

  return {
    onProcessed(processedDelta: number) {
      processed += processedDelta
      hooks.onProcessed?.(processedDelta)
      emit()
    },
    emit,
  }
}
