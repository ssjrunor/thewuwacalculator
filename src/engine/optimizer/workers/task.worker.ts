/*
  Author: Runor Ewhro
  Description: runs optimizer cpu and gpu tasks inside a dedicated worker,
               caching packed payloads and initialized gpu backends across
               messages so later jobs avoid repeated setup cost.
*/

import { runRotSrchBt } from '@/engine/optimizer/search/rotationCpu.ts'
import { runTgtSrchBt } from '@/engine/optimizer/search/targetCpu.ts'
import type {
  PckdOptXctnP,
} from '@/engine/optimizer/types.ts'
import { initTgtGpu, runTgtGpuBtc, runTgtGpuJob } from '@/engine/optimizer/gpu/targetRunner.ts'
import { initRotGpu, runRotGpuBtc, runRotGpuJob } from '@/engine/optimizer/gpu/rotationRunner.ts'
import { dtctWebGpuSp } from '@/engine/optimizer/gpu/getDevice.ts'
import type {
  OptTaskDoneM,
  OptTaskRrrMs,
  OptTaskInMsg,
  OptTaskPrgrM,
} from '@/engine/optimizer/workers/messages.ts'
import { errorOpt, logOptimizer } from '@/engine/optimizer/config/log.ts'

const FLUSH_MS = 80

// cpu workers cache the packed payload locally after the first task.
// gpu workers keep their initialized backend alive across later tasks.
let pckdTgtPay: PckdOptXctnP | null = null
let tgtBckn: 'cpu' | 'gpu-target' | 'gpu-rotation' = 'cpu'
let canUseGpuBck = false
let tgtGpuInit = false
let activeRunId: number | null = null
let cancelled = false

// cancellation only applies to the currently active run id
function isCancelled(runId: number): boolean {
  return cancelled && activeRunId === runId
}

// send a normalized worker error payload back to the caller
function postError(runId: number, error: unknown): void {
  const msg: OptTaskRrrMs = {
    type: 'error',
    runId,
    message: error instanceof Error ? error.message : 'Optimizer task worker failed unexpectedly',
  }
  self.postMessage(msg)
}

async function ensCpuPay(
    msg: Extract<OptTaskInMsg, { type: 'runTargetCpuBatch' }>,
): Promise<PckdOptXctnP> {
  // the first cpu task seeds the worker-local packed payload.
  if (msg.payload) {
    pckdTgtPay = msg.payload
    tgtBckn = 'cpu'
    tgtGpuInit = false
    canUseGpuBck = false

    logOptimizer('[optimizer:task-worker] CPU payload stored', {
      runId: msg.runId,
      mode: msg.payload.mode,
    })
  }

  if (!pckdTgtPay) {
    throw new Error('Optimizer task worker has not received a CPU payload')
  }

  return pckdTgtPay
}

async function ensGpuBckn(
    msg: Extract<OptTaskInMsg, {
      type: 'runTargetGpu' | 'runRotationGpu' | 'runTargetGpuBatch' | 'runRotationGpuBatch'
    }>,
): Promise<void> {
  const dsrdBckn = msg.type === 'runTargetGpu' || msg.type === 'runTargetGpuBatch'
      ? 'gpu-target'
      : 'gpu-rotation'

  // later gpu tasks reuse the existing backend if it already matches.
  if (tgtBckn === dsrdBckn && tgtGpuInit && canUseGpuBck) {
    return
  }

  if (!msg.btstPay) {
    throw new Error('Target GPU optimizer worker has not been initialized')
  }

  pckdTgtPay = null
  tgtBckn = dsrdBckn
  tgtGpuInit = false
  canUseGpuBck = false

  logOptimizer('[optimizer:task-worker] initializing GPU backend from task payload', {
    runId: msg.runId,
    type: msg.type,
  })

  logOptimizer('[optimizer:task-worker] detecting WebGPU support', { runId: msg.runId })
  canUseGpuBck = await dtctWebGpuSp()
  logOptimizer('[optimizer:task-worker] WebGPU detection result', {
    runId: msg.runId,
    canUseGpuBackend: canUseGpuBck,
  })

  if (!canUseGpuBck) {
    throw new Error('WebGPU is not available for target optimizer worker')
  }

  if (msg.type === 'runTargetGpu' || msg.type === 'runTargetGpuBatch') {
    await initTgtGpu(msg.btstPay)
  } else {
    await initRotGpu(msg.btstPay)
  }

  tgtGpuInit = true
  logOptimizer('[optimizer:task-worker] GPU resources ready', {
    runId: msg.runId,
    type: msg.type,
  })
}

