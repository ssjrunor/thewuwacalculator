/*
  Author: Runor Ewhro
  Description: centralized optimizer search-space counting helpers for both
               inventory-facing estimates and encoded main-index subsets.
*/

import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import type { OptSets } from '@/domain/entities/optimizer'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService'
import { getGameData } from '@/data/gameData'
import { ECHO_MAIN_STATS, getEchoSttsSrc } from '@/data/gameData/catalog/echoStats.ts'
import { listEffects } from '@/domain/gameData/registry.ts'
import { mkSetPlanCnd } from '@/engine/suggestions/mutate.ts'
import {
  normOptSets,
  optSetIdSet,
} from '@/engine/optimizer/config/allowedSets.ts'

// the optimizer always builds 5-echo loadouts
const ECHOES_PER_SET = 5

// total echo cost cap for one valid loadout
const OPT_MAX_COST = 12
const ELEMBNSKEYS = new Set(['aero', 'glacio', 'fusion', 'spectro', 'havoc', 'electro'])

export type OptCntMode = 'rows' | 'combos' | 'combinadic'

// resolve the catalog cost for an inventory echo
function getEchoCost(echo: EchoInstance): number {
  return getEchoById(echo.id)?.cost ?? 0
}

function mapMainFilter(key: string): string | null {
  if (key === 'atkPercent') return 'atk%'
  if (key === 'hpPercent') return 'hp%'
  if (key === 'defPercent') return 'def%'
  if (key === 'energyRegen') return 'er'
  if (key === 'critRate') return 'cr'
  if (key === 'critDmg') return 'cd'
  if (key === 'healingBonus') return 'healing'
  if (ELEMBNSKEYS.has(key)) return 'bonus'
  return null
}

function mainOptKeys(
    settings: OptSets,
    cost: number,
): string[] {
  const rawStats = getEchoSttsSrc()?.primaryStats?.[String(cost)]
  const all = Object.keys(rawStats ?? ECHO_MAIN_STATS[cost] ?? {})
  if (all.length === 0 || settings.mainStatFilter.length === 0) {
    return all
  }

  const filters = new Set(settings.mainStatFilter)
  const filt = all.filter((key) => {
    const filterKey = mapMainFilter(key)
    if (!filterKey || !filters.has(filterKey)) {
      return false
    }

    return filterKey !== 'bonus' || !settings.selectedBonus || key === settings.selectedBonus
  })

  return filt.length > 0 ? filt : all
}

function hasSelfBuff(echoId: string): boolean {
  const effects = listEffects(getGameData(), { type: 'echo', id: echoId })
  for (const effect of effects) {
    if ((effect.targetScope ?? 'self') === 'self') {
      return true
    }
  }
  return false
}

function getAllowedSets(settings: OptSets): Set<number> {
  return optSetIdSet(settings.allowedSets)
}

// count main-eligible catalog/set candidates by cost under the visible set
// filter. the worker attempts main echo by concrete catalog+set row, so this
// keeps the prepared total aligned with the processed counter.
function cntMainByCost(settings: OptSets): Map<number, number> {
  const setIds = getAllowedSets(settings)
  const locked = settings.lockedMainEchoId
  const byCost = new Map<number, Set<string>>()

  for (const echo of listEchoes()) {
    const sets = setIds.size === 0
        ? echo.sets
        : echo.sets.filter((setId) => setIds.has(setId))
    if (sets.length === 0) {
      continue
    }

    if (!(locked ? echo.id === locked : hasSelfBuff(echo.id))) {
      continue
    }

    const bucket = byCost.get(echo.cost) ?? new Set<string>()
    for (const setId of sets) {
      bucket.add(`${echo.id}|${setId}`)
    }
    byCost.set(echo.cost, bucket)
  }

  return new Map(
      [...byCost.entries()].map(([cost, ids]) => [cost, ids.size]),
  )
}

