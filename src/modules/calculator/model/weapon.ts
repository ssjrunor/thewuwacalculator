/*
  Author: Runor Ewhro
  Description: shared weapon helper utilities for looking up catalog entries,
               formatting stat displays, resolving level-scaled values,
               selecting passive params by rank, and applying fallback images.
*/

import type { SyntheticEvent } from 'react'
import type { GeneratedWeapon } from '@/domain/entities/weapon'
import { getWeaponById as getWeaponFromCatalog } from '@/domain/services/weaponCatalogService'
import { swapImageToFallback } from '@/shared/lib/imageFallback'

// user-facing labels for weapon secondary stat keys
export const WEAPON_STAT_LABELS: Record<string, string> = {
  critRate: 'Crit. Rate',
  critDmg: 'Crit. DMG',
  atkPercent: 'ATK%',
  energyRegen: 'Energy Regen',
  defPercent: 'DEF%',
  hpPercent: 'HP%',
}

// icon asset mapping for weapon stats in the ui
export const WEAPON_STAT_ICONS: Record<string, string> = {
  atk: '/assets/stat-icons/atk.png',
  hp: '/assets/stat-icons/hp.png',
  def: '/assets/stat-icons/def.png',
  critRate: '/assets/stat-icons/critrate.png',
  critDmg: '/assets/stat-icons/critdmg.png',
  atkPercent: '/assets/stat-icons/atk.png',
  energyRegen: '/assets/stat-icons/energyregen.png',
  defPercent: '/assets/stat-icons/def.png',
  hpPercent: '/assets/stat-icons/hp.png',
}

// stats that should be shown as percentages instead of raw flat values
const RATIO_STAT_KEYS = new Set(['critRate', 'critDmg', 'atkPercent', 'energyRegen', 'defPercent', 'hpPercent'])

// safe catalog lookup wrapper used by ui/components
export function getWeapon(id: string | null): GeneratedWeapon | null {
  if (!id) return null
  return getWeaponFromCatalog(id)
}

// format one stat value for display
// ratio-based stats get one decimal place plus a percent sign
export function formatWeaponStatDisplay(statKey: string, value: number): string {
  if (RATIO_STAT_KEYS.has(statKey)) {
    return `${value.toFixed(1)}%`
  }
  return String(value)
}

// resolve the weapon's atk and secondary stat for a specific level
// if the exact level does not exist, fall back to the nearest available level
export function resolveWeaponStatsAtLevel(
  weapon: GeneratedWeapon,
  level: number,
): { atk: number; secondaryStatValue: number } {
  const entry = weapon.statsByLevel[level]
  if (entry) return entry

  // collect and sort all valid numeric levels present in the table
  const levels = Object.keys(weapon.statsByLevel)
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)

  if (levels.length === 0) {
    return { atk: 0, secondaryStatValue: 0 }
  }

  // choose the closest available level when there is no exact match
  const nearest = levels.reduce((prev, curr) =>
    Math.abs(curr - level) < Math.abs(prev - level) ? curr : prev,
    levels[0],
  )

  return weapon.statsByLevel[nearest] ?? { atk: 0, secondaryStatValue: 0 }
}

// pick the parameter string for the current refinement rank from each param group
// rank is clamped into the supported 1..5 range and converted to a zero-based index
export function resolvePassiveParams(params: string[][], rank: number): string[] {
  const rankIndex = Math.max(0, Math.min(rank - 1, 4))
  return params.map((group) => group[rankIndex] ?? '')
}

// img onerror handler that swaps broken weapon icons to the shared default image
// guard prevents looping if the fallback itself is already active
export function withDefaultWeaponImage(event: SyntheticEvent<HTMLImageElement>) {
  swapImageToFallback(event, '/assets/weapon-icons/default.webp')
}
