/*
  Author: Runor Ewhro
  Description: message contracts for build evaluation worker jobs.
*/

import type { BuildEvaluationReport, EvaluationReportOpts, DefRotEvaluationIn } from '@/engine/evaluation/buildEvaluation'
import type { GameDataMode } from '@/domain/entities/gameDataMode'

interface EvaluationJobBase {
  id: number
  key: string
  gameDataMode?: GameDataMode
}

export interface EvaluationReportJob extends EvaluationJobBase {
  type: 'report'
  payload: DefRotEvaluationIn
  options?: EvaluationReportOpts
  cancelBuf?: SharedArrayBuffer
}

export interface EvaluationDone {
  id: number
  ok: true
  result: BuildEvaluationReport | null
}

export interface EvaluationError {
  id: number
  ok: false
  error: string
}

export type EvaluationWorkerIn =
  EvaluationReportJob

export type EvaluationWorkerOut =
  | EvaluationDone
  | EvaluationError
