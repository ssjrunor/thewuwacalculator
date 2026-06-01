/*
  Author: Runor Ewhro
  Description: Builds default and filtered main-stat pools for the
               suggestion engine using stat weights and character rules.
*/

import { ECHO_MAIN_STATS } from '@/data/gameData/catalog/echoStats'
import type { OptStatWeight } from '@/engine/optimizer/search/filtering.ts'

// main stat keys that can participate in the suggestor filter
const MAIN_STAT_KEYS = [
  'hpPercent',
  'atkPercent',
  'defPercent',
  'aero',
  'glacio',
  'electro',
  'fusion',
  'havoc',
  'spectro',
  'energyRegen',
  'critRate',
  'critDmg',
] as const

// build the default enabled main-stat filter from the current stat-weight map
export function getDefMainSt(
    statWeight: OptStatWeight = {},
    charId: string | null = null,
): Record<string, boolean> {
  const result: Record<string, boolean> = {}

  // enable any main stat that appears in the stat-weight map
  for (const key of MAIN_STAT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(statWeight, key)) {
      result[key] = true
    }
  }

  // explicitly force energy regen on for known characters that often need it
  const numericId = Number.parseInt(charId ?? '', 10)
  if (numericId === 1206 || numericId === 1209 || numericId === 1412) {
    result.energyRegen = true
  }

  return result
}

export interface MainStatPool {
  cost: number
  key: string
  value: number
}

// build the actual main-stat candidate pool used by the suggestor
export function mkMainStatPo(options: {
  statWeight?: OptStatWeight
  charId?: string | null
  mainStatFilter?: Record<string, boolean> | null
}): MainStatPool[] {
  // prefer an explicit filter, otherwise derive one from weights and character id
  const filter =
      options.mainStatFilter
      ?? getDefMainSt(options.statWeight ?? {}, options.charId ?? null)

  const hasFilter = Object.keys(filter).length > 0
  const pool: MainStatPool[] = []

  // scan each echo cost tier and collect valid primary main stats
  for (const cost of [1, 3, 4]) {
    const valid = ECHO_MAIN_STATS[cost] ?? {}

    for (const [key, value] of Object.entries(valid)) {
      // when a filter exists, skip anything not enabled
      if (hasFilter && !filter[key]) {
        continue
      }

      pool.push({ cost, key, value })
    }
  }

  return pool
}
