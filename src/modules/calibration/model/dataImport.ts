/*
  Author: Runor Ewhro
  Description: Resolves current and legacy app-data imports from text or file
               bytes without depending on the settings-page UI.
*/

import type { PersistedState } from '@/domain/entities/appState'
import type { LegAppSttMpr } from '@/domain/services/legacyAppStateImport/shared'
import { importLegacyApp } from '@/domain/services/legacyAppStateImport'
import { decAppFileBy } from '@/shared/lib/fileCodec'
import { resMprtData, type RslvMprtData } from './dataManagement'

export type DataImportSource =
  | { kind: 'text'; raw: string }
  | { kind: 'bytes'; bytes: ArrayBuffer }

export type DataImportJob =
  | {
    kind: 'snapshot'
    source: DataImportSource
    currentState: PersistedState
  }
  | {
    kind: 'legacy'
    source: DataImportSource
  }

export type DataImportResult =
  | { kind: 'snapshot'; result: RslvMprtData }
  | { kind: 'legacy'; result: LegAppSttMpr }

async function readImportSource(source: DataImportSource): Promise<string> {
  return source.kind === 'text'
    ? source.raw
    : decAppFileBy(new Uint8Array(source.bytes))
}

export async function runDataImportJob(job: DataImportJob): Promise<DataImportResult> {
  const raw = await readImportSource(job.source)
  // Snapshot imports merge against current persisted domains; legacy imports
  // first convert their retired shape through the dedicated migration path.
  return job.kind === 'snapshot'
    ? { kind: 'snapshot', result: resMprtData(raw, job.currentState) }
    : { kind: 'legacy', result: importLegacyApp(raw) }
}
