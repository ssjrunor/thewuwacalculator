/*
  Author: Runor Ewhro
  Description: encodes optimizer stat constraints into a flat float array
               as min/max pairs in the same order expected by the cpu and
               gpu constraint checks.
*/

import type { OptimizerSettings } from '@/domain/entities/optimizer'

// layout matches passesConstraints():
// [atkMin, atkMax, hpMin, hpMax, defMin, defMax, crMin, crMax,
//  cdMin, cdMax, erMin, erMax, bonusMin, bonusMax, damageMin, damageMax]
export function encodeStatConstraints(settings: OptimizerSettings): Float32Array {
  // a min greater than max means "disabled"
  const DISABLED_MIN = 1
  const DISABLED_MAX = 0

  // start with every constraint disabled
  const values = new Float32Array([
    DISABLED_MIN, DISABLED_MAX, // atk
    DISABLED_MIN, DISABLED_MAX, // hp
    DISABLED_MIN, DISABLED_MAX, // def
    DISABLED_MIN, DISABLED_MAX, // crit rate
    DISABLED_MIN, DISABLED_MAX, // crit dmg
    DISABLED_MIN, DISABLED_MAX, // energy regen
    DISABLED_MIN, DISABLED_MAX, // dmg bonus
    DISABLED_MIN, DISABLED_MAX, // damage
  ])

  // map each optimizer settings key to its min/max pair offset
  const slots: Array<[keyof OptimizerSettings['statConstraints'], number]> = [
    ['atk', 0],
    ['hp', 2],
    ['def', 4],
    ['cr', 6],
    ['cd', 8],
    ['er', 10],
    ['bonus', 12],
    ['damage', 14],
  ]

  for (const [key, offset] of slots) {
    const rule = settings.statConstraints[key]
    if (!rule) continue

    const hasMin = rule.minTotal != null && rule.minTotal.trim() !== ''
    const hasMax = rule.maxTotal != null && rule.maxTotal.trim() !== ''
    if (!hasMin && !hasMax) continue

    // blank sides stay open-ended
    const minValue = hasMin ? Number(rule.minTotal) : Number.NEGATIVE_INFINITY
    const maxValue = hasMax ? Number(rule.maxTotal) : Number.POSITIVE_INFINITY

    values[offset] = Number.isFinite(minValue) ? minValue : Number.NEGATIVE_INFINITY
    values[offset + 1] = Number.isFinite(maxValue) ? maxValue : Number.POSITIVE_INFINITY
  }

  return values
}