/*
  Author: Runor Ewhro
  Description: runs build evaluation jobs inside a dedicated web worker.
*/

/// <reference lib="webworker" />

import { initGameData } from '@/data/gameData'
import {
  ensureAnchorStoreHydrated,
  rotationBuildEvaluationReport,
} from '@/engine/evaluation/buildEvaluation'
import type {
  EvaluationWorkerIn,
  EvaluationWorkerOut,
} from '@/engine/evaluation/buildEvaluationWorkerTypes'

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
    const resonatorIds = Array.from(new Set([
      message.payload.runtime.id,
      ...Object.keys(message.payload.runtimesById),
    ]))
    await initGameData({
      mode: message.gameDataMode,
      resonatorIds,
      calculationOnly: true,
      weaponIds: [message.payload.runtime, ...Object.values(message.payload.runtimesById)]
        .flatMap((runtime) => runtime.build.weapon.id ? [runtime.build.weapon.id] : []),
    })
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
