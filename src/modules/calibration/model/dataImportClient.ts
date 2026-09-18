/*
  Author: Runor Ewhro
  Description: Owns the settings data-import worker lifecycle and transfers
               file buffers with request-id correlation and worker failure cleanup.
*/

import { getGameDataMode } from '@/data/gameData'
import type { PersistedState } from '@/domain/entities/appState'
import type { DataImportJob, DataImportResult, DataImportSource } from './dataImport'
import type { DataImportWorkerRequest, DataImportWorkerResponse } from './dataImport.worker'

let worker: Worker | null = null
let nextJobId = 1

const pendingJobs = new Map<number, {
  resolve: (value: DataImportResult) => void
  reject: (error: Error) => void
}>()

function ensureWorker(): Worker {
  if (worker) return worker

  worker = new Worker(new URL('./dataImport.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<DataImportWorkerResponse>) => {
    const message = event.data
    // Multiple imports share one worker; replies resolve only their matching job.
    const pending = pendingJobs.get(message.id)
    if (!pending) return

    pendingJobs.delete(message.id)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(message.error))
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Data import worker failed unexpectedly.')
    // A worker failure invalidates every outstanding job. The next request
    // creates a fresh worker rather than leaving those promises pending.
    for (const pending of pendingJobs.values()) pending.reject(error)
    pendingJobs.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

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
): Promise<DataImportResult & { kind: 'legacy' }>
export async function runDataImport(
  kind: 'snapshot' | 'legacy',
  source: string | File,
  currentState?: PersistedState,
): Promise<DataImportResult> {
  const resolvedSource = await makeSource(source)
  let job: DataImportJob
  if (kind === 'snapshot') {
    if (!currentState) {
      throw new Error('Current app state is required for snapshot imports.')
    }
    job = { kind, source: resolvedSource, currentState }
  } else {
    job = { kind, source: resolvedSource }
  }

  // Non-browser callers use the same parser and migration path without a worker.
  if (typeof Worker === 'undefined') {
    const { runDataImportJob } = await import('./dataImport')
    return runDataImportJob(job)
  }

  return new Promise((resolve, reject) => {
    const id = nextJobId++
    pendingJobs.set(id, { resolve, reject })
    const message: DataImportWorkerRequest = {
      id,
      gameDataMode: getGameDataMode(),
      job,
    }
    // Transfer ownership of file bytes; this detaches the client-side buffer.
    const transfer = resolvedSource.kind === 'bytes' ? [resolvedSource.bytes] : []
    try {
      ensureWorker().postMessage(message, transfer)
    } catch (error) {
      pendingJobs.delete(id)
      reject(error instanceof Error ? error : new Error('Could not start the data import worker.'))
    }
  })
}
