/*
  Author: Runor Ewhro
  Description: shared weapon helper utilities for looking up catalog entries,
               formatting stat displays, resolving level-scaled values,
               selecting passive params by rank, and applying fallback images.
*/

import type { GenWpn } from '@/domain/entities/weapon.ts'
import { getWpnById as getWpnFromCa } from '@/domain/services/weaponCatalogService.ts'

// user-facing labels for weapon secondary stat keys
export const WPNSTATLBLS: Record<string, string> = {
  critRate: 'Crit. Rate',
  critDmg: 'Crit. DMG',
  atkPercent: 'ATK%',
  energyRegen: 'Energy Regen',
  defPercent: 'DEF%',
  hpPercent: 'HP%',
  tuneBreakBoost: 'Tune Break Boost',
}

// icon asset mapping for weapon stats in the ui
export const WPN_STAT_CNS: Record<string, string> = {
  atk: '/assets/stat-icons/atk.png',
  hp: '/assets/stat-icons/hp.png',
  def: '/assets/stat-icons/def.png',
  critRate: '/assets/stat-icons/critrate.png',
  critDmg: '/assets/stat-icons/critdmg.png',
  atkPercent: '/assets/stat-icons/atk.png',
  energyRegen: '/assets/stat-icons/energyregen.png',
  defPercent: '/assets/stat-icons/def.png',
  hpPercent: '/assets/stat-icons/hp.png',
  tuneBreakBoost: '/assets/stat-icons/tune-break-boost.png',
}

// stats that should be shown as percentages instead of raw flat values
const RT_STAT_KEYS = new Set(['critRate', 'critDmg', 'atkPercent', 'energyRegen', 'defPercent', 'hpPercent'])

// safe catalog lookup wrapper used by ui/features
export function getWeapon(id: string | null): GenWpn | null {
  if (!id) return null
  return getWpnFromCa(id)
}

// format one stat value for display
// ratio-based stats get one decimal place plus a percent sign
export function fmtWpnStatDs(statKey: string, value: number): string {
  if (statKey === 'tuneBreakBoost') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
  }

  if (RT_STAT_KEYS.has(statKey)) {
    return `${value.toFixed(1)}%`
  }
  return String(value)
}

// resolve the weapon's atk and secondary stat for a specific level
// if the exact level does not exist, fall back to the nearest available level
export function weaponStatsAt(
  weapon: GenWpn,
  level: number,
): { atk: number; scndStatVl: number } {
  const entry = weapon.statsByLevel[level]
  if (entry) return { atk: entry.atk, scndStatVl: entry.secondaryStatValue }

  // collect and sort all valid numeric levels present in the table
  const levels = Object.keys(weapon.statsByLevel)
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)

  if (levels.length === 0) {
    return { atk: 0, scndStatVl: 0 }
  }

  // choose the closest available level when there is no exact match
  const nearest = levels.reduce((prev, curr) =>
    Math.abs(curr - level) < Math.abs(prev - level) ? curr : prev,
    levels[0],
  )

  const fallback = weapon.statsByLevel[nearest]
  return fallback ? { atk: fallback.atk, scndStatVl: fallback.secondaryStatValue } : { atk: 0, scndStatVl: 0 }
}

// pick the parameter string for the current refinement rank from each param group
// rank is clamped into the supported 1..5 range and converted to a zero-based index
export function resPssvPrms(params: string[][], rank: number): string[] {
  const rankIndex = Math.max(0, Math.min(rank - 1, 4))
  return params.map((group) => group[rankIndex] ?? '')
}

export { withDefWpnMg } from '@/shared/lib/imageFallback.ts'
