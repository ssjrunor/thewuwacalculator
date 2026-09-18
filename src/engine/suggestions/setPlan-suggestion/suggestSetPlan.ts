/*
  Author: Runor Ewhro
  Description: Explores valid echo set plans, evaluates each plan against
               the current suggestion context, and returns the strongest
               feasible set-plan recommendations.
*/

import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { applySetPlan, prepSetPlanFsb } from '@/engine/suggestions/mutate'
import type { SuggestContext } from '@/engine/suggestions/types'
import {
  getSetCntBkt,
  getSetRowFfs,
  SET_ROT_TOGGLES,
  SETCNSTLUTRO,
  SETRTTGLST14,
  SETRTTGLST22,
  SETRTTGLST29,
  SETRTTGLST33,
} from '@/engine/optimizer/encode/sets'
import {
  mkPrepSetPla,
  runSuggSmlt,
  resSuggDmg,
} from '@/engine/suggestions/shared'
import type {
  PrepSetPlanS,
  SetPlanDisplayEntry,
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

type DisplayAccumulator = {
  pieces: number
  setIds: Set<number>
}

type DamageResult = {
  avgDamage: number
}

function setEffectSig(ctx: SuggestContext, entry: SetPlanEntry): string {
  const row = getSetRowFfs(entry.setId, getSetCntBkt(entry.pieces))
  const totals: number[] = []
  for (let index = 0; index < SETCNSTLUTRO; index += 1) {
    totals.push(ctx.setConstLut[row + index] ?? 0)
  }

  const hasSpecialState =
      (entry.setId === 14 && (ctx.setRtMask & SETRTTGLST14) !== 0)
      || (entry.setId === 22 && (ctx.setRtMask & (SETRTTGLST22 | SET_ROT_TOGGLES)) !== 0)
      || (entry.setId === 29 && (ctx.setRtMask & SETRTTGLST29) !== 0)
      || (entry.setId === 33 && entry.pieces >= 5 && (ctx.setRtMask & SETRTTGLST33) !== 0)

  return `${totals.join(',')}|${hasSpecialState ? `${entry.setId}:${entry.pieces}` : ''}`
}

function setDisplayKey(ctx: SuggestContext, entry: SetPlanEntry): string {
  return `${entry.pieces}|${setEffectSig(ctx, entry)}`
}

function setEffectPlanKey(ctx: SuggestContext, setPlan: SetPlanEntry[]): string {
  return displaySlotsFor(ctx, setPlan)
      .map(({ key }) => key)
      .join('||')
}

function displaySlotsFor(ctx: SuggestContext, setPlan: SetPlanEntry[]): Array<{
  key: string
  entry: SetPlanEntry
}> {
  const seen = new Map<string, number>()
  return setPlan
      .map((entry) => {
        const baseKey = setDisplayKey(ctx, entry)
        const occurrence = seen.get(baseKey) ?? 0
        seen.set(baseKey, occurrence + 1)
        return {
          key: `${baseKey}#${occurrence}`,
          entry,
        }
      })
      .sort((left, right) => left.key.localeCompare(right.key))
}

function addDisplaySlots(
    displayByKey: Map<string, DisplayAccumulator>,
    ctx: SuggestContext,
    setPlan: SetPlanEntry[],
) {
  for (const { key, entry } of displaySlotsFor(ctx, setPlan)) {
    const display = displayByKey.get(key) ?? {
      pieces: entry.pieces,
      setIds: new Set<number>(),
    }
    display.setIds.add(entry.setId)
    displayByKey.set(key, display)
  }
}

function makeDisplayPlan(
    displayByKey: Map<string, DisplayAccumulator>,
): SetPlanDisplayEntry[] {
  const setIdsByBaseKey = new Map<string, Set<number>>()
  for (const [key, display] of displayByKey.entries()) {
    const baseKey = key.slice(0, key.lastIndexOf('#'))
    const setIds = setIdsByBaseKey.get(baseKey) ?? new Set<number>()
    for (const setId of display.setIds) {
      setIds.add(setId)
    }
    setIdsByBaseKey.set(baseKey, setIds)
  }

  return [...displayByKey.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, display]) => ({
        pieces: display.pieces,
        setIds: [...(setIdsByBaseKey.get(key.slice(0, key.lastIndexOf('#'))) ?? display.setIds)]
            .sort((left, right) => left - right),
      }))
      .sort((left, right) =>
        right.pieces - left.pieces || (left.setIds[0] ?? 0) - (right.setIds[0] ?? 0),
      )
}

