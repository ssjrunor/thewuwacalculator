import { runRotationSearchBatch } from '@/engine/optimizer/search/rotationCpu.ts'
import { runTargetSearchBatch } from '@/engine/optimizer/search/targetCpu.ts'
import type {
  PackedOptimizerExecutionPayload,
} from '@/engine/optimizer/types.ts'
import { initializeTargetGpu, runTargetGpuJob } from '@/engine/optimizer/gpu/targetRunner.ts'
import { initializeRotationGpu, runRotationGpuJob } from '@/engine/optimizer/gpu/rotationRunner.ts'
import { detectWebGpuSupport } from '@/engine/optimizer/gpu/getDevice.ts'
import type {
  OptimizerTaskDoneMessage,
  OptimizerTaskErrorMessage,
  OptimizerTaskInMessage,
  OptimizerTaskProgressMessage,
} from '@/engine/optimizer/workers/messages.ts'
import { errorOptimizer, logOptimizer } from '@/engine/optimizer/config/log.ts'

const PROGRESS_FLUSH_INTERVAL_MS = 80

// cpu workers cache the packed payload locally after the first task.
// gpu workers keep their initialized backend alive across later tasks.
let packedTargetPayload: PackedOptimizerExecutionPayload | null = null
let targetBackend: 'cpu' | 'gpu-target' | 'gpu-rotation' = 'cpu'
let canUseGpuBackend = false
let targetGpuInitialized = false
let activeRunId: number | null = null
let cancelled = false

function isCancelled(runId: number): boolean {
  return cancelled && activeRunId === runId
}

function postError(runId: number, error: unknown): void {
  const message: OptimizerTaskErrorMessage = {
    type: 'error',
    runId,
    message: error instanceof Error ? error.message : 'Optimizer task worker failed unexpectedly',
  }
  self.postMessage(message)
}

async function ensureCpuPayload(
    message: Extract<OptimizerTaskInMessage, { type: 'runTargetCpuBatch' }>,
): Promise<PackedOptimizerExecutionPayload> {
  // the first cpu task seeds the worker-local packed payload.
  if (message.payload) {
    packedTargetPayload = message.payload
    targetBackend = 'cpu'
    targetGpuInitialized = false
    canUseGpuBackend = false

    logOptimizer('[optimizer:task-worker] CPU payload stored', {
      runId: message.runId,
      mode: message.payload.mode,
    })
  }

  if (!packedTargetPayload) {
    throw new Error('Optimizer task worker has not received a CPU payload')
  }

  return packedTargetPayload
}

async function ensureGpuBackend(
    message: Extract<OptimizerTaskInMessage, { type: 'runTargetGpu' | 'runRotationGpu' }>,
): Promise<void> {
  const desiredBackend = message.type === 'runTargetGpu' ? 'gpu-target' : 'gpu-rotation'

  // later gpu tasks reuse the existing backend if it already matches.
  if (targetBackend === desiredBackend && targetGpuInitialized && canUseGpuBackend) {
    return
  }

  if (!message.bootstrapPayload) {
    throw new Error('Target GPU optimizer worker has not been initialized')
  }

  packedTargetPayload = null
  targetBackend = desiredBackend
  targetGpuInitialized = false
  canUseGpuBackend = false

  logOptimizer('[optimizer:task-worker] initializing GPU backend from task payload', {
    runId: message.runId,
    type: message.type,
  })

  logOptimizer('[optimizer:task-worker] detecting WebGPU support', { runId: message.runId })
  canUseGpuBackend = await detectWebGpuSupport()
  logOptimizer('[optimizer:task-worker] WebGPU detection result', {
    runId: message.runId,
    canUseGpuBackend,
  })

  if (!canUseGpuBackend) {
    throw new Error('WebGPU is not available for target optimizer worker')
  }

  if (message.type === 'runTargetGpu') {
    await initializeTargetGpu(message.bootstrapPayload)
  } else {
    await initializeRotationGpu(message.bootstrapPayload)
  }

  targetGpuInitialized = true
  logOptimizer('[optimizer:task-worker] GPU resources ready', {
    runId: message.runId,
    type: message.type,
  })
}

