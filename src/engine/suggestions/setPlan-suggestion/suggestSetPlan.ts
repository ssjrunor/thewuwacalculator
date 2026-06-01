/*
  Author: Runor Ewhro
  Description: Explores valid echo set plans, evaluates each plan against
               the current suggestion context, and returns the strongest
               feasible set-plan recommendations.
*/

import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { isSetPlanFsb } from '@/engine/suggestions/mutate'
import type { SuggestContext } from '@/engine/suggestions/types'
import {
  mkPrepSetPla,
  mkSuggMainEc,
  runSuggSmlt,
} from '@/engine/suggestions/shared'
import type {
  PrepSetPlanS,
  SetPlanEntry,
  SetPlanSuggest,
  SetPlanSuggs,
  SetPlanSugoi,
} from '@/engine/suggestions/types'
import {
  calcSetPlan,
  calcRotSetPlan,
} from '@/engine/suggestions/setPlan-suggestion/compute'
import type { EchoInstance } from '@/domain/entities/runtime'

// enumerate and evaluate set plans for either direct or rotation mode
export function sggsSetPlns({
                                  ctx,
                                  rotationCtx = null,
                                  fivePcSets: fivePcSets = [],
                                  thrPcSets: thrPcSets = [],
                                  topK = 10,
                                  exhaustive = false,
                                  qppdChs: qppdChs = [],
                                }: {
  ctx: SuggestContext | null
  rotationCtx?: SuggestContext | null
  fivePcSets?: number[]
  thrPcSets?: number[]
  topK?: number
  exhaustive?: boolean
  qppdChs?: Array<EchoInstance | null>
}): { baseAvg: number; results: SetPlanSuggest[] } {
  const results: SetPlanSuggest[] = []
  const isRotMode = rotationCtx != null

  // remove all current set assignments so every candidate plan starts
  // from a neutral baseline rather than inheriting existing set bonuses
  const baseEchoes: Array<EchoInstance | null> = qppdChs.map(
      (echo) => (echo ? { ...echo, set: 0 } : null),
  )

  // main echo buff rows only depend on the concrete echo identities,
  // so compute them once and reuse for every set-plan evaluation
  const activeCtx = (rotationCtx ?? ctx)!
  const mainEchoBuffs = mkSuggMainEc(activeCtx, qppdChs)

  // pick the correct damage evaluator based on direct vs rotation mode
  const cmptDmg = isRotMode
      ? (setPlan: SetPlanEntry[]) =>
          calcRotSetPlan(rotationCtx!, setPlan, baseEchoes, mainEchoBuffs)
      : (setPlan: SetPlanEntry[]) =>
          calcSetPlan(ctx!, setPlan, baseEchoes, mainEchoBuffs)

  // baseline damage with no set-plan override at all
  const baseDmg = cmptDmg([])
  const baseAvg = baseDmg.avgDamage

  // numeric tolerance for equality comparisons
  const eps = Math.max(1e-6, Math.abs(baseAvg) * 1e-6)

  // flatten the selectable set list into a DFS-friendly array
  const allSets = [
    ...fivePcSets.map((id) => ({ id, type: '5pc' as const })),
    ...thrPcSets.map((id) => ({ id, type: '3pc' as const })),
    ...ECHO_SET_DEFS.filter((entry) => entry.setMax === 1).map((entry) => ({ id: entry.id, type: '1pc' as const })),
  ]

  // cache partial-piece baselines like 2pc or 3pc so we can later suppress
  // redundant mixed plans that are effectively identical to a standalone partial set
  const pcBsln = new Map<string, number>()

  for (const { id, type } of allSets) {
    if (type === '5pc') {
      const dmg2 = cmptDmg([{ setId: id, pieces: 2 }])
      pcBsln.set(`${id}:2`, dmg2.avgDamage)
    } else if (type === '3pc') {
      const dmg3 = cmptDmg([{ setId: id, pieces: 3 }])
      pcBsln.set(`${id}:3`, dmg3.avgDamage)
    } else if (type === '1pc') {
      const dmg1 = cmptDmg([{ setId: id, pieces: 1 }])
      pcBsln.set(`${id}:1`, dmg1.avgDamage)
    }
  }

  // evaluate one concrete set-plan candidate and maybe keep it
  function maybeInsert(setPlan: SetPlanEntry[], totalPieces: number) {
    const dmg = cmptDmg(setPlan)

    const avg = dmg.avgDamage

    // skip plans that are effectively identical to the no-plan baseline
    if (Math.abs(avg - baseAvg) <= eps) {
      return
    }

    // if a mixed plan performs the same as one cached partial baseline,
    // drop it unless it is exactly that standalone partial plan
    for (const entry of setPlan) {
      if (entry.pieces === 2 || entry.pieces === 3 || entry.pieces === 1) {
        const key = `${entry.setId}:${entry.pieces}`
        const baseline = pcBsln.get(key)

        if (typeof baseline === 'number') {
          const localEps = Math.max(eps, Math.abs(baseline) * 1e-6)

          if (Math.abs(avg - baseline) <= localEps) {
            const isStandalone =
                setPlan.length === 1 && totalPieces === entry.pieces

            if (!isStandalone) {
              return
            }
          }
        }
      }
    }

    results.push({
      avgDamage: avg,
      setPlan: [...setPlan].map((entry) => ({
        setId: entry.setId,
        pieces: entry.pieces,
      })),
      echoes: qppdChs,
    })

    // in non-exhaustive mode, keep only the current top K as we go
    if (!exhaustive && topK > 0) {
      results.sort((a, b) => b.avgDamage - a.avgDamage)
      if (results.length > topK) {
        results.length = topK
      }
    }
  }

  // depth-first search over all selectable sets
  function dfs(index: number, usedPieces: number, plan: SetPlanEntry[]) {
    if (usedPieces > 5) {
      return
    }

    // once all candidate sets have been considered, score the built plan
    if (index === allSets.length) {
      if (usedPieces > 0) {
        maybeInsert(plan, usedPieces)
      }
      return
    }

    const { id, type } = allSets[index]

    // branch 1: skip this set entirely
    dfs(index + 1, usedPieces, plan)

    // branch 2+: include this set in any legal piece size it supports
    if (type === '5pc') {
      if (usedPieces + 2 <= 5) {
        plan.push({ setId: id, pieces: 2 })
        dfs(index + 1, usedPieces + 2, plan)
        plan.pop()
      }

      if (usedPieces + 5 <= 5) {
        plan.push({ setId: id, pieces: 5 })
        dfs(index + 1, usedPieces + 5, plan)
        plan.pop()
      }
    } else if (type === '3pc') {
      if (usedPieces + 3 <= 5) {
        plan.push({ setId: id, pieces: 3 })
        dfs(index + 1, usedPieces + 3, plan)
        plan.pop()
      }
    } else if (type === '1pc') {
      if (usedPieces + 1 <= 5) {
        plan.push({ setId: id, pieces: 1 })
        dfs(index + 1, usedPieces + 1, plan)
        plan.pop()
      }
    }
  }

  dfs(0, 0, [])

  // exhaustive mode collects everything first, then sorts once at the end
  if (exhaustive) {
    results.sort((a, b) => b.avgDamage - a.avgDamage)
  }

  return {
    baseAvg,
    results: results.map((result) => ({
      setPlan: result.setPlan,
      avgDamage: result.avgDamage,
      echoes: result.echoes,
    })),
  }
}

