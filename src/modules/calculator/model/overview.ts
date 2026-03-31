/*
  Author: Runor Ewhro
  Description: overview-only view helpers for grouped averages, rotation
               footer copy, and weapon icon key resolution.
*/

import { WEAPON_TYPE_TO_KEY } from '@/modules/calculator/model/resonator'

export interface OverviewBreakdownItem {
  label: string
  avg: number
}

// group rows by key while accumulating an average-style value bucket
export function groupByAverage<T>(
  entries: T[],
  getKey: (entry: T) => string,
  getLabel: (entry: T) => string,
  getValue: (entry: T) => number,
): OverviewBreakdownItem[] {
  const grouped = new Map<string, OverviewBreakdownItem>()

  for (const entry of entries) {
    const key = getKey(entry)
    const current = grouped.get(key)
    if (current) {
      current.avg += getValue(entry)
      continue
    }

    grouped.set(key, {
      label: getLabel(entry),
      avg: getValue(entry),
    })
  }

  return Array.from(grouped.values()).sort((left, right) => right.avg - left.avg)
}

// keep rotation footer copy stable when details are missing
export function getRotationFooter(detail: string | null, fallback: string) {
  return detail || fallback
}

// map numeric weapon types to the shared visual asset key
export function getWeaponVisualKey(weaponType: number | null | undefined): string | null {
  if (weaponType == null) {
    return null
  }

  return WEAPON_TYPE_TO_KEY[weaponType as keyof typeof WEAPON_TYPE_TO_KEY] ?? null
}
