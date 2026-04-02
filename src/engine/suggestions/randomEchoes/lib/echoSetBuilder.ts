/*
  Author: Runor Ewhro
  Description: Builds randomized echo objects for a chosen cost and
               main-stat combination by assigning main stats, fixed
               secondary stats, and sampled substats.
*/

import { ECHO_PRIMARY_STATS, ECHO_SECONDARY_STATS, ECHO_SUBSTAT_KEYS } from '@/data/gameData/catalog/echoStats'
import type { OptimizerStatWeightMap } from '@/engine/optimizer/search/filtering.ts'
import { getRandomSubstat, randomSubValue } from './substats'

// sentinel value meaning no concrete set is assigned yet
// this stays out of the normal set-count evaluation range
const NO_SET = 255

export interface RandGenEcho {
  cost: number
  setId: number
  primaryKey: string
  primaryValue: number
  secondaryKey: string
  secondaryValue: number
  substats: Record<string, number>
  mainEcho: boolean
}

// build one randomized echo loadout for a fixed main-stat combination
export function buildEchoSetForCombination(params: {
  combination: string[]
  costPlan: number[]
  bias: number
  rollQuality: number
  statWeight: OptimizerStatWeightMap
}): RandGenEcho[] {
  const { combination, costPlan, bias, rollQuality, statWeight } = params
  const echoes: RandGenEcho[] = []

  const maxSubs = 5
  const allSubKeys = ECHO_SUBSTAT_KEYS.length

  // walk slot by slot and construct each randomized echo
  for (let i = 0; i < costPlan.length; i++) {
    const cost = costPlan[i]
    const primaryKey = combination[i]

    // resolve the chosen primary main stat value from the cost tier table
    const primaryValue = ECHO_PRIMARY_STATS[cost]?.[primaryKey] ?? 0

    // resolve the fixed secondary stat for this cost tier
    const secondary = ECHO_SECONDARY_STATS[cost]

    const substats: Record<string, number> = {}

    // sample unique substats until the echo reaches the normal cap
    // or until every possible substat key has been exhausted
    while (
        Object.keys(substats).length < maxSubs &&
        Object.keys(substats).length < allSubKeys
        ) {
      const key = getRandomSubstat(bias, false, statWeight)

      // only keep the first roll for each substat key
      if (!substats[key]) {
        substats[key] = randomSubValue(key, rollQuality)
      }
    }

    echoes.push({
      cost,
      setId: NO_SET,
      primaryKey,
      primaryValue,
      secondaryKey: secondary?.key ?? 'atkFlat',
      secondaryValue: secondary?.value ?? 0,
      substats,
      mainEcho: i === 0,
    })
  }

  return echoes
}
