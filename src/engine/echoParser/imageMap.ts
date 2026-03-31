/*
  Author: Runor Ewhro
  Description: Builds lookup maps for echo and sonata set names to their
               corresponding image paths and set ids.
*/

import { listEchoes } from '@/domain/services/echoCatalogService'
import { SONATA_SETS } from '@/data/gameData/catalog/sonataSets'

let echoImageMapCache: Record<string, string> | null = null
let setNameImageMapCache: Record<string, string> | null = null
let setNameToIdCache: Record<string, number> | null = null

function buildEchoImageMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const echo of listEchoes()) {
    if (echo.name && echo.icon) {
      map[echo.name] = echo.icon
    }
  }
  return map
}

function buildSetMaps(): void {
  const imageMap: Record<string, string> = {}
  const idMap: Record<string, number> = {}
  for (const set of SONATA_SETS) {
    if (set.name && set.icon) {
      imageMap[set.name] = set.icon
      idMap[set.name] = set.id
    }
  }
  setNameImageMapCache = imageMap
  setNameToIdCache = idMap
}

export function getEchoImageMap(): Record<string, string> {
  return (echoImageMapCache ??= buildEchoImageMap())
}

export function getSetNameImageMap(): Record<string, string> {
  if (!setNameImageMapCache) buildSetMaps()
  return setNameImageMapCache!
}

export function getSetNameToId(): Record<string, number> {
  if (!setNameToIdCache) buildSetMaps()
  return setNameToIdCache!
}
