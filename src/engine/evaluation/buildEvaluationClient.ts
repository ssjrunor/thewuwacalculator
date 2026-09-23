/*
  Author: Runor Ewhro
  Description: browser-side client for dispatching build evaluation work to
               a dedicated worker.
*/

import type {
  BuildEvaluationReport,
  EvaluationReportOpts,
  DefRotEvaluationIn,
} from '@/engine/evaluation/buildEvaluation'
import type {
  EvaluationWorkerIn,
  EvaluationWorkerOut,
} from '@/engine/evaluation/buildEvaluationWorkerTypes'
import { makeEvaluationKey } from '@/engine/evaluation/buildEvaluationKey'
import { getGameDataMode } from '@/data/gameData'

type WorkerLane = 'report'
type WorkerReq = EvaluationWorkerIn extends infer Job
  ? Job extends { id: number } ? Omit<Job, 'id'> : never
  : never

const workers: Record<WorkerLane, Worker | null> = {
  report: null,
}
let nextJobId = 1
// Completed reports are large object graphs. Keep only a few recent reports in
// the one cache owner; the worker deliberately does not retain a second copy.
const MAX_REPORT_CACHE = 1
let activeReportKey: string | null = null
let activeReportCancel: Int32Array | null = null
const pendingJobs = new Map<number, {
  lane: WorkerLane
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}>()
const inFlightJobs = new Map<string, Promise<unknown>>()
const reportCache = new Map<string, BuildEvaluationReport | null>()

function canonicalReportOptions(options?: EvaluationReportOpts): EvaluationReportOpts {
  const sections = options?.sections
  return {
    alternativesLimit: options?.alternativesLimit ?? 12,
    sections: {
      rotationFeatures: sections?.rotationFeatures ?? true,
      upgradePaths: sections?.upgradePaths ?? true,
      echoStatsTable: sections?.echoStatsTable ?? true,
      evaluationTargets: sections?.evaluationTargets ?? true,
    },
  }
}

// The report worker holds the evaluation catalog and is torn down after a short
// idle period. Completed reports remain in the client cache, so teardown only
// trades a later cold start for reclaiming the worker's catalog memory.
const IDLE_TEARDOWN_MS: Record<WorkerLane, number> = { report: 1_200 }
const idleTimers: Record<WorkerLane, ReturnType<typeof setTimeout> | null> = {
  report: null,
}

function laneHasPendingJobs(lane: WorkerLane): boolean {
  for (const pending of pendingJobs.values()) {
    if (pending.lane === lane) {
      return true
    }
  }
  return false
}

function clearIdleTeardown(lane: WorkerLane): void {
  const timer = idleTimers[lane]
  if (timer != null) {
    clearTimeout(timer)
    idleTimers[lane] = null
  }
}

function scheduleIdleTeardown(lane: WorkerLane): void {
  clearIdleTeardown(lane)
  if (laneHasPendingJobs(lane)) {
    return
  }
  const delay = IDLE_TEARDOWN_MS[lane]
  if (!delay) {
    return
  }
  const timer = setTimeout(() => {
    idleTimers[lane] = null
    if (laneHasPendingJobs(lane)) {
      return
    }
    const worker = workers[lane]
    if (worker) {
      worker.terminate()
      workers[lane] = null
    }
    if (lane === 'report') {
      activeReportKey = null
    }
  }, delay)
  // Node returns a Timeout handle that would keep the event loop alive (and hang
  // tests); the browser returns a plain numeric id with no unref. Guard for both.
  ;(timer as unknown as { unref?: () => void }).unref?.()
  idleTimers[lane] = timer
}

function touchCacheEntry<T>(cache: Map<string, T>, key: string, value: T, limit: number): T {
  if (cache.has(key)) {
    cache.delete(key)
  }
  cache.set(key, value)
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) {
      break
    }
    cache.delete(oldestKey)
  }
  return value
}

function readCacheEntry<T>(cache: Map<string, T>, key: string): T | undefined {
  if (!cache.has(key)) {
    return undefined
  }
  const value = cache.get(key) as T
  cache.delete(key)
  cache.set(key, value)
  return value
}

