/*
  Author: Runor Ewhro
  Description: defines the message protocol and gpu-static payload shapes used
               by optimizer workers for cpu/gpu job execution, optional gpu
               bootstrap, progress, completion, cancellation, and error reporting.
*/

import type {
  OptimizerBagResultRef,
  PackedOptimizerExecutionPayload,
  PackedRotationExecutionPayload,
} from '@/engine/optimizer/types.ts'

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

// cpu work is sent as explicit combo batches.
// the first task can also seed the worker-local packed payload.
export interface OptimizerTaskRunTargetCpuBatchMessage {
  type: 'runTargetCpuBatch'
  runId: number
  payload?: PackedOptimizerExecutionPayload
  combosBatch: Int32Array
  comboCount: number
  lockedMainIndex: number
  jobResultsLimit: number
}

// target gpu jobs can lazily carry the static bootstrap payload on first use.
export interface OptimizerTaskRunTargetGpuMessage {
  type: 'runTargetGpu'
  runId: number
  comboStart: number
  comboCount: number
  lockedMainIndex: number
  jobResultsLimit: number
  bootstrapPayload?: OptimizerTargetGpuStaticPayload
}

// rotation gpu jobs do the same, but with the packed rotation bootstrap payload.
export interface OptimizerTaskRunRotationGpuMessage {
  type: 'runRotationGpu'
  runId: number
  comboStart: number
  comboCount: number
  lockedMainIndex: number
  jobResultsLimit: number
  bootstrapPayload?: PackedRotationExecutionPayload
}

// cancel the active run inside a worker
export interface OptimizerTaskCancelMessage {
  type: 'cancel'
  runId: number
}

// all messages a worker can receive
export type OptimizerTaskInMessage =
    | OptimizerTaskRunTargetCpuBatchMessage
    | OptimizerTaskRunTargetGpuMessage
    | OptimizerTaskRunRotationGpuMessage
    | OptimizerTaskCancelMessage

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
    | OptimizerTaskProgressMessage
    | OptimizerTaskDoneMessage
    | OptimizerTaskErrorMessage
