/*
  Author: Runor Ewhro
  Description: Provides resonator seed catalog helpers and resolves base
               stats by level using exact values or interpolation.
*/

import { getResonatorCatalog, getResonatorCatalogById } from '@/data/gameData/resonators/resonatorDataStore'
import type { ResonatorSeed } from '@/domain/entities/runtime'
import type { ResonatorBaseStats } from '@/domain/entities/stats'

// proxy so existing callers doing resonatorSeedsById[id] still work
export const resonatorSeedsById: Record<string, ResonatorSeed> = new Proxy(
  {} as Record<string, ResonatorSeed>,
  {
    get(_, key: string) {
      return getResonatorCatalogById()[key]
    },
  },
)

// list all resonator seeds
export function listResonatorSeeds(): ResonatorSeed[] {
  return getResonatorCatalog()
}

// get one resonator seed by id
export function getResonatorSeedById(resonatorId: string): ResonatorSeed | null {
  return getResonatorCatalogById()[resonatorId] ?? null
}

// resolve base stats at a given level using exact values or interpolation
export function resolveResonatorBaseStats(
    resonator: Pick<ResonatorSeed, 'baseStats' | 'baseStatsByLevel'>,
    level: number,
): ResonatorBaseStats {
  const resolvedLevel = Math.max(1, Math.min(90, Math.round(level)))
  const exact = resonator.baseStatsByLevel?.[resolvedLevel]

  if (exact) {
    return {
      ...resonator.baseStats,
      ...exact,
    }
  }

  const availableLevels = Object.keys(resonator.baseStatsByLevel ?? {})
      .map(Number)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)

  if (availableLevels.length === 0) {
    return resonator.baseStats
  }

  const lowerLevel =
      [...availableLevels].reverse().find((value) => value <= resolvedLevel) ?? availableLevels[0]
  const upperLevel =
      availableLevels.find((value) => value >= resolvedLevel) ?? availableLevels[availableLevels.length - 1]

  const lowerStats = resonator.baseStatsByLevel?.[lowerLevel]
  const upperStats = resonator.baseStatsByLevel?.[upperLevel]

  if (!lowerStats && !upperStats) {
    return resonator.baseStats
  }

  if (!lowerStats || lowerLevel === upperLevel || !upperStats) {
    return {
      ...resonator.baseStats,
      ...(lowerStats ?? upperStats),
    }
  }

  const progress = (resolvedLevel - lowerLevel) / (upperLevel - lowerLevel)
  const lerp = (start: number, end: number) => start + (end - start) * progress

  return {
    ...resonator.baseStats,
    hp: lerp(lowerStats.hp, upperStats.hp),
    atk: lerp(lowerStats.atk, upperStats.atk),
    def: lerp(lowerStats.def, upperStats.def),
  }
}