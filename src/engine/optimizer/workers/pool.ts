/*
  Author: Runor Ewhro
  Description: Manages the optimizer worker pool, dispatches GPU/CPU jobs,
               tracks progress, handles cancellation, and merges partial
               search results into final optimizer output.
*/

import {
  CPU_JOB_SIZE,
  TARGET_GPU_JOB,
  ROT_GPU_JOB,
  MIN_PAR_COMBOS,
  CPU_THEORY_JOB,
  GPU_THEORY_JOB,
  WORKER_COUNT,
} from '@/engine/optimizer/config/constants.ts'
import {countMainCombos} from '@/engine/optimizer/search/counting.ts'
import {OptResultSet} from '@/engine/optimizer/results/collector.ts'
import {gnrtTgtCpuCm} from '@/engine/optimizer/target/batches.ts'
import {gnrtThryCpuCm} from '@/engine/optimizer/target/theoryBatches.ts'
import {
  packTargetSkill,
  shrPckdTgtSk,
} from '@/engine/optimizer/payloads/targetPayload.ts'
import {
  packRotation,
  shrPckdRotXc,
} from '@/engine/optimizer/payloads/rotationPayload.ts'
import { packTargetCtx } from '@/engine/optimizer/context/pack.ts'
import { runTgtSrchBt } from '@/engine/optimizer/search/targetCpu.ts'
import { runRotSrchBt } from '@/engine/optimizer/search/rotationCpu.ts'
import type {
  OptBckn,
  OptBagResult,
  OptPrgr,
  OptRawResult,
  PckdOptXctnP,
  PckdRotXctnP,
  PrepOptPay,
  PrepRotRun,
  PrepTheoryRot,
  PrepTheoryTarget,
  PrepTargetSkill,
} from '@/engine/optimizer/types.ts'
import type {
  TargetGpuState,
  OptTaskDoneM,
  OptTaskInMsg,
  OptTaskOutMs,
  OptThryProdIn,
  OptThryProdOu,
} from '@/engine/optimizer/workers/messages.ts'
import {
  makeTargetGpu,
  mkTgtJobs,
  type TgtJobSpec,
} from '@/engine/optimizer/workers/targetGpu.ts'
import {logOptimizer} from '@/engine/optimizer/config/log.ts'

// guardrails for GPU result collection so per-job and collector heaps do not blow up
const GPU_RESULT_LIMIT = 65536
const TGTGPUJOBVRS = 2
const GPU_COLLECT_MUL = 8
const WORKER_TASK_MS = 300_000
const PRGRRATEMIN = 1_500
const PRGRRATEWND = 8_000

interface PoolRunHooks {
  isCancelled?: () => boolean
  onProgress?: (progress: OptPrgr) => void
}

type OptPoolGpuMode = 'target' | 'rotation'

// one queued GPU target job defined by a contiguous combo range
interface TargetGpuJob {
  type: 'runTarget'
  runId: number
  size: number
  comboStart: number
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
  onProgress?: (delta: number) => void
  resolve: (message: OptTaskDoneM) => void
  reject: (error: Error) => void
}

// one queued CPU batch job defined by an explicit batch of combinadic rows
interface TargetCpuJob {
  type: 'runTargetCpuBatch'
  runId: number
  size: number
  combosBatch: Int32Array
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
  onProgress?: (delta: number) => void
  resolve: (message: OptTaskDoneM) => void
  reject: (error: Error) => void
}

interface GpuBatchJob {
  type: 'runGpuBatch'
  runId: number
  size: number
  combosBatch: Int32Array
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
  onProgress?: (delta: number) => void
  resolve: (message: OptTaskDoneM) => void
  reject: (error: Error) => void
}

type OptPoolJob =
    | TargetGpuJob
    | TargetCpuJob
    | GpuBatchJob

interface OptPoolCpuRu {
  kind: 'cpu'
  payload: PckdOptXctnP
}

interface OptPoolGpuRu {
  kind: 'gpu'
  mode: OptPoolGpuMode
  payload: TargetGpuState | PckdRotXctnP
}

type OptPoolRunCt =
    | OptPoolCpuRu
    | OptPoolGpuRu

// each worker keeps only the bits needed to know whether it can reuse
// a cached cpu payload or a lazily initialized gpu backend.
interface OptPoolWrkr {
  worker: Worker
  currentJob: OptPoolJob | null
  cpuPayLdd: boolean
  gpuBackend: OptPoolGpuMode | null
}

// global worker-pool state reused across optimizer runs
let workers: OptPoolWrkr[] = []
let queue: OptPoolJob[] = []
let nextRunId = 1
let activeRunId: number | null = null
// the active run context is shared by the pool, but actual reuse happens
// inside each worker once its first task lands.
let actRunCtx: OptPoolRunCt | null = null
// the theory combo producers are kept warm across runs so they hydrate game
// data only once each (cached internally). multiple producers shard the
// (set-plan, main-row) unit space so combo generation, the dominant cost of a
// theory run, parallelizes across CPU cores instead of serializing on one
// thread while the GPU sits idle. torn down in rstOptWrkrPo / cnclActOptWr.
let thryProducers: Worker[] = []

// ensure at least `count` warm producer workers exist; returns the first
// `count` of them.
function ensThryProds(count: number): Worker[] {
  while (thryProducers.length < count) {
    thryProducers.push(new Worker(
        new URL('@/engine/optimizer/workers/theoryProducer.worker.ts', import.meta.url),
        { type: 'module' },
    ))
  }
  return thryProducers.slice(0, count)
}

function stopThryProd(): void {
  for (const producer of thryProducers) {
    producer.terminate()
  }
  thryProducers = []
}

function hasShrdRryBf(): boolean {
  return typeof SharedArrayBuffer !== 'undefined'
}

