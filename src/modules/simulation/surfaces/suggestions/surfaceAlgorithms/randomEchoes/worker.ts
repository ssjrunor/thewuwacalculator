/*
  Author: Runor Ewhro
  Description: Initializes worker-local game data and executes isolated
               random-Echo suggestion jobs for the requesting client.
*/

/// <reference lib="webworker" />

import { initGameData } from '@/data/gameData'
import { runRandomEchoGeneration } from './compute'
import type {
  RandomEchoWorkerRequest,
  RandomEchoWorkerResponse,
} from './types'

self.onmessage = async (event: MessageEvent<RandomEchoWorkerRequest>) => {
  const message = event.data
  const scope = self as DedicatedWorkerGlobalScope

  try {
    await initGameData({
      mode: message.gameDataMode,
      resonatorIds: [message.payload.runtimeId,
        ...(message.payload.context.mode === 'rotation'
          ? message.payload.context.resIds
          : [message.payload.context.runtime.id])],
    })
    const result = await runRandomEchoGeneration(message.payload)
    const response: RandomEchoWorkerResponse = { id: message.id, ok: true, result }
    scope.postMessage(response)
  } catch (error) {
    const response: RandomEchoWorkerResponse = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Random Echo worker failed unexpectedly',
    }
    scope.postMessage(response)
  }
}
