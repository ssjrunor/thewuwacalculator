/*
  Author: Runor Ewhro
  Description: Message contracts used by the optimizer compile worker for
               starting compilation, materializing compact result refs, and
               returning either prepared payloads, final result entries, or errors.
*/

import type {
  OptFinalResult,
  OptRawResult,
  OptResultStats,
  OptStartPay,
  PrepOptPay,
} from '@/engine/optimizer/types.ts'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals.ts'

// message sent to the compile worker to begin compiling a raw optimizer payload
export interface OptCompStart {
  type: 'start'
  runId: number
  payload: OptStartPay
}

// response sent back when compilation succeeds
export interface OptCompDoneM {
  type: 'done'
  runId: number
  payload: PrepOptPay
}

export interface OptBaselineStartM {
  type: 'baseline'
  runId: number
  payload: OptStartPay
  mainIndex: number
  setConds: SntSetConds
}

export interface OptBaselineDoneM {
  type: 'baselineDone'
  runId: number
  result: { damage: number; stats: OptResultStats | null } | null
}

// message sent to the worker when we already have a prepared payload
// and only need to materialize compact bag results into user-facing entries
export interface OptMatStartM {
  type: 'materialize'
  runId: number
  payload: PrepOptPay
  results: OptRawResult[]
  uidByIndex: string[]
  limit?: number
}

// response sent back after materialization completes
export interface OptMatDoneMs {
  type: 'materialized'
  runId: number
  results: OptFinalResult[]
}

// generic worker error response used for either compile or materialize failures
export interface OptCompRrrMs {
  type: 'error'
  runId: number
  message: string
}

// all valid inbound messages accepted by the compile worker
export type OptCompInMsg =
    | OptCompStart
    | OptBaselineStartM
    | OptMatStartM

// all valid outbound messages produced by the compile worker
export type OptCompOutMs =
    | OptCompDoneM
    | OptBaselineDoneM
    | OptMatDoneMs
    | OptCompRrrMs
