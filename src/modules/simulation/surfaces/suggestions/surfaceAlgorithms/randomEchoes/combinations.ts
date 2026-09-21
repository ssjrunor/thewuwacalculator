/*
  Author: Runor Ewhro
  Description: Defines random-generation limits and enumerates legal Echo cost
               plans and main-stat combinations.
*/

import { ECHO_MAIN_STATS } from '@/data/gameData/catalog/echoStats'

export const TRIES_PER_COMBO = 5

export const DEFAULT_RESULTS = 8

const COST_COMBOS = [
  [4, 4, 1, 1, 1],
  [4, 3, 3, 1, 1],
  [4, 3, 1, 1, 1],
  [4, 1, 1, 1, 1],
  [3, 3, 3, 1, 1],
  [3, 3, 1, 1, 1],
  [3, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
]

export function makeRandomEchoCostPlans(requiredCost?: number | null): number[][] {
  if (!requiredCost) {
    return COST_COMBOS.map((plan) => [...plan])
  }

  const filtered = COST_COMBOS.filter((plan) => plan.includes(requiredCost))

  // An unsupported constraint must not collapse the entire candidate space.
  return (filtered.length ? filtered : COST_COMBOS).map((plan) => [...plan])
}

export function mkMainStatCo(
    costPlan: number[],
    mainStatFilter: Record<string, boolean>,
): string[][] {
  const slots = costPlan.map((cost) => {
    const valid = ECHO_MAIN_STATS[cost] ?? {}
    const keys = Object.keys(valid)

    const weightedKeys = Object.entries(mainStatFilter ?? {})
        .filter(([, value]) => Boolean(value))
        .map(([key]) => key)

    const filtered = weightedKeys.filter((key) => key in valid)

    // A filter with no legal option for this cost tier falls back to its full domain.
    return filtered.length ? filtered : keys
  })

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
