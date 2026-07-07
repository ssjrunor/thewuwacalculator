/*
  Author: Runor Ewhro
  Description: runs build benchmark jobs inside a dedicated web worker.
*/

/// <reference lib="webworker" />

import { initGameData } from '@/data/gameData'
import {
  ensureAnchorStoreHydrated,
  getDefaultRotationBenchmarkScore,
  rotationBuildBenchmarkReport,
} from '@/data/scoring/buildBenchmark'
import type { DefaultRotationBenchmarkResult as DefRotBenchRes } from '@/data/scoring/buildBenchmark'
import type {
  BenchWorkerIn,
  BenchWorkerOut,
} from '@/data/scoring/buildBenchmarkWorkerTypes'

const scope = self as DedicatedWorkerGlobalScope
const MAX_CACHE_ENTRIES = 8
const resultCache = new Map<string, DefRotBenchRes>()
const REPORT_CANCEL_ERR = 'Build benchmark report superseded'

function makeCancelCheck(message: BenchWorkerIn): (() => void) | undefined {
  if (message.type !== 'report' || !message.cancelBuf) {
    return undefined
  }

  const view = new Int32Array(message.cancelBuf)
  return () => {
    if (Atomics.load(view, 0) !== 0) {
      throw new Error(REPORT_CANCEL_ERR)
    }
  }
}

function cacheResult(key: string, result: DefRotBenchRes): DefRotBenchRes {
  resultCache.set(key, result)
  if (resultCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = resultCache.keys().next().value
    if (oldestKey) {
      resultCache.delete(oldestKey)
    }
  }
  return result
}

function getCachedBenchmark(message: BenchWorkerIn): DefRotBenchRes {
  const key = message.key
  const cached = resultCache.get(key)
  if (cached) {
    resultCache.delete(key)
    if (message.type === 'report' && cached.report === undefined) {
      const report = rotationBuildBenchmarkReport(message.payload, message.options ?? {}, cached.benchmark)
      cached.report = report
      cached.benchmark = report?.benchmark ?? cached.benchmark
      cached.score = report ? report.benchmark.percent * 100 : cached.score
    }
    resultCache.set(key, cached)
    return cached
  }
  if (message.type === 'report') {
    const report = rotationBuildBenchmarkReport(
      message.payload,
      message.options ?? {},
      message.benchmark,
      makeCancelCheck(message),
    )
    return cacheResult(key, {
      benchmark: report?.benchmark ?? null,
      score: report ? report.benchmark.percent * 100 : null,
      report,
    })
  }

  return cacheResult(key, getDefaultRotationBenchmarkScore(message.payload))
}

scope.onmessage = async (event: MessageEvent<BenchWorkerIn>) => {
  const message = event.data

  try {
    await initGameData()
    // Rehydrate persisted anchors before the first search so a cold worker (idle
    // teardown / page reload) can re-score from disk instead of re-searching.
    await ensureAnchorStoreHydrated()
    makeCancelCheck(message)?.()
    const cached = getCachedBenchmark(message)
    const result = message.type === 'score'
      ? cached.score
      : message.type === 'report'
        ? cached.report ?? null
        : cached.benchmark

    const response: BenchWorkerOut = {
      id: message.id,
      ok: true,
      result,
    }
    scope.postMessage(response)
  } catch (error) {
    const response: BenchWorkerOut = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Build benchmark worker failed unexpectedly',
    }
    scope.postMessage(response)
  }
}
