/*
  Author: Runor Ewhro
  Description: browser-side client for dispatching build benchmark work to
               a dedicated worker.
*/

import type {
  BuildBenchmark,
  BuildBenchmarkReport,
  BenchmarkReportOpts,
  DefRotBenchIn,
} from '@/data/scoring/buildBenchmark'
import type {
  BenchWorkerIn,
  BenchWorkerOut,
} from '@/data/scoring/buildBenchmarkWorkerTypes'
import { makeBenchmarkKey } from '@/data/scoring/buildBenchmarkKey'

type WorkerLane = 'fast' | 'report'
type WorkerReq = BenchWorkerIn extends infer Job
  ? Job extends { id: number } ? Omit<Job, 'id'> : never
  : never

const workers: Record<WorkerLane, Worker | null> = {
  fast: null,
  report: null,
}
let nextJobId = 1
const MAX_SCORE_CACHE = 48
const MAX_DETAIL_CACHE = 12
const MAX_REPORT_CACHE = 6
let activeReportKey: string | null = null
let activeReportCancel: Int32Array | null = null
const FULL_REPORT_SECTIONS = {
  rotationFeatures: true,
  upgradePaths: true,
  echoStatsTable: true,
  benchmarkTargets: true,
} as const

const pendingJobs = new Map<number, {
  lane: WorkerLane
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}>()
const inFlightJobs = new Map<string, Promise<unknown>>()
const scoreCache = new Map<string, number | null>()
const detailCache = new Map<string, BuildBenchmark | null>()
const reportCache = new Map<string, BuildBenchmarkReport | null>()

