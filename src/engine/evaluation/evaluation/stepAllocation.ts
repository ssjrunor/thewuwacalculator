/*
  Author: Runor Ewhro
  Description: Allocates legal substat lines and tier increases within reference-build budgets.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { ECHO_STAT_STRIDE } from '@/engine/optimizer/config/constants'
import type { EvaluationSubstatEntry } from './types'
import { addStatTotal, ENERGY_REGEN, MAX_ROLLS_PER_KEY, MAX_SUBS } from './stats'

// Occupied lines and tier increases are separate native budgets. ER
// consumes both; non-damage filler occupies real slots at minimum values.
export const REFERENCE_STEP_MODEL = {
  slots: MAX_SUBS,
  maxCopies: MAX_ROLLS_PER_KEY,
  maxRelevantSubstats: 16,
  maxStepIncreases: 32,
  minimumRelevantFlats: 2,
  cappedKeyCount: 2,
  topKeyUpgradeFraction: 0.29,
  lowestKeyUpgradeFraction: 0.5,
} as const

export interface StepAllocation {
  damage: number
  stats: Float32Array
  values: Record<string, number[]>
  relevantCount: number
  stepIncreases: number
}

export function tierStepIncreases(steps: readonly number[], value: number): number {
  const index = steps.indexOf(value)
  if (index < 0) throw new Error(`Invalid substat tier: ${value}`)
  return index
}

interface ErPlan {
  values: number[]
  total: number
  cost: number
}

// Every nondecreasing legal combination, grouped by occupied ER slots. Build
// this small catalog once per anchor search, not once per main-stat candidate.
function makeErPlans(steps: readonly number[], maxCopies: number): ErPlan[][] {
  const plans: ErPlan[][] = Array.from({ length: maxCopies + 1 }, () => [])
  const visit = (values: number[], start: number, total: number, cost: number) => {
    plans[values.length].push({ values, total, cost })
    if (values.length === maxCopies) return
    for (let index = start; index < steps.length; index += 1) {
      visit([...values, steps[index]], index, total + steps[index], cost + index)
    }
  }
  visit([], 0, 0, 0)
  for (const group of plans) group.sort((a, b) => a.total - b.total)
  return plans
}

export function prepareStepAllocator(
  tiers: Record<string, readonly number[]>,
  relevantKeys: readonly string[],
  stepBudget: number = REFERENCE_STEP_MODEL.maxStepIncreases,
) {
  const keys = Object.keys(tiers).filter(key => key !== ENERGY_REGEN && tiers[key].length > 0)
  const relevant = new Set(relevantKeys)
  const damageKeys = keys.filter(key => relevant.has(key))
  const flatKeys = damageKeys.filter(key => ['atkFlat', 'hpFlat', 'defFlat'].includes(key))
  const fillerKeys = keys.filter(key => !relevant.has(key))
  // Get the encoded lane from the canonical writer, without duplicating its
  // stat layout. Equal Float32 totals are identical scoring trials, even when
  // they came from different current tiers on separate lines of the same key.
  const statOffsets = Object.fromEntries(damageKeys.map(key => {
    const probe = new Float32Array(ECHO_STAT_STRIDE)
    addStatTotal(probe, key, 1)
    return [key, probe.findIndex(value => value !== 0)]
  }))
  const erPlans = makeErPlans(tiers[ENERGY_REGEN] ?? [], REFERENCE_STEP_MODEL.maxCopies)

  const erChoices = (missing: number): ErPlan[] => {
    if (missing <= 1e-5) return erPlans[0]
    return erPlans.slice(1).flatMap(group => {
      // Native ER tiers are evenly spaced: at a fixed count, minimum total ER
      // also has the fewest steps. Do not round a near-exact Float32 total up.
      let low = 0
      let high = group.length
      while (low < high) {
        const mid = (low + high) >>> 1
        if (group[mid].total + 1e-5 < missing) low = mid + 1
        else high = mid
      }
      const plan = group[low]
      return plan && plan.cost <= stepBudget ? [plan] : []
    })
  }

  return (
    base: Float32Array,
    missingEr: number,
    score: (stats: Float32Array) => number,
    checkCancel?: () => void,
  ): StepAllocation | null => {
    if (flatKeys.length === 0) return null
    let best: StepAllocation | null = null
    const trial = base.slice()
    for (const er of erChoices(missingEr)) {
      checkCancel?.()
      const values: Record<string, number[]> = Object.fromEntries(keys.map(key => [key, []]))
      if (er.values.length) values[ENERGY_REGEN] = [...er.values]
      let relevantCount = er.values.length
      const working = base.slice()
      if (er.total) addStatTotal(working, ENERGY_REGEN, er.total)
      let damage = score(working)

      // Rank one minimum-value line against this candidate's mains and ER.
      // Keep that ranking fixed during allocation; ER is utility, not ranked.
      const ranking = damageKeys.map(key => {
        trial.set(working)
        addStatTotal(trial, key, tiers[key][0])
        return { key, gain: score(trial) - damage }
      }).sort((a, b) => b.gain - a.gain || a.key.localeCompare(b.key))
      const cappedKeys = new Set(ranking.slice(0, REFERENCE_STEP_MODEL.cappedKeyCount).map(entry => entry.key))
      const maxTier = (key: string) => cappedKeys.has(key)
        ? Math.floor((tiers[key].length - 1) * REFERENCE_STEP_MODEL.topKeyUpgradeFraction)
        : tiers[key].length - 1

      const addBestLine = (eligible: readonly string[]): boolean => {
        checkCancel?.()
        let selected: string | undefined
        let bestGain = -Infinity
        let selectedDamage = damage
        for (const key of eligible) {
          if (values[key].length >= REFERENCE_STEP_MODEL.maxCopies) continue
          trial.set(working)
          addStatTotal(trial, key, tiers[key][0])
          const trialDamage = score(trial)
          const gain = trialDamage - damage
          if (gain > bestGain) {
            selected = key
            bestGain = gain
            selectedDamage = trialDamage
          }
        }
        if (!selected) return false
        values[selected].push(tiers[selected][0])
        addStatTotal(working, selected, tiers[selected][0])
        damage = selectedDamage
        relevantCount += 1
        return true
      }
      // Relevant flats occupy the same relevant-line budget. Either both may be the
      // same key or they may differ; non-damage filler never satisfies this.
      for (let count = 0; count < REFERENCE_STEP_MODEL.minimumRelevantFlats; count += 1) {
        if (!addBestLine(flatKeys)) break
      }
      if (flatKeys.reduce((sum, key) => sum + values[key].length, 0) < REFERENCE_STEP_MODEL.minimumRelevantFlats) continue
      while (relevantCount < REFERENCE_STEP_MODEL.maxRelevantSubstats) {
        if (!addBestLine(damageKeys)) break
      }

      // Realize the remaining physical lines using only non-damage keys.
      // Spread filler deterministically; it receives no tier upgrades.
      let occupied = relevantCount
      while (occupied < REFERENCE_STEP_MODEL.slots) {
        const selected = fillerKeys.reduce<string | undefined>((bestKey, key) => (
          values[key].length < REFERENCE_STEP_MODEL.maxCopies
          && (bestKey == null || values[key].length < values[bestKey].length) ? key : bestKey
        ), undefined)
        if (!selected) break
        values[selected].push(tiers[selected][0])
        addStatTotal(working, selected, tiers[selected][0])
        occupied += 1
      }
      if (occupied !== REFERENCE_STEP_MODEL.slots) continue
      let spent = er.cost
      const lowestKey = ranking.filter(({ key }) => values[key].length > 0).at(-1)?.key
      if (lowestKey) {
        const minTier = Math.ceil((tiers[lowestKey].length - 1) * REFERENCE_STEP_MODEL.lowestKeyUpgradeFraction)
        // Reject conflicting caps or insufficient budget instead of silently
        // weakening either rule. Every selected line of this key gets the floor.
        if (minTier > maxTier(lowestKey)) continue
        spent += minTier * values[lowestKey].length
        if (spent > stepBudget) continue
        for (let index = 0; index < values[lowestKey].length; index += 1) {
          const value = tiers[lowestKey][minTier]
          addStatTotal(working, lowestKey, value - values[lowestKey][index])
          values[lowestKey][index] = value
        }
      }
      damage = score(working)
      while (spent < stepBudget) {
        checkCancel?.()
        let selected: { key: string; index: number; value: number; damage: number } | undefined
        let bestGain = 0
        for (const key of damageKeys) {
          const steps = tiers[key]
          // Identical values of a stat produce identical trials; evaluate one.
          const seen = new Set<number>()
          const seenTotals = new Set<number>()
          for (let index = 0; index < values[key].length; index += 1) {
            const current = values[key][index]
            if (seen.has(current)) continue
            seen.add(current)
            const nextTier = steps.indexOf(current) + 1
            if (nextTier > maxTier(key)) continue
            const next = steps[nextTier]
            trial.set(working)
            addStatTotal(trial, key, next - current)
            const total = trial[statOffsets[key]]
            if (seenTotals.has(total)) continue
            seenTotals.add(total)
            const trialDamage = score(trial)
            const gain = trialDamage - damage
            if (gain > bestGain) {
              selected = { key, index, value: next, damage: trialDamage }
              bestGain = gain
            }
          }
        }
        if (!selected) break
        const { key, index, value } = selected
        addStatTotal(working, key, value - values[key][index])
        values[key][index] = value
        spent += 1
        damage = selected.damage
      }
      if (!best || damage > best.damage) best = { stats: working, damage, values, relevantCount, stepIncreases: spent }
    }
    return best
  }
}

export function stepSubstatPlan(values: Record<string, number[]>): EvaluationSubstatEntry[] {
  return Object.entries(values).filter(([, entries]) => entries.length > 0).map(([key, entries]) => {
    const total = entries.reduce((sum, value) => sum + value, 0)
    return { key, count: entries.length, effectiveCount: entries.length, rollValue: total / entries.length, total }
  })
}

export function distributeStepSubstats(echoes: EchoInstance[], values: Record<string, number[]>): EchoInstance[] {
  if (echoes.length !== 5) throw new Error('A step allocation requires five Echoes')
  const result = echoes.map(echo => ({ ...echo, substats: {} as Record<string, number> }))
  const remaining = Object.entries(values).map(([key, entries]) => ({ key, entries: [...entries] }))
  // Assign highest remaining counts first: a bipartite degree realization
  // with five equal-capacity Echo slots and no duplicate key in an Echo.
  for (const echo of result) {
    remaining.sort((a, b) => b.entries.length - a.entries.length || a.key.localeCompare(b.key))
    const selected = remaining.filter(entry => entry.entries.length > 0).slice(0, 5)
    if (selected.length !== 5) throw new Error('Incomplete step allocation')
    for (const entry of selected) echo.substats[entry.key] = entry.entries.pop()!
  }
  if (remaining.some(entry => entry.entries.length)) throw new Error('Step allocation exceeds Echo capacity')
  return result
}
