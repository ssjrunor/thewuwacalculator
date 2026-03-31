/*
  Author: Runor Ewhro
  Description: Message contracts used by the optimizer compile worker for
               starting compilation, materializing compact result refs, and
               returning either prepared payloads, final result entries, or errors.
*/

import type {
  OptimizerBagResultRef,
  OptimizerResultEntry,
  OptimizerStartPayload,
  PreparedOptimizerPayload,
} from '@/engine/optimizer/types'

// message sent to the compile worker to begin compiling a raw optimizer payload
export interface OptimizerCompileStartMessage {
  type: 'start'
  runId: number
  payload: OptimizerStartPayload
}

// response sent back when compilation succeeds
export interface OptimizerCompileDoneMessage {
  type: 'done'
  runId: number
  payload: PreparedOptimizerPayload
}

// message sent to the worker when we already have a prepared payload
// and only need to materialize compact bag results into user-facing entries
export interface OptimizerMaterializeStartMessage {
  type: 'materialize'
  runId: number
  payload: PreparedOptimizerPayload
  results: OptimizerBagResultRef[]
  uidByIndex: string[]
  limit?: number
}

// response sent back after materialization completes
export interface OptimizerMaterializeDoneMessage {
  type: 'materialized'
  runId: number
  results: OptimizerResultEntry[]
}

// generic worker error response used for either compile or materialize failures
export interface OptimizerCompileErrorMessage {
  type: 'error'
  runId: number
  message: string
}

// all valid inbound messages accepted by the compile worker
export type OptimizerCompileInMessage =
    | OptimizerCompileStartMessage
    | OptimizerMaterializeStartMessage

// all valid outbound messages produced by the compile worker
export type OptimizerCompileOutMessage =
    | OptimizerCompileDoneMessage
    | OptimizerMaterializeDoneMessage
    | OptimizerCompileErrorMessage