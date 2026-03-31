/*
  Author: Runor Ewhro
  Description: Cached echo stat tables loaded from JSON before runtime
               consumers import calculator modules.
*/

export interface EchoSecondaryStat {
  key: string
  value: number
}

export interface EchoSubstatRange {
  min: number
  max: number
  divisions: number
}

export interface EchoStatsCatalogData {
  primaryStats: Record<string, Record<string, number>>
  secondaryStats: Record<string, EchoSecondaryStat>
  substatKeys: string[]
  substatRanges: Record<string, EchoSubstatRange>
}

export let ECHO_PRIMARY_STATS: Record<number, Record<string, number>> = {}
export let ECHO_SECONDARY_STATS: Record<number, EchoSecondaryStat> = {}
export let ECHO_SUBSTAT_KEYS: string[] = []
export let SUBSTAT_RANGES: Record<string, EchoSubstatRange> = {}

export function initEchoStatsCatalog(data: EchoStatsCatalogData): void {
  ECHO_PRIMARY_STATS = Object.fromEntries(
      Object.entries(data.primaryStats).map(([cost, stats]) => [Number(cost), stats]),
  ) as Record<number, Record<string, number>>

  ECHO_SECONDARY_STATS = Object.fromEntries(
      Object.entries(data.secondaryStats).map(([cost, stat]) => [Number(cost), stat]),
  ) as Record<number, EchoSecondaryStat>

  ECHO_SUBSTAT_KEYS = [...data.substatKeys]
  SUBSTAT_RANGES = { ...data.substatRanges }
}

// get all valid discrete step values for a substat key
export function getSubstatStepOptions(key: string): number[] {
  const range = SUBSTAT_RANGES[key]
  if (!range) return []

  const { min, max, divisions } = range
  const step = (max - min) / divisions
  const isFlatStat = key.endsWith('Flat')

  // hp flat uses an explicit hardcoded value list
  if (key === 'hpFlat') {
    return [320, 360, 390, 430, 470, 510, 540, 580]
  }

  const values: number[] = []
  for (let i = 0; i <= divisions; i += 1) {
    let value = min + step * i

    if (isFlatStat) {
      value = Math.ceil(value / 10) * 10
    } else {
      value = parseFloat(value.toFixed(1))
    }

    if (!values.includes(value)) {
      values.push(value)
    }
  }

  return values
}

// snap a value to the nearest legal substat step
export function snapToNearestSubstatValue(key: string, value: number): number {
  const options = getSubstatStepOptions(key)
  if (!options.length) return value

  let closest = options[0]
  let minDiff = Math.abs(value - closest)

  for (const option of options) {
    const diff = Math.abs(value - option)
    if (diff < minDiff) {
      minDiff = diff
      closest = option
    }
  }

  return closest
}

// get the base step increment for a substat key
export function getSubstatStep(key: string): number {
  const range = SUBSTAT_RANGES[key]
  if (!range) return 0.1

  const rawStep = (range.max - range.min) / range.divisions

  if (!key.endsWith('Flat')) {
    return Math.round(rawStep * 10) / 10
  }

  return rawStep
}
