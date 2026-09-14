/*
  Author: Runor Ewhro
  Description: Scores individual echoes and full builds against
               character-specific stat priorities, and aggregates
               total echo stat contributions.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getWeight, getWeightObj, getWeightSetKey } from './charStatWeights'
import {ECHO_MAIN_STATS, SUBSTAT_RANGES} from "@/data/gameData/catalog/echoStats.ts";

// ideal main/sub values used as the reference point for score normalization
const dlSubScrMap: Record<string, number> = {
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
function getSbstScr(key: string): number {
  const idealScore = SUBSTAT_RANGES[key]?.max
  const cdMax = SUBSTAT_RANGES.critDmg.max

  if (!idealScore) {
    return 0
  }

  return cdMax / idealScore
}

// normalize a main stat key into a score factor relative to crit damage ideal
function getMnstScr(key: string, cost: number): number {
  const idealScore = ECHO_MAIN_STATS[cost][key]
  const cdMax = dlSubScrMap.critDmg

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

// Utility rolls satisfy build requirements but do not describe Echo quality.
// They are omitted from both earned points and the matching maximum, rather
// than being retained as zero-value rolls that lower the displayed grade.
const UTILITY_SCORE_STATS = new Set(['energyRegen', 'healingBonus'])

// Character weight tables are immutable for the lifetime of a loaded catalog.
// Cache the normalized ceiling because inventory, parser, and Simulation rows
// otherwise recompute the same sort for every visible Echo.
const maxEchoScoreCache = new Map<string, number>()
const mainWeightCeilingCache = new Map<string, number>()

export interface EchoMainStatScoreProfile {
  cacheKey: string
  charId: string
  weightsByCost: Record<number, Record<string, number>>
  bestByCost: Record<number, string[]>
}

const MAIN_STAT_PROFILE_LIMIT = 24
const mainStatProfiles = new Map<string, EchoMainStatScoreProfile>()
const activeMainStatProfileByChar = new Map<string, string>()
const mainStatProfileRevisionByChar = new Map<string, number>()
const mainStatProfileListenersByChar = new Map<string, Set<() => void>>()

function notifyMainStatProfile(charId: string): void {
  mainStatProfileRevisionByChar.set(
    charId,
    (mainStatProfileRevisionByChar.get(charId) ?? 0) + 1,
  )

  for (const listener of mainStatProfileListenersByChar.get(charId) ?? []) {
    listener()
  }
}

export function getEchoScoringRevision(charId: string): number {
  return mainStatProfileRevisionByChar.get(charId) ?? 0
}

export function subscribeEchoScoring(
    charId: string,
    listener: () => void,
): () => void {
  let listeners = mainStatProfileListenersByChar.get(charId)
  if (!listeners) {
    listeners = new Set()
    mainStatProfileListenersByChar.set(charId, listeners)
  }

  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      mainStatProfileListenersByChar.delete(charId)
    }
  }
}

// Resolve the generated fallback independently of any current simulation
// profile. The main-stat search uses this for utility stats that damage alone
// cannot value, and scoring uses it until the current context has been primed.
export function getGeneratedMainStatWeight(
    charId: string,
    key: string,
    cost: number,
): number {
  const weight = getWeight(charId, key)
  if (weight <= 0) {
    return 0
  }

  const cacheKey = `${getWeightSetKey()}:${charId}:${cost}`
  let ceiling = mainWeightCeilingCache.get(cacheKey)
  if (ceiling === undefined) {
    ceiling = Math.max(
      0,
      ...Object.keys(ECHO_MAIN_STATS[cost] ?? {}).map((mainKey) => getWeight(charId, mainKey)),
    )
    mainWeightCeilingCache.set(cacheKey, ceiling)
  }

  return ceiling > 0 ? weight / ceiling : 0
}

// Select a cached simulation profile without rebuilding it. A miss leaves the
// current profile visible until its replacement finishes, avoiding a flash of
// legacy weights while the new build context is being prepared.
export function activateEchoMainStatScoreProfile(
    charId: string,
    cacheKey: string,
): boolean {
  const profile = mainStatProfiles.get(cacheKey)
  if (!profile || profile.charId !== charId) {
    return false
  }

  // Refresh insertion order so frequently revisited contexts stay in the LRU.
  mainStatProfiles.delete(cacheKey)
  mainStatProfiles.set(cacheKey, profile)
  if (activeMainStatProfileByChar.get(charId) !== cacheKey) {
    activeMainStatProfileByChar.set(charId, cacheKey)
    console.info('[echo-score:max-main-stats:cache]', {
      charId,
      bestByCost: profile.bestByCost,
    })
    notifyMainStatProfile(charId)
  }
  return true
}

// Store and activate a completed context profile. The cache is intentionally
// small: each entry is cheap, while scenarios and target configurations can be
// edited indefinitely during a session.
export function cacheEchoMainStatScoreProfile(
    profile: EchoMainStatScoreProfile,
): void {
  mainStatProfiles.delete(profile.cacheKey)
  mainStatProfiles.set(profile.cacheKey, profile)
  activeMainStatProfileByChar.set(profile.charId, profile.cacheKey)
  notifyMainStatProfile(profile.charId)

  while (mainStatProfiles.size > MAIN_STAT_PROFILE_LIMIT) {
    const oldestKey = mainStatProfiles.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    mainStatProfiles.delete(oldestKey)

    for (const [charId, activeKey] of activeMainStatProfileByChar) {
      if (activeKey === oldestKey) {
        activeMainStatProfileByChar.delete(charId)
        notifyMainStatProfile(charId)
      }
    }
  }
}

export function deactivateEchoMainStatScoreProfile(charId: string): void {
  if (activeMainStatProfileByChar.delete(charId)) {
    notifyMainStatProfile(charId)
  }
}

// Normalize primary-stat relevance within the main stats that can legally
// appear at this cost. This keeps the best 1/3/4-cost main worth the same 44
// points without flattening the generated damage weights used for substats.
function getMainWeight(charId: string, key: string, cost: number): number {
  const activeKey = activeMainStatProfileByChar.get(charId)
  const profile = activeKey ? mainStatProfiles.get(activeKey) : undefined
  if (profile?.bestByCost[cost]?.includes(key)) {
    return 1
  }

  const contextualWeight = profile?.weightsByCost[cost]?.[key]

  if (contextualWeight !== undefined && Number.isFinite(contextualWeight)) {
    return Math.max(0, Math.min(1, contextualWeight))
  }

  return getGeneratedMainStatWeight(charId, key, cost)
}

// resolve the score multiplier for a stat key depending on whether it is a substat
function resScrVl(key: string, isSubStat: boolean, cost: number): number {
  // flat stats are intentionally discounted compared to their percent versions
  if (key in FLAT_TO_PERCENT) {
    const factor = key === 'hpFlat' ? 0.05 : 0.6
    return factor * getSbstScr(key)
  }

  return isSubStat ? getSbstScr(key) : getMnstScr(key, cost)
}

export interface EchoScrRslt {
  mainScore: number
  subScore: number
  totalScore: number
}

// score one echo against the selected character's weight table
export function getEchoScrs(charId: string, echo: EchoInstance | null): EchoScrRslt {
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
  if (!primaryKey.endsWith('Flat') && !UTILITY_SCORE_STATS.has(primaryKey)) {
    const scoreValue = resScrVl(primaryKey, false, cost)
    const weight = getMainWeight(charId, primaryKey, cost)
    mainScore += scoreValue * echo.mainStats.primary.value * weight
  }

  // score each substat using its normalized value and character weight
  for (const [key, value] of Object.entries(echo.substats)) {
    if (Number.isNaN(value) || UTILITY_SCORE_STATS.has(key)) {
      continue
    }

    const scoreValue = resScrVl(key, true, cost)
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

function utilitySubstatSlots(echo: EchoInstance | null | undefined): number {
  if (!echo) {
    return 0
  }

  return Object.entries(echo.substats).filter(([key, value]) => (
    UTILITY_SCORE_STATS.has(key) && Number.isFinite(value) && value > 0
  )).length
}

// Estimate the matching maximum for one Echo. A utility main or substat is
// removed from both sides of the ratio, so a five-sub Echo containing one ER
// roll is graded against the best four scorable substats rather than five.
export function getMaxEchoSc(
    charId: string,
    echo?: EchoInstance | null,
): number {
  const substatSlots = Math.max(0, 5 - utilitySubstatSlots(echo))
  const includeMainStat = !echo
    || !UTILITY_SCORE_STATS.has(echo.mainStats.primary.key)
  const cacheKey = [
    getWeightSetKey(),
    charId,
    substatSlots,
    includeMainStat ? 'main' : 'no-main',
  ].join(':')
  const cached = maxEchoScoreCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  const weights = getWeightObj(charId)

  const scored = Object.entries(weights)
      // only substats that can actually roll on echoes matter here
      .filter(([key]) => key in SUBSTAT_RANGES && !UTILITY_SCORE_STATS.has(key))
      .map(([key, weight]) => {
        const rawScore = resScrVl(key, true, 0) * weight
        const specMax = SUBSTAT_RANGES[key]?.max ?? 0
        return {
          key,
          weight,
          maxValue: specMax,
          score: rawScore * specMax,
        }
      })
      .filter(({ score }) => Number.isFinite(score) && score > 0)
      .sort((a, b) => b.score - a.score)

  const selected = scored.slice(0, substatSlots)
  const substatScore = selected.reduce((sum, stat) => sum + stat.score, 0)
  const mainStatScore = includeMainStat ? 44 : 0

  const result = substatScore + mainStatScore
  console.info('[echo-score:max-substats]', {
    charId,
    weightSet: getWeightSetKey(),
    substatSlots,
    stats: selected,
    substatScore,
    mainStatScore,
    maxScore: result,
  })
  maxEchoScoreCache.set(cacheKey, result)
  return result
}

// score one echo as a percent of the maximum possible score
export function getEchoScrPr(charId: string, echo: EchoInstance | null): number {
  if (!charId || !echo) {
    return 0
  }

  const maxScore = getMaxEchoSc(charId, echo)
  if (maxScore <= 0) {
    return 0
  }

  return (getEchoScrs(charId, echo).totalScore / maxScore) * 100
}

// score the full five-echo build as a percent of the theoretical maximum
export function getMkScrPrcn(charId: string, echoes: Array<EchoInstance | null>): number {
  if (!charId) {
    return 0
  }

  const fullEchoMax = getMaxEchoSc(charId)
  let maxMkScr = 0
  let totalScore = 0

  // Preserve the five-Echo build denominator for empty slots while allowing
  // each equipped Echo to omit only the utility slots it actually contains.
  for (let index = 0; index < 5; index += 1) {
    const echo = echoes[index] ?? null
    maxMkScr += echo ? getMaxEchoSc(charId, echo) : fullEchoMax
    totalScore += getEchoScrs(charId, echo).totalScore
  }

  return maxMkScr > 0 ? (totalScore / maxMkScr) * 100 : 0
}

// aggregate all echo stat contributions into one totals object
export function ggrgEchoStts(echoes: Array<EchoInstance | null>): Record<string, number> {
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
