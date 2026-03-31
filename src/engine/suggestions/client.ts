/*
  Author: Runor Ewhro
  Description: Manages the suggestions worker lifecycle and dispatches
               typed jobs for main stat, set plan, and random computations.
*/

import type {
  MainStatSuggestionEntry,
  PreparedMainStatSuggestionsInput,
  PreparedRandomSuggestionsInput,
  PreparedSetPlanSuggestionsInput,
  RandomSuggestionEntry,
  SetPlanSuggestionEntry,
  SuggestionsWorkerInMessage,
  SuggestionsWorkerOutMessage,
} from '@/engine/suggestions/types'

// single shared worker instance reused across all suggestion jobs
let worker: Worker | null = null

// incremental id so each request can be matched to its response
let nextJobId = 1

// pending job callbacks keyed by worker message id
const pendingJobs = new Map<number, {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}>()

// lazily create the worker and attach message/error handlers once
function ensureWorker(): Worker {
  if (worker) {
    return worker
  }

  worker = new Worker(
      new URL('@/engine/suggestions/worker.ts', import.meta.url),
      { type: 'module' },
  )

  // resolve or reject the matching pending promise when the worker responds
  worker.onmessage = (event: MessageEvent<SuggestionsWorkerOutMessage>) => {
    const message = event.data
    const pending = pendingJobs.get(message.id)

    if (!pending) {
      return
    }

    pendingJobs.delete(message.id)

    if (message.ok) {
      pending.resolve(message.result)
      return
    }

    pending.reject(new Error(message.error))
  }

  // if the worker crashes, reject every pending job and clear the queue
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Suggestions worker failed unexpectedly')

    for (const pending of pendingJobs.values()) {
      pending.reject(error)
    }

    pendingJobs.clear()
  }

  return worker
}

// run a main-stat suggestion job through the worker
export function runMainStatSuggestionsJob(
    payload: PreparedMainStatSuggestionsInput,
): Promise<MainStatSuggestionEntry[]> {
  return new Promise((resolve, reject) => {
    const id = nextJobId++

    pendingJobs.set(id, {
      resolve: (value) => resolve(value as MainStatSuggestionEntry[]),
      reject,
    })

    const message: SuggestionsWorkerInMessage = {
      id,
      type: 'mainStats',
      payload,
    }

    ensureWorker().postMessage(message)
  }) as Promise<MainStatSuggestionEntry[]>
}

// run a set-plan suggestion job through the worker
export function runSetPlanSuggestionsJob(
    payload: PreparedSetPlanSuggestionsInput,
): Promise<SetPlanSuggestionEntry[]> {
  return new Promise((resolve, reject) => {
    const id = nextJobId++

    pendingJobs.set(id, {
      resolve: (value) => resolve(value as SetPlanSuggestionEntry[]),
      reject,
    })

    const message: SuggestionsWorkerInMessage = {
      id,
      type: 'setPlans',
      payload,
    }

    ensureWorker().postMessage(message)
  }) as Promise<SetPlanSuggestionEntry[]>
}

// run a random suggestion job through the worker
export function runRandomSuggestionsJob(
    payload: PreparedRandomSuggestionsInput,
): Promise<RandomSuggestionEntry[]> {
  return new Promise((resolve, reject) => {
    const id = nextJobId++

    pendingJobs.set(id, {
      resolve: (value) => resolve(value as RandomSuggestionEntry[]),
      reject,
    })

    const message: SuggestionsWorkerInMessage = {
      id,
      type: 'random',
      payload,
    }

    ensureWorker().postMessage(message)
  }) as Promise<RandomSuggestionEntry[]>
}