self.onmessage = async (event: MessageEvent<OptimizerTaskInMessage>) => {
  const message = event.data

  if (message.type === 'cancel') {
    if (activeRunId === message.runId) {
      logOptimizer('[optimizer:task-worker] cancellation requested', { runId: message.runId })
      cancelled = true
    }
    return
  }

  activeRunId = message.runId
  cancelled = false

  const jobT0 = performance.now()
  const jobComboCount = message.comboCount

  logOptimizer('[optimizer:task-worker] job started', {
    type: message.type,
    runId: message.runId,
    comboCount: jobComboCount,
    lockedMainIndex: message.lockedMainIndex,
    jobResultsLimit: message.jobResultsLimit,
    backend: targetBackend,
    hasCpuPayload: message.type === 'runTargetCpuBatch' ? Boolean(message.payload) : undefined,
    hasGpuBootstrap:
      message.type === 'runTargetGpu' || message.type === 'runRotationGpu'
        ? Boolean(message.bootstrapPayload)
        : undefined,
  })

  let flushProcessed = () => {}
  try {
    if (message.type === 'runTargetCpuBatch') {
      const payload = await ensureCpuPayload(message)

      let pendingProcessed = 0
      let lastFlushedAt = performance.now()
      // batch up progress posts a bit so long cpu jobs do not spam the pool.
      flushProcessed = () => {
        if (pendingProcessed <= 0) {
          return
        }

        const progressMessage: OptimizerTaskProgressMessage = {
          type: 'progress',
          runId: message.runId,
          processedDelta: pendingProcessed,
        }
        pendingProcessed = 0
        lastFlushedAt = performance.now()
        self.postMessage(progressMessage)
      }

      const onProcessed = (processedDelta: number) => {
        pendingProcessed += processedDelta
        const now = performance.now()
        if (now - lastFlushedAt >= PROGRESS_FLUSH_INTERVAL_MS) {
          flushProcessed()
        }
      }

      const results = await (
        payload.mode === 'rotation'
          ? runRotationSearchBatch(
              payload,
              {
                combosBatch: message.combosBatch,
                comboCount: message.comboCount,
                lockedMainIndex: message.lockedMainIndex,
                jobResultsLimit: message.jobResultsLimit,
              },
              {
                isCancelled: () => isCancelled(message.runId),
                onProcessed,
              },
            )
          : runTargetSearchBatch(
              payload,
              {
                combosBatch: message.combosBatch,
                comboCount: message.comboCount,
                lockedMainIndex: message.lockedMainIndex,
                jobResultsLimit: message.jobResultsLimit,
              },
              {
                isCancelled: () => isCancelled(message.runId),
                onProcessed,
              },
            )
      )

      flushProcessed()

      logOptimizer('[optimizer:task-worker] CPU job done', {
        runId: message.runId,
        resultCount: results.length,
        elapsedMs: Math.round(performance.now() - jobT0),
      })

      const doneMessage: OptimizerTaskDoneMessage = {
        type: 'done',
        runId: message.runId,
        results,
        returnedCombosBatch: message.combosBatch,
      }
      self.postMessage(doneMessage, [message.combosBatch.buffer])
      return
    }

    await ensureGpuBackend(message)

    const results = message.type === 'runTargetGpu'
      ? await runTargetGpuJob(
          {
            comboStart: message.comboStart,
            comboCount: message.comboCount,
            lockedMainIndex: message.lockedMainIndex,
            jobResultsLimit: message.jobResultsLimit,
          },
          {
            isCancelled: () => isCancelled(message.runId),
          },
        )
      : await runRotationGpuJob(
          {
            comboStart: message.comboStart,
            comboCount: message.comboCount,
            lockedMainIndex: message.lockedMainIndex,
            jobResultsLimit: message.jobResultsLimit,
          },
          {
            isCancelled: () => isCancelled(message.runId),
          },
        )

    logOptimizer('[optimizer:task-worker] GPU job done', {
      runId: message.runId,
      resultCount: results.length,
      elapsedMs: Math.round(performance.now() - jobT0),
    })

    const doneMessage: OptimizerTaskDoneMessage = {
      type: 'done',
      runId: message.runId,
      results,
    }
    self.postMessage(doneMessage)
  } catch (error) {
    errorOptimizer('[optimizer:task-worker] job failed', {
      type: message.type,
      runId: message.runId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      elapsedMs: Math.round(performance.now() - jobT0),
    })
    flushProcessed()
    postError(message.runId, error)
  }
}
