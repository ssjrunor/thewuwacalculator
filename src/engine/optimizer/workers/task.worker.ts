import { runRotationSearchBatch } from '@/engine/optimizer/search/rotationCpu.ts'
import { runTargetSearchBatch, runTargetSearchJob } from '@/engine/optimizer/search/targetCpu.ts'
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
  OptimizerTaskReadyMessage,
} from '@/engine/optimizer/workers/messages.ts'
import { errorOptimizer, logOptimizer } from '@/engine/optimizer/config/log.ts'

const PROGRESS_FLUSH_INTERVAL_MS = 80

let packedTargetPayload: PackedOptimizerExecutionPayload | null = null
let targetBackend: 'cpu' | 'gpu-target' | 'gpu-rotation' = 'cpu'
let canUseGpuBackend = false
let targetGpuInitialized = false
let activeRunId: number | null = null
let cancelled = false

function isCancelled(runId: number): boolean {
  return cancelled && activeRunId === runId
}

function postReady(runId: number): void {
  const message: OptimizerTaskReadyMessage = {
    type: 'ready',
    runId,
  }
  self.postMessage(message)
}

function postError(runId: number, error: unknown): void {
  const message: OptimizerTaskErrorMessage = {
    type: 'error',
    runId,
    message: error instanceof Error ? error.message : 'Optimizer task worker failed unexpectedly',
  }
  self.postMessage(message)
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

  if (message.type === 'initTargetCpu' || message.type === 'initTargetGpu' || message.type === 'initRotationGpu') {
    packedTargetPayload = null
    targetBackend =
      message.type === 'initTargetGpu'
        ? 'gpu-target'
        : message.type === 'initRotationGpu'
          ? 'gpu-rotation'
          : 'cpu'
    targetGpuInitialized = false
    canUseGpuBackend = false

    logOptimizer('[optimizer:task-worker] init message received', {
      type: message.type,
      runId: message.runId,
      targetBackend,
    })

    try {
      if (message.type === 'initTargetGpu' || message.type === 'initRotationGpu') {
        logOptimizer('[optimizer:task-worker] detecting WebGPU support', { runId: message.runId })
        canUseGpuBackend = await detectWebGpuSupport()
        logOptimizer('[optimizer:task-worker] WebGPU detection result', {
          runId: message.runId,
          canUseGpuBackend,
        })

        if (!canUseGpuBackend) {
          throw new Error('WebGPU is not available for target optimizer worker')
        }

        logOptimizer('[optimizer:task-worker] initializing GPU resources', {
          runId: message.runId,
          type: message.type,
        })

        if (message.type === 'initTargetGpu') {
          await initializeTargetGpu(message.payload)
        } else {
          await initializeRotationGpu(message.payload)
        }

        targetGpuInitialized = true
        logOptimizer('[optimizer:task-worker] GPU resources ready', { runId: message.runId, type: message.type })
      } else {
        packedTargetPayload = message.payload
        logOptimizer('[optimizer:task-worker] CPU payload stored', {
          runId: message.runId,
          mode: message.payload.mode,
        })
      }

      postReady(message.runId)
    } catch (error) {
      errorOptimizer('[optimizer:task-worker] init failed', {
        runId: message.runId,
        type: message.type,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      postError(message.runId, error)
    }
    return
  }

  if (message.type === 'runTarget' || message.type === 'runTargetCpuBatch') {
    const jobT0 = performance.now()
    const jobComboCount = message.type === 'runTargetCpuBatch' ? message.comboCount : message.comboCount

    logOptimizer('[optimizer:task-worker] job started', {
      type: message.type,
      runId: message.runId,
      comboCount: jobComboCount,
      lockedMainIndex: message.lockedMainIndex,
      jobResultsLimit: message.jobResultsLimit,
      backend: targetBackend,
    })

    let flushProcessed = () => {}
    try {
      if (message.type === 'runTarget' && (targetBackend === 'gpu-target' || targetBackend === 'gpu-rotation')) {
        if (!targetGpuInitialized || !canUseGpuBackend) {
          throw new Error('Target GPU optimizer worker has not been initialized')
        }

        const results = targetBackend === 'gpu-target'
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
        return
      }

      if (!packedTargetPayload) {
        throw new Error('Optimizer task worker has not been initialized')
      }

      let pendingProcessed = 0
      let lastFlushedAt = performance.now()
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

      const results = message.type === 'runTargetCpuBatch'
        ? await (
          packedTargetPayload.mode === 'rotation'
            ? runRotationSearchBatch(
                packedTargetPayload,
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
                packedTargetPayload,
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
        : await (
          packedTargetPayload.mode === 'rotation'
            ? Promise.reject(new Error('Rotation optimizer does not support indexed CPU jobs'))
            : runTargetSearchJob(
                packedTargetPayload,
                {
                  comboStart: message.comboStart,
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
        type: message.type,
        runId: message.runId,
        resultCount: results.length,
        elapsedMs: Math.round(performance.now() - jobT0),
      })

      const doneMessage: OptimizerTaskDoneMessage = {
        type: 'done',
        runId: message.runId,
        results,
        ...(message.type === 'runTargetCpuBatch'
          ? { returnedCombosBatch: message.combosBatch }
          : {}),
      }
      if (message.type === 'runTargetCpuBatch') {
        self.postMessage(doneMessage, [message.combosBatch.buffer])
      } else {
        self.postMessage(doneMessage)
      }
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
}
