/*
  Author: Runor Ewhro
  Description: Distributes target Energy Regen across generated echoes
               by finding a good ER split and injecting ER substats where
               they add the most value.
*/

import { getSubstatStepOptions } from '@/data/gameData/catalog/echoStats'
import type { OptimizerStatWeightMap } from '@/engine/optimizer/search/filtering.ts'
import type { RandGenEcho } from './echoSetBuilder'
import { getSubstatScore } from './substats'

// all legal ER roll values used when building an ER plan
const ER_OPTIONS = getSubstatStepOptions('energyRegen')

// find a low-overflow ER split across up to maxEchoes echoes
function findBestERSplit(target: number, maxEchoes: number, rollQuality: number): number[] {
  if (target <= 0 || ER_OPTIONS.length === 0) {
    return Array(maxEchoes).fill(0)
  }

  // center the search around the requested roll quality so we do not sample
  // the full ER range unnecessarily
  const targetIndex = Math.round(rollQuality * (ER_OPTIONS.length - 1))
  const narrowed = ER_OPTIONS.slice(
      Math.max(0, targetIndex - 1),
      Math.min(ER_OPTIONS.length, targetIndex + 2),
  )

  let bestSum = Infinity
  let bestCombo = Array(maxEchoes).fill(0) as number[]

  // highest ER value available in the narrowed set, used for pruning
  const maxValue = narrowed[narrowed.length - 1] ?? 0

  // iterative DFS stack: combo holds chosen ER rolls, sum is their total
  const stack: Array<{ combo: number[]; sum: number }> = [{ combo: [], sum: 0 }]

  while (stack.length) {
    const entry = stack.pop()!
    const { combo, sum } = entry

    // once the target is reached, keep the smallest total that satisfies it
    if (sum >= target) {
      if (sum < bestSum) {
        bestSum = sum
        bestCombo = [...combo, ...Array(maxEchoes - combo.length).fill(0)]
      }
      continue
    }

    // no more slots left to distribute ER into
    if (combo.length >= maxEchoes) {
      continue
    }

    const remainingSlots = maxEchoes - combo.length

    // prune branches that cannot possibly reach the target even with max rolls
    if (sum + remainingSlots * maxValue < target) {
      continue
    }

    for (const value of narrowed) {
      // prune branches already worse than the best satisfying sum found so far
      if (sum + value >= bestSum) {
        continue
      }

      stack.push({
        combo: [...combo, value],
        sum: sum + value,
      })
    }
  }

  return bestCombo
}

// inject one ER roll into an echo, either by replacing an existing ER roll,
// using an empty slot, or replacing the least valuable current substat
function injectErIntoEcho(
    echo: RandGenEcho,
    erValue: number,
    statWeight: OptimizerStatWeightMap,
): RandGenEcho {
  if (!erValue || erValue <= 0) {
    return echo
  }

  const substats = { ...echo.substats }

  // if ER already exists, overwrite it with the planned value
  if (Object.prototype.hasOwnProperty.call(substats, 'energyRegen')) {
    substats.energyRegen = erValue
    return { ...echo, substats }
  }

  // if the echo still has room, just add ER directly
  if (Object.keys(substats).length < 5) {
    substats.energyRegen = erValue
    return { ...echo, substats }
  }

  // otherwise replace the weakest existing substat according to score value
  let worstKey: string | null = null
  let worstScore = Infinity

  for (const [key, value] of Object.entries(substats)) {
    if (key === 'energyRegen') {
      continue
    }

    const score = getSubstatScore(key, value, statWeight)
    if (score < worstScore) {
      worstScore = score
      worstKey = key
    }
  }

  if (worstKey != null) {
    delete substats[worstKey]
  }

  substats.energyRegen = erValue

  return { ...echo, substats }
}

// apply an ER plan across a generated echo set until the target ER is met
export function applyErPlanToEchoes(params: {
  echoes: RandGenEcho[]
  targetEnergyRegen: number
  rollQuality: number
  statWeight: OptimizerStatWeightMap
}): RandGenEcho[] {
  const { echoes, targetEnergyRegen, rollQuality, statWeight } = params

  // no ER goal means no changes
  if (!targetEnergyRegen || targetEnergyRegen <= 0) {
    return echoes
  }

  // first measure how much ER the current generated build already has
  const existingER = echoes.reduce((sum, echo) => {
    return sum
        + (echo.primaryKey === 'energyRegen' ? echo.primaryValue : 0)
        + (echo.substats.energyRegen ?? 0)
  }, 0)

  // only plan for the missing portion
  const remainingTarget = Math.max(0, targetEnergyRegen - existingER)
  if (remainingTarget <= 0) {
    return echoes
  }

  // compute a per-echo ER allocation
  const erCombo = findBestERSplit(remainingTarget, echoes.length, rollQuality)

  // inject each allocated ER value into its corresponding echo
  return echoes.map((echo, index) => {
    const erVal = erCombo[index] ?? 0
    if (!erVal) {
      return echo
    }

    return injectErIntoEcho(echo, erVal, statWeight)
  })
}
