/*
  Author: Runor Ewhro
  Description: Generates random echo loadouts by sampling valid
               combinations, evaluating them against the current
               suggestion context, and returning the strongest unique sets.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { makeEchoUid } from '@/domain/entities/runtime'
import type { RandGnrtSetP } from '@/domain/entities/suggestions'
import { getEchoById, listChsByCos } from '@/domain/services/echoCatalogService'
import { ECHOES_PER_SET } from '@/engine/optimizer/config/constants'
import {
  mkPrepRandSu,
  runSuggSmlt,
} from '@/engine/suggestions/shared'
import type {
  RandomPrep,
  RandomEntry,
  RandSuggsNpt,
} from '@/engine/suggestions/types'
import { getDefMainSt } from '@/engine/suggestions/mainStat-suggestion/ctx-builder'
import type { OptStatWeight } from '@/engine/optimizer/search/filtering.ts'
import {
  mkCostPlns,
  mkMainStatCo,
  DEFAULT_RESULTS,
  TRIES_PER_COMBO,
} from './lib/combinations'
import { mkEchoSetFor, type RandGenEcho } from './lib/echoSetBuilder'
import { applyErPlanT } from './lib/energyRegen'
import { mkZeroMainEc, evalRandGenE } from './lib/evaluation'
import { pickNqLdtRsl } from './lib/signatures'

// drop zero or negative weights so only meaningful stats remain
function mkSprsWghtMa(weights: OptStatWeight): OptStatWeight {
  const result: OptStatWeight = {}

  for (const [key, value] of Object.entries(weights)) {
    if ((value ?? 0) > 0) {
      result[key] = value
    }
  }

  return result
}

// convert one generated echo shape into a concrete runtime echo instance
function randGenEchoT(
    echo: RandGenEcho,
    slotIndex: number,
    targetSetId: number | null,
): EchoInstance {
  const definitions = listChsByCos(echo.cost)

  // prefer echoes that match the requested set for this slot
  const bySet = targetSetId != null
      ? definitions.filter((def) => def.sets.includes(targetSetId))
      : definitions

  const definition = (bySet.length > 0 ? bySet : definitions)[0]

  const setId = targetSetId != null && definition?.sets.includes(targetSetId)
      ? targetSetId
      : definition?.sets[0] ?? 0

  return {
    uid: makeEchoUid(),
    id: definition?.id ?? '',
    set: setId,
    mainEcho: slotIndex === 0,
    mainStats: {
      primary: { key: echo.primaryKey, value: echo.primaryValue },
      secondary: { key: echo.secondaryKey, value: echo.scndVl },
    },
    substats: { ...echo.substats },
  }
}

// map a generated echo array into runtime instances using set preferences as slot targets
function cnvrToNstn(
    echoes: RandGenEcho[],
    setPrefs: RandGnrtSetP[],
): Array<EchoInstance | null> {
  // expand set preferences into a per-slot set id list
  const pieces = setPrefs
      .filter((preference) => preference.count > 0)
      .flatMap((preference) => Array.from({ length: preference.count }, () => preference.setId))

  return echoes.map((echo, index) =>
      echo ? randGenEchoT(echo, index, pieces[index] ?? null) : null,
  )
}

// run the random echo generator end to end and return the best unique results
export async function runEchoGnrt(
    input: RandSuggsNpt,
): Promise<RandomEntry[]> {
  const { settings, resultsLimit = DEFAULT_RESULTS } = input
  const { bias, rollQuality, targetEnergyRegen: trgtNrgyRgn, setPreferences: setPrefsList, mainEchoId } = settings

  // build the baseline simulation and fast evaluation context
  const simulation = runSuggSmlt(input)
  const prepared = mkPrepRandSu(input, simulation)
  if (!prepared) {
    return []
  }

  const sprsRawWghtM = mkSprsWghtMa(prepared.rawWeightMap)
  const mainStatFilter = getDefMainSt(sprsRawWghtM, prepared.runtimeId)

  // if a main echo is forced, its cost constrains valid cost plans
  const mainEchoDef = mainEchoId ? getEchoById(mainEchoId) : null
  const requiredCost = mainEchoDef?.cost ?? null
  const costPlans = mkCostPlns(requiredCost)

  // allocate reusable evaluation buffers once
  const comboIds = new Int32Array(ECHOES_PER_SET)
  for (let index = 0; index < ECHOES_PER_SET; index += 1) {
    comboIds[index] = index
  }

  const mainEchoBuffs = mkZeroMainEc(ECHOES_PER_SET)
  const results: Array<{ value: number; echoes: RandGenEcho[] }> = []

  // try every valid cost plan
  for (const costPlan of costPlans) {
    // for that cost plan, enumerate allowed main-stat layouts
    const combinations = mkMainStatCo(costPlan, mainStatFilter)

    for (const combination of combinations) {
      let bestValue = 0
      let bestEchoes: RandGenEcho[] | null = null

      // sample several random realizations for this combination and keep the best one
      for (let attempt = 0; attempt < TRIES_PER_COMBO; attempt += 1) {
        const echoes = mkEchoSetFor({
          combination,
          costPlan,
          bias,
          rollQuality,
          statWeight: prepared.statWeight,
        })

        // patch in energy regen planning after the base randomized build is formed
        const echoesWithEr = applyErPlanT({
          echoes,
          tgtNrgyRgn: trgtNrgyRgn,
          rollQuality,
          statWeight: prepared.statWeight,
        })

        const damage = evalRandGenE(echoesWithEr, prepared.context, comboIds, mainEchoBuffs)

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
  const unique = pickNqLdtRsl(sorted, targetCount)

  return unique.slice(0, targetCount).map((result) => ({
    damage: result.value,
    echoes: cnvrToNstn(result.echoes, setPrefsList),
  }))
}

export async function runPrepEchoG(
    input: RandomPrep,
): Promise<RandomEntry[]> {
  const { settings, resultsLimit = DEFAULT_RESULTS } = input
  const { rollQuality, targetEnergyRegen: trgtNrgyRgn, setPreferences: setPrefsList, mainEchoId, bias } = settings
  const sprsRawWghtM = mkSprsWghtMa(input.rawWeightMap)
  const mainStatFilter = getDefMainSt(sprsRawWghtM, input.runtimeId)

  const mainEchoDef = mainEchoId ? getEchoById(mainEchoId) : null
  const requiredCost = mainEchoDef?.cost ?? null
  const costPlans = mkCostPlns(requiredCost)

  const comboIds = new Int32Array(ECHOES_PER_SET)
  for (let index = 0; index < ECHOES_PER_SET; index += 1) {
    comboIds[index] = index
  }

  const mainEchoBuffs = mkZeroMainEc(ECHOES_PER_SET)
  const results: Array<{ value: number; echoes: RandGenEcho[] }> = []

  for (const costPlan of costPlans) {
    const combinations = mkMainStatCo(costPlan, mainStatFilter)

    for (const combination of combinations) {
      let bestValue = 0
      let bestEchoes: RandGenEcho[] | null = null

      for (let attempt = 0; attempt < TRIES_PER_COMBO; attempt += 1) {
        const echoes = mkEchoSetFor({
          combination,
          costPlan,
          bias,
          rollQuality,
          statWeight: input.statWeight,
        })

        const echoesWithEr = applyErPlanT({
          echoes,
          tgtNrgyRgn: trgtNrgyRgn,
          rollQuality,
          statWeight: input.statWeight,
        })

        const damage = evalRandGenE(echoesWithEr, input.context, comboIds, mainEchoBuffs)

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
  const unique = pickNqLdtRsl(sorted, targetCount)

  return unique.slice(0, targetCount).map((result) => ({
    damage: result.value,
    echoes: cnvrToNstn(result.echoes, setPrefsList),
  }))
}
