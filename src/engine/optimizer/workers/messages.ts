/*
  Author: Runor Ewhro
  Description: defines the message protocol and gpu-static payload shapes used
               by optimizer workers for cpu/gpu job execution, optional gpu
               bootstrap, progress, completion, cancellation, and error reporting.
*/

import type {
  OptBagResult,
  OptPrgrPh,
  OptRawResult,
  PckdOptXctnP,
  PckdRotXctnP,
  PrepTheoryRot,
  PrepTheoryTarget,
} from '@/engine/optimizer/types.ts'

// static payload uploaded once for target gpu workers
// this keeps runtime job messages small and avoids resending large buffers
export interface TargetGpuState {
  // packed target context used by the gpu evaluator
  context: Float32Array

  // encoded per-echo stat rows
  stats: Float32Array

  // flattened set bonus lookup table
  setConstLut: Float32Array

  // encoded echo costs, promoted to float for shader consumption
  costs: Float32Array

  // packed stat constraints used during evaluation
  constraints: Float32Array

  // per-echo main-echo bonus rows
  mainEchoBuffs: Float32Array

  // encoded set ids, promoted to float for shader consumption
  sets: Float32Array

  // per-echo kind ids used for duplicate-kind filtering
  kinds: Int32Array

  // combinadic search dimensions
  comboN: number
  comboK: number
  totalCombos: number

  // combinadic lookup data
  comboIndexMap: Int32Array
  comboBinom: Uint32Array

  // locked-main configuration
  lockMainReq: boolean
  lockMainCands: Int32Array
}

// gpu target workers emit the same compact bag-result references used elsewhere
export type OptTgtGpuRsl = OptBagResult

// cpu work is sent as explicit combo batches.
// the first task can also seed the worker-local packed payload.
export interface OptTaskRunTg {
  type: 'runTargetCpuBatch'
  runId: number
  payload?: PckdOptXctnP
  combosBatch: Int32Array
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
}

// target gpu jobs can lazily carry the static bootstrap payload on first use.
export interface OptTaskRunac {
  type: 'runTargetGpu'
  runId: number
  comboStart: number
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
  btstPay?: TargetGpuState
}

// target gpu batch jobs consume explicit 5-row combo buffers produced by theory search.
export interface OptTaskRunTB {
  type: 'runTargetGpuBatch'
  runId: number
  combosBatch: Int32Array
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
  btstPay?: TargetGpuState
}

// rotation gpu jobs do the same, but with the packed rotation bootstrap payload.
export interface OptTaskRunRo {
  type: 'runRotationGpu'
  runId: number
  comboStart: number
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
  btstPay?: PckdRotXctnP
}

// rotation gpu batch jobs mirror target batch mode for theory rotation search.
export interface OptTaskRunRB {
  type: 'runRotationGpuBatch'
  runId: number
  combosBatch: Int32Array
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
  btstPay?: PckdRotXctnP
}

// cancel the active run inside a worker
export interface OptTaskCnclM {
  type: 'cancel'
  runId: number
}

// all messages a worker can receive
export type OptTaskInMsg =
    | OptTaskRunTg
    | OptTaskRunac
    | OptTaskRunTB
    | OptTaskRunRo
    | OptTaskRunRB
    | OptTaskCnclM

// incremental processed-row update emitted during long-running jobs
export interface OptTaskPrgrM {
  type: 'progress'
  runId: number
  phase?: OptPrgrPh
  label?: string
  prcsDlt: number
  total?: number
}

// worker completed a job and returns top result refs
// cpu batch mode may also hand back the transferred batch buffer for reuse.
export interface OptTaskDoneM {
  type: 'done'
  runId: number
  results: OptRawResult[]
  rtrnCmbsBtch?: Int32Array
}

// worker failed during init or execution
export interface OptTaskRrrMs {
  type: 'error'
  runId: number
  message: string
}

// all messages a worker can post back to the pool
export type OptTaskOutMs =
    | OptTaskPrgrM
    | OptTaskDoneM
    | OptTaskRrrMs

// start streaming theory combo batches for a given prep payload.
// the producer walks the synthetic theory row space and posts batches as soon
// as they are filled, so the orchestrator never blocks the main thread on
// generation work.
export interface OptThryProdSt {
  type: 'startTheoryProducer'
  runId: number
  payload: PrepTheoryTarget | PrepTheoryRot
  batchSize: number
}

// hand a reusable Int32Array buffer back to the producer worker so it can
// continue without allocating a fresh buffer for the next batch. lowMem
// signals the producer to drop the buffer rather than retain it past the
// minimum needed to keep emission flowing.
export interface OptThryProdRt {
  type: 'returnTheoryBuffer'
  runId: number
  buffer: Int32Array
  lowMem?: boolean
}

// cancel an in-flight theory producer run
export interface OptThryProdCn {
  type: 'cancelTheoryProducer'
  runId: number
}

export type OptThryProdIn =
    | OptThryProdSt
    | OptThryProdRt
    | OptThryProdCn

// one streamed theory combo batch
export interface OptThryProdBt {
  type: 'theoryBatch'
  runId: number
  combos: Int32Array
  comboCount: number
  lockMainIdx: number
}

// producer finished walking the synthetic row space
export interface OptThryProdDn {
  type: 'theoryProducerDone'
  runId: number
  generated: number
}

// producer failed
export interface OptThryProdRr {
  type: 'theoryProducerError'
  runId: number
  message: string
}

export type OptThryProdOu =
    | OptThryProdBt
    | OptThryProdDn
    | OptThryProdRr