// run the full set-plan suggestor pipeline from simulation to filtered output
export function runSetSggs(
    input: SetPlanSuggs,
    options: {
      fivePcSets?: number[]
      thrPcSets?: number[]
      topK?: number
    } = {},
): SetPlanSugoi {
  const rotationMode = input.rotationMode

  // first simulate the current state to build the suggestion context
  const simulation = runSuggSmlt(input)
  const prepared = mkPrepSetPla(input, simulation)
  if (!prepared) {
    return { baseAvg: 0, results: [], isRotation: rotationMode }
  }

  const curChs = prepared.qppdChs
  const nonNullCount = curChs.filter((echo) => echo != null).length

  // no equipped echoes means there is nothing meaningful to assign sets onto
  if (nonNullCount === 0) {
    return { baseAvg: 0, results: [], isRotation: rotationMode }
  }

  // default candidate sets come from the echo set catalog grouped by set size
  const fivePcSets = options.fivePcSets
      ?? ECHO_SET_DEFS.filter((entry) => entry.setMax === 5).map((entry) => entry.id)

  const thrPcSets = options.thrPcSets
      ?? ECHO_SET_DEFS.filter((entry) => entry.setMax === 3).map((entry) => entry.id)

  const topK = options.topK ?? 10

  const { baseAvg, results } = sggsSetPlns({
    ctx: rotationMode ? null : prepared.context,
    rotationCtx: rotationMode ? prepared.context : null,
    fivePcSets: fivePcSets,
    thrPcSets: thrPcSets,
    topK: prepared.topK ?? topK,
    exhaustive: true,
    qppdChs: curChs,
  })

  // remove plans that either exceed the number of equipped echoes
  // or cannot actually be realized on the current echo collection
  const filtered = results.filter((result) =>
      result.setPlan.reduce((sum, entry) => sum + entry.pieces, 0) <= nonNullCount &&
      isSetPlanFsb(result.setPlan, curChs),
  )

  return {
    baseAvg,
    results: filtered,
    isRotation: rotationMode,
  }
}

export function runPrepSetSg(
    input: PrepSetPlanS,
): SetPlanSugoi {
  const curChs = input.qppdChs
  const nonNullCount = curChs.filter((echo) => echo != null).length
  if (nonNullCount === 0) {
    return { baseAvg: 0, results: [], isRotation: input.rotationMode }
  }

  const fivePcSets = ECHO_SET_DEFS.filter((entry) => entry.setMax === 5).map((entry) => entry.id)
  const thrPcSets = ECHO_SET_DEFS.filter((entry) => entry.setMax === 3).map((entry) => entry.id)

  const { baseAvg, results } = sggsSetPlns({
    ctx: input.rotationMode ? null : input.context,
    rotationCtx: input.rotationMode ? input.context : null,
    fivePcSets: fivePcSets,
    thrPcSets: thrPcSets,
    topK: input.topK ?? 10,
    exhaustive: true,
    qppdChs: curChs,
  })

  return {
    baseAvg,
    results: results.filter((result) =>
        result.setPlan.reduce((sum, entry) => sum + entry.pieces, 0) <= nonNullCount
        && isSetPlanFsb(result.setPlan, curChs),
    ),
    isRotation: input.rotationMode,
  }
}
