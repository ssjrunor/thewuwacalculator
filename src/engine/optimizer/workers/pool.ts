/*
  Author: Runor Ewhro
  Description: Manages the optimizer worker pool, dispatches GPU/CPU jobs,
               tracks progress, handles cancellation, and merges partial
               search results into final optimizer output.
*/

import {
  ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU,
  ECHO_OPTIMIZER_JOB_TARGET_COMBOS_GPU,
  ECHO_OPTIMIZER_JOB_TARGET_COMBOS_ROTATION_GPU,
  OPTIMIZER_LOW_MEMORY_RESULTS_LIMIT,
  OPTIMIZER_MIN_PARALLEL_COMBOS,
  WORKER_COUNT,
} from '@/engine/optimizer/config/constants.ts'
import { countOptimizerCombinationsForMainIndices } from '@/engine/optimizer/search/counting.ts'
import { OptimizerBagResultCollector } from '@/engine/optimizer/results/collector.ts'
import { generateTargetCpuComboBatches } from '@/engine/optimizer/target/batches.ts'
import {
  createPackedTargetSkillExecution,
  sharePackedTargetSkillExecution,
} from '@/engine/optimizer/payloads/targetPayload.ts'
import {
  createPackedRotationExecution,
  sharePackedRotationExecution,
} from '@/engine/optimizer/payloads/rotationPayload.ts'
import type {
  OptimizerBackend,
  OptimizerBagResultRef,
  OptimizerProgress,
  PreparedOptimizerPayload,
  PreparedRotationRun,
  PreparedTargetSkillRun,
} from '@/engine/optimizer/types.ts'
import type {
  OptimizerTaskDoneMessage,
  OptimizerTaskInMessage,
  OptimizerTaskOutMessage,
} from '@/engine/optimizer/workers/messages.ts'
import {
  buildTargetJobs,
  buildTargetGpuStaticPayload,
  type TargetJobSpec,
} from '@/engine/optimizer/workers/targetGpu.ts'

// guardrails for GPU result collection so per-job and collector heaps do not blow up
const TARGET_GPU_RESULT_LIMIT_CAP = 65536
const TARGET_GPU_JOB_OVERSAMPLE = 2
const TARGET_GPU_COLLECTOR_OVERSAMPLE = 8

interface PoolRunHooks {
  onProgress?: (progress: OptimizerProgress) => void
}

// one queued GPU target job defined by a contiguous combo range
interface OptimizerPoolRunTargetJob {
  type: 'runTarget'
  runId: number
  size: number
  comboStart: number
  comboCount: number
  lockedMainIndex: number
  jobResultsLimit: number
  onProgress?: (delta: number) => void
  resolve: (message: OptimizerTaskDoneMessage) => void
  reject: (error: Error) => void
}

// one queued CPU batch job defined by an explicit batch of combinadic rows
interface OptimizerPoolRunTargetCpuBatchJob {
  type: 'runTargetCpuBatch'
  runId: number
  size: number
  combosBatch: Int32Array
  comboCount: number
  lockedMainIndex: number
  jobResultsLimit: number
  onProgress?: (delta: number) => void
  resolve: (message: OptimizerTaskDoneMessage) => void
  reject: (error: Error) => void
}

type OptimizerPoolJob =
    | OptimizerPoolRunTargetJob
    | OptimizerPoolRunTargetCpuBatchJob

// wrapper around a real worker plus initialization / in-flight job state
interface OptimizerPoolWorker {
  worker: Worker
  initResolve: (() => void) | null
  initReject: ((error: Error) => void) | null
  currentJob: OptimizerPoolJob | null
  ready: boolean
}

// global worker-pool state reused across optimizer runs
let workers: OptimizerPoolWorker[] = []
let queue: OptimizerPoolJob[] = []
let nextRunId = 1
let activeRunId: number | null = null

// scale a result limit upward for GPU local collection, but clamp it hard
function clampTargetGpuResultLimit(resultsLimit: number, oversample: number): number {
  const baseLimit = Math.max(1, Math.floor(resultsLimit || 1))
  return Math.min(
      Math.max(Math.floor(baseLimit * oversample), baseLimit),
      TARGET_GPU_RESULT_LIMIT_CAP,
  )
}

// result cap for an individual GPU job before merging
export function resolveTargetGpuJobResultsLimit(resultsLimit: number): number {
  return clampTargetGpuResultLimit(resultsLimit, TARGET_GPU_JOB_OVERSAMPLE)
}

