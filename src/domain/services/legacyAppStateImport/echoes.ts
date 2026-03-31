import { ECHO_PRIMARY_STATS, ECHO_SECONDARY_STATS } from '@/data/gameData/catalog/echoStats'
import type { EchoDefinition } from '@/domain/entities/catalog'
import type { EchoInstance } from '@/domain/entities/runtime'
import { createEchoUid } from '@/domain/entities/runtime'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService'
import {
  coerceNumber,
  extractLegacyAppBackupPayload,
  isRecord,
  parseMaybeJson,
  pushIssue,
  type JsonRecord,
  type LegacyImportIssue,
} from './shared'

interface LegacyEchoIssue {
  index: number
  reason: string
}

export interface LegacyInventoryEchoImportResult {
  echoes: EchoInstance[]
  importedCount: number
  skippedCount: number
  issues: LegacyEchoIssue[]
}

function extractLegacyEchoArray(parsed: unknown): unknown[] {
  const maybeParsed = parseMaybeJson(parsed)

  if (Array.isArray(maybeParsed)) {
    return maybeParsed
  }

  if (!isRecord(maybeParsed)) {
    throw new Error('Expected a legacy echo bag JSON array or object.')
  }

  const root = extractLegacyAppBackupPayload(maybeParsed)
  const backupEchoBag = parseMaybeJson(root.stores.echoBag)
  if (Array.isArray(backupEchoBag)) {
    return backupEchoBag
  }

  const echoBag = parseMaybeJson(maybeParsed.echoBag)
  if (Array.isArray(echoBag)) {
    return echoBag
  }

  const titledEchoBag = parseMaybeJson(maybeParsed['Echo Bag'])
  if (Array.isArray(titledEchoBag)) {
    return titledEchoBag
  }

  throw new Error('Expected a legacy echo bag JSON array or an object containing `echoBag`.')
}

function resolveEchoDefinition(raw: JsonRecord): EchoDefinition | null {
  const idCandidates = [raw.id, raw.echoId]
    .map((value) => (value == null ? null : String(value)))
    .filter((value): value is string => Boolean(value))

  for (const echoId of idCandidates) {
    const direct = getEchoById(echoId)
    if (direct) {
      return direct
    }
  }

  const nameCandidates = [raw.name, raw.echo]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)

  if (nameCandidates.length === 0) {
    return null
  }

  const echoes = listEchoes()
  for (const name of nameCandidates) {
    const exact = echoes.find((echo) => echo.name === name)
    if (exact) {
      return exact
    }

    const lower = name.toLowerCase()
    const caseInsensitive = echoes.find((echo) => echo.name.toLowerCase() === lower)
    if (caseInsensitive) {
      return caseInsensitive
    }
  }

  return null
}

function resolveSetId(definition: EchoDefinition, raw: JsonRecord): number {
  const requestedSet = coerceNumber(raw.selectedSet ?? raw.set ?? raw.setId)

  if (requestedSet != null && definition.sets.includes(requestedSet)) {
    return requestedSet
  }

  if (requestedSet === 18 && definition.sets.includes(6)) {
    return 6
  }

  return definition.sets[0] ?? 0
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {}
  }

  const result: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) {
    const numeric = coerceNumber(entry)
    if (numeric != null) {
      result[key] = numeric
    }
  }

  return result
}

