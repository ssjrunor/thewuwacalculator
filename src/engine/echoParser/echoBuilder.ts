/*
  Author: Runor Ewhro
  description: builds echo instances from parsed ocr results; the stat lines
               themselves are read in statReading.
*/

import { listEchoes } from '@/data/catalog/echoCatalogService'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import { makeEchoUid } from '@/domain/entities/runtime'
import type { EchoInstance } from '@/domain/entities/runtime'
import { getSetNameTo } from '@/engine/echoParser/imageMap'
import type { RawPrsdEcho } from '@/engine/echoParser/ocrParsing'
import { readSubstats, resolveMainByValue, resolveMainKey } from '@/engine/echoParser/statReading'

export { costForMain } from '@/engine/echoParser/statReading'

// build echo instances from parsed ocr results
export function mkEchoNstnFr(raw: RawPrsdEcho[]): Array<EchoInstance | null> {
  const echoCatalog = listEchoes()

  return raw.map((item, index) => {
    const echoDef = item.echoName ? echoCatalog.find((echo) => echo.name === item.echoName) : null
    if (!echoDef) return null
    // use the matched echo's catalog cost after image selection.
    const cost = echoDef.cost

    const primaryKey = resolveMainKey(item.mainStatLbl ?? '', cost)
        ?? resolveMainByValue(item.mainStatLbl ?? '', item.mainStatValue ?? '', cost)
    const primaryStats = ECHO_MAIN_STATS[cost]
    const secondaryStat = ECHO_SIDE_STATS[cost]
    if (!primaryKey || !primaryStats || !secondaryStat) return null

    const primaryValue = primaryStats[primaryKey]
    if (primaryValue === undefined) return null

    // reject a set outside the echo's catalog sets; infer only a unique set.
    const parsedSetId = item.setName ? getSetNameTo()[item.setName] : null
    const validSets = echoDef.sets
    const selectedSet =
        parsedSetId != null && validSets.includes(parsedSetId)
            ? parsedSetId
            : validSets.length === 1 ? validSets[0] : null
    if (selectedSet === null) return null

    return {
      uid: makeEchoUid(),
      id: echoDef.id,
      set: selectedSet,
      mainEcho: index === 0,
      mainStats: {
        primary: { key: primaryKey, value: primaryValue },
        secondary: { key: secondaryStat.key, value: secondaryStat.value },
      },
      substats: readSubstats(item.substats, item.substatValues),
    }
  })
}
