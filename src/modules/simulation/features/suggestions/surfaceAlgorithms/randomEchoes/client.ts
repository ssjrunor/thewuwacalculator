/*
  Author: Runor Ewhro
  Description: Owns the random-Echo worker lifecycle and correlates concurrent
               suggestion requests with their asynchronous replies.
*/

import { getGameDataMode } from '@/data/gameData'
import type {
  RandomEchoEntry,
  RandomEchoPrep,
  RandomEchoWorkerRequest,
  RandomEchoWorkerResponse,
} from './types'

let worker: Worker | null = null
let nextJobId = 1

const pendingJobs = new Map<number, {
  resolve: (value: RandomEchoEntry[]) => void
  reject: (error: Error) => void
}>()

function ensureWorker(): Worker {
  if (worker) {
    return worker
  }

  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

  worker.onmessage = (event: MessageEvent<RandomEchoWorkerResponse>) => {
    const message = event.data
    const pending = pendingJobs.get(message.id)
    if (!pending) {
      return
    }

    pendingJobs.delete(message.id)
    if (message.ok) {
      pending.resolve(message.result)
    } else {
      pending.reject(new Error(message.error))
    }
  }

  worker.onerror = (event) => {
    const error = new Error(event.message || 'Random Echo worker failed unexpectedly')
    for (const pending of pendingJobs.values()) {
      pending.reject(error)
    }
    pendingJobs.clear()
  }

  return worker
}

export function runRandomEchoSuggestions(
    payload: RandomEchoPrep,
): Promise<RandomEchoEntry[]> {
  return new Promise((resolve, reject) => {
    const id = nextJobId++
    pendingJobs.set(id, { resolve, reject })

    const message: RandomEchoWorkerRequest = {
      id,
      gameDataMode: getGameDataMode(),
      payload,
    }
    ensureWorker().postMessage(message)
  })
}