// scale a result limit upward for GPU local collection, but clamp it hard
function clmpTgtGpuRs(resultsLimit: number, oversample: number): number {
  const baseLimit = Math.max(1, Math.floor(resultsLimit || 1))
  return Math.min(
      Math.max(Math.floor(baseLimit * oversample), baseLimit),
      GPU_RESULT_LIMIT,
  )
}

// result cap for an individual GPU job before merging. low-memory drops
// the oversample factor so the GPU output buffer allocates only what the
// user asked for, not 2-8x.
export function resTgtGpuJob(resultsLimit: number, lowMem = false): number {
  return clmpTgtGpuRs(resultsLimit, lowMem ? 1 : TGTGPUJOBVRS)
}

// larger result cap for the shared collector that merges job outputs.
// low-memory collapses the collector oversample to 1 for the same reason.
export function resTgtGpuCll(resultsLimit: number, lowMem = false): number {
  return clmpTgtGpuRs(resultsLimit, lowMem ? 1 : GPU_COLLECT_MUL)
}

// create a progress tracker that accumulates processed work and emits conservative speed estimates
function mkPrgrTrck(
    ttlForPrgr: number,
    onProgress?: (progress: OptPrgr) => void,
    initialPhase: import('@/engine/optimizer/types').OptPrgrPh = 'evaluating',
) {
  let curTotal = Math.max(0, ttlForPrgr)
  let ttlPrcs = 0
  let phase: import('@/engine/optimizer/types').OptPrgrPh = initialPhase
  let discovered = 0
  const startTime = performance.now()
  let evalStart = initialPhase === 'evaluating' ? startTime : 0
  const ratePts: Array<{ time: number; done: number }> = []

  // report conservative wall-clock throughput instead of averaging per-message
  // bursts. worker progress arrives in chunks, so instantaneous rates can be
  // much higher than the run can sustain.
  const calcSpeed = (now: number) => {
    if (phase !== 'evaluating' || evalStart <= 0) {
      return 0
    }

    const done = curTotal > 0 ? Math.min(ttlPrcs, curTotal) : ttlPrcs
    const elapsed = now - evalStart
    if (done <= 0 || elapsed < PRGRRATEMIN) {
      return 0
    }

    const fullRate = done / elapsed
    const cutoff = now - PRGRRATEWND
    while (ratePts.length > 1 && ratePts[0].time < cutoff) {
      ratePts.shift()
    }

    const base = ratePts[0]
    if (!base || now - base.time < PRGRRATEMIN || done <= base.done) {
      return fullRate
    }

    const winRate = (done - base.done) / (now - base.time)
    return Math.min(fullRate, winRate)
  }

  const emit = (now: number) => {
    if (!onProgress) {
      return
    }

    const speed = calcSpeed(now)
    let remainingMs = Infinity
    if (phase === 'evaluating' && speed > 0) {
      const combosLeft = Math.max(0, curTotal - ttlPrcs)
      remainingMs = combosLeft / speed
    }

    const progress = curTotal > 0
        ? Math.min(1, ttlPrcs / curTotal)
        : 0

    onProgress({
      progress,
      elapsedMs: now - startTime,
      remainingMs,
      processed: curTotal > 0 ? Math.min(ttlPrcs, curTotal) : ttlPrcs,
      speed: speed * 1000,
      total: curTotal,
      phase,
      discovered,
    })
  }

  // push an initial snapshot so subscribers see the exact denominator before
  // the first worker batch reports; otherwise the UI falls back to its
  // reactive countTheory estimate (the looser upper bound) until evaluation
  // actually starts producing progress events.
  emit(performance.now())

  return {
    // let generated-batch paths raise the total as the real work queue expands
    setTotal(total: number, exact = false) {
      curTotal = exact
          ? Math.max(0, total)
          : Math.max(curTotal, total)
      emit(performance.now())
    },

    // record what the discovery producer has emitted so far. only meaningful
    // while phase === 'discovering'; safe to call afterward as a final tally.
    setDiscovered(count: number) {
      discovered = Math.max(discovered, count)
      emit(performance.now())
    },

    // switch the run from discovery to evaluation. resets the speed estimator
    // so evaluation throughput is not skewed by the (much faster) producer's
    // contribution.
    setPhase(next: import('@/engine/optimizer/types').OptPrgrPh) {
      if (phase === next) {
        return
      }
      phase = next
      if (next === 'evaluating') {
        evalStart = performance.now()
        ratePts.length = 0
      }
      emit(performance.now())
    },

    // apply a processed delta and update speed estimates
    applyPrgr(delta: number) {
      ttlPrcs += delta

      const now = performance.now()
      if (phase === 'evaluating') {
        const done = curTotal > 0 ? Math.min(ttlPrcs, curTotal) : ttlPrcs
        const last = ratePts[ratePts.length - 1]
        if (!last || done > last.done) {
          ratePts.push({ time: now, done })
        }
      }

      emit(now)
    },

    // force completion state at the end of a run
    complete() {
      ttlPrcs = curTotal
      emit(performance.now())
    },
  }
}

// reject every queued job that has not been dispatched yet
function rjctQdJobs(reason: Error): void {
  const pending = queue
  queue = []

  for (const job of pending) {
    job.reject(reason)
  }
}

// fully dispose a worker handle, rejecting anything waiting on it
function dspsWrkrOn(handle: OptPoolWrkr, reason: Error): void {
  if (handle.currentJob) {
    handle.currentJob.reject(reason)
  }

  handle.currentJob = null
  handle.cpuPayLdd = false
  handle.gpuBackend = null
  handle.worker.terminate()
}

