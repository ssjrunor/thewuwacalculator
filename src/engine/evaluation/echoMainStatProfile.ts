/*
  Author: Runor Ewhro
  Description: Reuses the Main Stat Suggestions search to cache its top layout
               and cost-relative weights for synchronous Echo scoring.
*/

import { getGameDataMode } from '@/data/gameData'
import { ECHO_MAIN_STATS, SUBSTAT_RANGES } from '@/data/gameData/catalog/echoStats'
import {
  activateEchoMainStatScoreProfile,
  cacheEchoMainStatScoreProfile,
  deactivateEchoMainStatScoreProfile,
  getGeneratedMainStatWeight,
  type EchoMainStatScoreProfile,
} from '@/engine/evaluation/echoScoring'
import { getWeightSetKey } from '@/data/scoring/charStatWeights'
import { calcSubEvaluation } from '@/engine/evaluation/substatEvaluation'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatScenarioId, TeamMemberId } from '@/domain/entities/combatScenario'
import type { EchoInstance, ResRuntime, ResSeed } from '@/domain/entities/runtime'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { runtimeSig } from '@/engine/runtime/runtimeSignature'
import type { SimResult } from '@/engine/pipeline/types'
import { runMainStatS } from '@/engine/suggestions/client'
import { applyMainSta } from '@/engine/suggestions/mainStat-suggestion/utils'
import { mkPrepMainSt } from '@/engine/suggestions/shared'
import type {
  MainStatPrep,
  MainStatSugg,
  MainStatSuwo,
} from '@/engine/suggestions/types'
import type { BuildEvaluationReport } from '@/engine/evaluation/buildEvaluation'

type MainStatRunner = (payload: MainStatPrep) => Promise<MainStatSugg[]>

const latestProfileKeyByChar = new Map<string, string>()
const inFlightBestByKey = new Map<string, Promise<MainStatSugg | null>>()

export interface EchoMainStatProfileInput {
  scenarioId: CombatScenarioId
  memberId: TeamMemberId
  runtime: ResRuntime
  seed: ResSeed
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
  selectedTargets: Record<string, string | null>
  setConds?: SntSetConds
  simulation: SimResult
}

function sortedRecord(record: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
}

function scoringReferenceRuntime(runtime: ResRuntime): ResRuntime {
  return {
    ...runtime,
    build: {
      ...runtime.build,
      echoes: runtime.build.echoes.map((echo, index) => echo ? {
        ...echo,
        uid: `echo-score-slot-${index}`,
        substats: {},
      } : null),
    },
  }
}

function suggestionInput(input: EchoMainStatProfileInput): MainStatSuwo {
  return {
    scenarioId: input.scenarioId,
    memberId: input.memberId,
    runtime: input.runtime,
    seed: input.seed,
    enemy: input.enemy,
    runtimesById: input.runtimesById,
    selectedTargets: input.selectedTargets,
    setConds: input.setConds,
    setStateMode: 'resolved',
    tgtFeatId: null,
    rotationMode: true,
    topK: 1,
  }
}

export function makeEchoMainStatProfileKey(
    input: Omit<EchoMainStatProfileInput, 'simulation'>,
): string {
  const participants = Object.entries(input.runtimesById)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([resonatorId, runtime]) => [
        resonatorId,
        runtimeSig(resonatorId === input.runtime.id ? scoringReferenceRuntime(runtime) : runtime),
      ])

  // The scoring target follows combat context and the equipped main-stat
  // layout, but not the substat rolls currently being graded. Otherwise tuning
  // a single roll would move the 100% reference underneath the user.
  return JSON.stringify({
    version: 6,
    mode: getGameDataMode(),
    weights: getWeightSetKey(),
    scenarioId: input.scenarioId,
    memberId: input.memberId,
    runtime: runtimeSig(scoringReferenceRuntime(input.runtime)),
    participants,
    enemy: input.enemy,
    selectedTargets: sortedRecord(input.selectedTargets),
    setConds: input.setConds ?? null,
    targetFeatureId: null,
    rotationMode: true,
  })
}