// count legal cost/main layouts for the five current substat profiles.
// this intentionally ignores set identity; set identity is counted by the
// set-plan dimension so equivalent slot-level set permutations do not inflate
// theory mode's displayed search space.
export function countTheoryMain(settings: OptSets, slotCount: number): number {
  const setIds = getAllowedSets(settings)
  const mainByCost = cntMainByCost(settings)
  const costs = new Set<number>()

  for (const echo of listEchoes()) {
    const sets = setIds.size === 0
        ? echo.sets
        : echo.sets.filter((setId) => setIds.has(setId))
    if (sets.length > 0) {
      costs.add(echo.cost)
    }
  }

  const opts = [...costs]
      .map((cost) => ({
        cost,
        mains: mainOptKeys(settings, cost).length,
        mainCats: mainByCost.get(cost) ?? 0,
      }))
      .filter((entry) => entry.mains > 0)

  let ways = new Float64Array(OPT_MAX_COST + 1)
  let mainSums = new Float64Array(OPT_MAX_COST + 1)
  ways[0] = 1

  for (let slot = 0; slot < slotCount; slot += 1) {
    const nextWays = new Float64Array(OPT_MAX_COST + 1)
    const nextMainSums = new Float64Array(OPT_MAX_COST + 1)

    for (let cost = 0; cost <= OPT_MAX_COST; cost += 1) {
      const baseWays = ways[cost]
      if (baseWays <= 0) {
        continue
      }

      for (const opt of opts) {
        const nextCost = cost + opt.cost
        if (nextCost > OPT_MAX_COST) {
          continue
        }

        const optWays = baseWays * opt.mains
        nextWays[nextCost] += optWays
        nextMainSums[nextCost] += (mainSums[cost] * opt.mains) +
            (optWays * opt.mainCats)
      }
    }

    ways = nextWays
    mainSums = nextMainSums
  }

  let total = 0
  for (let cost = 0; cost <= OPT_MAX_COST; cost += 1) {
    total += mainSums[cost]
  }

  return total
}

// count the visible set-plan dimension using the same helper as suggestions.
// hidden sets stay out of the count; an empty allowed-set shape means the
// compiler should leave set plans unrestricted.
export function countSetPlans(settings: OptSets, slotCount: number): number {
  const allowedSets = normOptSets(settings.allowedSets)
  const allow5 = new Set(allowedSets[5])
  const allow3 = new Set(allowedSets[3])
  const hasFilter = allow5.size > 0 || allow3.size > 0

  return 1 + mkSetPlanCnd(slotCount).filter((plan) => (
    !hasFilter ||
    plan.every((entry) => (
      entry.pieces === 3
          ? allow3.has(entry.setId)
          : allow5.has(entry.setId)
    ))
  )).length
}

// collect all inventory indices that are allowed to serve as the main echo
function getMainIndices(
    echoes: EchoInstance[],
    lockedMainEcho: string | null,
): number[] {
  // if no main echo is locked, every echo can be the main slot
  if (!lockedMainEcho) {
    return echoes.map((_, index) => index)
  }

  const indices: number[] = []

  // otherwise keep only echoes whose id matches the locked main id
  for (let index = 0; index < echoes.length; index += 1) {
    if (echoes[index]?.id === lockedMainEcho) {
      indices.push(index)
    }
  }

  return indices
}

// sum the exact number of valid 5-echo combos from one DP row up to a cost cap
function countDpRows(row: Int32Array, maxCost: number): number {
  let total = 0

  for (let cost = 0; cost <= maxCost; cost += 1) {
    total += row[cost]
  }

  return total
}

