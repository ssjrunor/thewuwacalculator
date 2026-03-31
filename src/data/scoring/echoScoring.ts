/*
  Author: Runor Ewhro
  Description: Scores individual echoes and full builds against
               character-specific stat priorities, and aggregates
               total echo stat contributions.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getWeight, getWeightObj } from './charStatWeights'
import {ECHO_PRIMARY_STATS, SUBSTAT_RANGES} from "@/data/gameData/catalog/echoStats.ts";

// ideal main/sub values used as the reference point for score normalization
const idealSubScoreMap: Record<string, number> = {
  hpPercent: 30,
  atkPercent: 30,
  defPercent: 38,
  critRate: 22,
  critDmg: 44,
  energyRegen: 32,
  resonanceLiberation: 30,
  basicAtk: 30,
  resonanceSkill: 30,
  heavyAtk: 30,
}

// normalize a substat key into a score factor relative to crit damage max
function getSubstatScore(key: string): number {
  const idealScore = SUBSTAT_RANGES[key]?.max
  const cdMax = SUBSTAT_RANGES.critDmg.max

  if (!idealScore) {
    return 0
  }

  return cdMax / idealScore
}

// normalize a main stat key into a score factor relative to crit damage ideal
function getMainstatScore(key: string, cost: number): number {
  const idealScore = ECHO_PRIMARY_STATS[cost][key]
  const cdMax = idealSubScoreMap.critDmg

  if (!idealScore) {
    return 0
  }

  return cdMax / idealScore
}

// flat rolls are converted to their percent-family equivalents for scoring
const FLAT_TO_PERCENT: Record<string, string> = {
  atkFlat: 'atkPercent',
  hpFlat: 'hpPercent',
  defFlat: 'defPercent',
}

// resolve the score multiplier for a stat key depending on whether it is a substat
function resolveScoreValue(key: string, isSubStat: boolean, cost: number): number {
  // flat stats are intentionally discounted compared to their percent versions
  if (key in FLAT_TO_PERCENT) {
    const factor = key === 'hpFlat' ? 0.05 : 0.6
    return factor * getSubstatScore(key)
  }

  return isSubStat ? getSubstatScore(key) : getMainstatScore(key, cost)
}

export interface EchoScoreResult {
  mainScore: number
  subScore: number
  totalScore: number
}

// score one echo against the selected character's weight table
export function getEchoScores(charId: string, echo: EchoInstance | null): EchoScoreResult {
  if (!echo) {
    return { mainScore: 0, subScore: 0, totalScore: 0 }
  }

  const def = getEchoById(echo.id)
  const cost = def?.cost ?? 1
  let mainScore = 0
  let subScore = 0

  // score the primary main stat only
  // the secondary stat is fixed by cost and is not treated as the build-defining roll
  const primaryKey = echo.mainStats.primary.key
  if (!primaryKey.endsWith('Flat')) {
    const scoreValue = resolveScoreValue(primaryKey, false, cost)
    const weight = getWeight(charId, primaryKey)
    mainScore += scoreValue * echo.mainStats.primary.value * weight
  }

  // score each substat using its normalized value and character weight
  for (const [key, value] of Object.entries(echo.substats)) {
    if (Number.isNaN(value)) {
      continue
    }

    const scoreValue = resolveScoreValue(key, true, cost)
    const weight = getWeight(charId, key)
    subScore += scoreValue * value * weight
  }

  // guard against accidental NaN propagation
  mainScore = Number.isNaN(mainScore) ? 0 : mainScore
  subScore = Number.isNaN(subScore) ? 0 : subScore

  return {
    mainScore,
    subScore,
    totalScore: mainScore + subScore,
  }
}

// estimate the theoretical best score for one echo for this character
// top five weighted substats are used, then 44 is added as the reference main-stat contribution
export function getMaxEchoScore(charId: string): number {
  const weights = getWeightObj(charId)

  const scored = Object.entries(weights)
      // only substats that can actually roll on echoes matter here
      .filter(([key]) => key in SUBSTAT_RANGES)
      .map(([key, weight]) => {
        const rawScore = resolveScoreValue(key, true, 0) * weight
        const specMax = SUBSTAT_RANGES[key]?.max ?? 0
        return rawScore * specMax
      })
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => b - a)

  const top5Sum = scored.slice(0, 5).reduce((a, b) => a + b, 0)

  return top5Sum + 44
}

// score one echo as a percent of the maximum possible score
export function getEchoScorePercent(charId: string, echo: EchoInstance | null): number {
  if (!charId || !echo) {
    return 0
  }

  const maxScore = getMaxEchoScore(charId)
  if (maxScore <= 0) {
    return 0
  }

  return (getEchoScores(charId, echo).totalScore / maxScore) * 100
}

// score the full five-echo build as a percent of the theoretical maximum
export function getBuildScorePercent(charId: string, echoes: Array<EchoInstance | null>): number {
  if (!charId) {
    return 0
  }

  const maxScore = getMaxEchoScore(charId)
  if (maxScore <= 0) {
    return 0
  }

  const maxBuildScore = maxScore * 5
  let totalScore = 0

  for (const echo of echoes) {
    totalScore += getEchoScores(charId, echo).totalScore
  }

  return (totalScore / maxBuildScore) * 100
}

// aggregate all echo stat contributions into one totals object
export function aggregateEchoStats(echoes: Array<EchoInstance | null>): Record<string, number> {
  const totals: Record<string, number> = {}

  for (const echo of echoes) {
    if (!echo) {
      continue
    }

    // add primary main stat contribution
    const primaryKey = echo.mainStats.primary.key
    totals[primaryKey] = (totals[primaryKey] ?? 0) + echo.mainStats.primary.value

    // add secondary main stat contribution
    const secondaryKey = echo.mainStats.secondary.key
    totals[secondaryKey] = (totals[secondaryKey] ?? 0) + echo.mainStats.secondary.value

    // add all substat contributions
    for (const [key, value] of Object.entries(echo.substats)) {
      totals[key] = (totals[key] ?? 0) + value
    }
  }

  // remove zero-value entries from the final result
  return Object.fromEntries(
      Object.entries(totals).filter(([, value]) => value !== 0),
  )
}