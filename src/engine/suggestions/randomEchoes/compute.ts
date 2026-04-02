/*
  Author: Runor Ewhro
  Description: Generates random echo loadouts by sampling valid
               combinations, evaluating them against the current
               suggestion context, and returning the strongest unique sets.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { createEchoUid } from '@/domain/entities/runtime'
import type { RandomGeneratorSetPreference } from '@/domain/entities/suggestions'
import { getEchoById, listEchoesByCost } from '@/domain/services/echoCatalogService'
import { OPTIMIZER_ECHOS_PER_COMBO } from '@/engine/optimizer/config/constants'
import {
  buildPreparedRandomSuggestionsInput,
  runSuggestionSimulation,
} from '@/engine/suggestions/shared'
import type {
  PreparedRandomSuggestionsInput,
  RandomSuggestionEntry,
  RandomSuggestionsInput,
} from '@/engine/suggestions/types'
import { getDefaultMainStatFilter } from '@/engine/suggestions/mainStat-suggestion/ctx-builder'
import type { OptimizerStatWeightMap } from '@/engine/optimizer/search/filtering.ts'
import {
  buildCostPlans,
  buildMainStatCombinations,
  DEFAULT_RESULTS_LIMIT,
  TRIES_PER_COMBO,
} from './lib/combinations'
import { buildEchoSetForCombination, type RandGenEcho } from './lib/echoSetBuilder'
import { applyErPlanToEchoes } from './lib/energyRegen'
import { buildZeroMainEchoBuffs, evaluateRandGenEchoSet } from './lib/evaluation'
import { pickUniqueLoadoutResults } from './lib/signatures'

// drop zero or negative weights so only meaningful stats remain
function buildSparseWeightMap(weights: OptimizerStatWeightMap): OptimizerStatWeightMap {
  const result: OptimizerStatWeightMap = {}

  for (const [key, value] of Object.entries(weights)) {
    if ((value ?? 0) > 0) {
      result[key] = value
    }
  }

  return result
}

// convert one generated echo shape into a concrete runtime echo instance
function randGenEchoToInstance(
    echo: RandGenEcho,
    slotIndex: number,
    targetSetId: number | null,
): EchoInstance {
  const definitions = listEchoesByCost(echo.cost)

  // prefer echoes that match the requested set for this slot
  const bySet = targetSetId != null
      ? definitions.filter((def) => def.sets.includes(targetSetId))
      : definitions

  const definition = (bySet.length > 0 ? bySet : definitions)[0]

  const setId = targetSetId != null && definition?.sets.includes(targetSetId)
      ? targetSetId
      : definition?.sets[0] ?? 0

  return {
    uid: createEchoUid(),
    id: definition?.id ?? '',
    set: setId,
    mainEcho: slotIndex === 0,
    mainStats: {
      primary: { key: echo.primaryKey, value: echo.primaryValue },
      secondary: { key: echo.secondaryKey, value: echo.secondaryValue },
    },
    substats: { ...echo.substats },
  }
}

// map a generated echo array into runtime instances using set preferences as slot targets
function convertToInstances(
    echoes: RandGenEcho[],
    setPreferences: RandomGeneratorSetPreference[],
): Array<EchoInstance | null> {
  // expand set preferences into a per-slot set id list
  const pieces = setPreferences
      .filter((preference) => preference.count > 0)
      .flatMap((preference) => Array.from({ length: preference.count }, () => preference.setId))

  return echoes.map((echo, index) =>
      echo ? randGenEchoToInstance(echo, index, pieces[index] ?? null) : null,
  )
}

// run the random echo generator end to end and return the best unique results
export async function runEchoGenerator(
    input: RandomSuggestionsInput,
): Promise<RandomSuggestionEntry[]> {
  const { settings, resultsLimit = DEFAULT_RESULTS_LIMIT } = input
  const { bias, rollQuality, targetEnergyRegen, setPreferences, mainEchoId } = settings

  // build the baseline simulation and fast evaluation context
  const simulation = runSuggestionSimulation(input)
  const prepared = buildPreparedRandomSuggestionsInput(input, simulation)
  if (!prepared) {
    return []
  }

  const sparseRawWeightMap = buildSparseWeightMap(prepared.rawWeightMap)
  const mainStatFilter = getDefaultMainStatFilter(sparseRawWeightMap, prepared.runtimeId)

  // if a main echo is forced, its cost constrains valid cost plans
  const mainEchoDefinition = mainEchoId ? getEchoById(mainEchoId) : null
  const requiredCost = mainEchoDefinition?.cost ?? null
  const costPlans = buildCostPlans(requiredCost)

  // allocate reusable evaluation buffers once
  const comboIds = new Int32Array(OPTIMIZER_ECHOS_PER_COMBO)
  for (let index = 0; index < OPTIMIZER_ECHOS_PER_COMBO; index += 1) {
    comboIds[index] = index
  }

  const mainEchoBuffs = buildZeroMainEchoBuffs(OPTIMIZER_ECHOS_PER_COMBO)
  const results: Array<{ value: number; echoes: RandGenEcho[] }> = []

  // try every valid cost plan
  for (const costPlan of costPlans) {
    // for that cost plan, enumerate allowed main-stat layouts
    const combinations = buildMainStatCombinations(costPlan, mainStatFilter)

    for (const combination of combinations) {
      let bestValue = 0
      let bestEchoes: RandGenEcho[] | null = null

      // sample several random realizations for this combination and keep the best one
      for (let attempt = 0; attempt < TRIES_PER_COMBO; attempt += 1) {
        const echoes = buildEchoSetForCombination({
          combination,
          costPlan,
          bias,
          rollQuality,
          statWeight: prepared.statWeight,
        })

        // patch in energy regen planning after the base randomized build is formed
        const echoesWithEr = applyErPlanToEchoes({
          echoes,
          targetEnergyRegen,
          rollQuality,
          statWeight: prepared.statWeight,
        })

        const damage = evaluateRandGenEchoSet(echoesWithEr, prepared.context, comboIds, mainEchoBuffs)

        if (damage > bestValue) {
          bestValue = damage
          bestEchoes = echoesWithEr
        }
      }

      if (bestEchoes) {
        results.push({ value: bestValue, echoes: bestEchoes })
      }
    }
  }

  // keep enough results so uniqueness filtering still leaves a healthy final set
  const targetCount = Math.max(5, resultsLimit)
  const sorted = results.sort((a, b) => b.value - a.value)
  const unique = pickUniqueLoadoutResults(sorted, targetCount)

  return unique.slice(0, targetCount).map((result) => ({
    damage: result.value,
    echoes: convertToInstances(result.echoes, setPreferences),
  }))
}

export async function runPreparedEchoGenerator(
    input: PreparedRandomSuggestionsInput,
): Promise<RandomSuggestionEntry[]> {
  const { settings, resultsLimit = DEFAULT_RESULTS_LIMIT } = input
  const { rollQuality, targetEnergyRegen, setPreferences, mainEchoId, bias } = settings
  const sparseRawWeightMap = buildSparseWeightMap(input.rawWeightMap)
  const mainStatFilter = getDefaultMainStatFilter(sparseRawWeightMap, input.runtimeId)

  const mainEchoDefinition = mainEchoId ? getEchoById(mainEchoId) : null
  const requiredCost = mainEchoDefinition?.cost ?? null
  const costPlans = buildCostPlans(requiredCost)

  const comboIds = new Int32Array(OPTIMIZER_ECHOS_PER_COMBO)
  for (let index = 0; index < OPTIMIZER_ECHOS_PER_COMBO; index += 1) {
    comboIds[index] = index
  }

  const mainEchoBuffs = buildZeroMainEchoBuffs(OPTIMIZER_ECHOS_PER_COMBO)
  const results: Array<{ value: number; echoes: RandGenEcho[] }> = []

  for (const costPlan of costPlans) {
    const combinations = buildMainStatCombinations(costPlan, mainStatFilter)

    for (const combination of combinations) {
      let bestValue = 0
      let bestEchoes: RandGenEcho[] | null = null

      for (let attempt = 0; attempt < TRIES_PER_COMBO; attempt += 1) {
        const echoes = buildEchoSetForCombination({
          combination,
          costPlan,
          bias,
          rollQuality,
          statWeight: input.statWeight,
        })

        const echoesWithEr = applyErPlanToEchoes({
          echoes,
          targetEnergyRegen,
          rollQuality,
          statWeight: input.statWeight,
        })

        const damage = evaluateRandGenEchoSet(echoesWithEr, input.context, comboIds, mainEchoBuffs)

        if (damage > bestValue) {
          bestValue = damage
          bestEchoes = echoesWithEr
        }
      }

      if (bestEchoes) {
        results.push({ value: bestValue, echoes: bestEchoes })
      }
    }
  }

  const targetCount = Math.max(5, resultsLimit)
  const sorted = results.sort((a, b) => b.value - a.value)
  const unique = pickUniqueLoadoutResults(sorted, targetCount)

  return unique.slice(0, targetCount).map((result) => ({
    damage: result.value,
    echoes: convertToInstances(result.echoes, setPreferences),
  }))
}
