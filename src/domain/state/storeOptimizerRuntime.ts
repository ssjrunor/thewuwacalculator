/*
  Author: Runor Ewhro
  Description: Owns store-side optimizer worker lifecycle helpers, run-token
               invalidation, payload transfer lists, and compile/materialize
               request plumbing.
*/

import type {
  OptBckn,
  OptFinalResult,
  OptRawResult,
  OptStartPay,
  PrepOptPay,
} from '@/engine/optimizer/types'
import type { OptCompOutMs } from '@/engine/optimizer/compiler/compileWorker.types.ts'
import {
  CPU_JOB_SIZE,
  TARGET_GPU_JOB,
  ROT_GPU_JOB,
  CPU_THEORY_JOB,
  GPU_THEORY_JOB,
} from '@/engine/optimizer/config/constants'
import { errorOpt, logOptimizer } from '@/engine/optimizer/config/log.ts'

let optRunTkn = 0
let optCompWrkr: Worker | null = null

export function bgnOptRun(): number {
  // each new run gets a strictly newer token so stale async work can be ignored.
  optRunTkn += 1
  return optRunTkn
}

export function nvldOptRun(): number {
  optRunTkn += 1
  return optRunTkn
}

export function isOptRunCur(runToken: number): boolean {
  return optRunTkn === runToken
}

export function ensOptCompWr(): Worker {
  if (optCompWrkr) {
    return optCompWrkr
  }

  // the compile worker is shared between runs until explicitly torn down.
  logOptimizer('[optimizer:store] spawning compile worker')
  optCompWrkr = new Worker(
    new URL('@/engine/optimizer/workers/compile.worker.ts', import.meta.url),
    { type: 'module' },
  )

  optCompWrkr.onerror = (event) => {
    errorOpt('[optimizer:store] compile worker uncaught error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    })
  }

  return optCompWrkr
}

export function stopOptCompW(): void {
  optCompWrkr?.terminate()
  optCompWrkr = null
}

export function stopOptComhl(worker: Worker): void {
  if (optCompWrkr !== worker) {
    return
  }

  stopOptCompW()
}

function cllcPrepPayT(payload: PrepOptPay): Transferable[] {
  const maybePush = (items: Transferable[], buffer: ArrayBufferLike) => {
    // shared buffers cannot be transferred away from the sending thread.
    if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
      return
    }
    items.push(buffer)
  }

  const out: Transferable[] = []
  maybePush(out, payload.constraints.buffer)
  maybePush(out, payload.costs.buffer)
  maybePush(out, payload.sets.buffer)
  maybePush(out, payload.kinds.buffer)
  maybePush(out, payload.comboIndexMap.buffer)
  maybePush(out, payload.comboBinom.buffer)
  maybePush(out, payload.lockMainCands.buffer)

  if (payload.mode === 'theoryTarget' || payload.mode === 'theoryRotation') {
    return out
  }

  if (payload.mode === 'rotation') {
    maybePush(out, payload.contexts.buffer)
    maybePush(out, payload.contextWeight.buffer)
    maybePush(out, payload.displayContext.buffer)
    maybePush(out, payload.stats.buffer)
    maybePush(out, payload.setConstLut.buffer)
    maybePush(out, payload.mainEchoBuffs.buffer)
    return out
  }

  maybePush(out, payload.stats.buffer)
  maybePush(out, payload.setConstLut.buffer)
  maybePush(out, payload.mainEchoBuffs.buffer)
  return out
}

async function waitForCompW<T extends OptCompOutMs['type']>(
  worker: Worker,
  runId: number,
  expectedType: T,
  dispatch: () => void,
): Promise<Extract<OptCompOutMs, { type: T }>> {
  return await new Promise((resolve, reject) => {
    const onMsg = (event: MessageEvent<OptCompOutMs>) => {
      const message = event.data
      // multiple runs may reuse the same worker, so ignore out-of-date replies.
      if (message.runId !== runId) {
        return
      }

      worker.removeEventListener('message', onMsg)
      worker.removeEventListener('error', handleError)

      if (message.type === 'error') {
        reject(new Error(message.message))
        return
      }

      if (message.type !== expectedType) {
        reject(new Error(`Unexpected optimizer compile worker response: ${message.type}`))
        return
      }

      resolve(message as Extract<OptCompOutMs, { type: T }>)
    }

    const handleError = (event: ErrorEvent) => {
      worker.removeEventListener('message', onMsg)
      worker.removeEventListener('error', handleError)
      reject(new Error(event.message || 'Optimizer compile worker failed unexpectedly'))
    }

    worker.addEventListener('message', onMsg)
    worker.addEventListener('error', handleError)
    dispatch()
  })
}

export async function compOptPayIn(
  worker: Worker,
  runId: number,
  input: OptStartPay,
): Promise<PrepOptPay> {
  logOptimizer('[optimizer:store] dispatching compile job to worker', {
    runId,
    resonatorId: input.resonatorId,
    rotationMode: input.settings.rotationMode,
    inventorySize: input.invChs.length,
    hasStaticData: !!input.staticData,
  })

  const t0 = performance.now()
  const message = await waitForCompW(worker, runId, 'done', () => {
    worker.postMessage({
      type: 'start',
      runId,
      payload: input,
    })
  })

  logOptimizer('[optimizer:store] compile worker responded', {
    runId,
    mode: message.payload.mode,
    comboTotalCombos: message.payload.totalCombos,
    comboN: message.payload.comboN,
    comboK: message.payload.comboK,
    contextCount: 'contextCount' in message.payload ? message.payload.contextCount : undefined,
    elapsedMs: Math.round(performance.now() - t0),
  })

  return message.payload
}

export async function matOptRsltsI(
  worker: Worker,
  runId: number,
  payload: PrepOptPay,
  results: OptRawResult[],
  uidByIndex: string[],
  limit: number,
): Promise<OptFinalResult[]> {
  logOptimizer('[optimizer:store] dispatching materialize job to worker', {
    runId,
    resultCount: results.length,
    limit,
    mode: payload.mode,
  })

  const t0 = performance.now()
  const message = await waitForCompW(worker, runId, 'materialized', () => {
    worker.postMessage({
      type: 'materialize',
      runId,
      payload,
      results,
      uidByIndex,
      limit,
    }, cllcPrepPayT(payload))
  })

  logOptimizer('[optimizer:store] materialize complete', {
    runId,
    finalizedCount: message.results.length,
    elapsedMs: Math.round(performance.now() - t0),
  })

  return message.results
}

export function inferOptBtch(input: OptStartPay): number | null {
  if (input.settings.searchMode === 'theory') {
    return input.settings.enableGpu
      ? GPU_THEORY_JOB
      : CPU_THEORY_JOB
  }

  // batch sizing follows the effective backend path because rotation gpu,
  // target gpu, and cpu runs have different practical combo windows.
  if (input.settings.rotationMode) {
    return input.settings.enableGpu
      ? ROT_GPU_JOB
      : CPU_JOB_SIZE
  }

  return input.settings.enableGpu
    ? TARGET_GPU_JOB
    : CPU_JOB_SIZE
}

export function resOptBtchSi(backend: OptBckn): number | null {
  return backend === 'gpu'
    ? TARGET_GPU_JOB
    : CPU_JOB_SIZE
}