function displayEntriesFor(result: SetPlanSuggest): SetPlanEntry[] {
  if (result.displayPlan?.length) {
    return result.displayPlan.flatMap((entry) =>
      entry.setIds.map((setId) => ({ setId, pieces: entry.pieces })),
    )
  }

  return result.setPlan
}

function sameDamage(left: number, right: number, eps: number): boolean {
  return Math.abs(left - right) <= Math.max(eps, Math.abs(left) * 1e-6, Math.abs(right) * 1e-6)
}

function groupEquivalentSetPlans(
    results: SetPlanSuggest[],
    ctx: SuggestContext,
    eps: number,
): SetPlanSuggest[] {
  const grouped = new Map<string, Array<{
    result: SetPlanSuggest
    displayByKey: Map<string, DisplayAccumulator>
  }>>()

  for (const result of results) {
    const displayEntries = displayEntriesFor(result)
    const key = setEffectPlanKey(ctx, displayEntries)
    const bucket = grouped.get(key) ?? []
    const existing = bucket.find((entry) => sameDamage(entry.result.avgDamage, result.avgDamage, eps))

    if (existing) {
      addDisplaySlots(existing.displayByKey, ctx, displayEntries)
      if (result.avgDamage > existing.result.avgDamage) {
        existing.result = result
      }
      continue
    }

    const displayByKey = new Map<string, DisplayAccumulator>()
    addDisplaySlots(displayByKey, ctx, displayEntries)
    bucket.push({
      result,
      displayByKey,
    })
    grouped.set(key, bucket)
  }

  return [...grouped.values()].flat()
      .map(({ result, displayByKey }) => ({
        ...result,
        displayPlan: makeDisplayPlan(displayByKey),
      }))
      .sort((left, right) => right.avgDamage - left.avgDamage)
}

function usefulSetPlan(
    setPlan: SetPlanEntry[],
    avgDamage: number,
    scorePlan: (setPlan: SetPlanEntry[]) => DamageResult,
    eps: number,
): SetPlanEntry[] {
  return setPlan.filter((_, index) => {
    const withoutEntry = [
      ...setPlan.slice(0, index),
      ...setPlan.slice(index + 1),
    ]
    const withoutDamage = scorePlan(withoutEntry).avgDamage
    return !sameDamage(avgDamage, withoutDamage, eps)
  })
}

