/*
  Author: Runor Ewhro
  Description: Reuses the Main Stat Suggestions search to cache its top layout
               and cost-relative weights for synchronous Echo scoring.
*/

import { getGameDataMode } from '@/data/gameData'
import { ECHO_MAIN_STATS } from '@/data/gameData/catalog/echoStats'
import {
  activateEchoMainStatScoreProfile,
  cacheEchoMainStatScoreProfile,
  deactivateEchoMainStatScoreProfile,
  getGeneratedMainStatWeight,
  type EchoMainStatScoreProfile,
} from '@/data/scoring/echoScoring'
import { getWeightSetKey } from '@/data/scoring/charStatWeights'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatScenarioId, TeamMemberId } from '@/domain/entities/combatScenario'
import type { EchoInstance, ResRuntime, ResSeed } from '@/domain/entities/runtime'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { runtimeSig } from '@/domain/state/runtimeSignature'
import type { SimResult } from '@/engine/pipeline/types'
import { runMainStatS } from '@/engine/suggestions/client'
import { applyMainSta } from '@/engine/suggestions/mainStat-suggestion/utils'
import { mkPrepMainSt } from '@/engine/suggestions/shared'
import type {
  MainStatPrep,
  MainStatSugg,
  MainStatSuwo,
} from '@/engine/suggestions/types'

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
      .map(([resonatorId, runtime]) => [resonatorId, runtimeSig(runtime)])

  // This mirrors the inputs that can affect Main Stat Suggestions. Equipped
  // Echo details must remain in the key because their sets and substats change
  // both the winning layout and its displayed damage.
  return JSON.stringify({
    version: 3,
    mode: getGameDataMode(),
    weights: getWeightSetKey(),
    scenarioId: input.scenarioId,
    memberId: input.memberId,
    runtime: runtimeSig(input.runtime),
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
}): EchoMainStatScoreProfile | null {
  const { cacheKey, charId, equipped, suggestion } = options
  const bestEchoes = applyMainSta(suggestion.recipes, equipped)
  const weightsByCost: Record<number, Record<string, number>> = {}
  const bestByCost: Record<number, string[]> = {}

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

  console.info('[echo-score:max-main-stats]', {
    charId,
    stats,
    damage: suggestion.damage,
  })

  return { cacheKey, charId, weightsByCost, bestByCost }
}

// Called from the route shell so every Echo-scoring surface receives the same
// top layout and damage as Main Stat Suggestions without requiring that pane
// to have mounted first.
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

  const prepared = mkPrepMainSt(suggestionInput(input), input.simulation)
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
    })
    if (!profile) {
      deactivateEchoMainStatScoreProfile(input.runtime.id)
      return null
    }

    cacheEchoMainStatScoreProfile(profile)
    return cacheKey
  })
}