function resWrkrJobMs(
    handle: OptPoolWrkr,
    job: OptPoolJob,
): {
  message: OptTaskInMsg
  trns: Transferable[]
} {
  if (!actRunCtx) {
    throw new Error('Optimizer worker run context is missing')
  }

  if (job.type === 'runTargetCpuBatch') {
    if (actRunCtx.kind !== 'cpu') {
      throw new Error('CPU optimizer job was dispatched without a CPU run context')
    }

    const message: OptTaskInMsg = {
      type: 'runTargetCpuBatch',
      runId: job.runId,
      payload: handle.cpuPayLdd ? undefined : actRunCtx.payload,
      combosBatch: job.combosBatch,
      comboCount: job.comboCount,
      lockMainIdx: job.lockMainIdx,
      jobResultLimit: job.jobResultLimit,
    }

    // once a worker sees the payload once, later cpu tasks can stay small.
    handle.cpuPayLdd = true

    return {
      message,
      trns: [job.combosBatch.buffer],
    }
  }

  if (actRunCtx.kind !== 'gpu') {
    throw new Error('GPU optimizer job was dispatched without a GPU run context')
  }

  if (actRunCtx.mode === 'target') {
    if (job.type === 'runGpuBatch') {
      const message: OptTaskInMsg = {
        type: 'runTargetGpuBatch',
        runId: job.runId,
        combosBatch: job.combosBatch,
        comboCount: job.comboCount,
        lockMainIdx: job.lockMainIdx,
        jobResultLimit: job.jobResultLimit,
        btstPay: handle.gpuBackend === 'target'
          ? undefined
          : actRunCtx.payload as TargetGpuState,
      }

      handle.gpuBackend = 'target'
      return { message, trns: [job.combosBatch.buffer] }
    }

    const message: OptTaskInMsg = {
      type: 'runTargetGpu',
      runId: job.runId,
      comboStart: job.comboStart,
      comboCount: job.comboCount,
      lockMainIdx: job.lockMainIdx,
      jobResultLimit: job.jobResultLimit,
      btstPay: handle.gpuBackend === 'target'
        ? undefined
        : actRunCtx.payload as TargetGpuState,
    }

    // only the first target gpu task per worker needs the bootstrap payload.
    handle.gpuBackend = 'target'
    return { message, trns: [] }
  }

  if (job.type === 'runGpuBatch') {
    const message: OptTaskInMsg = {
      type: 'runRotationGpuBatch',
      runId: job.runId,
      combosBatch: job.combosBatch,
      comboCount: job.comboCount,
      lockMainIdx: job.lockMainIdx,
      jobResultLimit: job.jobResultLimit,
      btstPay: handle.gpuBackend === 'rotation'
        ? undefined
        : actRunCtx.payload as PckdRotXctnP,
    }

    handle.gpuBackend = 'rotation'
    return { message, trns: [job.combosBatch.buffer] }
  }

  const message: OptTaskInMsg = {
    type: 'runRotationGpu',
    runId: job.runId,
    comboStart: job.comboStart,
    comboCount: job.comboCount,
    lockMainIdx: job.lockMainIdx,
    jobResultLimit: job.jobResultLimit,
    btstPay: handle.gpuBackend === 'rotation'
      ? undefined
      : actRunCtx.payload as PckdRotXctnP,
  }

  // same idea for rotation gpu workers.
  handle.gpuBackend = 'rotation'
  return { message, trns: [] }
}

