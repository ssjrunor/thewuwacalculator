const OPTIMIZER_MAX_COST = 12
const OPTIMIZER_ECHOS_PER_COMBO = 5

function buildDpExcluding(
  costs: Uint8Array,
  maxCost: number,
  excludedIndex: number | null,
): Int32Array[] {
  const maxK = excludedIndex == null ? OPTIMIZER_ECHOS_PER_COMBO : (OPTIMIZER_ECHOS_PER_COMBO - 1)
  const dp = Array.from({ length: maxK + 1 }, () => new Int32Array(maxCost + 1))
  dp[0][0] = 1

  for (let index = 0; index < costs.length; index += 1) {
    if (excludedIndex != null && index === excludedIndex) {
      continue
    }

    const cost = costs[index] | 0
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

export function countOptimizerCombinationsForMainIndices(
  costs: Uint8Array,
  mainCandidateIndices: ReadonlyArray<number> | Int32Array,
): number {
  let total = 0

  for (const mainIndex of mainCandidateIndices) {
    const remainingCost = OPTIMIZER_MAX_COST - (costs[mainIndex] | 0)
    if (remainingCost < 0) {
      continue
    }

    const dp = buildDpExcluding(costs, OPTIMIZER_MAX_COST, mainIndex)
    const row = dp[OPTIMIZER_ECHOS_PER_COMBO - 1]
    for (let cost = 0; cost <= remainingCost; cost += 1) {
      total += row[cost]
    }
  }

  return total
}
