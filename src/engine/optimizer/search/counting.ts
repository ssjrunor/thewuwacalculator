/*
  Author: Runor Ewhro
  Description: Centralized optimizer search-space counting helpers for both
               inventory-facing estimates and encoded main-index subsets.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { getEchoById } from '@/domain/services/echoCatalogService'

// the optimizer always builds 5-echo loadouts
const OPTIMIZER_ECHOS_PER_COMBO = 5

// total echo cost cap for one valid loadout
const OPTIMIZER_MAX_COST = 12

export type OptimizerCountMode = 'rows' | 'combos' | 'combinadic'

// resolve the catalog cost for an inventory echo
function getEchoCost(echo: EchoInstance): number {
  return getEchoById(echo.id)?.cost ?? 0
}

// collect all inventory indices that are allowed to serve as the main echo
function collectMainCandidateIndices(
    echoes: EchoInstance[],
    lockedMainEchoId: string | null,
): number[] {
  // if no main echo is locked, every echo can be the main slot
  if (!lockedMainEchoId) {
    return echoes.map((_, index) => index)
  }

  const indices: number[] = []

  // otherwise keep only echoes whose id matches the locked main id
  for (let index = 0; index < echoes.length; index += 1) {
    if (echoes[index]?.id === lockedMainEchoId) {
      indices.push(index)
    }
  }

  return indices
}

// sum the exact number of valid 5-echo combos from one DP row up to a cost cap
function countDpRowWays(row: Int32Array, maxCost: number): number {
  let total = 0

  for (let cost = 0; cost <= maxCost; cost += 1) {
    total += row[cost]
  }

  return total
}

// build a DP table where dp[k][c] = number of ways to choose k echoes
// with total cost exactly c, optionally skipping one excluded index.
// this is the core counting engine for the exact cost-constrained modes.
function buildDpExcluding(
    costs: ArrayLike<number>,
    maxCost: number,
    excludedIndex: number | null,
): Int32Array[] {
  // if one echo is already fixed as the main echo, only 4 more need to be chosen
  const maxK = excludedIndex == null
      ? OPTIMIZER_ECHOS_PER_COMBO
      : (OPTIMIZER_ECHOS_PER_COMBO - 1)

  const dp = Array.from(
      { length: maxK + 1 },
      () => new Int32Array(maxCost + 1),
  )

  // one way to choose zero echoes at zero total cost
  dp[0][0] = 1

  for (let index = 0; index < costs.length; index += 1) {
    // skip the excluded main echo when one is fixed
    if (excludedIndex != null && index === excludedIndex) {
      continue
    }

    const cost = costs[index] ?? 0

    // iterate backwards in k so each echo is only used once
    for (let k = maxK - 1; k >= 0; k -= 1) {
      const currentRow = dp[k]
      const nextRow = dp[k + 1]

      for (let totalCost = 0; totalCost + cost <= maxCost; totalCost += 1) {
        const ways = currentRow[totalCost]
        if (ways !== 0) {
          nextRow[totalCost + cost] += ways
        }
      }
    }
  }

  return dp
}

// standard n-choose-k count used for combinadic-style rough estimates
function countCombinadic(n: number, k: number): number {
  if (k < 0 || k > n) {
    return 0
  }

  let numerator = 1
  let denominator = 1

  for (let index = 1; index <= k; index += 1) {
    numerator *= (n - (k - index))
    denominator *= index
  }

  return Math.floor(numerator / denominator)
}

// count the optimizer search space using one of three modes:
// - combinadic: rough closed-form estimate ignoring cost constraints
// - combos: exact number of valid 5-echo combinations
// - rows: exact combinations multiplied by 5 row positions when main is unlocked
export function countOptimizerCombinationsByMode(
    echoes: EchoInstance[],
    lockedMainEchoId: string | null,
    countMode: OptimizerCountMode = 'rows',
): number {
  // fewer than 5 echoes means no valid loadout exists
  if (echoes.length < OPTIMIZER_ECHOS_PER_COMBO) {
    return 0
  }

  const costs = echoes.map(getEchoCost)

  // combinadic mode is a fast estimate that ignores the 12-cost cap
  if (countMode === 'combinadic') {
    const mainCandidateIndices = collectMainCandidateIndices(echoes, lockedMainEchoId)
    if (mainCandidateIndices.length === 0) {
      return 0
    }

    // without a locked main echo:
    // choose any 5 echoes, then treat each of the 5 positions as a possible main row
    if (!lockedMainEchoId) {
      return countCombinadic(echoes.length, OPTIMIZER_ECHOS_PER_COMBO) * OPTIMIZER_ECHOS_PER_COMBO
    }

    // with a locked main echo:
    // choose 4 of the remaining echoes for each valid locked-main candidate
    return countCombinadic(
        echoes.length - 1,
        OPTIMIZER_ECHOS_PER_COMBO - 1,
    ) * mainCandidateIndices.length
  }

  // exact counting when the main echo is not locked
  if (!lockedMainEchoId) {
    const dp = buildDpExcluding(costs, OPTIMIZER_MAX_COST, null)
    const combos = countDpRowWays(dp[OPTIMIZER_ECHOS_PER_COMBO], OPTIMIZER_MAX_COST)

    // "combos" returns the exact number of legal 5-echo sets
    // "rows" expands each combo into 5 possible main-row placements
    return countMode === 'combos'
        ? combos
        : (combos * OPTIMIZER_ECHOS_PER_COMBO)
  }

  // exact counting when the main echo is locked to one or more matching candidates
  const lockedIndices = collectMainCandidateIndices(echoes, lockedMainEchoId)
  if (lockedIndices.length === 0) {
    return 0
  }

  let totalCombos = 0

  for (const lockedIndex of lockedIndices) {
    const remainingCost = OPTIMIZER_MAX_COST - costs[lockedIndex]

    // if the locked main alone already exceeds the cost cap, skip it
    if (remainingCost < 0) {
      continue
    }

    // count ways to choose 4 additional echoes from the remaining pool
    const dp = buildDpExcluding(costs, OPTIMIZER_MAX_COST, lockedIndex)
    const combosForMain = countDpRowWays(
        dp[OPTIMIZER_ECHOS_PER_COMBO - 1],
        remainingCost,
    )

    totalCombos += combosForMain
  }

  return totalCombos
}

// default helper used by callers that want the historical "rows" count
export function countOptimizerCombinations(
    echoes: EchoInstance[],
    lockedMainEchoId: string | null,
): number {
  return countOptimizerCombinationsByMode(echoes, lockedMainEchoId, 'rows')
}

export function countOptimizerCombinationsForMainIndices(
    costs: ArrayLike<number>,
    mainCandidateIndices: ReadonlyArray<number> | Int32Array,
): number {
  let total = 0

  for (const mainIndex of mainCandidateIndices) {
    const remainingCost = OPTIMIZER_MAX_COST - ((costs[mainIndex] ?? 0) | 0)
    if (remainingCost < 0) {
      continue
    }

    const dp = buildDpExcluding(costs, OPTIMIZER_MAX_COST, mainIndex)
    total += countDpRowWays(dp[OPTIMIZER_ECHOS_PER_COMBO - 1], remainingCost)
  }

  return total
}
