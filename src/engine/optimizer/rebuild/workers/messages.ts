/*
  Author: Runor Ewhro
  Description: defines the message protocol and gpu-static payload shapes used
               by optimizer workers for cpu/gpu init, job execution, progress,
               completion, cancellation, and error reporting.
*/

import type {
  OptimizerBagResultRef,
  PackedOptimizerExecutionPayload,
  PackedRotationExecutionPayload,
} from '@/engine/optimizer/types'

// static payload uploaded once for target gpu workers
// this keeps runtime job messages small and avoids resending large buffers
export interface OptimizerTargetGpuStaticPayload {
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
  comboTotalCombos: number

  // combinadic lookup data
  comboIndexMap: Int32Array
  comboBinom: Uint32Array

  // locked-main configuration
  lockedMainRequested: boolean
  lockedMainCandidateIndices: Int32Array
}

// gpu target workers emit the same compact bag-result references used elsewhere
export type OptimizerTargetGpuResultEntry = OptimizerBagResultRef

// initialize a worker with a fully packed cpu execution payload
export interface OptimizerTaskInitTargetCpuMessage {
  type: 'initTargetCpu'
  runId: number
  payload: PackedOptimizerExecutionPayload
}

// initialize a worker with a target gpu static payload
export interface OptimizerTaskInitTargetGpuMessage {
  type: 'initTargetGpu'
  runId: number
  payload: OptimizerTargetGpuStaticPayload
}

// initialize a worker with a rotation gpu execution payload
export interface OptimizerTaskInitRotationGpuMessage {
  type: 'initRotationGpu'
  runId: number
  payload: PackedRotationExecutionPayload
}

// run a rank-window gpu/cpu target search job
export interface OptimizerTaskRunTargetMessage {
  type: 'runTarget'
  runId: number
  comboStart: number
  comboCount: number
  lockedMainIndex: number
  jobResultsLimit: number
}

// run an explicit cpu batch of concrete combos
export interface OptimizerTaskRunTargetCpuBatchMessage {
  type: 'runTargetCpuBatch'
  runId: number
  combosBatch: Int32Array
  comboCount: number
  lockedMainIndex: number
  jobResultsLimit: number
}

// cancel the active run inside a worker
export interface OptimizerTaskCancelMessage {
  type: 'cancel'
  runId: number
}

// all messages a worker can receive
export type OptimizerTaskInMessage =
    | OptimizerTaskInitTargetCpuMessage
    | OptimizerTaskInitTargetGpuMessage
    | OptimizerTaskInitRotationGpuMessage
    | OptimizerTaskRunTargetMessage
    | OptimizerTaskRunTargetCpuBatchMessage
    | OptimizerTaskCancelMessage

// worker finished initialization and is ready for jobs
export interface OptimizerTaskReadyMessage {
  type: 'ready'
  runId: number
}

// incremental processed-row update emitted during long-running jobs
export interface OptimizerTaskProgressMessage {
  type: 'progress'
  runId: number
  processedDelta: number
}

// worker completed a job and returns top result refs
// cpu batch mode may also hand back the transferred batch buffer for reuse
export interface OptimizerTaskDoneMessage {
  type: 'done'
  runId: number
  results: OptimizerBagResultRef[]
  returnedCombosBatch?: Int32Array
}

// worker failed during init or execution
export interface OptimizerTaskErrorMessage {
  type: 'error'
  runId: number
  message: string
}

// all messages a worker can post back to the pool
export type OptimizerTaskOutMessage =
    | OptimizerTaskReadyMessage
    | OptimizerTaskProgressMessage
    | OptimizerTaskDoneMessage
    | OptimizerTaskErrorMessage