/*
  Author: Runor Ewhro
  Description: Samples random substats and substat roll values using
               weighted biasing, optional Energy Regen inclusion, and
               simple score helpers for replacement decisions.
*/

import { ECHO_SUBSTAT_KEYS, getSubstatStepOptions } from '@/data/gameData/catalog/echoStats'
import type { OptimizerStatWeightMap } from '@/engine/optimizer/rebuild/filter'

// roll one random legal value for a substat, biased by rollQuality toward a local window
export function randomSubValue(statKey: string, rollQuality = 0): number {
  const options = getSubstatStepOptions(statKey)
  if (!options.length) {
    return 0
  }

  // pick a target position inside the stat's legal step list
  const targetIndex = Math.round(rollQuality * (options.length - 1))

  // restrict randomness to a small neighborhood around the target quality
  const windowStart = Math.max(0, targetIndex - 1)
  const windowEnd = Math.min(options.length - 1, targetIndex + 1)

  const randomIndex =
      Math.floor(Math.random() * (windowEnd - windowStart + 1)) + windowStart

  return options[randomIndex]
}

// pick one random substat key, preferring weighted stats depending on bias
export function getRandomSubstat(
    bias = 0.5,
    includeEnergyRegen = false,
    statWeight?: OptimizerStatWeightMap,
): string {
  const weights = statWeight ?? {}
  const allKeys = [...ECHO_SUBSTAT_KEYS] as string[]

  // optionally remove Energy Regen from the candidate pool
  const filteredKeys = allKeys.filter(
      (key) => includeEnergyRegen || key !== 'energyRegen',
  )

  // separate meaningful weighted stats from unweighted ones
  const nonZeroKeys = filteredKeys.filter((key) => (weights[key] ?? 0) > 0)
  const zeroKeys = filteredKeys.filter((key) => (weights[key] ?? 0) <= 0)

  // force Energy Regen into the preferred pool when it is explicitly allowed
  if (
      includeEnergyRegen &&
      !nonZeroKeys.includes('energyRegen') &&
      filteredKeys.includes('energyRegen')
  ) {
    nonZeroKeys.push('energyRegen')

    const idx = zeroKeys.indexOf('energyRegen')
    if (idx !== -1) {
      zeroKeys.splice(idx, 1)
    }
  }

  // bias controls how often we try to draw from the weighted pool first
  const baseChance = 0.6
  const scaledChance = baseChance * 1.3 * bias
  const pickNonZero = Math.random() < scaledChance

  let chosenPool: string[]
  if (pickNonZero && nonZeroKeys.length) {
    chosenPool = nonZeroKeys
  } else {
    chosenPool = filteredKeys
  }

  // compute average weight in the chosen pool so we can blend values toward it
  let total = 0
  let count = 0
  for (const key of chosenPool) {
    total += weights[key] ?? 0
    count++
  }

  const avg = total / (count || 1)

  // blend each stat toward the average depending on bias,
  // with a small floor so nothing becomes impossible to roll
  const adjusted: Array<[string, number]> = new Array(chosenPool.length)
  let totalWeight = 0

  for (let i = 0; i < chosenPool.length; i++) {
    const key = chosenPool[i]
    const base = weights[key] ?? 0
    const weight = avg + (base - avg) * bias + 0.05

    adjusted[i] = [key, Math.max(weight, 0.05)]
    totalWeight += adjusted[i][1]
  }

  // weighted random draw across the adjusted pool
  let roll = Math.random() * totalWeight
  for (let i = 0; i < adjusted.length; i++) {
    roll -= adjusted[i][1]
    if (roll <= 0) {
      return adjusted[i][0]
    }
  }

  // fallback in case floating-point drift leaves roll slightly above zero
  return adjusted[adjusted.length - 1][0]
}

// simple weighted score used when comparing substats for replacement logic
export function getSubstatScore(
    key: string,
    value: number,
    statWeight?: OptimizerStatWeightMap,
): number {
  return Number(statWeight?.[key] ?? 0) * value
}