// larger result cap for the shared collector that merges job outputs
export function resolveTargetGpuCollectorLimit(resultsLimit: number): number {
  return clampTargetGpuResultLimit(resultsLimit, TARGET_GPU_COLLECTOR_OVERSAMPLE)
}

// create a progress tracker that accumulates processed work and emits smoothed speed estimates
function createProgressTracker(
    totalForProgress: number,
    onProgress?: (progress: OptimizerProgress) => void,
) {
  let totalProcessed = 0
  const startTime = performance.now()
  let lastUpdateTime = startTime
  let avgSpeed = 0
  let speedSamples = 0

  const emit = (now: number) => {
    if (!onProgress) {
      return
    }

    let remainingMs = Infinity
    if (avgSpeed > 0) {
      const combosLeft = Math.max(0, totalForProgress - totalProcessed)
      remainingMs = combosLeft / avgSpeed
    }

    const progress = totalForProgress > 0
        ? totalProcessed / totalForProgress
        : 0

    onProgress({
      progress,
      elapsedMs: now - startTime,
      remainingMs,
      processed: totalProcessed,
      speed: avgSpeed * 1000,
    })
  }

  return {
    // apply a processed delta and update speed estimates
    applyProgress(delta: number) {
      totalProcessed += delta

      const now = performance.now()
      const elapsedSinceLast = now - lastUpdateTime

      if (elapsedSinceLast > 0) {
        const speed = delta / elapsedSinceLast
        avgSpeed = (avgSpeed * speedSamples + speed) / (speedSamples + 1)
        speedSamples += 1
        lastUpdateTime = now
      }

      emit(now)
    },

    // force completion state at the end of a run
    complete() {
      totalProcessed = totalForProgress
      emit(performance.now())
    },
  }
}

// reject every queued job that has not been dispatched yet
function rejectQueuedJobs(reason: Error): void {
  const pending = queue
  queue = []

  for (const job of pending) {
    job.reject(reason)
  }
}

// fully dispose a worker handle, rejecting anything waiting on it
function disposeWorkerHandle(handle: OptimizerPoolWorker, reason: Error): void {
  if (handle.initReject) {
    handle.initReject(reason)
  }

  if (handle.currentJob) {
    handle.currentJob.reject(reason)
  }

  handle.initResolve = null
  handle.initReject = null
  handle.currentJob = null
  handle.ready = false
  handle.worker.terminate()
}

// send the next assigned job to a worker using the correct message shape
function dispatchWorkerJob(handle: OptimizerPoolWorker, job: OptimizerPoolJob): void {
  handle.currentJob = job

  if (job.type === 'runTargetCpuBatch') {
    const message: OptimizerTaskInMessage = {
      type: 'runTargetCpuBatch',
      runId: job.runId,
      combosBatch: job.combosBatch,
      comboCount: job.comboCount,
      lockedMainIndex: job.lockedMainIndex,
      jobResultsLimit: job.jobResultsLimit,
    }

    // transfer the batch buffer to avoid copying large arrays
    handle.worker.postMessage(message, [job.combosBatch.buffer])
    return
  }

  const message: OptimizerTaskInMessage = {
    type: 'runTarget',
    runId: job.runId,
    comboStart: job.comboStart,
    comboCount: job.comboCount,
    lockedMainIndex: job.lockedMainIndex,
    jobResultsLimit: job.jobResultsLimit,
  }

  handle.worker.postMessage(message)
}

// feed idle ready workers from the size-prioritized queue
function scheduleQueuedJobs(): void {
  if (queue.length === 0) {
    return
  }

  for (const handle of workers) {
    if (!handle.ready || handle.currentJob) {
      continue
    }

    const job = queue.shift()
    if (!job) {
      return
    }

    dispatchWorkerJob(handle, job)
  }
}