function profileFromSuggestion(options: {
  cacheKey: string
  charId: string
  equipped: Array<EchoInstance | null>
  suggestion: MainStatSugg
  context: MainStatPrep['context']
}): EchoMainStatScoreProfile | null {
  const { cacheKey, charId, equipped, suggestion, context } = options
  const bestEchoes = applyMainSta(suggestion.recipes, equipped)
  const weightsByCost: Record<number, Record<string, number>> = {}
  const bestByCost: Record<number, string[]> = {}
  const mainCountsByCost: Record<number, Record<string, number>> = {}

  for (const cost of [1, 3, 4]) {
    const slots = bestEchoes.flatMap((echo, index) => (
      echo && getEchoById(echo.id)?.cost === cost ? [index] : []
    ))
    const bestSet = new Set(slots.flatMap((index) => {
      const key = bestEchoes[index]?.mainStats.primary.key
      return key ? [key] : []
    }))
    weightsByCost[cost] = Object.fromEntries(
      Object.keys(ECHO_MAIN_STATS[cost] ?? {}).map((key) => [
        key,
        bestSet.has(key) ? 1 : getGeneratedMainStatWeight(charId, key, cost),
      ]),
    )
    bestByCost[cost] = [...bestSet].sort()
    mainCountsByCost[cost] = equipped.reduce<Record<string, number>>((counts, echo) => {
      if (echo && getEchoById(echo.id)?.cost === cost) {
        const key = echo.mainStats.primary.key
        counts[key] = (counts[key] ?? 0) + 1
      }
      return counts
    }, {})
  }

  const stats = bestEchoes.flatMap((echo) => {
    const cost = echo ? getEchoById(echo.id)?.cost : null
    return echo && cost
      ? [{ cost, key: echo.mainStats.primary.key }]
      : []
  })
  if (stats.length === 0) {
    return null
  }

  const referenceEchoes = equipped.map((echo) => echo ? {
    ...echo,
    mainStats: {
      primary: { ...echo.mainStats.primary },
      secondary: { ...echo.mainStats.secondary },
    },
    substats: {},
  } : null)
  const concreteReference = referenceEchoes.filter((echo): echo is EchoInstance => echo != null)
  const substatEvaluation = concreteReference.length === 5
    ? calcSubEvaluation(context, referenceEchoes, { measureUsefulTargets: true })
    : null
  const idealSubstatCounts = substatEvaluation
    ? Object.fromEntries(substatEvaluation.ideal.map(({ key, count }) => [key, count]))
    : undefined
  const idealSubstatValues = substatEvaluation
    ? Object.fromEntries(substatEvaluation.ideal.map(({ key, target }) => [key, target]))
    : undefined
  const rolledReferenceEchoes = substatEvaluation
    ? substatEvaluation.ideal
      .slice()
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
      .reduce((echoes, stat) => {
        const maxValue = SUBSTAT_RANGES[stat.key]?.max ?? 0
        if (maxValue <= 0) return echoes
        const targetSlots = echoes
          .map((echo, index) => ({ echo, index }))
          .sort((left, right) => (
            Object.keys(left.echo.substats).length - Object.keys(right.echo.substats).length
            || left.index - right.index
          ))
          .slice(0, stat.count)
        for (const { echo } of targetSlots) {
          echo.substats[stat.key] = maxValue
        }
        return echoes
      }, concreteReference)
    : concreteReference

  return {
    cacheKey,
    charId,
    weightsByCost,
    bestByCost,
    idealSubstatCounts,
    idealSubstatValues,
    mainCountsByCost,
    referenceEchoes: rolledReferenceEchoes,
  }
}

/**
 * Reuse Modulation's legal reference build for Echo scoring. This avoids
 * launching a second catalog-heavy Suggestions worker for the same resonator
 * immediately after the summary evaluation worker finishes.
 */
