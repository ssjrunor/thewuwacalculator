/*
  Author: Runor Ewhro
  Description: Keeps optimizer allowed-set selections aligned with authored
               Sonata set piece-count metadata before search-space filtering.
*/

import type { OptSetChoice } from '@/domain/entities/optimizer.ts'
import { SONATA_SETS } from '@/data/gameData/catalog/sonataSets.ts'
import {
  ECHO_SET_DEFS,
  getEchoSetDe,
} from '@/data/gameData/echoSets/effects.ts'

const PCS = [1, 3, 5] as const

// collect every authored set into its real selector bucket
// use the catalog ids only when authored set metadata has not hydrated yet.
export function allOptSetIds(): OptSetChoice {
  const out: OptSetChoice = { 1: [], 3: [], 5: [] }

  for (const def of ECHO_SET_DEFS) {
    out[def.setMax].push(def.id)
  }

  if (out[1].length === 0 && out[3].length === 0 && out[5].length === 0) {
    out[5] = SONATA_SETS.map((set) => set.id)
  }

  return out
}

// keep each set id only in the bucket matching the authored setMax
// selector buckets are exclusive because each set has one authored piece-count mode.
export function normOptSets(input: OptSetChoice): OptSetChoice {
  const out: OptSetChoice = { 1: [], 3: [], 5: [] }

  for (const pc of PCS) {
    const seen = new Set<number>()

    for (const setId of input[pc] ?? []) {
      const def = getEchoSetDe(setId)
      if (def && def.setMax !== pc) {
        continue
      }

      if (!seen.has(setId)) {
        out[pc].push(setId)
        seen.add(setId)
      }
    }
  }

  return out
}

// flatten a normalized selector into the actual set ids accepted by search
export function optSetIdSet(input: OptSetChoice): Set<number> {
  const norm = normOptSets(input)
  return new Set([...norm[1], ...norm[3], ...norm[5]])
}
