/*
  Author: Runor Ewhro
  Description: Repairs persisted echo instances whose catalog definition is no
               longer available while preserving their rolls and build shape.
*/

import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import type { EchoDef } from '@/domain/entities/catalog'
import type { EchoInstance } from '@/domain/entities/runtime'
import { getEchoById, listEchoes } from '@/data/catalog/echoCatalogService'

const MAX_LOADOUT_COST = 12
const COST_ORDER = [1, 3, 4]

interface EchoCandidate {
  definition: EchoDef
  set: number
  catalogIndex: number
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.0001
}

// Saved echoes do not store their cost directly, but their canonical main-stat
// pair does. The secondary stat is the strongest signal because it separates
// cost 1 from 3/4 and its value separates cost 3 from 4.
export function inferSavedEchoCost(echo: EchoInstance): number | null {
  const secondaryMatch = COST_ORDER.find((cost) => {
    const secondary = ECHO_SIDE_STATS[cost]
    return secondary?.key === echo.mainStats.secondary.key
      && sameNumber(secondary.value, echo.mainStats.secondary.value)
  })
  if (secondaryMatch != null) {
    return secondaryMatch
  }

  const primaryMatch = COST_ORDER.find((cost) => {
    const value = ECHO_MAIN_STATS[cost]?.[echo.mainStats.primary.key]
    return value != null && sameNumber(value, echo.mainStats.primary.value)
  })
  if (primaryMatch != null) {
    return primaryMatch
  }

  const secondaryKeyMatches = COST_ORDER.filter(
    (cost) => ECHO_SIDE_STATS[cost]?.key === echo.mainStats.secondary.key,
  )
  return secondaryKeyMatches.length === 1 ? secondaryKeyMatches[0] : null
}

function candidateVariants(): EchoCandidate[] {
  return listEchoes().flatMap((definition, catalogIndex) =>
    definition.sets.map((set) => ({ definition, set, catalogIndex })),
  )
}

function candidateKey(candidate: EchoCandidate): string {
  return `${candidate.definition.id}|${candidate.set}`
}

function compareCandidates(
  left: EchoCandidate,
  right: EchoCandidate,
  echo: EchoInstance,
  wantedCost: number | null,
): number {
  const leftSet = left.set === echo.set ? 1 : 0
  const rightSet = right.set === echo.set ? 1 : 0
  if (leftSet !== rightSet) return rightSet - leftSet

  const leftCost = wantedCost != null && left.definition.cost === wantedCost ? 1 : 0
  const rightCost = wantedCost != null && right.definition.cost === wantedCost ? 1 : 0
  if (leftCost !== rightCost) return rightCost - leftCost

  if (wantedCost != null) {
    const leftDistance = Math.abs(left.definition.cost - wantedCost)
    const rightDistance = Math.abs(right.definition.cost - wantedCost)
    if (leftDistance !== rightDistance) return leftDistance - rightDistance
  }

  if (left.catalogIndex !== right.catalogIndex) return left.catalogIndex - right.catalogIndex
  return left.set - right.set
}

function pickReplacement(
  echo: EchoInstance,
  usedKeys: Set<string>,
  availableCost: number,
): EchoCandidate | null {
  const wantedCost = inferSavedEchoCost(echo)
  const all = candidateVariants()
  if (all.length === 0) return null

  const unique = all.filter((candidate) => !usedKeys.has(candidateKey(candidate)))
  const uniquePool = unique.length > 0 ? unique : all
  const withinBudget = uniquePool.filter(
    (candidate) => candidate.definition.cost <= availableCost,
  )
  const pool = withinBudget.length > 0 ? withinBudget : uniquePool

  return [...pool].sort((left, right) =>
    compareCandidates(left, right, echo, wantedCost),
  )[0] ?? null
}

function repairMainStats(
  echo: EchoInstance,
  replacementCost: number,
  wantedCost: number | null,
): EchoInstance['mainStats'] {
  if (wantedCost === replacementCost) {
    return {
      primary: { ...echo.mainStats.primary },
      secondary: { ...echo.mainStats.secondary },
    }
  }

  const primaryStats = ECHO_MAIN_STATS[replacementCost] ?? {}
  const primaryKey = primaryStats[echo.mainStats.primary.key] != null
    ? echo.mainStats.primary.key
    : Object.keys(primaryStats)[0]
  const secondary = ECHO_SIDE_STATS[replacementCost]

  return {
    primary: primaryKey
      ? { key: primaryKey, value: primaryStats[primaryKey] }
      : { ...echo.mainStats.primary },
    secondary: secondary
      ? { key: secondary.key, value: secondary.value }
      : { ...echo.mainStats.secondary },
  }
}

/**
 * Repair one saved build at a time so generated replacements can avoid an
 * id/set pair already present in that build. Existing catalog echoes keep their
 * identity; only a stale set is moved onto one the definition currently owns.
 */
export function repairEchoLoadoutForCatalog(
  echoes: ReadonlyArray<EchoInstance | null | undefined>,
): Array<EchoInstance | null> {
  const knownCosts = echoes.map((echo) => {
    if (!echo) return 0
    return getEchoById(echo.id)?.cost ?? 0
  })
  const wantedCosts = echoes.map((echo, index) => {
    if (!echo || knownCosts[index] > 0) return 0
    return inferSavedEchoCost(echo) ?? 0
  })
  let materializedCost = knownCosts.reduce((total, cost) => total + cost, 0)
  const usedKeys = new Set<string>()

  for (const echo of echoes) {
    if (!echo) continue
    const definition = getEchoById(echo.id)
    if (!definition) continue
    const set = definition.sets.includes(echo.set)
      ? echo.set
      : (definition.sets[0] ?? echo.set)
    usedKeys.add(`${definition.id}|${set}`)
  }

  return echoes.map((echo, index) => {
    if (!echo) return null

    const definition = getEchoById(echo.id)
    if (definition) {
      const set = definition.sets.includes(echo.set)
        ? echo.set
        : (definition.sets[0] ?? echo.set)
      return set === echo.set ? echo : { ...echo, set }
    }

    const reservedCost = wantedCosts
      .slice(index + 1)
      .reduce((total, cost) => total + cost, 0)
    const availableCost = Math.max(0, MAX_LOADOUT_COST - materializedCost - reservedCost)
    const replacement = pickReplacement(echo, usedKeys, availableCost)
    if (!replacement) return null

    const wantedCost = wantedCosts[index] || null
    materializedCost += replacement.definition.cost
    usedKeys.add(candidateKey(replacement))

    return {
      ...echo,
      id: replacement.definition.id,
      set: replacement.set,
      mainStats: repairMainStats(echo, replacement.definition.cost, wantedCost),
      substats: { ...echo.substats },
    }
  })
}

export function repairSavedEchoForCatalog(echo: EchoInstance): EchoInstance {
  return repairEchoLoadoutForCatalog([echo])[0] ?? echo
}
