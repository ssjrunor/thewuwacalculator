/*
  Author: Runor Ewhro
  description: classifies dropped files and pasted text for import.
*/

import type { HydratedAppState } from '@/domain/entities/appState'
import type { LegAppSttMpr } from '@/application/imports/legacy/shared'
import { useAppStore } from '@/application/state'
import { selectPersisted } from '@/application/state/serialization'
import { saveAppState } from '@/application/persistence/appStorage'
import { resolveShareText } from '@/shared/lib/shareCodec'
import { runDataImport } from './dataImportClient'
import { legacyHasData } from './dataImport'

export type ResolvedImport =
  | { kind: 'image'; file: File }
  | { kind: 'gameData'; raw: string }
  | { kind: 'snapshot'; label: string; snapshot: HydratedAppState }
  | { kind: 'legacy'; result: LegAppSttMpr }
  // resolved share text; the rotation reader decides whether it is one.
  | { kind: 'other'; raw: string }

export const UNREAD_IMPORT = 'Could not read that. Use an export from this app, a Mornye Tools export, a share code, or a build card screenshot.'

function looksLikeJson(text: string): boolean {
  const lead = text.trimStart()[0]
  return lead === '{' || lead === '['
}

export async function resolveImport(source: string | File): Promise<ResolvedImport> {
  if (typeof source !== 'string' && source.type.startsWith('image/')) {
    return { kind: 'image', file: source }
  }

  let input: string | File = source
  if (typeof source === 'string') {
    // share codes and links resolve to their payload before anything reads them.
    input = looksLikeJson(source) ? source : await resolveShareText(source)
    if (!input.trim()) throw new Error(UNREAD_IMPORT)
  }

  const store = useAppStore.getState()
  store.ensureFullLibrary()
  const read = await runDataImport('auto', input, selectPersisted(useAppStore.getState()))
  if (read.kind === 'snapshot') {
    return { kind: 'snapshot', label: read.result.label, snapshot: read.result.snapshot }
  }
  if (read.kind === 'legacy') {
    if (!legacyHasData(read.result)) {
      throw new Error('No valid legacy app-state data was found. Current state was left unchanged.')
    }
    return { kind: 'legacy', result: read.result }
  }
  return read
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0)
      return
    }
    window.requestAnimationFrame(() => resolve())
  })
}

export async function applyAppData(snapshot: HydratedAppState): Promise<void> {
  useAppStore.getState().hydrate(snapshot)
  await nextFrame()
  saveAppState(snapshot)
}

export function legacySummary(result: LegAppSttMpr): string {
  const { report } = result
  return [
    `Imported ${report.importedProfileIds.length} profiles, ${report.importedInventoryEchoes} bag echoes, and ${report.importedInventoryBuilds} saved builds.`,
    report.skippedProfileIds.length > 0
      ? `Skipped ${report.skippedProfileIds.length} missing or unsupported profile${report.skippedProfileIds.length === 1 ? '' : 's'}.`
      : null,
    report.issues.length > 0
      ? `Recorded ${report.issues.length} migration note${report.issues.length === 1 ? '' : 's'} during conversion.`
      : null,
  ].filter(Boolean).join(' ')
}
