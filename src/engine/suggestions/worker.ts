/*
  Author: Runor Ewhro
  Description: Runs suggestions jobs inside a dedicated web worker and
               posts either successful results or structured errors back
               to the main thread.
*/

/// <reference lib="webworker" />

import { initGameData } from '@/data/gameData'
import type {
  SuggsWrkrDon,
  SuggsWrkrRrr,
  SuggsWrkrInM,
} from '@/engine/suggestions/types'

let suggsCorePrm: Promise<typeof import('@/engine/suggestions/core')> | null = null

function loadSuggsCor() {
  if (!suggsCorePrm) {
    suggsCorePrm = import('@/engine/suggestions/core')
  }

  return suggsCorePrm
}

self.onmessage = async (event: MessageEvent<SuggsWrkrInM>) => {
  const message = event.data
  const scope = self as DedicatedWorkerGlobalScope

  try {
    const input = message.type === 'weapons'
      ? message.payload
      : message.payload.scoringInput
    await initGameData({
      mode: message.gameDataMode,
      resonatorIds: [input.runtime.id, ...Object.keys(input.runtimesById)],
    })
    const {
      runMainStats: mainRunner,
      runSetPlanqc: setRunner,
      runWpnSuggs: wpnRunner,
    } = await loadSuggsCor()

    const result =
        message.type === 'mainStats'
            ? mainRunner(message.payload)
            : message.type === 'setPlans'
                ? setRunner(message.payload)
                : wpnRunner(message.payload)

    const response: SuggsWrkrDon = {
      id: message.id,
      ok: true,
      result,
    }

    scope.postMessage(response)
  } catch (error) {
    const response: SuggsWrkrRrr = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Suggestions worker failed unexpectedly',
    }

    scope.postMessage(response)
  }
}
