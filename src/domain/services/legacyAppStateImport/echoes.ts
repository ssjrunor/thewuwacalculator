/*
  Author: Runor Ewhro
  Description: Converts legacy echo inventory data into the current persisted
               calculator inventory shape.
*/

import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import type { EchoDef } from '@/domain/entities/catalog'
import type { EchoInstance } from '@/domain/entities/runtime'
import { makeEchoUid } from '@/domain/entities/runtime'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService'
import {
  coerceNumber,
  xtrcLegAppBc,
  isRecord,
  prsMybJson,
  pushIssue,
  type JsonRecord,
  type LegMprtSs,
} from './shared'

interface LegEchoSs {
  index: number
  reason: string
}

export interface LegInvEchoMp {
  echoes: EchoInstance[]
  importedCount: number
  skippedCount: number
  issues: LegEchoSs[]
}

function xtrcLegEchoR(parsed: unknown): unknown[] {
  const maybeParsed = prsMybJson(parsed)

  if (Array.isArray(maybeParsed)) {
    return maybeParsed
  }

  if (!isRecord(maybeParsed)) {
    throw new Error('Expected a legacy echo bag JSON array or object.')
  }

  // importer accepts both standalone echo-bag exports and full app backups, so
  // check each legacy container shape before failing the payload.
  const root = xtrcLegAppBc(maybeParsed)
  const bckpEchoBag = prsMybJson(root.stores.echoBag)
  if (Array.isArray(bckpEchoBag)) {
    return bckpEchoBag
  }

  const echoBag = prsMybJson(maybeParsed.echoBag)
  if (Array.isArray(echoBag)) {
    return echoBag
  }

  const ttldEchoBag = prsMybJson(maybeParsed['Echo Bag'])
  if (Array.isArray(ttldEchoBag)) {
    return ttldEchoBag
  }

  throw new Error('Expected a legacy echo bag JSON array or an object containing `echoBag`.')
}

function resEchoDef(raw: JsonRecord): EchoDef | null {
  // ids are the strongest match, but name fallback keeps very old exports
  // usable after catalog ids were added to the saved echo shape.
  const idCandidates = [raw.id, raw.echoId]
    .map((value) => (value == null ? null : String(value)))
    .filter((value): value is string => Boolean(value))

  for (const echoId of idCandidates) {
    const direct = getEchoById(echoId)
    if (direct) {
      return direct
    }
  }

  const nameCndd = [raw.name, raw.echo]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)

  if (nameCndd.length === 0) {
    return null
  }

  const echoes = listEchoes()
  for (const name of nameCndd) {
    const exact = echoes.find((echo) => echo.name === name)
    if (exact) {
      return exact
    }

    const lower = name.toLowerCase()
    const caseNsns = echoes.find((echo) => echo.name.toLowerCase() === lower)
    if (caseNsns) {
      return caseNsns
    }
  }

  return null
}

function resolveSetId(definition: EchoDef, raw: JsonRecord): number {
  const requestedSet = coerceNumber(raw.selectedSet ?? raw.set ?? raw.setId)

  if (requestedSet != null && definition.sets.includes(requestedSet)) {
    return requestedSet
  }

  // early exports used set 18 for a sonata id that now maps to 6.
  if (requestedSet === 18 && definition.sets.includes(6)) {
    return 6
  }

  return definition.sets[0] ?? 0
}

function normNmbrRcrd(value: unknown): Record<string, number> {
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

function resMainStts(
  definition: EchoDef,
  raw: JsonRecord,
): EchoInstance['mainStats'] | null {
  const rawMainStats = raw.mainStats
  if (!isRecord(rawMainStats)) {
    return null
  }

  const cost = definition.cost
  const primaryOptions = ECHO_MAIN_STATS[cost]
  const secondaryOption = ECHO_SIDE_STATS[cost]

  if (!primaryOptions || !secondaryOption) {
    return null
  }

  const drctPrmr = isRecord(rawMainStats.primary) ? rawMainStats.primary : null
  const drctScnd = isRecord(rawMainStats.secondary) ? rawMainStats.secondary : null

  // current exports store explicit primary/secondary objects; older exports
  // flattened both values into one stat record, handled below.
  if (drctPrmr && drctScnd) {
    const primaryKey =
      typeof drctPrmr.key === 'string' ? drctPrmr.key : Object.keys(primaryOptions)[0]
    const secondaryKey =
      typeof drctScnd.key === 'string' ? drctScnd.key : secondaryOption.key

    return {
      primary: {
        key: primaryKey in primaryOptions ? primaryKey : Object.keys(primaryOptions)[0],
        value:
          coerceNumber(drctPrmr.value)
          ?? primaryOptions[primaryKey]
          ?? primaryOptions[Object.keys(primaryOptions)[0]],
      },
      secondary: {
        key: secondaryKey,
        value: coerceNumber(drctScnd.value) ?? secondaryOption.value,
      },
    }
  }

  const flatMainStts = normNmbrRcrd(rawMainStats)
  const prmrEnts = Object.entries(flatMainStts).filter(([key]) => key in primaryOptions)
  const primaryKey =
    prmrEnts.find(([key]) => key !== secondaryOption.key)?.[0]
    ?? prmrEnts[0]?.[0]
    ?? Object.keys(primaryOptions)[0]

  return {
    primary: {
      key: primaryKey,
      value: flatMainStts[primaryKey] ?? primaryOptions[primaryKey],
    },
    secondary: {
      key: secondaryOption.key,
      value: flatMainStts[secondaryOption.key] ?? secondaryOption.value,
    },
  }
}

export function cnvrLegEcho(
  raw: unknown,
  index: number,
  options?: { slotIndex?: number | null },
): EchoInstance | LegEchoSs {
  if (!isRecord(raw)) {
    return { index, reason: 'Entry is not an object.' }
  }

  const definition = resEchoDef(raw)
  if (!definition) {
    return { index, reason: 'Echo could not be matched to the current catalog.' }
  }

  const mainStats = resMainStts(definition, raw)
  if (!mainStats) {
    return { index, reason: `Echo ${definition.name} is missing valid main stat data.` }
  }

  // accept both spellings because the legacy app changed casing during export
  // refactors while keeping the same numeric stat payload.
  const substats = normNmbrRcrd(raw.substats ?? raw.subStats)

  return {
    uid: typeof raw.uid === 'string' && raw.uid.trim() ? raw.uid : makeEchoUid(),
    id: definition.id,
    set: resolveSetId(definition, raw),
    mainEcho: options?.slotIndex != null ? options.slotIndex === 0 : false,
    mainStats,
    substats,
  }
}

export function cnvrLegEchoL(
  entries: unknown[],
  options?: {
    slotAware?: boolean
    issues?: LegMprtSs[]
    issueScope?: LegMprtSs['scope']
    subject?: string
  },
): EchoInstance[] {
  const echoes: EchoInstance[] = []

  entries.forEach((entry, index) => {
    const converted = cnvrLegEcho(entry, index, {
      slotIndex: options?.slotAware ? index : null,
    })

    if ('reason' in converted) {
      // batch imports collect issues instead of throwing so one invalid echo
      // does not prevent the rest of the bag or loadout from importing.
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

export function mprtLegInvEc(raw: string): LegInvEchoMp {
  const parsed = JSON.parse(raw)
  const legEnts = xtrcLegEchoR(parsed)

  const echoes: EchoInstance[] = []
  const issues: LegEchoSs[] = []

  legEnts.forEach((entry, index) => {
    const converted = cnvrLegEcho(entry, index)
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