function resolveMainStats(
  definition: EchoDefinition,
  raw: JsonRecord,
): EchoInstance['mainStats'] | null {
  const rawMainStats = raw.mainStats
  if (!isRecord(rawMainStats)) {
    return null
  }

  const cost = definition.cost
  const primaryOptions = ECHO_PRIMARY_STATS[cost]
  const secondaryOption = ECHO_SECONDARY_STATS[cost]

  if (!primaryOptions || !secondaryOption) {
    return null
  }

  const directPrimary = isRecord(rawMainStats.primary) ? rawMainStats.primary : null
  const directSecondary = isRecord(rawMainStats.secondary) ? rawMainStats.secondary : null

  if (directPrimary && directSecondary) {
    const primaryKey =
      typeof directPrimary.key === 'string' ? directPrimary.key : Object.keys(primaryOptions)[0]
    const secondaryKey =
      typeof directSecondary.key === 'string' ? directSecondary.key : secondaryOption.key

    return {
      primary: {
        key: primaryKey in primaryOptions ? primaryKey : Object.keys(primaryOptions)[0],
        value:
          coerceNumber(directPrimary.value)
          ?? primaryOptions[primaryKey]
          ?? primaryOptions[Object.keys(primaryOptions)[0]],
      },
      secondary: {
        key: secondaryKey,
        value: coerceNumber(directSecondary.value) ?? secondaryOption.value,
      },
    }
  }

  const flatMainStats = normalizeNumberRecord(rawMainStats)
  const primaryEntries = Object.entries(flatMainStats).filter(([key]) => key in primaryOptions)
  const primaryKey =
    primaryEntries.find(([key]) => key !== secondaryOption.key)?.[0]
    ?? primaryEntries[0]?.[0]
    ?? Object.keys(primaryOptions)[0]

  return {
    primary: {
      key: primaryKey,
      value: flatMainStats[primaryKey] ?? primaryOptions[primaryKey],
    },
    secondary: {
      key: secondaryOption.key,
      value: flatMainStats[secondaryOption.key] ?? secondaryOption.value,
    },
  }
}

export function convertLegacyEcho(
  raw: unknown,
  index: number,
  options?: { slotIndex?: number | null },
): EchoInstance | LegacyEchoIssue {
  if (!isRecord(raw)) {
    return { index, reason: 'Entry is not an object.' }
  }

  const definition = resolveEchoDefinition(raw)
  if (!definition) {
    return { index, reason: 'Echo could not be matched to the current catalog.' }
  }

  const mainStats = resolveMainStats(definition, raw)
  if (!mainStats) {
    return { index, reason: `Echo ${definition.name} is missing valid main stat data.` }
  }

  const substats = normalizeNumberRecord(raw.substats ?? raw.subStats)

  return {
    uid: typeof raw.uid === 'string' && raw.uid.trim() ? raw.uid : createEchoUid(),
    id: definition.id,
    set: resolveSetId(definition, raw),
    mainEcho: options?.slotIndex != null ? options.slotIndex === 0 : false,
    mainStats,
    substats,
  }
}

export function convertLegacyEchoList(
  entries: unknown[],
  options?: {
    slotAware?: boolean
    issues?: LegacyImportIssue[]
    issueScope?: LegacyImportIssue['scope']
    subject?: string
  },
): EchoInstance[] {
  const echoes: EchoInstance[] = []

  entries.forEach((entry, index) => {
    const converted = convertLegacyEcho(entry, index, {
      slotIndex: options?.slotAware ? index : null,
    })

    if ('reason' in converted) {
      if (options?.issues) {
        pushIssue(options.issues, {
          scope: options.issueScope ?? 'inventory',
          subject: options.subject,
          reason: `Echo ${index + 1}: ${converted.reason}`,
        })
      }
      return
    }

    echoes.push(converted)
  })

  return echoes
}

export function importLegacyInventoryEchoJson(raw: string): LegacyInventoryEchoImportResult {
  const parsed = JSON.parse(raw)
  const legacyEntries = extractLegacyEchoArray(parsed)

  const echoes: EchoInstance[] = []
  const issues: LegacyEchoIssue[] = []

  legacyEntries.forEach((entry, index) => {
    const converted = convertLegacyEcho(entry, index)
    if ('reason' in converted) {
      issues.push(converted)
      return
    }

    echoes.push(converted)
  })

  return {
    echoes,
    importedCount: echoes.length,
    skippedCount: issues.length,
    issues,
  }
}
