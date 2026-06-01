/*
  Author: Runor Ewhro
  Description: Generates main-stat suggestions by exploring valid
               main-stat recipe combinations, evaluating their damage,
               and keeping the top-performing results.
*/

import type {
  MainStatSugg,
  MainStatSuwo,
  MainStatPrep,
} from '@/engine/suggestions/types'
import type { SuggestContext } from '@/engine/suggestions/types'
import {
  mkPrepMainSt,
  mkSuggMainEc,
  runSuggSmlt,
} from '@/engine/suggestions/shared'
import { mkMainStatPo } from '@/engine/suggestions/mainStat-suggestion/ctx-builder'
import { cmptMainStat, cmptRotMainS } from '@/engine/suggestions/mainStat-suggestion/compute'
import type { MainStatRecipe } from '@/engine/suggestions/mainStat-suggestion/utils'
import type { EchoInstance } from '@/domain/entities/runtime'

// search through valid main-stat recipes and return the best-scoring options
export function sggsMainStts({
                                   ctx,
                                   rotationCtx = null,
                                   charId,
                                   statWeight = {},
                                   mainStatFilter: mainStatFilter = null,
                                   maxSlots = 5,
                                   minSlots = 1,
                                   maxCost = 12,
                                   topK = 5,
                                   qppdChs: qppdChs = [],
                                 }: {
  ctx: SuggestContext | null
  rotationCtx?: SuggestContext | null
  charId?: string | null
  statWeight?: Partial<Record<string, number>>
  mainStatFilter?: Record<string, boolean> | null
  maxSlots?: number
  minSlots?: number
  maxCost?: number
  topK?: number
  qppdChs?: Array<EchoInstance | null>
}): MainStatSugg[] {
  // build the candidate pool of legal main stats
  const pool = mkMainStatPo({ statWeight, charId, mainStatFilter: mainStatFilter })

  const results: MainStatSugg[] = []

  // determine whether we are evaluating direct damage or rotation damage
  const isRotMode = rotationCtx != null
  const activeCtx = (ctx ?? rotationCtx)!

  // main echo buff rows only depend on echo identity/layout, not the recipe choices,
  // so compute them once and reuse across all evaluations
  const mainEchoBuffs = mkSuggMainEc(activeCtx, qppdChs)

  // mutable path used during dfs
  const curRcps: MainStatRecipe[] = []

  // evaluate the current recipe set and insert it into the ranked results
  function mybNsrtRslt(costUsed: number) {
    let avgDamage: number

    if (isRotMode) {
      avgDamage = cmptRotMainS(
          rotationCtx!,
          curRcps,
          qppdChs,
          mainEchoBuffs,
      )
    } else {
      avgDamage = cmptMainStat(
          ctx!,
          curRcps,
          qppdChs,
          mainEchoBuffs,
      )
    }

    results.push({
      damage: avgDamage,
      totalCost: costUsed,
      isRotation: isRotMode,
      recipes: curRcps.map((recipe) => ({ ...recipe })),
    })

    // keep results sorted best-first and trim to topK
    results.sort((a, b) => b.damage - a.damage)
    if (results.length > topK) {
      results.length = topK
    }
  }

  // depth-first search over non-decreasing recipe choices
  function dfs(startIndex: number, slotsUsed: number, costUsed: number) {
    // once the minimum slot count is met, the current path is a valid candidate
    if (slotsUsed >= minSlots) {
      mybNsrtRslt(costUsed)
    }

    // stop when the slot cap is reached
    if (slotsUsed === maxSlots) {
      return
    }

    // continue adding more main-stat choices, allowing reuse of the same option
    for (let i = startIndex; i < pool.length; i++) {
      const option = pool[i]
      const newCost = costUsed + option.cost

      // skip combinations that exceed the total echo cost budget
      if (newCost > maxCost) {
        continue
      }

      curRcps.push({
        cost: option.cost,
        primaryKey: option.key,
      })

      dfs(i, slotsUsed + 1, newCost)

      curRcps.pop()
    }
  }

  dfs(0, 0, 0)

  return results
}

// run the full main-stat suggestor pipeline from simulation to ranked outputs
export function runMainStats(
    input: MainStatSuwo,
    options: {
      maxSlots?: number
      minSlots?: number
      maxCost?: number
      topK?: number
    } = {},
): MainStatSugg[] {
  const rotationMode = input.rotationMode

  // simulate the current build first so we can derive context and stat weights
  const simulation = runSuggSmlt(input)
  const prepared = mkPrepMainSt(input, simulation)
  if (!prepared) {
    return []
  }

  // dispatch to the shared search routine
  return sggsMainStts({
    ctx: rotationMode ? null : prepared.context,
    rotationCtx: rotationMode ? prepared.context : null,
    charId: prepared.charId,
    statWeight: prepared.statWeight,
    maxSlots: options.maxSlots ?? 5,
    minSlots: options.minSlots ?? 1,
    maxCost: options.maxCost ?? 12,
    topK: options.topK ?? prepared.topK ?? 10,
    qppdChs: prepared.qppdChs,
  })
}

export function runPrepMainS(
    input: MainStatPrep,
): MainStatSugg[] {
  const nonNullCount = input.qppdChs.filter((echo) => echo != null).length
  if (nonNullCount === 0) {
    return []
  }

  return sggsMainStts({
    ctx: input.rotationMode ? null : input.context,
    rotationCtx: input.rotationMode ? input.context : null,
    charId: input.charId,
    statWeight: input.statWeight,
    topK: input.topK ?? 10,
    qppdChs: input.qppdChs,
  })
}