// send the next assigned job to a worker using request-scoped listeners instead
// of a persistent worker "ready" handshake.
function dispWrkrJob(handle: OptPoolWrkr, job: OptPoolJob): void {
  handle.currentJob = job

  let message: OptTaskInMsg
  let trns: Transferable[] = []

  try {
    const resolved = resWrkrJobMs(handle, job)
    message = resolved.message
    trns = resolved.trns
  } catch (error) {
    handle.currentJob = null
    job.reject(error instanceof Error ? error : new Error(String(error)))
    schdQdJobs()
    return
  }

  const worker = handle.worker
  const timeoutLabel = message.type
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const cleanup = () => {
    if (timeoutId != null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    worker.removeEventListener('message', onMessage)
    worker.removeEventListener('error', onError)
  }

  const fnshWithRrr = (error: Error) => {
    cleanup()
    if (handle.currentJob === job) {
      handle.currentJob = null
    }
    job.reject(error)
    schdQdJobs()
  }

  const armTimeout = () => {
    if (timeoutId != null) {
      clearTimeout(timeoutId)
    }
    // turn silent worker stalls into a surfaced optimizer error.
    timeoutId = setTimeout(() => {
      fnshWithRrr(new Error(`Optimizer worker task timed out: ${timeoutLabel}`))
    }, WORKER_TASK_MS)
  }

  const onMessage = (event: MessageEvent<OptTaskOutMs>) => {
    const wrkrMsg = event.data

    if (!wrkrMsg || wrkrMsg.runId !== job.runId) {
      return
    }

    if (wrkrMsg.type === 'progress') {
      job.onProgress?.(wrkrMsg.prcsDlt)
      armTimeout()
      return
    }

    cleanup()

    if (handle.currentJob === job) {
      handle.currentJob = null
    }

    if (wrkrMsg.type === 'error') {
      job.reject(new Error(wrkrMsg.message))
    } else {
      job.resolve(wrkrMsg)
    }

    schdQdJobs()
  }

  const onError = (event: ErrorEvent) => {
    fnshWithRrr(new Error(event.message || 'Optimizer task worker failed unexpectedly'))
  }

  worker.addEventListener('message', onMessage)
  worker.addEventListener('error', onError)
  armTimeout()

  try {
    if (trns.length > 0) {
      worker.postMessage(message, trns)
    } else {
      worker.postMessage(message)
    }
  } catch (error) {
    fnshWithRrr(error instanceof Error ? error : new Error(String(error)))
  }
}

// feed idle workers from the size-prioritized queue
function schdQdJobs(): void {
  if (queue.length === 0) {
    return
  }

  for (const handle of workers) {
    if (handle.currentJob) {
      continue
    }

    const job = queue.shift()
    if (!job) {
      return
    }

    dispWrkrJob(handle, job)
  }
}

// construct one worker handle and wire all lifecycle message handlers
function mkWrkrOn(): OptPoolWrkr {
  const worker = new Worker(
      new URL('@/engine/optimizer/workers/task.worker.ts', import.meta.url),
      { type: 'module' },
  )

  return {
    worker,
    currentJob: null,
    cpuPayLdd: false,
    gpuBackend: null,
  }
}

// ensure the global pool has exactly the requested number of workers
function ensWrkrPool(count: number): OptPoolWrkr[] {
  if (workers.length === count) {
    return workers
  }

  logOptimizer('[optimizer:pool] creating worker pool', { count, previous: workers.length })
  rstOptWrkrPo()
  workers = Array.from({ length: count }, () => mkWrkrOn())
  return workers
}

// tear down the entire pool and reject anything waiting
export function rstOptWrkrPo(): void {
  if (workers.length > 0 || queue.length > 0) {
    logOptimizer('[optimizer:pool] resetting worker pool', {
      workerCount: workers.length,
      queuedJobs: queue.length,
    })
  }

  const reason = new Error('Optimizer worker pool reset')

  rjctQdJobs(reason)

  for (const handle of workers) {
    dspsWrkrOn(handle, reason)
  }

  workers = []
  activeRunId = null
  actRunCtx = null
}

// cancel the active run on every worker and then reset the pool
export function cnclActOptWr(): void {
  if (activeRunId == null) {
    return
  }

  const runId = activeRunId
  logOptimizer('[optimizer:pool] cancelling active run', { runId, workerCount: workers.length })

  for (const handle of workers) {
    const message: OptTaskInMsg = {
      type: 'cancel',
      runId,
    }
    handle.worker.postMessage(message)
  }

  activeRunId = null
  // explicit cancel is a teardown point, so free the warm producer too.
  stopThryProd()
  rstOptWrkrPo()
}

// insert jobs into the queue ordered by size so larger jobs get dispatched first
function enqueueJob(job: OptPoolJob): void {
  let index = 0
  while (index < queue.length && queue[index].size <= job.size) {
    index += 1
  }

  queue.splice(index, 0, job)
  schdQdJobs()
}

// helper to run one GPU-style range job through the queue
async function runTgtWrkrJo(
    runId: number,
    job: TgtJobSpec,
    jobResultLimit: number,
    onProgress?: (delta: number) => void,
): Promise<OptTaskDoneM> {
  return new Promise<OptTaskDoneM>((resolve, reject) => {
    enqueueJob({
      type: 'runTarget',
      runId,
      size: job.comboCount,
      comboStart: job.comboStart,
      comboCount: job.comboCount,
      lockMainIdx: job.lockMainIdx,
      jobResultLimit: jobResultLimit,
      onProgress,
      resolve,
      reject,
    })
  })
}

// helper to run one CPU combinadic-batch job through the queue
async function runTgtCpuBtc(
    runId: number,
    combosBatch: Int32Array,
    comboCount: number,
    lockedMainIndex: number,
    jobResultLimit: number,
    onProgress?: (delta: number) => void,
): Promise<OptTaskDoneM> {
  return new Promise<OptTaskDoneM>((resolve, reject) => {
    enqueueJob({
      type: 'runTargetCpuBatch',
      runId,
      size: comboCount,
      combosBatch,
      comboCount,
      lockMainIdx: lockedMainIndex,
      jobResultLimit: jobResultLimit,
      onProgress,
      resolve,
      reject,
    })
  })
}

async function runGpuBtc(
    runId: number,
    combosBatch: Int32Array,
    comboCount: number,
    lockedMainIndex: number,
    jobResultLimit: number,
    onProgress?: (delta: number) => void,
): Promise<OptTaskDoneM> {
  return new Promise<OptTaskDoneM>((resolve, reject) => {
    enqueueJob({
      type: 'runGpuBatch',
      runId,
      size: comboCount,
      combosBatch,
      comboCount,
      lockMainIdx: lockedMainIndex,
      jobResultLimit: jobResultLimit,
      onProgress,
      resolve,
      reject,
    })
  })
}

// merge a batch of result refs into the shared top-k collector
function mergeResults(
    collector: OptResultSet,
    results: readonly OptBagResult[],
): void {
  for (const result of results) {
    collector.push(result)
  }
}

function isBagRslt(result: OptRawResult): result is OptBagResult {
  return !('ids' in result)
}

// shrink the per-job combo batch when the user opts into low-memory mode.
// each combo batch is an Int32Array of (batchSize * 5) entries, so halving
// the count directly halves the per-buffer allocation. with max-in-flight
// already pinned at 1 in low-mem, batch buffers are the largest transient
// allocation left in the run; this is where the real RSS savings come from.
function bchSzFr(normal: number, lowMem: boolean): number {
  return lowMem ? Math.max(1, Math.floor(normal / 2)) : normal
}

function mkThryXctPay(
    payload: PrepTheoryTarget | PrepTheoryRot,
): PckdOptXctnP {
  if (payload.mode === 'theoryRotation') {
    return {
      ...payload,
      mode: 'rotation',
    }
  }

  return {
    ...payload,
    mode: 'targetSkill',
    context: packTargetCtx({
      compiled: payload.compiled,
      skill: payload.skill,
      runtime: payload.runtime,
      comboN: payload.comboN,
      comboK: payload.comboK,
      comboCount: payload.totalCombos,
      comboBaseIndex: 0,
      lockEchoIdx: payload.lockMainCands[0] ?? -1,
      setRtMask: payload.setRtMask,
    }),
  }
}

// drive the theory orchestrator without a producer worker. used only in
// environments where Worker is unavailable (e.g. vitest in plain Node).
async function runThryBtcInP(
    payload: PrepTheoryTarget | PrepTheoryRot,
    execution: PckdOptXctnP,
    effectResultMax: number,
    totalCombos: number,
    runId: number,
    progress: ReturnType<typeof mkPrgrTrck>,
    collector: OptResultSet,
    hooks: PoolRunHooks,
): Promise<void> {
  const effBatch = bchSzFr(CPU_THEORY_JOB, payload.lowMmryMode)
  const freeBtchBffr: Int32Array[] = []
  const iterator = gnrtThryCpuCm({
    payload,
    batchSize: effBatch,
    borrowBuffer: (length) => freeBtchBffr.pop() ?? new Int32Array(length),
  })
  let genCmbs = 0

  for (const batch of iterator) {
    const rmnnCmbs = totalCombos - genCmbs
    if (rmnnCmbs <= 0) {
      break
    }

    const comboCount = Math.min(batch.comboCount, rmnnCmbs)
    genCmbs += comboCount

    if (activeRunId !== runId || hooks.isCancelled?.()) {
      return
    }

    const results = execution.mode === 'rotation'
        ? await runRotSrchBt(
            execution,
            {
              combosBatch: batch.combos,
              comboCount,
              lockMainIdx: batch.lockMainIdx,
              jobResultLimit: effectResultMax,
            },
            {
              isCancelled: hooks.isCancelled,
              onProcessed: progress.applyPrgr,
            },
          )
        : await runTgtSrchBt(
            execution,
            {
              combosBatch: batch.combos,
              comboCount,
              lockMainIdx: batch.lockMainIdx,
              jobResultLimit: effectResultMax,
            },
            {
              isCancelled: hooks.isCancelled,
              onProcessed: progress.applyPrgr,
            },
          )

    mergeResults(collector, results)

    if (genCmbs >= totalCombos) {
      break
    }
  }
}

async function runThryBtcWr(
    payload: PrepTheoryTarget | PrepTheoryRot,
    backend: OptBckn,
    hooks: PoolRunHooks = {},
): Promise<OptBagResult[]> {
  const runT0 = performance.now()
  const totalCombos = payload.theoryTotal
  if (totalCombos <= 0) {
    return []
  }

  const lowMmryMode = payload.lowMmryMode
  const useGpu = backend === 'gpu' && typeof Worker !== 'undefined'
  const workerTarget = lowMmryMode
      ? 1
      : totalCombos < MIN_PAR_COMBOS
          ? 1
          : useGpu
            ? WORKER_COUNT.gpu
            : WORKER_COUNT.cpu
  const effBatch = bchSzFr(useGpu ? GPU_THEORY_JOB : CPU_THEORY_JOB, lowMmryMode)
  const stmtJobs = Math.max(
      1,
      Math.ceil(totalCombos / Math.max(1, effBatch)),
  )
  const workerCount = typeof Worker === 'undefined'
      ? 0
      : Math.min(workerTarget, stmtJobs)
  if (workerCount > 0) {
    ensWrkrPool(workerCount)
  }

  const runId = nextRunId++
  activeRunId = runId
  logOptimizer('[optimizer:theory] run start', {
    runId,
    mode: payload.mode,
    totalCombos,
    theoryRows: payload.theoryRows.length,
    resultLimit: payload.resultsLimit,
    lowMemoryMode: lowMmryMode,
    workerTarget,
    workerCount,
    batchSize: effBatch,
    statedJobs: stmtJobs,
    backend: useGpu ? 'gpu' : 'cpu',
  })

  // totalCombos comes from prnThryRows -> cntThryEmt and is exact, so the
  // tracker can start in 'evaluating' from t=0. no discovery phase is needed.
  const progress = mkPrgrTrck(totalCombos, hooks.onProgress, 'evaluating')
  const effectResultMax = payload.resultsLimit
  const jobResultLimit = useGpu
      ? resTgtGpuJob(effectResultMax, payload.lowMmryMode)
      : effectResultMax
  const collector = new OptResultSet(effectResultMax, payload.lowMmryMode)
  const execution = mkThryXctPay(payload)
  actRunCtx = useGpu
      ? {
        kind: 'gpu',
        mode: payload.mode === 'theoryRotation' ? 'rotation' : 'target',
        payload: payload.mode === 'theoryRotation'
            ? packRotation(payload)
            : makeTargetGpu(payload),
      }
      : {
        kind: 'cpu',
        payload: execution.mode === 'rotation'
            ? shrPckdRotXc(execution)
            : shrPckdTgtSk(execution),
      }

  // detaches this run's listeners from the warm producer workers; set once the
  // producer path wires them up. invoked in finally so the shared workers are
  // left clean regardless of how the run exits.
  let detachProducer: (() => void) | null = null

  // theory production (combo enumeration) is the dominant cost of a GPU run and
  // is embarrassingly parallel over (set-plan, main-row) units, so shard it
  // across CPU cores. CPU-backend runs already saturate cores with evaluation
  // workers, so they keep a single producer to avoid oversubscription.
  //
  // use as many producers as the CPU worker budget allows: finishing the
  // generation sooner is what matters. (on thermally constrained machines the
  // total combos/sec is capped by the power envelope regardless of producer
  // count, so fewer-but-longer-running producers only sustain the load and
  // throttle harder; more producers that finish faster is never worse.)
  const producerCount = (useGpu && !lowMmryMode && totalCombos >= MIN_PAR_COMBOS)
      ? Math.min(WORKER_COUNT.cpu, stmtJobs)
      : 1

  try {
    if (workerCount <= 0) {
      await runThryBtcInP(
          payload,
          execution,
          effectResultMax,
          totalCombos,
          runId,
          progress,
          collector,
          hooks,
      )
    } else {
      // reuse the warm producer workers across runs; their game-data hydration
      // persists. per-run message listeners are added/removed below so the
      // shared workers stay clean between runs.
      const producers = ensThryProds(producerCount)

      const rsblBtchLngt = effBatch * 5
      const inFlight = new Set<Promise<void>>()
      const maxInFlghJob = lowMmryMode ? 1 : Math.max(1, workerCount)
      const batchQueue: Array<{
        combos: Int32Array
        comboCount: number
        lockMainIdx: number
        src: Worker
      }> = []
      // number of producers still streaming; production is finished only when
      // every shard has reported done and the queue has drained.
      let producersRemaining = producers.length
      let producerError: Error | null = null
      let pendingResolve: (() => void) | null = null
      let genCmbs = 0
      let jobsSent = 0
      let jobsDone = 0
      let rsltsSeen = 0

      const wake = () => {
        const resolve = pendingResolve
        pendingResolve = null
        if (resolve) {
          resolve()
        }
      }

      // wire one producer's message/error listeners, tagging batches with their
      // source worker so returned reuse buffers go back to the right producer.
      const detachers: Array<() => void> = []
      for (const producer of producers) {
        const onMessage = (event: MessageEvent<OptThryProdOu>) => {
          const msg = event.data
          if (msg.runId !== runId) {
            return
          }

          if (msg.type === 'theoryBatch') {
            batchQueue.push({
              combos: msg.combos,
              comboCount: msg.comboCount,
              lockMainIdx: msg.lockMainIdx,
              src: producer,
            })
            wake()
            return
          }

          if (msg.type === 'theoryProducerDone') {
            producersRemaining -= 1
            wake()
            return
          }

          producerError = new Error(msg.message)
          wake()
        }

        const onError = (event: ErrorEvent) => {
          producerError = new Error(event.message || 'Theory producer worker failed unexpectedly')
          wake()
        }

        producer.addEventListener('message', onMessage)
        producer.addEventListener('error', onError)
        detachers.push(() => {
          producer.removeEventListener('message', onMessage)
          producer.removeEventListener('error', onError)
        })
      }

      detachProducer = () => {
        for (const detach of detachers) {
          detach()
        }
      }

      const cancelAllProducers = () => {
        const cancelMsg: OptThryProdIn = {
          type: 'cancelTheoryProducer',
          runId,
        }
        for (const producer of producers) {
          producer.postMessage(cancelMsg)
        }
      }

      producers.forEach((producer, index) => {
        const startMsg: OptThryProdIn = {
          type: 'startTheoryProducer',
          runId,
          payload,
          batchSize: effBatch,
          shard: { index, count: producers.length },
        }
        producer.postMessage(startMsg)
      })

      while (true) {
        if (activeRunId !== runId || hooks.isCancelled?.()) {
          cancelAllProducers()
          break
        }

        if (producerError) {
          throw producerError
        }

        if (batchQueue.length === 0) {
          if (producersRemaining <= 0) {
            break
          }
          await new Promise<void>((resolve) => {
            pendingResolve = resolve
          })
          continue
        }

        const batch = batchQueue.shift()!
        const rmnnCmbs = totalCombos - genCmbs
        if (rmnnCmbs <= 0) {
          // tell the producers we're done; drain their trailing messages.
          cancelAllProducers()
          break
        }

        const comboCount = Math.min(batch.comboCount, rmnnCmbs)
        genCmbs += comboCount
        jobsSent += 1

        const localProducer = batch.src
        const jobPromise = (useGpu ? runGpuBtc : runTgtCpuBtc)(
            runId,
            batch.combos,
            comboCount,
            batch.lockMainIdx,
            jobResultLimit,
            (delta) => {
              if (activeRunId !== runId) {
                return
              }
              progress.applyPrgr(delta)
            },
        )
            .then((done) => {
              if (activeRunId !== runId) {
                return
              }
              mergeResults(collector, done.results.filter(isBagRslt))
              if (useGpu) {
                progress.applyPrgr(comboCount)
              }
              jobsDone += 1
              rsltsSeen += done.results.length

              if (
                  done.rtrnCmbsBtch &&
                  done.rtrnCmbsBtch.length === rsblBtchLngt &&
                  activeRunId === runId
              ) {
                const returnMsg: OptThryProdIn = {
                  type: 'returnTheoryBuffer',
                  runId,
                  buffer: done.rtrnCmbsBtch,
                  lowMem: lowMmryMode,
                }
                localProducer.postMessage(returnMsg, [done.rtrnCmbsBtch.buffer])
              }
            })
            .finally(() => {
              inFlight.delete(jobPromise)
              wake()
            })

        inFlight.add(jobPromise)

        if (inFlight.size >= maxInFlghJob) {
          await Promise.race(inFlight)
        }
      }

      await Promise.all(inFlight)

      logOptimizer('[optimizer:theory] dispatch done', {
        runId,
        generated: genCmbs,
        totalCombos,
        jobsSent,
        jobsDone,
        resultRefs: rsltsSeen,
        elapsedMs: Math.round(performance.now() - runT0),
      })
    }
  } catch (error) {
    logOptimizer('[optimizer:theory] run error', {
      runId,
      elapsedMs: Math.round(performance.now() - runT0),
      error: error instanceof Error ? error.message : String(error),
    })
    // defensively replace the producer on error when it may be in a bad state.
    stopThryProd()
    rstOptWrkrPo()
    throw error
  } finally {
    // leave the producer warm; just detach this run's listeners. teardown of
    // the worker itself happens via rstOptWrkrPo / cnclActOptWr (incl. the
    // error path above, which already called rstOptWrkrPo).
    detachProducer?.()
    if (activeRunId === runId) {
      activeRunId = null
      progress.complete()
    }
    actRunCtx = null
  }

  const finalResults = collector.sorted()
  logOptimizer('[optimizer:theory] run complete', {
    runId,
    elapsedMs: Math.round(performance.now() - runT0),
    resultCount: finalResults.length,
  })
  return finalResults
}

// run a target-skill search on GPU workers using contiguous combo jobs
async function runTgtSkllGp(
    payload: PrepTargetSkill,
    hooks: PoolRunHooks = {},
): Promise<OptBagResult[]> {
  const totalCombos =
      payload.totalCombos *
      Math.max(1, payload.lockMainReq ? payload.lockMainCands.length : 1) *
      payload.progFact

  if (totalCombos <= 0) {
    return []
  }

  const jobs = mkTgtJobs(payload, TARGET_GPU_JOB)
  const workerCount = Math.min(WORKER_COUNT.gpu, Math.max(1, jobs.length))
  ensWrkrPool(workerCount)

  const runId = nextRunId++
  activeRunId = runId

  const progress = mkPrgrTrck(totalCombos, hooks.onProgress)
  const effectResultMax = payload.resultsLimit
  const cllcLmt = resTgtGpuCll(effectResultMax, payload.lowMmryMode)
  const collector = new OptResultSet(cllcLmt, payload.lowMmryMode)
  const jobResultLimit = resTgtGpuJob(effectResultMax, payload.lowMmryMode)

  // gpu workers bootstrap lazily inside their first real task instead of
  // blocking the whole run on a separate ready handshake.
  actRunCtx = {
    kind: 'gpu',
    mode: 'target',
    payload: makeTargetGpu(payload),
  }

  try {
    for (const job of jobs) {
      if (activeRunId !== runId) {
        return collector.sorted()
      }

      const done = await runTgtWrkrJo(runId, job, jobResultLimit)

      if (activeRunId !== runId) {
        return collector.sorted()
      }

      mergeResults(collector, done.results.filter(isBagRslt))
      progress.applyPrgr(job.comboCount * payload.progFact)
    }
  } catch (error) {
    rstOptWrkrPo()
    throw error
  } finally {
    if (activeRunId === runId) {
      activeRunId = null
      progress.complete()
    }
    actRunCtx = null
  }

  return collector.sorted()
}

// run a rotation search on GPU workers using the same job model as target mode
async function runRotGpuWit(
    payload: PrepRotRun,
    hooks: PoolRunHooks = {},
): Promise<OptBagResult[]> {
  const totalCombos =
      payload.totalCombos *
      Math.max(1, payload.lockMainReq ? payload.lockMainCands.length : 1) *
      payload.progFact

  if (payload.contextCount <= 0 || totalCombos <= 0) {
    return []
  }

  const jobs = mkTgtJobs(payload, ROT_GPU_JOB)
  const workerCount = Math.min(WORKER_COUNT.gpu, Math.max(1, jobs.length))
  ensWrkrPool(workerCount)

  const runId = nextRunId++
  activeRunId = runId

  const progress = mkPrgrTrck(totalCombos, hooks.onProgress)
  const effectResultMax = payload.resultsLimit
  const cllcLmt = resTgtGpuCll(effectResultMax, payload.lowMmryMode)
  const collector = new OptResultSet(cllcLmt, payload.lowMmryMode)
  const jobResultLimit = resTgtGpuJob(effectResultMax, payload.lowMmryMode)

  // same lazy bootstrap path for rotation gpu workers.
  actRunCtx = {
    kind: 'gpu',
    mode: 'rotation',
    payload: packRotation(payload),
  }

  try {
    for (const job of jobs) {
      if (activeRunId !== runId) {
        return collector.sorted()
      }

      const done = await runTgtWrkrJo(runId, job, jobResultLimit)

      if (activeRunId !== runId) {
        return collector.sorted()
      }

      mergeResults(collector, done.results.filter(isBagRslt))
      progress.applyPrgr(job.comboCount * payload.progFact)
    }
  } catch (error) {
    rstOptWrkrPo()
    throw error
  } finally {
    if (activeRunId === runId) {
      activeRunId = null
      progress.complete()
    }
    actRunCtx = null
  }

  return collector.sorted()
}

// run a target-skill search on CPU workers using explicit combo batches
async function runTgtSkllCp(
    payload: PrepTargetSkill,
    hooks: PoolRunHooks = {},
): Promise<OptBagResult[]> {
  const totalCombos = countMainCombos(
      payload.costs,
      payload.lockMainCands,
  )

  if (totalCombos <= 0) {
    return []
  }

  // low-memory mode or tiny workloads avoid parallel overhead
  const lowMmryMode = payload.lowMmryMode
  const workerTarget = lowMmryMode
      ? 1
      : totalCombos < MIN_PAR_COMBOS
          ? 1
          : WORKER_COUNT.cpu

  const lckdMainNdcs = payload.lockMainReq
      ? payload.lockMainCands
      : [-1]

  const effBatch = bchSzFr(CPU_JOB_SIZE, lowMmryMode)
  const stmtJobs = lckdMainNdcs.length * Math.max(
      1,
      Math.ceil(totalCombos / Math.max(1, effBatch * payload.progFact)),
  )

  const workerCount = Math.min(workerTarget, Math.max(1, stmtJobs))
  const maxInFlghJob = lowMmryMode ? 1 : workerCount
  ensWrkrPool(workerCount)

  const runId = nextRunId++
  activeRunId = runId

  const progress = mkPrgrTrck(totalCombos, hooks.onProgress)
  const effectResultMax = payload.resultsLimit
  const collector = new OptResultSet(effectResultMax, payload.lowMmryMode)

  actRunCtx = {
    kind: 'cpu',
    payload: shrPckdTgtSk(packTargetSkill(payload)),
  }

  try {
    const inFlight = new Set<Promise<void>>()

    // each combo batch stores 5 indices per combination
    const rsblBtchLngt = effBatch * 5
    const freeBtchBffr: Int32Array[] = []

    for (const lockedMainIndex of lckdMainNdcs) {
      for (const batch of gnrtTgtCpuCm({
        costs: payload.costs,
        batchSize: effBatch,
        lockMainIdx: lockedMainIndex,
        borrowBuffer: (length) => freeBtchBffr.pop() ?? new Int32Array(length),
      })) {
        const jobPromise = runTgtCpuBtc(
            runId,
            batch.combos,
            batch.comboCount,
            lockedMainIndex,
            effectResultMax,
            (delta) => {
              if (activeRunId !== runId) {
                return
              }
              progress.applyPrgr(delta)
            },
        )
            .then((done) => {
              if (activeRunId !== runId) {
                return
              }

              mergeResults(collector, done.results.filter(isBagRslt))

              // recycle returned combo buffers when they match the standard reusable size
              if (done.rtrnCmbsBtch && done.rtrnCmbsBtch.length === rsblBtchLngt) {
                freeBtchBffr.push(done.rtrnCmbsBtch)
              }
            })
            .finally(() => {
              inFlight.delete(jobPromise)
            })

        inFlight.add(jobPromise)

        // throttle in-flight work to avoid over-buffering huge runs
        if (inFlight.size >= maxInFlghJob) {
          await Promise.race(inFlight)
        }
      }
    }

    await Promise.all(inFlight)
  } catch (error) {
    rstOptWrkrPo()
    throw error
  } finally {
    if (activeRunId === runId) {
      activeRunId = null
      progress.complete()
    }
    actRunCtx = null
  }

  return collector.sorted()
}

// run a rotation search on CPU workers using the same batch system as target mode
async function runRotCpuWit(
    payload: PrepRotRun,
    hooks: PoolRunHooks = {},
): Promise<OptBagResult[]> {
  const totalCombos = countMainCombos(
      payload.costs,
      payload.lockMainCands,
  )

  if (payload.contextCount <= 0 || totalCombos <= 0) {
    return []
  }

  const lowMmryMode = payload.lowMmryMode
  const workerTarget = lowMmryMode
      ? 1
      : totalCombos < MIN_PAR_COMBOS
          ? 1
          : WORKER_COUNT.cpu

  const lckdMainNdcs = payload.lockMainReq
      ? payload.lockMainCands
      : [-1]

  const effBatch = bchSzFr(CPU_JOB_SIZE, lowMmryMode)
  const stmtJobs = lckdMainNdcs.length * Math.max(
      1,
      Math.ceil(totalCombos / Math.max(1, effBatch * payload.progFact)),
  )

  const workerCount = Math.min(workerTarget, Math.max(1, stmtJobs))
  const maxInFlghJob = lowMmryMode ? 1 : workerCount
  ensWrkrPool(workerCount)

  const runId = nextRunId++
  activeRunId = runId

  const progress = mkPrgrTrck(totalCombos, hooks.onProgress)
  const effectResultMax = payload.resultsLimit
  const collector = new OptResultSet(effectResultMax, payload.lowMmryMode)

  actRunCtx = {
    kind: 'cpu',
    payload: shrPckdRotXc(packRotation(payload)),
  }

  try {
    const inFlight = new Set<Promise<void>>()
    const rsblBtchLngt = effBatch * 5
    const freeBtchBffr: Int32Array[] = []

    for (const lockedMainIndex of lckdMainNdcs) {
      for (const batch of gnrtTgtCpuCm({
        costs: payload.costs,
        batchSize: effBatch,
        lockMainIdx: lockedMainIndex,
        borrowBuffer: (length) => freeBtchBffr.pop() ?? new Int32Array(length),
      })) {
        const jobPromise = runTgtCpuBtc(
            runId,
            batch.combos,
            batch.comboCount,
            lockedMainIndex,
            effectResultMax,
            (delta) => {
              if (activeRunId !== runId) {
                return
              }
              progress.applyPrgr(delta)
            },
        )
            .then((done) => {
              if (activeRunId !== runId) {
                return
              }

              mergeResults(collector, done.results.filter(isBagRslt))

              if (done.rtrnCmbsBtch && done.rtrnCmbsBtch.length === rsblBtchLngt) {
                freeBtchBffr.push(done.rtrnCmbsBtch)
              }
            })
            .finally(() => {
              inFlight.delete(jobPromise)
            })

        inFlight.add(jobPromise)

        if (inFlight.size >= maxInFlghJob) {
          await Promise.race(inFlight)
        }
      }
    }

    await Promise.all(inFlight)
  } catch (error) {
    rstOptWrkrPo()
    throw error
  } finally {
    if (activeRunId === runId) {
      activeRunId = null
      progress.complete()
    }
    actRunCtx = null
  }

  return collector.sorted()
}

// top-level pool entrypoint that resets the pool, then routes by mode and backend
export async function runOptWithWr(
    payload: PrepOptPay,
    backend: OptBckn,
    hooks: PoolRunHooks = {},
): Promise<OptRawResult[]> {
  logOptimizer('[optimizer:pool] run starting', {
    mode: payload.mode,
    backend,
    totalCombos: payload.totalCombos,
    resultsLimit: payload.resultsLimit,
    lowMemoryMode: payload.lowMmryMode,
    sharedArrayBufferAvailable: hasShrdRryBf(),
    lockedMainRequested: payload.lockMainReq,
    lockedMainCandidateCount: payload.lockMainCands.length,
    contextCount: 'contextCount' in payload ? payload.contextCount : undefined,
  })

  rstOptWrkrPo()

  const t0 = performance.now()
  let results: OptRawResult[]

  if (payload.mode === 'theoryTarget' || payload.mode === 'theoryRotation') {
    results = await runThryBtcWr(payload, backend, hooks)
  } else if (payload.mode === 'rotation') {
    results = backend === 'gpu'
        ? await runRotGpuWit(payload, hooks)
        : await runRotCpuWit(payload, hooks)
  } else {
    results = backend === 'gpu'
        ? await runTgtSkllGp(payload, hooks)
        : await runTgtSkllCp(payload, hooks)
  }

  logOptimizer('[optimizer:pool] run complete', {
    mode: payload.mode,
    backend,
    resultCount: results.length,
    elapsedMs: Math.round(performance.now() - t0),
  })

  return results
}