function ensureWorker(lane: WorkerLane): Worker {
  if (workers[lane]) {
    return workers[lane]
  }

  const worker = new Worker(
    new URL('@/engine/evaluation/buildEvaluation.worker.ts', import.meta.url),
    { type: 'module' },
  )

  worker.onmessage = (event: MessageEvent<EvaluationWorkerOut>) => {
    const message = event.data
    const pending = pendingJobs.get(message.id)
    if (!pending || pending.lane !== lane) {
      return
    }

    pendingJobs.delete(message.id)
    if (message.ok) {
      pending.resolve(message.result)
    } else {
      pending.reject(new Error(message.error))
    }
    scheduleIdleTeardown(lane)
  }

  worker.onerror = (event) => {
    const error = new Error(event.message || 'Build evaluation worker failed unexpectedly')
    for (const [id, pending] of pendingJobs) {
      if (pending.lane === lane) {
        pending.reject(error)
        pendingJobs.delete(id)
      }
    }
    worker.terminate()
    if (workers[lane] === worker) workers[lane] = null
  }

  workers[lane] = worker
  return worker
}

export function cancelEvaluationReport(): void {
  if (activeReportCancel) {
    Atomics.store(activeReportCancel, 0, 1)
    activeReportCancel = null
  }
  if (activeReportKey) {
    inFlightJobs.delete(activeReportKey)
    activeReportKey = null
  }
}

function makeReportCancelFlag(): Int32Array | null {
  if (typeof SharedArrayBuffer === 'undefined') {
    return null
  }
  return new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
}

function reportJobMessage(
  payloadKey: string,
  payload: DefRotEvaluationIn,
  reportOptions: EvaluationReportOpts | undefined,
  cancelFlag: Int32Array | null,
): WorkerReq {
  return {
    key: payloadKey,
    type: 'report',
    payload,
    options: reportOptions,
    ...(cancelFlag ? { cancelBuf: cancelFlag.buffer as SharedArrayBuffer } : {}),
  }
}

function dispatchEvaluationJob(
  message: WorkerReq,
  lane: WorkerLane,
): Promise<unknown> {
  if (typeof Worker === 'undefined') {
    return Promise.reject(new Error('Build evaluation worker is not available'))
  }

  return new Promise((resolve, reject) => {
    const id = nextJobId++
    pendingJobs.set(id, { lane, resolve, reject })
    clearIdleTeardown(lane)
    ensureWorker(lane).postMessage({
      id,
      gameDataMode: getGameDataMode(),
      ...message,
    } satisfies EvaluationWorkerIn)
  })
}

function dispatchCachedEvaluationJob(
  key: string,
  message: WorkerReq,
  lane: WorkerLane,
): Promise<unknown> {
  const inFlight = inFlightJobs.get(key)
  if (inFlight) {
    return inFlight
  }

  const job = dispatchEvaluationJob(message, lane)
    .finally(() => {
      inFlightJobs.delete(key)
    })
  inFlightJobs.set(key, job)
  return job
}

export function runEvaluationReport(
  payload: DefRotEvaluationIn,
  options: {
    force?: boolean
    reportOptions?: EvaluationReportOpts
    cacheResult?: boolean
  } = {},
): Promise<BuildEvaluationReport | null> {
  // Equivalent omitted/default section options share one cache entry instead
  // of retaining duplicate reports under syntactically different requests.
  const canonicalOptions = canonicalReportOptions(options.reportOptions)
  const reportKey = makeEvaluationKey({
    payload,
    reportOptions: canonicalOptions,
  })
  const cacheResult = options.cacheResult !== false
  if (options.force) {
    reportCache.delete(reportKey)
  } else if (cacheResult) {
    const cached = readCacheEntry(reportCache, reportKey)
    if (cached !== undefined) {
      return Promise.resolve(cached)
    }
  }

  const key = `report:${reportKey}`
  if (activeReportKey && activeReportKey !== key) {
    cancelEvaluationReport()
  }
  activeReportKey = key
  const cancelFlag = makeReportCancelFlag()
  activeReportCancel = cancelFlag
  return dispatchCachedEvaluationJob(key, reportJobMessage(
    reportKey,
    payload,
    options.reportOptions,
    cancelFlag,
  ), 'report').then((report) => {
    const result = report as BuildEvaluationReport | null
    if (cacheResult) {
      touchCacheEntry(reportCache, reportKey, result, MAX_REPORT_CACHE)
    }
    return result
  }).finally(() => {
    if (activeReportKey === key) activeReportKey = null
    if (activeReportCancel === cancelFlag) activeReportCancel = null
  })
}
