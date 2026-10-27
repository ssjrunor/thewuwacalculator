/*
  Author: Runor Ewhro
  description: manages settings data-import worker requests and file transfers.
*/

import { getGameDataMode } from '@/data/gameData'
import type { PersistedState } from '@/domain/entities/appState'
import { WorkerChannel } from '@/shared/lib/WorkerChannel'
import type { AutoImportResult, DataImportJob, DataImportResult, DataImportSource } from './dataImport'
import type { DataImportWorkerRequest, DataImportWorkerResponse } from './dataImport.worker'

class DataImportClient {
  private readonly channel = new WorkerChannel<DataImportWorkerRequest, DataImportWorkerResponse>({
    createWorker: () => new Worker(new URL('./dataImport.worker.ts', import.meta.url), { type: 'module' }),
    idleMs: 2_000,
    errorMessage: 'Data import worker failed unexpectedly.',
  })

  async run(job: DataImportJob, transfer: Transferable[]): Promise<AutoImportResult> {
    const response = await this.channel.request(
      (id) => ({ id, gameDataMode: getGameDataMode(), job }),
      { transfer },
    )
    if (!response.ok) throw new Error(response.error)
    return response.result
  }
}

const client = new DataImportClient()

async function makeSource(source: string | File): Promise<DataImportSource> {
  return typeof source === 'string'
    ? { kind: 'text', raw: source }
    : { kind: 'bytes', bytes: await source.arrayBuffer() }
}

export async function runDataImport(
  kind: 'snapshot',
  source: string | File,
  currentState: PersistedState,
): Promise<DataImportResult & { kind: 'snapshot' }>
export async function runDataImport(
  kind: 'legacy',
  source: string | File,
  currentState?: PersistedState,
): Promise<DataImportResult & { kind: 'legacy' }>
export async function runDataImport(
  kind: 'auto',
  source: string | File,
  currentState: PersistedState,
): Promise<AutoImportResult>
export async function runDataImport(
  kind: 'snapshot' | 'legacy' | 'auto',
  source: string | File,
  currentState?: PersistedState,
): Promise<AutoImportResult> {
  const resolvedSource = await makeSource(source)
  let job: DataImportJob
  if (kind === 'snapshot' || kind === 'auto') {
    if (!currentState) throw new Error('Current app state is required for snapshot imports.')
    job = { kind, source: resolvedSource, currentState }
  } else {
    job = { kind, source: resolvedSource, currentState }
  }

  // non-browser callers use the same parser and migration path without a worker.
  if (typeof Worker === 'undefined') {
    const { runDataImportJob } = await import('./dataImport')
    return runDataImportJob(job)
  }

  const transfer = resolvedSource.kind === 'bytes' ? [resolvedSource.bytes] : []
  return client.run(job, transfer)
}
