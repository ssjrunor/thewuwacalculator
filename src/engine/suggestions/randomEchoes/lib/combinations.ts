/*
  Author: Runor Ewhro
  Description: Defines random generator combination settings and builds
               valid cost plans and main-stat combinations for echo generation.
*/

import { ECHO_PRIMARY_STATS } from '@/data/gameData/catalog/echoStats'

// number of random build attempts to try for each main-stat combination
export const TRIES_PER_COMBO = 5

// default number of final results to keep from the random generator
export const DEFAULT_RESULTS_LIMIT = 8

// all supported total-cost echo layouts used by the generator
const ALL_COST_COMBOS = [
  [4, 4, 1, 1, 1],
  [4, 3, 3, 1, 1],
  [4, 3, 1, 1, 1],
  [4, 1, 1, 1, 1],
  [3, 3, 3, 1, 1],
  [3, 3, 1, 1, 1],
  [3, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
]

// build the list of valid cost plans, optionally forcing at least one slot
// to include a required main echo cost
export function buildCostPlans(requiredCost?: number | null): number[][] {
  // no constraint means every known cost plan is valid
  if (!requiredCost) {
    return ALL_COST_COMBOS.map((plan) => [...plan])
  }

  // keep only plans that can host the required cost
  const filtered = ALL_COST_COMBOS.filter((plan) => plan.includes(requiredCost))

  // if none match, fall back to the full list instead of returning nothing
  return (filtered.length ? filtered : ALL_COST_COMBOS).map((plan) => [...plan])
}

// build every allowed primary-main-stat combination for a given cost plan
export function buildMainStatCombinations(
    costPlan: number[],
    mainStatFilter: Record<string, boolean>,
): string[][] {
  // for each slot cost, determine the set of allowed primary main stats
  const slots = costPlan.map((cost) => {
    const valid = ECHO_PRIMARY_STATS[cost] ?? {}
    const keys = Object.keys(valid)

    // collect explicitly enabled filter keys
    const weightedKeys = Object.entries(mainStatFilter ?? {})
        .filter(([, value]) => Boolean(value))
        .map(([key]) => key)

    // only keep enabled keys that are actually legal for this cost tier
    const filtered = weightedKeys.filter((key) => key in valid)

    // if nothing survives filtering, fall back to all legal keys for that slot
    return filtered.length ? filtered : keys
  })

  // start with one empty combination, then expand slot by slot
  let combos: string[][] = [[]]

  for (const options of slots) {
    const next: string[][] = []

    for (const combo of combos) {
      for (const key of options) {
        next.push(combo.concat(key))
      }
    }

    combos = next
  }

  return combos
}