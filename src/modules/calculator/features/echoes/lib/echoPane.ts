/*
  Author: Runor Ewhro
  Description: shared echo-pane helpers for stat labels, icon resolution,
               default echo instancing, and set/cost summaries.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { makeEchoUid } from '@/domain/entities/runtime.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import { formatStatKeyLabel, formatStatKeyValue, STAT_ICON_MAP } from '@/modules/calculator/model/statsView.ts'

// map internal stat keys to the shorter ui display labels
export function fmtEchoStatL(key: string): string {
  return formatStatKeyLabel(key)
}

// format echo stat values according to flat vs percent display rules
export function fmtEchoStatV(key: string, value: number): string {
  return formatStatKeyValue(key, value)
}

// resolve the stat icon asset used by the echo pane's mask icon
export function getEchoStatI(key: string): string | undefined {
  return STAT_ICON_MAP[formatStatKeyLabel(key, 'bonus')]
}

// build a default echo instance for a picked catalog echo and slot
export function mkDefEchoNst(
  echoId: string,
  index: number,
  previous: EchoInstance | null,
): EchoInstance | null {
  const definition = getEchoById(echoId)
  if (!definition) {
    return null
  }

  const cost = definition.cost
  const primaryStats = ECHO_MAIN_STATS[cost]
  const secondaryStats = ECHO_SIDE_STATS[cost]
  if (!primaryStats || !secondaryStats) {
    return null
  }

  const vldPrmrKeys = Object.keys(primaryStats)
  const fllbPrmrKey = vldPrmrKeys[0]
  const prvsPrmrKey = previous?.mainStats?.primary?.key
  const keepPrimary =
    prvsPrmrKey != null && vldPrmrKeys.includes(prvsPrmrKey)
  const primaryKey = keepPrimary ? prvsPrmrKey : fllbPrmrKey
  const primaryValue = primaryStats[primaryKey]

  const previousSet = previous?.set
  const keepSet =
    previousSet != null && definition.sets.includes(previousSet)

  const keepUid = previous?.id === definition.id

  return {
    uid: keepUid ? previous.uid : makeEchoUid(),
    id: definition.id,
    set: keepSet ? previousSet : (definition.sets[0] ?? 0),
    mainEcho: index === 0,
    mainStats: {
      primary: {
        key: primaryKey,
        value: primaryValue,
      },
      secondary: {
        key: secondaryStats.key,
        value: secondaryStats.value,
      },
    },
    substats: previous?.substats ? { ...previous.substats } : {},
  }
}

// counts pieces per sonata for the set summary badges. within one sonata a
// repeated echo id counts once; the same echo id in two sonatas counts toward each.
export function cmptSetCnts(echoes: Array<EchoInstance | null>): Record<number, number> {
  const counts: Record<number, number> = {}
  const seenIdsBySet: Record<number, Set<string>> = {}
  for (const echo of echoes) {
    if (!echo) {
      continue
    }

    const seenIds = seenIdsBySet[echo.set] ?? (seenIdsBySet[echo.set] = new Set<string>())
    if (seenIds.has(echo.id)) {
      continue
    }

    seenIds.add(echo.id)
    counts[echo.set] = (counts[echo.set] ?? 0) + 1
  }

  return counts
}