// construct one worker handle and wire all lifecycle message handlers
function createWorkerHandle(): OptimizerPoolWorker {
  const worker = new Worker(
      new URL('@/engine/optimizer/workers/task.worker.ts', import.meta.url),
      { type: 'module' },
  )

  const handle: OptimizerPoolWorker = {
    worker,
    initResolve: null,
    initReject: null,
    currentJob: null,
    ready: false,
  }

  worker.onmessage = (event: MessageEvent<OptimizerTaskOutMessage>) => {
    const message = event.data

    // worker finished static initialization and is ready to accept jobs
    if (message.type === 'ready') {
      handle.ready = true

      if (handle.initResolve) {
        const resolve = handle.initResolve
        handle.initResolve = null
        handle.initReject = null
        resolve()
      }

      scheduleQueuedJobs()
      return
    }

    const currentJob = handle.currentJob

    // forward progress deltas only to the active matching job
    if (message.type === 'progress') {
      if (currentJob && currentJob.runId === message.runId) {
        currentJob.onProgress?.(message.processedDelta)
      }
      return
    }

    // worker-level error, either during init or while running a job
    if (message.type === 'error') {
      if (handle.initReject) {
        const reject = handle.initReject
        handle.initResolve = null
        handle.initReject = null
        reject(new Error(message.message))
        return
      }

      if (currentJob && currentJob.runId === message.runId) {
        handle.currentJob = null
        currentJob.reject(new Error(message.message))
        scheduleQueuedJobs()
      }
      return
    }

    // ignore stale or mismatched run responses
    if (!currentJob || currentJob.runId !== message.runId) {
      return
    }

    // successful completion of the current job
    if (message.type === 'done') {
      handle.currentJob = null
      currentJob.resolve(message)
      scheduleQueuedJobs()
    }
  }

  worker.onerror = (event) => {
    const error = new Error(event.message || 'Optimizer task worker failed unexpectedly')

    if (handle.initReject) {
      const reject = handle.initReject
      handle.initResolve = null
      handle.initReject = null
      reject(error)
    }

    if (handle.currentJob) {
      const job = handle.currentJob
      handle.currentJob = null
      job.reject(error)
    }
  }

  return handle
}

// ensure the global pool has exactly the requested number of workers
function ensureWorkerPool(count: number): OptimizerPoolWorker[] {
  if (workers.length === count) {
    return workers
  }

  resetOptimizerWorkerPool()
  workers = Array.from({ length: count }, () => createWorkerHandle())
  return workers
}

// tear down the entire pool and reject anything waiting
export function resetOptimizerWorkerPool(): void {
  const reason = new Error('Optimizer worker pool reset')

  rejectQueuedJobs(reason)

  for (const handle of workers) {
    disposeWorkerHandle(handle, reason)
  }

  workers = []
  activeRunId = null
}

// cancel the active run on every worker and then reset the pool
export function cancelActiveOptimizerWorkerPoolRun(): void {
  if (activeRunId == null) {
    return
  }

  const runId = activeRunId

  for (const handle of workers) {
    const message: OptimizerTaskInMessage = {
      type: 'cancel',
      runId,
    }
    handle.worker.postMessage(message)
  }

  activeRunId = null
  resetOptimizerWorkerPool()
}

// initialize one worker with a static payload and wait until it sends "ready"
async function initTargetWorker(
    handle: OptimizerPoolWorker,
    payload: OptimizerTaskInMessage,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    handle.ready = false
    handle.initResolve = resolve
    handle.initReject = reject

    handle.worker.postMessage(payload)
  })
}

// insert jobs into the queue ordered by size so larger jobs get dispatched first
function enqueueJob(job: OptimizerPoolJob): void {
  let index = 0
  while (index < queue.length && queue[index].size <= job.size) {
    index += 1
  }

  queue.splice(index, 0, job)
  scheduleQueuedJobs()
}

// helper to run one GPU-style range job through the queue
async function runTargetWorkerJob(
    runId: number,
    job: TargetJobSpec,
    jobResultsLimit: number,
    onProgress?: (delta: number) => void,
): Promise<OptimizerTaskDoneMessage> {
  return new Promise<OptimizerTaskDoneMessage>((resolve, reject) => {
    enqueueJob({
      type: 'runTarget',
      runId,
      size: job.comboCount,
      comboStart: job.comboStart,
      comboCount: job.comboCount,
      lockedMainIndex: job.lockedMainIndex,
      jobResultsLimit,
      onProgress,
      resolve,
      reject,
    })
  })
}

