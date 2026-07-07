/*
  Author: Runor Ewhro
  Description: message contracts for build benchmark worker jobs.
*/

import type {
  BuildBenchmark,
  BuildBenchmarkReport,
  BenchmarkReportOpts,
  DefRotBenchIn,
} from '@/data/scoring/buildBenchmark'

export interface BenchScoreJob {
  id: number
  key: string
  type: 'score'
  payload: DefRotBenchIn
}

export interface BenchDetailJob {
  id: number
  key: string
  type: 'benchmark'
  payload: DefRotBenchIn
}

export interface BenchReportJob {
  id: number
  key: string
  type: 'report'
  payload: DefRotBenchIn
  benchmark?: BuildBenchmark | null
  options?: BenchmarkReportOpts
  cancelBuf?: SharedArrayBuffer
}

export interface BenchDone {
  id: number
  ok: true
  result: number | BuildBenchmark | BuildBenchmarkReport | null
}

export interface BenchError {
  id: number
  ok: false
  error: string
}

export type BenchWorkerIn =
  | BenchScoreJob
  | BenchDetailJob
  | BenchReportJob

export type BenchWorkerOut =
  | BenchDone
  | BenchError
