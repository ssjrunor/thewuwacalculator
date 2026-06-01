/*
  Author: Runor Ewhro
  Description: Builds lookup maps for echo and sonata set names to their
               corresponding image paths and set ids.
*/

import { listEchoes } from '@/domain/services/echoCatalogService'
import { SONATA_SETS } from '@/data/gameData/catalog/sonataSets'

let echoMgMapCch: Record<string, string> | null = null
let setNameMgMap: Record<string, string> | null = null
let setNameToIdC: Record<string, number> | null = null

function mkEchoMgMap(): Record<string, string> {
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
  setNameMgMap = imageMap
  setNameToIdC = idMap
}

export function getEchoMgMap(): Record<string, string> {
  return (echoMgMapCch ??= mkEchoMgMap())
}

export function getSetNameMg(): Record<string, string> {
  if (!setNameMgMap) buildSetMaps()
  return setNameMgMap!
}

export function getSetNameTo(): Record<string, number> {
  if (!setNameToIdC) buildSetMaps()
  return setNameToIdC!
}