// helper to run one CPU combinadic-batch job through the queue
async function runTargetCpuBatchWorkerJob(
    runId: number,
    combosBatch: Int32Array,
    comboCount: number,
    lockedMainIndex: number,
    jobResultsLimit: number,
    onProgress?: (delta: number) => void,
): Promise<OptimizerTaskDoneMessage> {
  return new Promise<OptimizerTaskDoneMessage>((resolve, reject) => {
    enqueueJob({
      type: 'runTargetCpuBatch',
      runId,
      size: comboCount,
      combosBatch,
      comboCount,
      lockedMainIndex,
      jobResultsLimit,
      onProgress,
      resolve,
      reject,
    })
  })
}

// merge a batch of result refs into the shared top-k collector
function mergeResults(
    collector: OptimizerBagResultCollector,
    results: readonly OptimizerBagResultRef[],
): void {
  for (const result of results) {
    collector.push(result)
  }
}

// low-memory mode clamps the effective result limit further
function resolveEffectiveResultsLimit(payload: PreparedOptimizerPayload): number {
  return payload.lowMemoryMode
      ? Math.min(payload.resultsLimit, OPTIMIZER_LOW_MEMORY_RESULTS_LIMIT)
      : payload.resultsLimit
}

// run a target-skill search on GPU workers using contiguous combo jobs
async function runTargetSkillGpuWithWorkerPool(
    payload: PreparedTargetSkillRun,
    hooks: PoolRunHooks = {},
): Promise<OptimizerBagResultRef[]> {
  const totalCombos =
      payload.comboTotalCombos *
      Math.max(1, payload.lockedMainRequested ? payload.lockedMainCandidateIndices.length : 1) *
      payload.progressFactor

  if (totalCombos <= 0) {
    return []
  }

  const jobs = buildTargetJobs(payload, ECHO_OPTIMIZER_JOB_TARGET_COMBOS_GPU)
  const workerCount = Math.min(WORKER_COUNT.gpu, Math.max(1, jobs.length))
  const pool = ensureWorkerPool(workerCount)

  const runId = nextRunId++
  activeRunId = runId

  const progress = createProgressTracker(totalCombos, hooks.onProgress)
  const effectiveResultsLimit = resolveEffectiveResultsLimit(payload)
  const collectorLimit = resolveTargetGpuCollectorLimit(effectiveResultsLimit)
  const collector = new OptimizerBagResultCollector(collectorLimit)
  const jobResultsLimit = resolveTargetGpuJobResultsLimit(effectiveResultsLimit)

  // static GPU payload uploaded once per worker before jobs begin
  const gpuInitPayload = buildTargetGpuStaticPayload(payload)

  await Promise.all(
      pool.map((handle) => initTargetWorker(handle, {
        type: 'initTargetGpu',
        runId,
        payload: gpuInitPayload,
      })),
  )

  try {
    for (const job of jobs) {
      if (activeRunId !== runId) {
        return collector.sorted()
      }

      const done = await runTargetWorkerJob(runId, job, jobResultsLimit)

      if (activeRunId !== runId) {
        return collector.sorted()
      }

      mergeResults(collector, done.results)
      progress.applyProgress(job.comboCount * payload.progressFactor)
    }
  } catch (error) {
    resetOptimizerWorkerPool()
    throw error
  } finally {
    if (activeRunId === runId) {
      activeRunId = null
      progress.complete()
    }
  }

  return collector.sorted()
}

// run a rotation search on GPU workers using the same job model as target mode
async function runRotationGpuWithWorkerPool(
    payload: PreparedRotationRun,
    hooks: PoolRunHooks = {},
): Promise<OptimizerBagResultRef[]> {
  const totalCombos =
      payload.comboTotalCombos *
      Math.max(1, payload.lockedMainRequested ? payload.lockedMainCandidateIndices.length : 1) *
      payload.progressFactor

  if (payload.contextCount <= 0 || totalCombos <= 0) {
    return []
  }

  const jobs = buildTargetJobs(payload, ECHO_OPTIMIZER_JOB_TARGET_COMBOS_ROTATION_GPU)
  const workerCount = Math.min(WORKER_COUNT.gpu, Math.max(1, jobs.length))
  const pool = ensureWorkerPool(workerCount)

  const runId = nextRunId++
  activeRunId = runId

  const progress = createProgressTracker(totalCombos, hooks.onProgress)
  const effectiveResultsLimit = resolveEffectiveResultsLimit(payload)
  const collectorLimit = resolveTargetGpuCollectorLimit(effectiveResultsLimit)
  const collector = new OptimizerBagResultCollector(collectorLimit)
  const jobResultsLimit = resolveTargetGpuJobResultsLimit(effectiveResultsLimit)

  // rotation GPU workers receive a fully packed payload directly
  const gpuInitPayload = createPackedRotationExecution(payload)

  await Promise.all(
      pool.map((handle) => initTargetWorker(handle, {
        type: 'initRotationGpu',
        runId,
        payload: gpuInitPayload,
      })),
  )

  try {
    for (const job of jobs) {
      if (activeRunId !== runId) {
        return collector.sorted()
      }

      const done = await runTargetWorkerJob(runId, job, jobResultsLimit)

      if (activeRunId !== runId) {
        return collector.sorted()
      }

      mergeResults(collector, done.results)
      progress.applyProgress(job.comboCount * payload.progressFactor)
    }
  } catch (error) {
    resetOptimizerWorkerPool()
    throw error
  } finally {
    if (activeRunId === runId) {
      activeRunId = null
      progress.complete()
    }
  }

  return collector.sorted()
}

