/*
  Author: Runor Ewhro
  Description: Exhaustively audits tier spending for one fixed reference line layout offline.
*/

import { ECHO_STAT_STRIDE } from '@/engine/optimizer/config/constants'
import { addStatTotal, ENERGY_REGEN } from './stats'
import { REFERENCE_STEP_MODEL, type StepAllocation } from './stepAllocation'

export interface FixedLineTierAudit {
  complete: boolean
  evaluations: number
  heuristicDamage: number
  bestDamage: number
  bestValues: Record<string, number[]>
}

// This proves the best tier spend only for the supplied line counts and ER
// choice. It deliberately does not run during anchor generation: the complete
// search can be exponential, and changing the live winner changes 100% ties.
export function auditFixedLineTiers(
  base: Float32Array,
  allocation: StepAllocation,
  tiers: Record<string, readonly number[]>,
  relevantKeys: readonly string[],
  score: (stats: Float32Array) => number,
  options: { stepBudget?: number; maxEvaluations?: number } = {},
): FixedLineTierAudit {
  const stepBudget = options.stepBudget ?? REFERENCE_STEP_MODEL.maxStepIncreases
  const maxEvaluations = options.maxEvaluations ?? 100_000
  if (!Number.isInteger(maxEvaluations) || maxEvaluations < 1) throw new Error('maxEvaluations must be positive')
  if (base.length !== ECHO_STAT_STRIDE * 5) throw new Error('Expected five encoded Echo rows')
  const values = allocation.values
  const damageKeys = Object.keys(tiers).filter(key => key !== ENERGY_REGEN && relevantKeys.includes(key))
  const erValues = values[ENERGY_REGEN] ?? []
  const erSteps = tiers[ENERGY_REGEN] ?? []
  const erCost = erValues.reduce((sum, value) => {
    const tier = erSteps.indexOf(value)
    if (tier < 0) throw new Error('Invalid ER tier in allocation')
    return sum + tier
  }, 0)
  const working = base.slice()
  if (erValues.length) addStatTotal(working, ENERGY_REGEN, erValues.reduce((sum, value) => sum + value, 0))
  const rankBase = score(working)
  const ranking = damageKeys.map(key => {
    const minimum = tiers[key]?.[0]
    if (minimum == null) throw new Error(`Missing tiers for ${key}`)
    const probe = new Float32Array(ECHO_STAT_STRIDE)
    addStatTotal(probe, key, 1)
    const offset = probe.findIndex(value => value !== 0)
    const previous = working[offset]
    addStatTotal(working, key, minimum)
    const gain = score(working) - rankBase
    working[offset] = previous
    return { key, gain }
  }).sort((a, b) => b.gain - a.gain || a.key.localeCompare(b.key))
  for (const [key, entries] of Object.entries(values)) {
    if (key === ENERGY_REGEN || damageKeys.includes(key) || entries.length === 0) continue
    addStatTotal(working, key, entries.reduce((sum, value) => sum + value, 0))
  }
  const capped = new Set(ranking.slice(0, REFERENCE_STEP_MODEL.cappedKeyCount).map(entry => entry.key))
  const lowest = ranking.filter(entry => (values[entry.key]?.length ?? 0) > 0).at(-1)?.key
  const active = damageKeys.filter(key => (values[key]?.length ?? 0) > 0)
  const offsets = Object.fromEntries(active.map(key => {
    const probe = new Float32Array(ECHO_STAT_STRIDE)
    addStatTotal(probe, key, 1)
    return [key, probe.findIndex(value => value !== 0)]
  })) as Record<string, number>
  const current = Object.fromEntries(Object.entries(values).map(([key, entries]) => [key, [...entries]])) as Record<string, number[]>
  let bestDamage = allocation.damage
  let bestValues = Object.fromEntries(Object.entries(values).map(([key, entries]) => [key, [...entries]])) as Record<string, number[]>
  let evaluations = 0
  let complete = true

  const visitKey = (keyIndex: number, spent: number): void => {
    if (!complete) return
    if (keyIndex === active.length) {
      if (evaluations >= maxEvaluations) { complete = false; return }
      evaluations += 1
      const damage = score(working)
      if (damage > bestDamage) {
        bestDamage = damage
        bestValues = Object.fromEntries(Object.entries(current).map(([key, entries]) => [key, [...entries]]))
      }
      return
    }
    const key = active[keyIndex]
    const steps = tiers[key]
    const maxTier = capped.has(key)
      ? Math.floor((steps.length - 1) * REFERENCE_STEP_MODEL.topKeyUpgradeFraction)
      : steps.length - 1
    const minTier = key === lowest
      ? Math.ceil((steps.length - 1) * REFERENCE_STEP_MODEL.lowestKeyUpgradeFraction)
      : 0
    if (minTier > maxTier) return
    const offset = offsets[key]
    const original = working[offset]
    const selected = current[key]
    const visitLine = (line: number, startTier: number, cost: number, total: number): void => {
      if (!complete) return
      if (line === selected.length) {
        working[offset] = base[offset]
        addStatTotal(working, key, total)
        visitKey(keyIndex + 1, spent + cost)
        return
      }
      for (let tier = startTier; tier <= maxTier; tier += 1) {
        if (spent + cost + tier > stepBudget) break
        selected[line] = steps[tier]
        visitLine(line + 1, tier, cost + tier, total + steps[tier])
        if (!complete) break
      }
    }
    visitLine(0, minTier, 0, 0)
    working[offset] = original
  }
  visitKey(0, erCost)
  return { complete, evaluations, heuristicDamage: allocation.damage, bestDamage, bestValues }
}
