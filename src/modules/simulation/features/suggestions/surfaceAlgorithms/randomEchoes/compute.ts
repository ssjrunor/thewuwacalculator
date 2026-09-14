/*
  Author: Runor Ewhro
  Description: Samples random Echo loadouts, evaluates their objective damage,
               and retains the strongest unique results.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { makeEchoUid } from '@/domain/entities/runtime'
import type { RandGnrtSetP } from '@/domain/entities/suggestions'
import type { EchoDef } from '@/domain/entities/catalog'
import { getEchoById, listChsByCos } from '@/domain/services/echoCatalogService'
import { evalSuggChs } from '@/engine/suggestions/shared'
import type { RandomEchoEntry, RandomEchoPrep } from './types'
import { getDefMainSt } from '@/engine/suggestions/mainStat-suggestion/ctx-builder'
import type { OptStatWeight } from '@/engine/optimizer/search/filtering.ts'
import {
  makeRandomEchoCostPlans,
  mkMainStatCo,
  DEFAULT_RESULTS,
  TRIES_PER_COMBO,
} from './combinations'
import { mkEchoSetFor, type RandGenEcho } from './echoSetBuilder'
import { applyErPlanT } from './energyRegen'
import { pickNqLdtRsl } from './signatures'

type ScoredRandEchoes = {
  value: number
  echoes: RandGenEcho[]
  instances: Array<EchoInstance | null>
}

function mkSprsWghtMa(weights: OptStatWeight): OptStatWeight {
  const result: OptStatWeight = {}

  for (const [key, value] of Object.entries(weights)) {
    if ((value ?? 0) > 0) {
      result[key] = value
    }
  }

  return result
}

function randGenEchoT(
    echo: RandGenEcho,
    slotIndex: number,
    targetSetId: number | null,
    forcedEcho?: EchoDef | null,
): EchoInstance {
  const definitions = listChsByCos(echo.cost)

  const bySet = targetSetId != null
      ? definitions.filter((def) => def.sets.includes(targetSetId))
      : definitions

  const definition = forcedEcho ?? (bySet.length > 0 ? bySet : definitions)[0]

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

function randSetPieces(setPrefs: RandGnrtSetP[]): number[] {
  return setPrefs
      .filter((preference) => preference.count > 0)
      .flatMap((preference) => Array.from({ length: preference.count }, () => preference.setId))
}

function randSetFitsSlot(
    costs: readonly number[],
    slotIndex: number,
    setId: number,
    mainEcho: EchoDef | null,
): boolean {
  const cost = costs[slotIndex]
  if (slotIndex === 0 && mainEcho) {
    return mainEcho.cost === cost && mainEcho.sets.includes(setId)
  }

  return listChsByCos(cost).some((echo) => echo.sets.includes(setId))
}

function resolveRandMainEcho(
    mainEchoId: string | null,
    setPrefs: RandGnrtSetP[],
    costs: readonly number[],
): EchoDef | null {
  const selected = mainEchoId ? getEchoById(mainEchoId) : null
  if (!selected) {
    return null
  }

  if (assignRandSetTargets(costs, selected, setPrefs)) {
    return selected
  }

  const candidates = listChsByCos(costs[0] ?? 0)
      .filter((echo) => assignRandSetTargets(costs, echo, setPrefs))
  return candidates.length > 0
      ? candidates[Math.floor(Math.random() * candidates.length)]
      : null
}

function assignRandSetTargets(
    costs: readonly number[],
    mainEcho: EchoDef | null,
    setPrefs: RandGnrtSetP[],
): Array<number | null> | null {
  if (mainEcho && (costs.length === 0 || mainEcho.cost !== costs[0])) {
    return null
  }

  const targets = new Array<number | null>(costs.length).fill(null)
  const pieces = randSetPieces(setPrefs)
  if (pieces.length === 0) {
    return targets
  }

  const orderedPieces = [...pieces].sort((left, right) => {
    const leftSlots = costs.filter((_, index) => randSetFitsSlot(costs, index, left, mainEcho)).length
    const rightSlots = costs.filter((_, index) => randSetFitsSlot(costs, index, right, mainEcho)).length
    return leftSlots - rightSlots
  })
  const used = new Set<number>()

  function assign(pieceIndex: number): boolean {
    if (pieceIndex >= orderedPieces.length) {
      return true
    }

    const setId = orderedPieces[pieceIndex]
    for (let slotIndex = 0; slotIndex < costs.length; slotIndex += 1) {
      if (used.has(slotIndex) || !randSetFitsSlot(costs, slotIndex, setId, mainEcho)) {
        continue
      }

      used.add(slotIndex)
      targets[slotIndex] = setId
      if (assign(pieceIndex + 1)) {
        return true
      }
      targets[slotIndex] = null
      used.delete(slotIndex)
    }

    return false
  }

  return assign(0) ? targets : null
}

function fallbackSetTgts(
    setPrefs: RandGnrtSetP[],
    slotCount: number,
): Array<number | null> {
  const pieces = randSetPieces(setPrefs)
  const fallback: Array<number | null> = pieces.map((setId) => setId)
  while (fallback.length < slotCount) {
    fallback.push(null)
  }
  return fallback.slice(0, slotCount)
}

function cnvrToNstn(
    echoes: RandGenEcho[],
    setPrefs: RandGnrtSetP[],
    mainEchoId: string | null,
): Array<EchoInstance | null> {
  const costs = echoes.map((echo) => echo.cost)
  const mainEcho = resolveRandMainEcho(mainEchoId, setPrefs, costs)
  const targets = assignRandSetTargets(costs, mainEcho, setPrefs)
      ?? fallbackSetTgts(setPrefs, costs.length)

  return echoes.map((echo, index) =>
      echo ? randGenEchoT(echo, index, targets[index] ?? null, index === 0 ? mainEcho : null) : null,
  )
}

export async function runRandomEchoGeneration(
    input: RandomEchoPrep,
): Promise<RandomEchoEntry[]> {
  const { settings, resultsLimit = DEFAULT_RESULTS } = input
  const { rollQuality, targetEnergyRegen: trgtNrgyRgn, setPreferences: setPrefsList, mainEchoId, bias } = settings
  const sprsRawWghtM = mkSprsWghtMa(input.rawWeightMap)
  const mainStatFilter = getDefMainSt(sprsRawWghtM, input.runtimeId)

  const mainEchoDef = mainEchoId ? getEchoById(mainEchoId) : null
  const requiredCost = mainEchoDef?.cost ?? null
  const costPlans = makeRandomEchoCostPlans(requiredCost)

  const results: ScoredRandEchoes[] = []

  for (const costPlan of costPlans) {
    const combinations = mkMainStatCo(costPlan, mainStatFilter)

    for (const combination of combinations) {
      let bestValue = 0
      let bestEchoes: RandGenEcho[] | null = null
      let bestInstances: Array<EchoInstance | null> | null = null

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

        const instances = cnvrToNstn(echoesWithEr, setPrefsList, mainEchoId)
        const damage = evalSuggChs(input.context, instances)

        if (damage > bestValue) {
          bestValue = damage
          bestEchoes = echoesWithEr
          bestInstances = instances
        }
      }

      if (bestEchoes && bestInstances) {
        results.push({ value: bestValue, echoes: bestEchoes, instances: bestInstances })
      }
    }
  }

  const targetCount = Math.max(5, resultsLimit)
  const sorted = results.sort((a, b) => b.value - a.value)
  const unique = pickNqLdtRsl(sorted, targetCount)

  return unique.slice(0, targetCount).map((result) => ({
    damage: result.value,
    echoes: result.instances,
  }))
}
