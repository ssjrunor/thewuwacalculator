/*
  Author: Runor Ewhro
  Description: shared substat aggregation, roll bounds, and ER-aware key helpers.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { SUBSTAT_KEYS, getSbstStep, getSbstStepP } from '@/data/gameData/catalog/echoStats'
import { ignoresEr } from '@/data/scoring/energyRegenPolicy'

export const IDEAL_SUBSTAT_SLOTS = 25
export const MAX_SUBSTAT_SLOTS_PER_KEY = 5
export const ENERGY_REGEN = 'energyRegen'

export interface SubstatTotals {
  totals: Record<string, number>
  counts: Record<string, number>
}

export interface SubstatRollBounds {
  key: string
  step: number
  min: number
  max: number
}

export function roundStat(value: number): number {
  return Number(value.toFixed(4))
}

export function aggregateSubstats(echoes: EchoInstance[]): SubstatTotals {
  const totals: Record<string, number> = {}
  const counts: Record<string, number> = {}

  for (const echo of echoes) {
    for (const [key, value] of Object.entries(echo.substats)) {
      totals[key] = roundStat((totals[key] ?? 0) + value)
      counts[key] = (counts[key] ?? 0) + 1
    }
  }

  return { totals, counts }
}

export function substatKeysForResonator(resonatorId: string): string[] {
  return ignoresEr(resonatorId)
    ? SUBSTAT_KEYS.filter((key) => key !== ENERGY_REGEN)
    : [...SUBSTAT_KEYS]
}

export function substatRollBounds(key: string): SubstatRollBounds {
  const steps = getSbstStepP(key)
  return {
    key,
    step: getSbstStep(key),
    min: steps.length ? steps[0] : 0,
    max: steps.length ? steps[steps.length - 1] : 0,
  }
}

export function allSubstatRollBounds(): Record<string, SubstatRollBounds> {
  return Object.fromEntries(SUBSTAT_KEYS.map((key) => [key, substatRollBounds(key)]))
}

export function substatQuality(total: number, count: number, maxRoll: number): number {
  return count > 0 && maxRoll > 0 ? (total / (count * maxRoll)) * 100 : 0
}