// enumerate and evaluate set plans for either direct or rotation mode
export function sggsSetPlns({
                                  ctx,
                                  rotationCtx = null,
                                  fivePcSets: fivePcSets = [],
                                  thrPcSets: thrPcSets = [],
                                  topK = 10,
                                  exhaustive = false,
                                  qppdChs: qppdChs = [],
                                  scorePlan,
                                  isFeasible,
                                }: {
  ctx: SuggestContext | null
  rotationCtx?: SuggestContext | null
  fivePcSets?: number[]
  thrPcSets?: number[]
  topK?: number
  exhaustive?: boolean
  qppdChs?: Array<EchoInstance | null>
  scorePlan?: (setPlan: SetPlanEntry[]) => DamageResult
  isFeasible?: (setPlan: SetPlanEntry[]) => boolean
}): { baseAvg: number; results: SetPlanSuggest[] } {
  const results: SetPlanSuggest[] = []
  const isRotMode = rotationCtx != null

  // remove all current set assignments so every candidate plan starts
  // from a neutral baseline rather than inheriting existing set bonuses
  const baseEchoes: Array<EchoInstance | null> = qppdChs.map(
      (echo) => (echo ? { ...echo, set: 0 } : null),
  )

  // Useful-piece comparisons isolate set bonuses on a neutral loadout.
  // Full candidate simulation can also change Echo bodies and inherit worn
  // filler sets, which must not make an otherwise useless piece contribute.
  const cmptDmg = isRotMode
      ? (setPlan: SetPlanEntry[]) =>
          calcRotSetPlan(rotationCtx!, setPlan, baseEchoes)
      : (setPlan: SetPlanEntry[]) =>
          calcSetPlan(ctx!, setPlan, baseEchoes)

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
    if (isFeasible && !isFeasible(setPlan)) return
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

    const usefulPlan = usefulSetPlan(setPlan, avg, cmptDmg, eps)
    if (usefulPlan.length === 0) {
      return
    }

    results.push({
      avgDamage: scorePlan ? scorePlan(setPlan).avgDamage : avg,
      setPlan: [...setPlan].map((entry) => ({
        setId: entry.setId,
        pieces: entry.pieces,
      })),
      displayPlan: usefulPlan.map((entry) => ({
        setIds: [entry.setId],
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
      displayPlan: result.displayPlan,
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

  return scorePreparedSetPlans(prepared, options)
}

export function runPrepSetSg(input: PrepSetPlanS): SetPlanSugoi {
  return scorePreparedSetPlans(input)
}

// Score concrete, feasible plans before grouping. Changing a set may also
// replace the main Echo, so a fixed packed context cannot own candidate totals.
function scorePreparedSetPlans(
    input: PrepSetPlanS,
    options: { fivePcSets?: number[], thrPcSets?: number[], topK?: number } = {},
): SetPlanSugoi {
  const currentEchoes = input.qppdChs
  const nonNullCount = currentEchoes.filter((echo) => echo != null).length
  if (nonNullCount === 0) {
    return { baseAvg: 0, results: [], isRotation: input.rotationMode }
  }

  const feasible = prepSetPlanFsb(currentEchoes)
  const scores = new Map<string, DamageResult>()
  const scorePlan = (setPlan: SetPlanEntry[]): DamageResult => {
    const key = JSON.stringify(setPlan)
    const cached = scores.get(key)
    if (cached) return cached
    const echoes = applySetPlan(setPlan, currentEchoes)
    const runtime = { ...input.scoringInput.runtime, build: { ...input.scoringInput.runtime.build, echoes } }
    const scoring = { ...input.scoringInput, runtime }
    const result = { avgDamage: resSuggDmg(runSuggSmlt(scoring), scoring) }
    scores.set(key, result)
    return result
  }

  const { results } = sggsSetPlns({
    ctx: input.rotationMode ? null : input.context,
    rotationCtx: input.rotationMode ? input.context : null,
    fivePcSets: options.fivePcSets ?? ECHO_SET_DEFS.filter((entry) => entry.setMax === 5).map((entry) => entry.id),
    thrPcSets: options.thrPcSets ?? ECHO_SET_DEFS.filter((entry) => entry.setMax === 3).map((entry) => entry.id),
    topK: options.topK ?? input.topK ?? 10,
    exhaustive: true,
    qppdChs: currentEchoes,
    scorePlan,
    isFeasible: (plan) => plan.reduce((sum, entry) => sum + entry.pieces, 0) <= nonNullCount && feasible(plan),
  })

  const baseAvg = resSuggDmg(runSuggSmlt(input.scoringInput), input.scoringInput)
  return {
    baseAvg,
    results: groupEquivalentSetPlans(results, input.context, Math.max(1e-6, Math.abs(baseAvg) * 1e-6)),
    isRotation: input.rotationMode,
  }
}