export function cacheEchoMainStatScoringFromEvaluation(
  input: EchoMainStatProfileInput,
  report: BuildEvaluationReport,
): string | null {
  const referenceBuild = report.evaluation.builds.referenceBuild
  const referenceSlots = referenceBuild.echoes
  if (referenceSlots.length !== 5) return null

  const cacheKey = makeEchoMainStatProfileKey(input)
  latestProfileKeyByChar.set(input.runtime.id, cacheKey)
  if (activateEchoMainStatScoreProfile(input.runtime.id, cacheKey)) {
    return cacheKey
  }

  const bestByCost: Record<number, string[]> = {}
  const weightsByCost: Record<number, Record<string, number>> = {}
  const mainCountsByCost: Record<number, Record<string, number>> = {}

  for (const cost of [1, 3, 4]) {
    const bestSet = new Set(referenceSlots
      .filter((slot) => slot.cost === cost)
      .map((slot) => slot.primary.key))
    bestByCost[cost] = [...bestSet].sort()
    weightsByCost[cost] = Object.fromEntries(
      Object.keys(ECHO_MAIN_STATS[cost] ?? {}).map((key) => [
        key,
        bestSet.has(key) ? 1 : getGeneratedMainStatWeight(input.runtime.id, key, cost),
      ]),
    )
    mainCountsByCost[cost] = input.runtime.build.echoes.reduce<Record<string, number>>((counts, echo) => {
      if (echo && getEchoById(echo.id)?.cost === cost) {
        counts[echo.mainStats.primary.key] = (counts[echo.mainStats.primary.key] ?? 0) + 1
      }
      return counts
    }, {})
  }

  const idealSubstatCounts: Record<string, number> = {}
  const idealSubstatValues: Record<string, number> = {}
  for (const row of referenceBuild.statRows) {
    const count = Math.round(row.substatCount)
    // A 25-slot benchmark can still contain minimum/tier-budget values. Only
    // an all-maximum reference can seed the independent Echo-quality ideal.
    if (Math.abs(count - row.substatCount) > 0.000001) return null
    if (count <= 0 || !Number.isFinite(row.substatTotal) || row.substatTotal <= 0) continue
    if (Math.abs(row.substatTotal - count * (SUBSTAT_RANGES[row.key]?.max ?? 0)) > 0.0001) return null
    idealSubstatCounts[row.key] = count
    idealSubstatValues[row.key] = row.substatTotal
  }

  if (Object.values(idealSubstatCounts).reduce((sum, count) => sum + count, 0) !== 25) {
    return null
  }

  const referenceEchoes = referenceSlots.map((slot, index): EchoInstance => ({
    uid: `echo-score-reference-${index}`,
    id: slot.echoId,
    set: slot.setId,
    mainEcho: slot.mainEcho,
    mainStats: {
      primary: { ...slot.primary },
      secondary: { ...slot.secondary },
    },
    substats: {},
  }))

  Object.entries(idealSubstatCounts)
    .sort(([leftKey, leftCount], [rightKey, rightCount]) => (
      rightCount - leftCount || leftKey.localeCompare(rightKey)
    ))
    .forEach(([key, count]) => {
      const maxValue = SUBSTAT_RANGES[key]?.max ?? 0
      if (maxValue <= 0) return
      const targetSlots = referenceEchoes
        .map((echo, index) => ({ echo, index }))
        .sort((left, right) => (
          Object.keys(left.echo.substats).length - Object.keys(right.echo.substats).length
          || left.index - right.index
        ))
        .slice(0, count)
      for (const { echo } of targetSlots) {
        echo.substats[key] = maxValue
      }
    })

  cacheEchoMainStatScoreProfile({
    cacheKey,
    charId: input.runtime.id,
    weightsByCost,
    bestByCost,
    idealSubstatCounts,
    idealSubstatValues,
    mainCountsByCost,
    referenceEchoes,
  })
  return cacheKey
}

// Called from the route shell so every scoring surface shares one reference
// for the equipped mains, independent of its current substat rolls.
export function prepareEchoMainStatScoring(
    input: EchoMainStatProfileInput,
    runner: MainStatRunner = runMainStatS,
): Promise<string | null> {
  const cacheKey = makeEchoMainStatProfileKey(input)
  latestProfileKeyByChar.set(input.runtime.id, cacheKey)
  if (activateEchoMainStatScoreProfile(input.runtime.id, cacheKey)) {
    return Promise.resolve(cacheKey)
  }

  if (!input.runtime.build.echoes.some((echo) => echo != null)) {
    deactivateEchoMainStatScoreProfile(input.runtime.id)
    return Promise.resolve(null)
  }

  const referenceRuntime = scoringReferenceRuntime(input.runtime)
  const referenceInput = {
    ...input,
    runtime: referenceRuntime,
    runtimesById: { ...input.runtimesById, [referenceRuntime.id]: referenceRuntime },
  }
  const prepared = mkPrepMainSt(suggestionInput(referenceInput), input.simulation)
  if (!prepared) {
    deactivateEchoMainStatScoreProfile(input.runtime.id)
    return Promise.resolve(null)
  }

  let bestRequest = inFlightBestByKey.get(cacheKey)
  if (!bestRequest) {
    bestRequest = runner({ ...prepared, topK: 1 })
      .then((results) => results[0] ?? null)
      .finally(() => {
        inFlightBestByKey.delete(cacheKey)
      })
    inFlightBestByKey.set(cacheKey, bestRequest)
  }

  return bestRequest.then((best) => {
    if (latestProfileKeyByChar.get(input.runtime.id) !== cacheKey) {
      return null
    }
    if (!best) {
      deactivateEchoMainStatScoreProfile(input.runtime.id)
      return null
    }

    const profile = profileFromSuggestion({
      cacheKey,
      charId: input.runtime.id,
      equipped: prepared.qppdChs,
      suggestion: best,
      context: prepared.context,
    })
    if (!profile) {
      deactivateEchoMainStatScoreProfile(input.runtime.id)
      return null
    }

    cacheEchoMainStatScoreProfile(profile)
    return cacheKey
  })
}
