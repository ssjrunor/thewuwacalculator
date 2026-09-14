/*
  Author: Runor Ewhro
  Description: runs build evaluation jobs inside a dedicated web worker.
*/

/// <reference lib="webworker" />

import { initGameData } from '@/data/gameData'
import {
  ensureAnchorStoreHydrated,
  rotationBuildEvaluationReport,
} from '@/data/scoring/buildEvaluation'
import type {
  EvaluationWorkerIn,
  EvaluationWorkerOut,
} from '@/data/scoring/buildEvaluationWorkerTypes'

const scope = self as DedicatedWorkerGlobalScope
const REPORT_CANCEL_ERR = 'Build evaluation report superseded'

function makeCancelCheck(message: EvaluationWorkerIn): (() => void) | undefined {
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

function buildReport(message: Extract<EvaluationWorkerIn, { type: 'report' }>): ReturnType<typeof rotationBuildEvaluationReport> {
  return rotationBuildEvaluationReport(
    message.payload,
    message.options ?? {},
    makeCancelCheck(message),
  )
}

scope.onmessage = async (event: MessageEvent<EvaluationWorkerIn>) => {
  const message = event.data

  try {
    await initGameData({ mode: message.gameDataMode })
    // Rehydrate persisted anchors before the first search so a cold worker (idle
    // teardown / page reload) can re-score from disk instead of re-searching.
    await ensureAnchorStoreHydrated()
    makeCancelCheck(message)?.()
    const result = message.type === 'report' ? buildReport(message) : null

    const response: EvaluationWorkerOut = {
      id: message.id,
      ok: true,
      result,
    }
    scope.postMessage(response)
  } catch (error) {
    const response: EvaluationWorkerOut = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Build evaluation worker failed unexpectedly',
    }
    scope.postMessage(response)
  }
}