// Idle teardown: each benchmark worker holds its own full copy of game data
// (~100 MB+). The report lane is bursty and only spun up when the detailed
// report view is open, so we terminate it shortly after it goes idle to reclaim
// that second copy. The fast lane is the steady-state score/detail path, so it
// is torn down only after a long idle, so normal interaction never pays a cold
// start. Completed results live in the client-side caches above, so teardown
// never loses work (re-requests hit the cache without dispatching).
const IDLE_TEARDOWN_MS: Record<WorkerLane, number> = {
  fast: 5 * 60_000,
  report: 20_000,
}
const idleTimers: Record<WorkerLane, ReturnType<typeof setTimeout> | null> = {
  fast: null,
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

function isFullReportOptions(options?: BenchmarkReportOpts): boolean {
  if (!options?.sections) {
    return true
  }
  return (
    (options.sections.rotationFeatures ?? FULL_REPORT_SECTIONS.rotationFeatures)
    && (options.sections.upgradePaths ?? FULL_REPORT_SECTIONS.upgradePaths)
    && (options.sections.echoStatsTable ?? FULL_REPORT_SECTIONS.echoStatsTable)
    && (options.sections.benchmarkTargets ?? FULL_REPORT_SECTIONS.benchmarkTargets)
  )
}

function ensureWorker(lane: WorkerLane): Worker {
  if (workers[lane]) {
    return workers[lane]
  }

  const worker = new Worker(
    new URL('@/data/scoring/buildBenchmark.worker.ts', import.meta.url),
    { type: 'module' },
  )

  worker.onmessage = (event: MessageEvent<BenchWorkerOut>) => {
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
    const error = new Error(event.message || 'Build benchmark worker failed unexpectedly')
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

export function cancelBenchReport(): void {
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
  payload: DefRotBenchIn,
  benchmark: BuildBenchmark | null | undefined,
  reportOptions: BenchmarkReportOpts | undefined,
  cancelFlag: Int32Array | null,
): WorkerReq {
  return {
    key: payloadKey,
    type: 'report',
    payload,
    benchmark,
    options: reportOptions,
    ...(cancelFlag ? { cancelBuf: cancelFlag.buffer as SharedArrayBuffer } : {}),
  }
}

function dispatchBenchmarkJob(
  message: WorkerReq,
  lane: WorkerLane,
): Promise<unknown> {
  if (typeof Worker === 'undefined') {
    return Promise.reject(new Error('Build benchmark worker is not available'))
  }

  return new Promise((resolve, reject) => {
    const id = nextJobId++
    pendingJobs.set(id, { lane, resolve, reject })
    clearIdleTeardown(lane)
    ensureWorker(lane).postMessage({ id, ...message } satisfies BenchWorkerIn)
  })
}

function dispatchBenchJob(
  key: string,
  message: WorkerReq,
  lane: WorkerLane,
): Promise<unknown> {
  const inFlight = inFlightJobs.get(key)
  if (inFlight) {
    return inFlight
  }

  const job = dispatchBenchmarkJob(message, lane)
    .finally(() => {
      inFlightJobs.delete(key)
    })
  inFlightJobs.set(key, job)
  return job
}

export function runBenchScore(
  payload: DefRotBenchIn,
): Promise<number | null> {
  const payloadKey = makeBenchmarkKey(payload)
  const report = readCacheEntry(reportCache, payloadKey)
  if (report !== undefined) {
    return Promise.resolve(report ? report.benchmark.percent * 100 : null)
  }

  const detail = readCacheEntry(detailCache, payloadKey)
  if (detail !== undefined) {
    return Promise.resolve(detail ? detail.percent * 100 : null)
  }

  const cached = readCacheEntry(scoreCache, payloadKey)
  if (cached !== undefined) {
    return Promise.resolve(cached)
  }

  const key = `score:${payloadKey}`
  return dispatchBenchJob(key, {
    key: payloadKey,
    type: 'score',
    payload,
  }, 'fast').then((score) => touchCacheEntry(scoreCache, payloadKey, score as number | null, MAX_SCORE_CACHE))
}

export function peekBenchScore(
  payload: DefRotBenchIn,
): number | null | undefined {
  const payloadKey = makeBenchmarkKey(payload)
  const detail = readCacheEntry(detailCache, payloadKey)
  if (detail !== undefined) {
    return detail ? detail.percent * 100 : null
  }
  return readCacheEntry(scoreCache, payloadKey)
}

export function runBenchDetail(
  payload: DefRotBenchIn,
): Promise<BuildBenchmark | null> {
  const payloadKey = makeBenchmarkKey(payload)
  const report = readCacheEntry(reportCache, payloadKey)
  if (report !== undefined) {
    return Promise.resolve(report?.benchmark ?? null)
  }

  const cached = readCacheEntry(detailCache, payloadKey)
  if (cached !== undefined) {
    return Promise.resolve(cached)
  }

  const key = `detail:${payloadKey}`
  return dispatchBenchJob(key, {
    key: payloadKey,
    type: 'benchmark',
    payload,
  }, 'fast').then((benchmark) => {
    const result = benchmark as BuildBenchmark | null
    touchCacheEntry(detailCache, payloadKey, result, MAX_DETAIL_CACHE)
    touchCacheEntry(scoreCache, payloadKey, result ? result.percent * 100 : null, MAX_SCORE_CACHE)
    return result
  })
}

// Warm the worker's anchor cache for a build ahead of time (e.g. the moment a
// resonator is selected) so the multi-second 0/100/200 search is already done
// by the time the user looks at or edits the benchmark. This reuses the
// score path, so it shares the in-flight dedup and result caches; the result is
// intentionally discarded and failures are swallowed.
export function prefetchBench(payload: DefRotBenchIn): void {
  void runBenchScore(payload).catch(() => {})
}

export function runBenchReport(
  payload: DefRotBenchIn,
  options: { force?: boolean; reportOptions?: BenchmarkReportOpts } = {},
): Promise<BuildBenchmarkReport | null> {
  const payloadKey = makeBenchmarkKey(payload)
  const reportKey = makeBenchmarkKey({
    payload,
    reportOptions: options.reportOptions ?? {},
  })
  if (options.force) {
    reportCache.delete(reportKey)
    detailCache.delete(payloadKey)
    scoreCache.delete(payloadKey)
  } else {
    const cached = readCacheEntry(reportCache, reportKey)
    if (cached !== undefined) {
      return Promise.resolve(cached)
    }
  }

  const key = `report:${reportKey}`
  const benchmark = options.force ? undefined : readCacheEntry(detailCache, payloadKey)
  if (activeReportKey && activeReportKey !== key) {
    cancelBenchReport()
  }
  activeReportKey = key
  const cancelFlag = makeReportCancelFlag()
  activeReportCancel = cancelFlag
  return dispatchBenchJob(key, reportJobMessage(
    reportKey,
    payload,
    benchmark,
    options.reportOptions,
    cancelFlag,
  ), 'report').then((report) => {
    const result = report as BuildBenchmarkReport | null
    touchCacheEntry(reportCache, reportKey, result, MAX_REPORT_CACHE)
    if (isFullReportOptions(options.reportOptions)) {
      touchCacheEntry(detailCache, payloadKey, result?.benchmark ?? null, MAX_DETAIL_CACHE)
    }
    touchCacheEntry(scoreCache, payloadKey, result ? result.benchmark.percent * 100 : null, MAX_SCORE_CACHE)
    return result
  }).finally(() => {
    if (activeReportKey === key) activeReportKey = null
    if (activeReportCancel === cancelFlag) activeReportCancel = null
  })
}
