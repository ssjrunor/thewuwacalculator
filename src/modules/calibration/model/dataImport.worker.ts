/// <reference lib="webworker" />

/*
  Author: Runor Ewhro
  Description: Parses, migrates, and validates large settings-page imports
               outside the browser's interaction thread.
*/

import { initGameData } from '@/data/gameData'
import { runDataImportJob, type DataImportJob, type DataImportResult } from './dataImport'
import type { GameDataMode } from '@/domain/entities/gameDataMode'

export interface DataImportWorkerRequest {
  id: number
  gameDataMode: GameDataMode
  job: DataImportJob
}

export type DataImportWorkerResponse =
  | { id: number; ok: true; result: DataImportResult }
  | { id: number; ok: false; error: string }

self.onmessage = async (event: MessageEvent<DataImportWorkerRequest>) => {
  const message = event.data
  const scope = self as DedicatedWorkerGlobalScope

  try {
    // Validation and migration must use the same catalog mode as the caller.
    await initGameData({ mode: message.gameDataMode })
    const result = await runDataImportJob(message.job)
    scope.postMessage({ id: message.id, ok: true, result } satisfies DataImportWorkerResponse)
  } catch (error) {
    scope.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Data import failed unexpectedly.',
    } satisfies DataImportWorkerResponse)
  }
}
