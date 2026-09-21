/*
  Author: Runor Ewhro
  Description: Samples legal substats and roll values using objective weights,
               configurable bias, and optional Energy Regen inclusion.
*/

import { SUBSTAT_KEYS, getSbstStepP } from '@/data/gameData/catalog/echoStats'
import type { OptStatWeight } from '@/engine/optimizer/search/filtering.ts'

export function randSubVl(statKey: string, rollQuality = 0): number {
  const options = getSbstStepP(statKey)
  if (!options.length) {
    return 0
  }

  const targetIndex = Math.round(rollQuality * (options.length - 1))

  // Keep variance local to the requested quality while retaining legal roll values.
  const windowStart = Math.max(0, targetIndex - 1)
  const windowEnd = Math.min(options.length - 1, targetIndex + 1)

  const randomIndex =
      Math.floor(Math.random() * (windowEnd - windowStart + 1)) + windowStart

  return options[randomIndex]
}

export function getRandSbst(
    bias = 0.5,
    ncldNrgyRgn = false,
    statWeight?: OptStatWeight,
): string {
  const weights = statWeight ?? {}
  const allKeys = [...SUBSTAT_KEYS] as string[]

  const filteredKeys = allKeys.filter(
      (key) => ncldNrgyRgn || key !== 'energyRegen',
  )

  const nonZeroKeys = filteredKeys.filter((key) => (weights[key] ?? 0) > 0)
  const zeroKeys = filteredKeys.filter((key) => (weights[key] ?? 0) <= 0)

  // Explicit ER inclusion keeps it eligible even when the objective gives it no weight.
  if (
      ncldNrgyRgn &&
      !nonZeroKeys.includes('energyRegen') &&
      filteredKeys.includes('energyRegen')
  ) {
    nonZeroKeys.push('energyRegen')

    const idx = zeroKeys.indexOf('energyRegen')
    if (idx !== -1) {
      zeroKeys.splice(idx, 1)
    }
  }

  const baseChance = 0.6
  const scaledChance = baseChance * 1.3 * bias
  const pickNonZero = Math.random() < scaledChance

  let chosenPool: string[]
  if (pickNonZero && nonZeroKeys.length) {
    chosenPool = nonZeroKeys
  } else {
    chosenPool = filteredKeys
  }

  let total = 0
  let count = 0
  for (const key of chosenPool) {
    total += weights[key] ?? 0
    count++
  }

  const avg = total / (count || 1)

  // Blend toward the mean and retain a floor so every eligible stat remains possible.
  const adjusted: Array<[string, number]> = new Array(chosenPool.length)
  let totalWeight = 0

  for (let i = 0; i < chosenPool.length; i++) {
    const key = chosenPool[i]
    const base = weights[key] ?? 0
    const weight = avg + (base - avg) * bias + 0.05

    adjusted[i] = [key, Math.max(weight, 0.05)]
    totalWeight += adjusted[i][1]
  }

  let roll = Math.random() * totalWeight
  for (let i = 0; i < adjusted.length; i++) {
    roll -= adjusted[i][1]
    if (roll <= 0) {
      return adjusted[i][0]
    }
  }

  // Floating-point residue can survive the final subtraction.
  return adjusted[adjusted.length - 1][0]
}

export function getSbstScr(
    key: string,
    value: number,
    statWeight?: OptStatWeight,
): number {
  return Number(statWeight?.[key] ?? 0) * value
}