// build a DP table where dp[k][c] = number of ways to choose k echoes
// with total cost exactly c, optionally skipping one excluded index.
// this is the core counting engine for the exact cost-constrained modes.
function makeDpExclude(
    costs: ArrayLike<number>,
    maxCost: number,
    excludeIndex: number | null,
): Int32Array[] {
  // if one echo is already fixed as the main echo, only 4 more need to be chosen
  const maxK = excludeIndex == null
      ? ECHOES_PER_SET
      : (ECHOES_PER_SET - 1)

  const dp = Array.from(
      { length: maxK + 1 },
      () => new Int32Array(maxCost + 1),
  )

  // one way to choose zero echoes at zero total cost
  dp[0][0] = 1

  for (let index = 0; index < costs.length; index += 1) {
    // skip the excluded main echo when one is fixed
    if (excludeIndex != null && index === excludeIndex) {
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
function countChoose(n: number, k: number): number {
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
export function countOptCombos(
    echoes: EchoInstance[],
    lockedMainEcho: string | null,
    countMode: OptCntMode = 'rows',
): number {
  // fewer than 5 echoes means no valid loadout exists
  if (echoes.length < ECHOES_PER_SET) {
    return 0
  }

  const costs = echoes.map(getEchoCost)

  // combinadic mode is a fast estimate that ignores the 12-cost cap
  if (countMode === 'combinadic') {
    const mainIndices = getMainIndices(echoes, lockedMainEcho)
    if (mainIndices.length === 0) {
      return 0
    }

    // without a locked main echo:
    // choose any 5 echoes, then treat each of the 5 positions as a possible main row
    if (!lockedMainEcho) {
      return countChoose(echoes.length, ECHOES_PER_SET) * ECHOES_PER_SET
    }

    // with a locked main echo:
    // choose 4 of the remaining echoes for each valid locked-main candidate
    return countChoose(
        echoes.length - 1,
        ECHOES_PER_SET - 1,
    ) * mainIndices.length
  }

  // exact counting when the main echo is not locked
  if (!lockedMainEcho) {
    const dp = makeDpExclude(costs, OPT_MAX_COST, null)
    const combos = countDpRows(dp[ECHOES_PER_SET], OPT_MAX_COST)

    // "combos" returns the exact number of legal 5-echo sets
    // "rows" expands each combo into 5 possible main-row placements
    return countMode === 'combos'
        ? combos
        : (combos * ECHOES_PER_SET)
  }

  // exact counting when the main echo is locked to one or more matching candidates
  const lckdNdcs = getMainIndices(echoes, lockedMainEcho)
  if (lckdNdcs.length === 0) {
    return 0
  }

  let totalCombos = 0

  for (const lockedIndex of lckdNdcs) {
    const remainCost = OPT_MAX_COST - costs[lockedIndex]

    // if the locked main alone already exceeds the cost cap, skip it
    if (remainCost < 0) {
      continue
    }

    // count ways to choose 4 additional echoes from the remaining pool
    const dp = makeDpExclude(costs, OPT_MAX_COST, lockedIndex)
    const combosForMain = countDpRows(
        dp[ECHOES_PER_SET - 1],
        remainCost,
    )

    totalCombos += combosForMain
  }

  return totalCombos
}

// default helper used by callers that want the historical "rows" count
export function countOptRows(
    echoes: EchoInstance[],
    lockedMainEcho: string | null,
): number {
  return countOptCombos(echoes, lockedMainEcho, 'rows')
}

export function countMainCombos(
    costs: ArrayLike<number>,
    mainIndices: ReadonlyArray<number> | Int32Array,
): number {
  let total = 0

  for (const mainIndex of mainIndices) {
    const remainCost = OPT_MAX_COST - ((costs[mainIndex] ?? 0) | 0)
    if (remainCost < 0) {
      continue
    }

    const dp = makeDpExclude(costs, OPT_MAX_COST, mainIndex)
    total += countDpRows(dp[ECHOES_PER_SET - 1], remainCost)
  }

  return total
}

export function countTheory(
    settings: OptSets,
    runtime: ResRuntime,
): number {
  const slotCount = runtime.build.echoes.filter((echo) => echo != null).length
  if (slotCount !== ECHOES_PER_SET) {
    return 0
  }

  return countTheoryMain(settings, slotCount) *
      countSetPlans(settings, slotCount)
}
