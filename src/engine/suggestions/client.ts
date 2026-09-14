/*
  Author: Runor Ewhro
  Description: Manages the durable suggestions worker lifecycle and dispatches
               typed jobs for main-stat, set-plan, and weapon computations.
*/

import type {
  MainStatSugg,
  MainStatPrep,
  PrepSetPlanS,
  PrepWeaponPlan,
  SetPlanSuggest,
  SuggsWrkrInM,
  SuggsWrkrOut,
  WeaponEntry,
} from '@/engine/suggestions/types'
import { getGameDataMode } from '@/data/gameData'

let worker: Worker | null = null

let nextJobId = 1

const pendingJobs = new Map<number, {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}>()

function ensureWorker(): Worker {
  if (worker) {
    return worker
  }

  worker = new Worker(
      new URL('@/engine/suggestions/worker.ts', import.meta.url),
      { type: 'module' },
  )

  worker.onmessage = (event: MessageEvent<SuggsWrkrOut>) => {
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

  // A worker failure invalidates every request awaiting that shared instance.
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Suggestions worker failed unexpectedly')

    for (const pending of pendingJobs.values()) {
      pending.reject(error)
    }

    pendingJobs.clear()
  }

  return worker
}

export function runMainStatS(
    payload: MainStatPrep,
): Promise<MainStatSugg[]> {
  return new Promise((resolve, reject) => {
    const id = nextJobId++

    pendingJobs.set(id, {
      resolve: (value) => resolve(value as MainStatSugg[]),
      reject,
    })

    const message: SuggsWrkrInM = {
      id,
      gameDataMode: getGameDataMode(),
      type: 'mainStats',
      payload,
    }

    ensureWorker().postMessage(message)
  }) as Promise<MainStatSugg[]>
}

export function runSetPlanSu(
    payload: PrepSetPlanS,
): Promise<SetPlanSuggest[]> {
  return new Promise((resolve, reject) => {
    const id = nextJobId++

    pendingJobs.set(id, {
      resolve: (value) => resolve(value as SetPlanSuggest[]),
      reject,
    })

    const message: SuggsWrkrInM = {
      id,
      gameDataMode: getGameDataMode(),
      type: 'setPlans',
      payload,
    }

    ensureWorker().postMessage(message)
  }) as Promise<SetPlanSuggest[]>
}

export function runWpnSuggs(
    payload: PrepWeaponPlan,
): Promise<WeaponEntry[]> {
  return new Promise((resolve, reject) => {
    const id = nextJobId++

    pendingJobs.set(id, {
      resolve: (value) => resolve(value as WeaponEntry[]),
      reject,
    })

    const message: SuggsWrkrInM = {
      id,
      gameDataMode: getGameDataMode(),
      type: 'weapons',
      payload,
    }

    ensureWorker().postMessage(message)
  }) as Promise<WeaponEntry[]>
}
