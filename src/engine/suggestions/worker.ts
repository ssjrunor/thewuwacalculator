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

// handle incoming worker jobs and route them to the correct suggestion runner
self.onmessage = async (event: MessageEvent<SuggsWrkrInM>) => {
  const message = event.data
  const scope = self as DedicatedWorkerGlobalScope

  try {
    await initGameData()
    const {
      runMainStats: mainRunner,
      runRandGnrt: randRunner,
      runSetPlanqc: setRunner,
      runWpnSuggs: wpnRunner,
    } = await loadSuggsCor()

    // pick the correct runner based on the message type
    const result =
        message.type === 'mainStats'
            ? mainRunner(message.payload)
            : message.type === 'setPlans'
                ? setRunner(message.payload)
                : message.type === 'weapons'
                    ? wpnRunner(message.payload)
                    : await randRunner(message.payload)

    // send a success response back to the main thread
    const response: SuggsWrkrDon = {
      id: message.id,
      ok: true,
      result,
    }

    scope.postMessage(response)
  } catch (error) {
    // send a structured error response back to the main thread
    const response: SuggsWrkrRrr = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Suggestions worker failed unexpectedly',
    }

    scope.postMessage(response)
  }
}
