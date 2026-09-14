/*
  Author: Runor Ewhro
  Description: Finds a low-overflow Energy Regen allocation across generated
               Echoes and replaces the least valuable substats when necessary.
*/

import { getSbstStepP } from '@/data/gameData/catalog/echoStats'
import type { OptStatWeight } from '@/engine/optimizer/search/filtering.ts'
import type { RandGenEcho } from './echoSetBuilder'
import { getSbstScr } from './substats'

const ER_OPTIONS = getSbstStepP('energyRegen')

function findBestErSp(target: number, maxEchoes: number, rollQuality: number): number[] {
  if (target <= 0 || ER_OPTIONS.length === 0) {
    return Array(maxEchoes).fill(0)
  }

  // Search only the legal rolls surrounding the requested quality.
  const targetIndex = Math.round(rollQuality * (ER_OPTIONS.length - 1))
  const narrowed = ER_OPTIONS.slice(
      Math.max(0, targetIndex - 1),
      Math.min(ER_OPTIONS.length, targetIndex + 2),
  )

  let bestSum = Infinity
  let bestCombo = Array(maxEchoes).fill(0) as number[]

  const maxValue = narrowed[narrowed.length - 1] ?? 0

  const stack: Array<{ combo: number[]; sum: number }> = [{ combo: [], sum: 0 }]

  while (stack.length) {
    const entry = stack.pop()!
    const { combo, sum } = entry

    // The winning branch is the smallest legal total that reaches the target.
    if (sum >= target) {
      if (sum < bestSum) {
        bestSum = sum
        bestCombo = [...combo, ...Array(maxEchoes - combo.length).fill(0)]
      }
      continue
    }

    if (combo.length >= maxEchoes) {
      continue
    }

    const rmnnSlts = maxEchoes - combo.length

    // Prune branches that cannot reach the target or already exceed the best sum.
    if (sum + rmnnSlts * maxValue < target) {
      continue
    }

    for (const value of narrowed) {
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

function njctErIntoEc(
    echo: RandGenEcho,
    erValue: number,
    statWeight: OptStatWeight,
): RandGenEcho {
  if (!erValue || erValue <= 0) {
    return echo
  }

  const substats = { ...echo.substats }

  if (Object.prototype.hasOwnProperty.call(substats, 'energyRegen')) {
    substats.energyRegen = erValue
    return { ...echo, substats }
  }

  if (Object.keys(substats).length < 5) {
    substats.energyRegen = erValue
    return { ...echo, substats }
  }

  // A full Echo gives up the substat with the lowest objective weight.
  let worstKey: string | null = null
  let worstScore = Infinity

  for (const [key, value] of Object.entries(substats)) {
    if (key === 'energyRegen') {
      continue
    }

    const score = getSbstScr(key, value, statWeight)
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

export function applyErPlanT(params: {
  echoes: RandGenEcho[]
  tgtNrgyRgn: number
  rollQuality: number
  statWeight: OptStatWeight
}): RandGenEcho[] {
  const { echoes, tgtNrgyRgn: trgtNrgyRgn, rollQuality, statWeight } = params

  if (!trgtNrgyRgn || trgtNrgyRgn <= 0) {
    return echoes
  }

  const existingER = echoes.reduce((sum, echo) => {
    return sum
        + (echo.primaryKey === 'energyRegen' ? echo.primaryValue : 0)
        + (echo.substats.energyRegen ?? 0)
  }, 0)

  const rmnnTgt = Math.max(0, trgtNrgyRgn - existingER)
  if (rmnnTgt <= 0) {
    return echoes
  }

  const erCombo = findBestErSp(rmnnTgt, echoes.length, rollQuality)

  return echoes.map((echo, index) => {
    const erVal = erCombo[index] ?? 0
    if (!erVal) {
      return echo
    }

    return njctErIntoEc(echo, erVal, statWeight)
  })
}