// run a target-skill search on CPU workers using explicit combo batches
async function runTargetSkillCpuWithWorkerPool(
    payload: PreparedTargetSkillRun,
    hooks: PoolRunHooks = {},
): Promise<OptimizerBagResultRef[]> {
  const totalCombos = countOptimizerCombinationsForMainIndices(
      payload.costs,
      payload.lockedMainCandidateIndices,
  )

  if (totalCombos <= 0) {
    return []
  }

  // low-memory mode or tiny workloads avoid parallel overhead
  const lowMemoryMode = payload.lowMemoryMode
  const workerTarget = lowMemoryMode
      ? 1
      : totalCombos < OPTIMIZER_MIN_PARALLEL_COMBOS
          ? 1
          : WORKER_COUNT.cpu

  const lockedMainIndices = payload.lockedMainRequested
      ? payload.lockedMainCandidateIndices
      : [-1]

  const estimatedJobs = lockedMainIndices.length * Math.max(
      1,
      Math.ceil(totalCombos / Math.max(1, ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU * payload.progressFactor)),
  )

  const workerCount = Math.min(workerTarget, Math.max(1, estimatedJobs))
  const maxInFlightJobs = lowMemoryMode ? 1 : workerCount
  const pool = ensureWorkerPool(workerCount)

  const runId = nextRunId++
  activeRunId = runId

  const progress = createProgressTracker(totalCombos, hooks.onProgress)
  const effectiveResultsLimit = resolveEffectiveResultsLimit(payload)
  const collector = new OptimizerBagResultCollector(effectiveResultsLimit)

  // shared packed CPU payload reused by all workers
  const cpuInitPayload = sharePackedTargetSkillExecution(createPackedTargetSkillExecution(payload))

  await Promise.all(
      pool.map((handle) => initTargetWorker(handle, {
        type: 'initTargetCpu',
        runId,
        payload: cpuInitPayload,
      })),
  )

  try {
    const inFlight = new Set<Promise<void>>()

    // each combo batch stores 5 indices per combination
    const reusableBatchLength = ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU * 5
    const freeBatchBuffers: Int32Array[] = []

    for (const lockedMainIndex of lockedMainIndices) {
      for (const batch of generateTargetCpuComboBatches({
        costs: payload.costs,
        batchSize: ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU,
        lockedMainIndex,
        borrowBuffer: (length) => freeBatchBuffers.pop() ?? new Int32Array(length),
      })) {
        const jobPromise = runTargetCpuBatchWorkerJob(
            runId,
            batch.combos,
            batch.comboCount,
            lockedMainIndex,
            effectiveResultsLimit,
            (delta) => {
              if (activeRunId !== runId) {
                return
              }
              progress.applyProgress(delta)
            },
        )
            .then((done) => {
              if (activeRunId !== runId) {
                return
              }

              mergeResults(collector, done.results)

              // recycle returned combo buffers when they match the standard reusable size
              if (done.returnedCombosBatch && done.returnedCombosBatch.length === reusableBatchLength) {
                freeBatchBuffers.push(done.returnedCombosBatch)
              }
            })
            .finally(() => {
              inFlight.delete(jobPromise)
            })

        inFlight.add(jobPromise)

        // throttle in-flight work to avoid over-buffering huge runs
        if (inFlight.size >= maxInFlightJobs) {
          await Promise.race(inFlight)
        }
      }
    }

    await Promise.all(inFlight)
  } catch (error) {
    resetOptimizerWorkerPool()
    throw error
  } finally {
    if (activeRunId === runId) {
      activeRunId = null
      progress.complete()
    }
  }

  return collector.sorted()
}

