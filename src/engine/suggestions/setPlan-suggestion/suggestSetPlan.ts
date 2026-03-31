/*
  Author: Runor Ewhro
  Description: Explores valid echo set plans, evaluates each plan against
               the current suggestion context, and returns the strongest
               feasible set-plan recommendations.
*/

import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { isSetPlanFeasible } from '@/engine/suggestions/mutate'
import type { SuggestionEvaluationContext } from '@/engine/suggestions/types'
import {
  buildPreparedSetPlanSuggestionsInput,
  buildSuggestionMainEchoBuffs,
  runSuggestionSimulation,
} from '@/engine/suggestions/shared'
import type {
  PreparedSetPlanSuggestionsInput,
  SetPlanEntry,
  SetPlanSuggestionEntry,
  SetPlanSuggestionsInput,
  SetPlanSuggestionsResult,
} from '@/engine/suggestions/types'
import {
  computeSetPlanDamage,
  computeRotationSetPlanDamage,
} from '@/engine/suggestions/setPlan-suggestion/compute'
import type { EchoInstance } from '@/domain/entities/runtime'

// enumerate and evaluate set plans for either direct or rotation mode
export function suggestSetPlans({
                                  ctx,
                                  rotationCtx = null,
                                  fivePieceSets = [],
                                  threePieceSets = [],
                                  topK = 10,
                                  exhaustive = false,
                                  equippedEchoes = [],
                                }: {
  ctx: SuggestionEvaluationContext | null
  rotationCtx?: SuggestionEvaluationContext | null
  fivePieceSets?: number[]
  threePieceSets?: number[]
  topK?: number
  exhaustive?: boolean
  equippedEchoes?: Array<EchoInstance | null>
}): { baseAvg: number; results: SetPlanSuggestionEntry[] } {
  const results: SetPlanSuggestionEntry[] = []
  const isRotationMode = rotationCtx != null

  // remove all current set assignments so every candidate plan starts
  // from a neutral baseline rather than inheriting existing set bonuses
  const baseEchoes: Array<EchoInstance | null> = equippedEchoes.map(
      (echo) => (echo ? { ...echo, set: 0 } : null),
  )

  // main echo buff rows only depend on the concrete echo identities,
  // so compute them once and reuse for every set-plan evaluation
  const activeCtx = (rotationCtx ?? ctx)!
  const mainEchoBuffs = buildSuggestionMainEchoBuffs(activeCtx, equippedEchoes)

  // pick the correct damage evaluator based on direct vs rotation mode
  const computeDamage = isRotationMode
      ? (setPlan: SetPlanEntry[]) =>
          computeRotationSetPlanDamage(rotationCtx!, setPlan, baseEchoes, mainEchoBuffs)
      : (setPlan: SetPlanEntry[]) =>
          computeSetPlanDamage(ctx!, setPlan, baseEchoes, mainEchoBuffs)

  // baseline damage with no set-plan override at all
  const baseDmg = computeDamage([])
  const baseAvg = baseDmg.avgDamage

  // numeric tolerance for equality comparisons
  const eps = Math.max(1e-6, Math.abs(baseAvg) * 1e-6)

  // flatten the selectable set list into a DFS-friendly array
  const allSets = [
    ...fivePieceSets.map((id) => ({ id, type: '5pc' as const })),
    ...threePieceSets.map((id) => ({ id, type: '3pc' as const })),
  ]

  // cache partial-piece baselines like 2pc or 3pc so we can later suppress
  // redundant mixed plans that are effectively identical to a standalone partial set
  const pieceBaselines = new Map<string, number>()

  for (const { id, type } of allSets) {
    if (type === '5pc') {
      const dmg2 = computeDamage([{ setId: id, pieces: 2 }])
      pieceBaselines.set(`${id}:2`, dmg2.avgDamage)
    } else if (type === '3pc') {
      const dmg3 = computeDamage([{ setId: id, pieces: 3 }])
      pieceBaselines.set(`${id}:3`, dmg3.avgDamage)
    }
  }

  // evaluate one concrete set-plan candidate and maybe keep it
  function maybeInsert(setPlan: SetPlanEntry[], totalPieces: number) {
    const dmg = computeDamage(setPlan)

    const avg = dmg.avgDamage

    // skip plans that are effectively identical to the no-plan baseline
    if (Math.abs(avg - baseAvg) <= eps) {
      return
    }

    // if a mixed plan performs the same as one cached partial baseline,
    // drop it unless it is exactly that standalone partial plan
    for (const entry of setPlan) {
      if (entry.pieces === 2 || entry.pieces === 3) {
        const key = `${entry.setId}:${entry.pieces}`
        const baseline = pieceBaselines.get(key)

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
      echoes: equippedEchoes,
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
    } else {
      if (usedPieces + 3 <= 5) {
        plan.push({ setId: id, pieces: 3 })
        dfs(index + 1, usedPieces + 3, plan)
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
export function runSetSuggestor(
    input: SetPlanSuggestionsInput,
    options: {
      fivePieceSets?: number[]
      threePieceSets?: number[]
      topK?: number
    } = {},
): SetPlanSuggestionsResult {
  const rotationMode = input.rotationMode

  // first simulate the current state to build the suggestion context
  const simulation = runSuggestionSimulation(input)
  const prepared = buildPreparedSetPlanSuggestionsInput(input, simulation)
  if (!prepared) {
    return { baseAvg: 0, results: [], isRotation: rotationMode }
  }

  const currentEchoes = prepared.equippedEchoes
  const nonNullCount = currentEchoes.filter((echo) => echo != null).length

  // no equipped echoes means there is nothing meaningful to assign sets onto
  if (nonNullCount === 0) {
    return { baseAvg: 0, results: [], isRotation: rotationMode }
  }

  // default candidate sets come from the echo set catalog grouped by set size
  const fivePieceSets = options.fivePieceSets
      ?? ECHO_SET_DEFS.filter((entry) => entry.setMax !== 3).map((entry) => entry.id)

  const threePieceSets = options.threePieceSets
      ?? ECHO_SET_DEFS.filter((entry) => entry.setMax === 3).map((entry) => entry.id)

  const topK = options.topK ?? 10

  const { baseAvg, results } = suggestSetPlans({
    ctx: rotationMode ? null : prepared.context,
    rotationCtx: rotationMode ? prepared.context : null,
    fivePieceSets,
    threePieceSets,
    topK: prepared.topK ?? topK,
    exhaustive: true,
    equippedEchoes: currentEchoes,
  })

  // remove plans that either exceed the number of equipped echoes
  // or cannot actually be realized on the current echo collection
  const filtered = results.filter((result) =>
      result.setPlan.reduce((sum, entry) => sum + entry.pieces, 0) <= nonNullCount &&
      isSetPlanFeasible(result.setPlan, currentEchoes),
  )

  return {
    baseAvg,
    results: filtered,
    isRotation: rotationMode,
  }
}

export function runPreparedSetSuggestor(
    input: PreparedSetPlanSuggestionsInput,
): SetPlanSuggestionsResult {
  const currentEchoes = input.equippedEchoes
  const nonNullCount = currentEchoes.filter((echo) => echo != null).length
  if (nonNullCount === 0) {
    return { baseAvg: 0, results: [], isRotation: input.rotationMode }
  }

  const fivePieceSets = ECHO_SET_DEFS.filter((entry) => entry.setMax !== 3).map((entry) => entry.id)
  const threePieceSets = ECHO_SET_DEFS.filter((entry) => entry.setMax === 3).map((entry) => entry.id)

  const { baseAvg, results } = suggestSetPlans({
    ctx: input.rotationMode ? null : input.context,
    rotationCtx: input.rotationMode ? input.context : null,
    fivePieceSets,
    threePieceSets,
    topK: input.topK ?? 10,
    exhaustive: true,
    equippedEchoes: currentEchoes,
  })

  return {
    baseAvg,
    results: results.filter((result) =>
        result.setPlan.reduce((sum, entry) => sum + entry.pieces, 0) <= nonNullCount
        && isSetPlanFeasible(result.setPlan, currentEchoes),
    ),
    isRotation: input.rotationMode,
  }
}
