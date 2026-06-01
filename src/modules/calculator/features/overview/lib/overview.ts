/*
  Author: Runor Ewhro
  Description: overview-only view helpers for grouped averages, rotation
               footer copy, and weapon icon key resolution.
*/

import { WPNTYPETOKEY } from '@/modules/calculator/features/resonator/lib/resonator.ts'

export interface VrvwBrkdItem {
  label: string
  avg: number
}

// group rows by key while accumulating an average-style value bucket
export function grpByVrg<T>(
  entries: T[],
  getKey: (entry: T) => string,
  getLabel: (entry: T) => string,
  getValue: (entry: T) => number,
): VrvwBrkdItem[] {
  const grouped = new Map<string, VrvwBrkdItem>()

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
export function getRotFtr(detail: string | null, fallback: string) {
  return detail || fallback
}

// map numeric weapon types to the shared weapon asset key
export function getWpnVslKey(weaponType: number | null | undefined): string | null {
  if (weaponType == null) {
    return null
  }

  return WPNTYPETOKEY[weaponType as keyof typeof WPNTYPETOKEY] ?? null
}