// run a rotation search on CPU workers using the same batch system as target mode
async function runRotationCpuWithWorkerPool(
    payload: PreparedRotationRun,
    hooks: PoolRunHooks = {},
): Promise<OptimizerBagResultRef[]> {
  const totalCombos = countOptimizerCombinationsForMainIndices(
      payload.costs,
      payload.lockedMainCandidateIndices,
  )

  if (payload.contextCount <= 0 || totalCombos <= 0) {
    return []
  }

  const lowMemoryMode = payload.lowMemoryMode
  const workerTarget = lowMemoryMode
      ? 1
      : totalCombos < OPTIMIZER_MIN_PARALLEL_COMBOS
          ? 1
          : WORKER_COUNT.cpu

  const lockedMainIndices = payload.lockedMainRequested
      ? payload.lockedMainCandidateIndices
      : [-1]

  const estimatedJobs = lockedMainIndices.length * Math.max(
      1,
      Math.ceil(totalCombos / Math.max(1, ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU * payload.progressFactor)),
  )

  const workerCount = Math.min(workerTarget, Math.max(1, estimatedJobs))
  const maxInFlightJobs = lowMemoryMode ? 1 : workerCount
  const pool = ensureWorkerPool(workerCount)

  const runId = nextRunId++
  activeRunId = runId

  const progress = createProgressTracker(totalCombos, hooks.onProgress)
  const effectiveResultsLimit = resolveEffectiveResultsLimit(payload)
  const collector = new OptimizerBagResultCollector(effectiveResultsLimit)

  // packed rotation execution payload is shared across CPU workers
  const cpuInitPayload = sharePackedRotationExecution(createPackedRotationExecution(payload))

  await Promise.all(
      pool.map((handle) => initTargetWorker(handle, {
        type: 'initTargetCpu',
        runId,
        payload: cpuInitPayload,
      })),
  )

  try {
    const inFlight = new Set<Promise<void>>()
    const reusableBatchLength = ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU * 5
    const freeBatchBuffers: Int32Array[] = []

    for (const lockedMainIndex of lockedMainIndices) {
      for (const batch of generateTargetCpuComboBatches({
        costs: payload.costs,
        batchSize: ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU,
        lockedMainIndex,
        borrowBuffer: (length) => freeBatchBuffers.pop() ?? new Int32Array(length),
      })) {
        const jobPromise = runTargetCpuBatchWorkerJob(
            runId,
            batch.combos,
            batch.comboCount,
            lockedMainIndex,
            effectiveResultsLimit,
            (delta) => {
              if (activeRunId !== runId) {
                return
              }
              progress.applyProgress(delta)
            },
        )
            .then((done) => {
              if (activeRunId !== runId) {
                return
              }

              mergeResults(collector, done.results)

              if (done.returnedCombosBatch && done.returnedCombosBatch.length === reusableBatchLength) {
                freeBatchBuffers.push(done.returnedCombosBatch)
              }
            })
            .finally(() => {
              inFlight.delete(jobPromise)
            })

        inFlight.add(jobPromise)

        if (inFlight.size >= maxInFlightJobs) {
          await Promise.race(inFlight)
        }
      }
    }

    await Promise.all(inFlight)
  } catch (error) {
    resetOptimizerWorkerPool()
    throw error
  } finally {
    if (activeRunId === runId) {
      activeRunId = null
      progress.complete()
    }
  }

  return collector.sorted()
}

// top-level pool entrypoint that resets the pool, then routes by mode and backend
export async function runOptimizerWithWorkerPool(
    payload: PreparedOptimizerPayload,
    backend: OptimizerBackend,
    hooks: PoolRunHooks = {},
): Promise<OptimizerBagResultRef[]> {
  resetOptimizerWorkerPool()

  if (payload.mode === 'rotation') {
    return backend === 'gpu'
        ? runRotationGpuWithWorkerPool(payload, hooks)
        : runRotationCpuWithWorkerPool(payload, hooks)
  }

  return backend === 'gpu'
      ? runTargetSkillGpuWithWorkerPool(payload, hooks)
      : runTargetSkillCpuWithWorkerPool(payload, hooks)
}
