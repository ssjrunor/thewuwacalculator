import type { PersistedAppState } from '@/domain/entities/appState'

export interface LegacyImportIssue {
  scope: 'backup' | 'ui' | 'profile' | 'inventory' | 'rotation' | 'suggestions'
  subject?: string
  reason: string
}

export interface LegacyImportReport {
  importedProfileIds: string[]
  skippedProfileIds: string[]
  importedInventoryEchoes: number
  importedInventoryBuilds: number
  importedInventoryRotations: number
  importedSuggestionStates: number
  issues: LegacyImportIssue[]
}

export interface LegacyAppStateImportResult {
  snapshot: PersistedAppState
  report: LegacyImportReport
}

export type JsonRecord = Record<string, unknown>

export interface LegacyAppBackupPayload {
  charInfo: JsonRecord
  controls: JsonRecord
  stores: JsonRecord
}

export function isRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return value
  }

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return value
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

export function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

export function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value !== 0
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }

  return null
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function coerceString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function toStableId(prefix: string, value: unknown, fallbackIndex: number): string {
  const id = coerceString(value)
  return id ? `${prefix}:${id}` : `${prefix}:${fallbackIndex}`
}

export function extractLegacyAppBackupPayload(parsed: unknown): LegacyAppBackupPayload {
  const maybeParsed = parseMaybeJson(parsed)
  if (!isRecord(maybeParsed)) {
    throw new Error('Expected a legacy backup JSON object.')
  }

  if (
    isRecord(maybeParsed.charInfo)
    && isRecord(maybeParsed.controls)
    && isRecord(maybeParsed.stores)
  ) {
    return {
      charInfo: maybeParsed.charInfo,
      controls: maybeParsed.controls,
      stores: maybeParsed.stores,
    }
  }

  const root = isRecord(maybeParsed['All Data'])
    ? (maybeParsed['All Data'] as JsonRecord)
    : maybeParsed

  const charInfo = parseMaybeJson(root.__charInfo__)
  const controls = parseMaybeJson(root.__controls__)
  const stores = parseMaybeJson(root.__stores__)

  return {
    charInfo: isRecord(charInfo) ? charInfo : {},
    controls: isRecord(controls) ? controls : {},
    stores: isRecord(stores) ? stores : {},
  }
}

export function parseLegacyAppBackupJson(raw: string): LegacyAppBackupPayload {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Legacy backup is not valid JSON.')
  }

  return extractLegacyAppBackupPayload(parsed)
}

export function pushIssue(
  issues: LegacyImportIssue[],
  issue: LegacyImportIssue,
): void {
  issues.push(issue)
}

export function extractPrimitiveControls(
  value: unknown,
): Record<string, boolean | number | string> {
  if (!isRecord(value)) {
    return {}
  }

  const result: Record<string, boolean | number | string> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "boolean") {
      result[key] = entry
      continue
    }

    if (typeof entry === 'string') {
      result[key] = entry
      continue
    }

    if (typeof entry === 'number' && Number.isFinite(entry)) {
      result[key] = entry
    }
  }

  return result
}
