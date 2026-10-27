/*
  Author: Runor Ewhro
  description: resolves current and legacy app-data imports from text or file
               bytes without depending on the settings-page ui.
*/

import type { PersistedState } from '@/domain/entities/appState'
import { isRecord, type LegAppSttMpr } from '@/application/imports/legacy/shared'
import { importLegacyApp } from '@/application/imports/legacy/index'
import { decAppFileBy } from '@/application/persistence/fileCodec'
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
    currentState?: PersistedState
  }
  | {
    kind: 'auto'
    source: DataImportSource
    currentState: PersistedState
  }

export type DataImportResult =
  | { kind: 'snapshot'; result: RslvMprtData }
  | { kind: 'legacy'; result: LegAppSttMpr }

// auto detection returns parsed app data or raw text for other handlers.
export type AutoImportResult =
  | DataImportResult
  | { kind: 'gameData'; raw: string }
  | { kind: 'other'; raw: string }

type AutoKind = 'gameData' | 'snapshot' | 'legacy' | 'other'

// select import parsers by exporter payload shape.
function sniffImport(raw: string): AutoKind {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'other'
  }
  if (!isRecord(parsed)) return 'other'
  if (Array.isArray(parsed.resonators) && Array.isArray(parsed.weapons) && Array.isArray(parsed.echoes)) {
    return 'gameData'
  }
  if (parsed.exportFormat === 'wwcalc-data' || ('ui' in parsed && ('combat' in parsed || 'library' in parsed))) {
    return 'snapshot'
  }
  if (
    (isRecord(parsed.charInfo) && isRecord(parsed.controls) && isRecord(parsed.stores))
    || 'All Data' in parsed
    || '__charInfo__' in parsed
    || '__stores__' in parsed
  ) {
    return 'legacy'
  }
  return 'other'
}

export function legacyHasData(result: LegAppSttMpr): boolean {
  return result.report.importedProfileIds.length > 0
    || result.report.importedInventoryEchoes > 0
    || result.report.importedInventoryBuilds > 0
}

async function readImportSource(source: DataImportSource): Promise<string> {
  return source.kind === 'text'
    ? source.raw
    : decAppFileBy(new Uint8Array(source.bytes))
}

export async function runDataImportJob(job: DataImportJob & { kind: 'snapshot' | 'legacy' }): Promise<DataImportResult>
export async function runDataImportJob(job: DataImportJob): Promise<AutoImportResult>
export async function runDataImportJob(job: DataImportJob): Promise<AutoImportResult> {
  const raw = await readImportSource(job.source)
  if (job.kind === 'auto') {
    const kind = sniffImport(raw)
    if (kind === 'snapshot') return { kind, result: resMprtData(raw, job.currentState) }
    if (kind === 'legacy') return { kind, result: importLegacyApp(raw, { baseState: job.currentState }) }
    return { kind, raw }
  }
  // snapshot imports merge against current persisted domains; legacy imports
  // first convert their retired shape through the dedicated migration path.
  return job.kind === 'snapshot'
    ? { kind: 'snapshot', result: resMprtData(raw, job.currentState) }
    : { kind: 'legacy', result: importLegacyApp(raw, { baseState: job.currentState }) }
}
