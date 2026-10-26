/*
  Author: Runor Ewhro
  description: executes saved rotation simulations outside the main thread.
*/

import { initGameData } from '@/data/gameData'
import { collectResonatorIds } from '@/application/persistence/resonatorScope.ts'
import type { GameDataMode } from '@/domain/entities/gameDataMode.ts'
import {
  runSavedRotationJob,
  type SavedRotationJob,
} from './simulation.ts'

interface SavedRotationWorkerRequest {
  requests: Array<{
    id: number
    job: SavedRotationJob
  }>
  gameDataMode: GameDataMode
}

interface SavedRotationWorkerResult {
  id: number
  value?: ReturnType<typeof runSavedRotationJob>
  error?: string
}

export async function handleMessage(event: MessageEvent<SavedRotationWorkerRequest>) {
  const { requests, gameDataMode } = event.data
  // the worker realm starts without game data; load what this batch names.
  // a failure here leaves every job to the main-thread fallback below.
  let dataError: string | null = null
  try {
    await initGameData({
      mode: gameDataMode,
      resonatorIds: collectResonatorIds(requests.map(({ job }) => job.entry)),
    })
  } catch (error) {
    dataError = error instanceof Error ? error.message : String(error)
  }

  const results: SavedRotationWorkerResult[] = requests.map(({ id, job }) => {
    if (dataError !== null) return { id, error: dataError }
    try {
      const value = runSavedRotationJob(job)
      return { id, value }
    } catch (error) {
      return {
        id,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
  self.postMessage({ results })
}