self.onmessage = async (event: MessageEvent<OptTaskInMsg>) => {
  const msg = event.data

  if (msg.type === 'cancel') {
    if (activeRunId === msg.runId) {
      logOptimizer('[optimizer:task-worker] cancellation requested', { runId: msg.runId })
      cancelled = true
    }
    return
  }

  activeRunId = msg.runId
  cancelled = false

  const jobT0 = performance.now()
  const jobCmbCnt = 'comboCount' in msg ? msg.comboCount : 0

  logOptimizer('[optimizer:task-worker] job started', {
    type: msg.type,
    runId: msg.runId,
    comboCount: jobCmbCnt,
    lockedMainIndex: 'lockMainIdx' in msg ? msg.lockMainIdx : 0,
    jobResultsLimit: 'jobResultLimit' in msg ? msg.jobResultLimit : 0,
    backend: tgtBckn,
    hasCpuPayload: msg.type === 'runTargetCpuBatch' ? Boolean(msg.payload) : undefined,
    hasGpuBootstrap:
      msg.type === 'runTargetGpu' ||
      msg.type === 'runRotationGpu' ||
      msg.type === 'runTargetGpuBatch' ||
      msg.type === 'runRotationGpuBatch'
        ? Boolean(msg.btstPay)
        : undefined,
  })

  let flshPrcs = () => {}
  try {
    if (msg.type === 'runTargetCpuBatch') {
      const payT0 = performance.now()
      const payload = await ensCpuPay(msg)
      const payMs = performance.now() - payT0

      let pndnPrcs = 0
      let lastFlshAt = performance.now()
      // batch up progress posts a bit so long cpu jobs do not spam the pool.
      flshPrcs = () => {
        if (pndnPrcs <= 0) {
          return
        }

        const prgrMsg: OptTaskPrgrM = {
          type: 'progress',
          runId: msg.runId,
          prcsDlt: pndnPrcs,
        }
        pndnPrcs = 0
        lastFlshAt = performance.now()
        self.postMessage(prgrMsg)
      }

      const onProcessed = (prcsDlt: number) => {
        pndnPrcs += prcsDlt
        const now = performance.now()
        if (now - lastFlshAt >= FLUSH_MS) {
          flshPrcs()
        }
      }

      const runT0 = performance.now()
      const results = await (
        payload.mode === 'rotation'
          ? runRotSrchBt(
              payload,
              {
                combosBatch: msg.combosBatch,
                comboCount: msg.comboCount,
                lockMainIdx: msg.lockMainIdx,
                jobResultLimit: msg.jobResultLimit,
              },
              {
                isCancelled: () => isCancelled(msg.runId),
                onProcessed,
              },
            )
          : runTgtSrchBt(
              payload,
              {
                combosBatch: msg.combosBatch,
                comboCount: msg.comboCount,
                lockMainIdx: msg.lockMainIdx,
                jobResultLimit: msg.jobResultLimit,
              },
              {
                isCancelled: () => isCancelled(msg.runId),
                onProcessed,
              },
            )
      )
      const runMs = performance.now() - runT0

      const flushT0 = performance.now()
      flshPrcs()
      const flushMs = performance.now() - flushT0

      logOptimizer('[optimizer:task-worker] CPU job done', {
        runId: msg.runId,
        mode: payload.mode,
        comboCount: msg.comboCount,
        resultCount: results.length,
        payloadMs: Math.round(payMs),
        runMs: Math.round(runMs),
        flushMs: Math.round(flushMs),
        elapsedMs: Math.round(performance.now() - jobT0),
        combosPerSec: Math.round((msg.comboCount / Math.max(1, runMs)) * 1000),
      })

      const postT0 = performance.now()
      const doneMessage: OptTaskDoneM = {
        type: 'done',
        runId: msg.runId,
        results,
        rtrnCmbsBtch: msg.combosBatch,
      }
      self.postMessage(doneMessage, [msg.combosBatch.buffer])
      logOptimizer('[optimizer:task-worker] CPU result posted', {
        runId: msg.runId,
        postMs: Math.round(performance.now() - postT0),
      })
      return
    }

    if (
      msg.type === 'runTargetGpu' ||
      msg.type === 'runRotationGpu' ||
      msg.type === 'runTargetGpuBatch' ||
      msg.type === 'runRotationGpuBatch'
    ) {
      await ensGpuBckn(msg)

      const results = msg.type === 'runTargetGpu'
        ? await runTgtGpuJob(
            {
              comboStart: msg.comboStart,
              comboCount: msg.comboCount,
              lockMainIdx: msg.lockMainIdx,
              jobResultLimit: msg.jobResultLimit,
            },
            {
              isCancelled: () => isCancelled(msg.runId),
            },
          )
        : msg.type === 'runRotationGpu'
          ? await runRotGpuJob(
            {
              comboStart: msg.comboStart,
              comboCount: msg.comboCount,
              lockMainIdx: msg.lockMainIdx,
              jobResultLimit: msg.jobResultLimit,
            },
            {
              isCancelled: () => isCancelled(msg.runId),
            },
          )
          : msg.type === 'runTargetGpuBatch'
            ? await runTgtGpuBtc(
              {
                combosBatch: msg.combosBatch,
                comboCount: msg.comboCount,
                lockMainIdx: msg.lockMainIdx,
                jobResultLimit: msg.jobResultLimit,
              },
              {
                isCancelled: () => isCancelled(msg.runId),
              },
            )
            : await runRotGpuBtc(
              {
                combosBatch: msg.combosBatch,
                comboCount: msg.comboCount,
                lockMainIdx: msg.lockMainIdx,
                jobResultLimit: msg.jobResultLimit,
              },
              {
                isCancelled: () => isCancelled(msg.runId),
              },
            )

      logOptimizer('[optimizer:task-worker] GPU job done', {
        runId: msg.runId,
        resultCount: results.length,
        elapsedMs: Math.round(performance.now() - jobT0),
      })

      const doneMessage: OptTaskDoneM = {
        type: 'done',
        runId: msg.runId,
        results,
        rtrnCmbsBtch:
          msg.type === 'runTargetGpuBatch' || msg.type === 'runRotationGpuBatch'
            ? msg.combosBatch
            : undefined,
      }
      if (msg.type === 'runTargetGpuBatch' || msg.type === 'runRotationGpuBatch') {
        self.postMessage(doneMessage, [msg.combosBatch.buffer])
      } else {
        self.postMessage(doneMessage)
      }
    }
  } catch (error) {
    errorOpt('[optimizer:task-worker] job failed', {
      type: msg.type,
      runId: msg.runId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      elapsedMs: Math.round(performance.now() - jobT0),
    })
    flshPrcs()
    postError(msg.runId, error)
  }
}
