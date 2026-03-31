/*
  Author: Runor Ewhro
  Description: Runs suggestions jobs inside a dedicated web worker and
               posts either successful results or structured errors back
               to the main thread.
*/

/// <reference lib="webworker" />

import { initializeGameData } from '@/data/gameData'
import type {
  SuggestionsWorkerDoneMessage,
  SuggestionsWorkerErrorMessage,
  SuggestionsWorkerInMessage,
} from '@/engine/suggestions/types'

let suggestionsCorePromise: Promise<typeof import('@/engine/suggestions/core')> | null = null

function loadSuggestionsCore() {
  if (!suggestionsCorePromise) {
    suggestionsCorePromise = import('@/engine/suggestions/core')
  }

  return suggestionsCorePromise
}

// handle incoming worker jobs and route them to the correct suggestion runner
self.onmessage = async (event: MessageEvent<SuggestionsWorkerInMessage>) => {
  const message = event.data
  const scope = self as DedicatedWorkerGlobalScope

  try {
    await initializeGameData()
    const {
      runMainStatSuggestions,
      runRandomGenerator,
      runSetPlanSuggestions,
    } = await loadSuggestionsCore()

    // pick the correct runner based on the message type
    const result =
        message.type === 'mainStats'
            ? runMainStatSuggestions(message.payload)
            : message.type === 'setPlans'
                ? runSetPlanSuggestions(message.payload)
                : await runRandomGenerator(message.payload)

    // send a success response back to the main thread
    const response: SuggestionsWorkerDoneMessage = {
      id: message.id,
      ok: true,
      result,
    }

    scope.postMessage(response)
  } catch (error) {
    // send a structured error response back to the main thread
    const response: SuggestionsWorkerErrorMessage = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Suggestions worker failed unexpectedly',
    }

    scope.postMessage(response)
  }
}
