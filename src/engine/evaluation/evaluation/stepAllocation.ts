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
  const statOffsets = Object.fromEntries([...keys, ENERGY_REGEN].map(key => {
    const probe = new Float32Array(ECHO_STAT_STRIDE)
    addStatTotal(probe, key, 1)
    return [key, probe.findIndex(value => value !== 0)]
  }))
  const erPlans = makeErPlans(tiers[ENERGY_REGEN] ?? [], REFERENCE_STEP_MODEL.maxCopies)
  const seenTotalsScratch = new Float32Array(REFERENCE_STEP_MODEL.maxCopies)
  // Candidate trials are sequential. Keep the small line workspace and Echo
  // buffer alive across calls; copy only a winning allocation.
  const working = new Float32Array(ECHO_STAT_STRIDE * 5)
  const values: Record<string, number[]> = Object.fromEntries([...keys, ENERGY_REGEN].map(key => [key, []]))

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
    refine = false,
  ): StepAllocation | null => {
    if (flatKeys.length === 0) return null
    let best: StepAllocation | null = null
    // Rebuild a changed lane from its main-stat base and selected legal
    // values. Repeated Float32 tier deltas accumulate error (five 15% CD
    // lines became 74.99996), making report totals disagree with the lines.
    const writeValues = (buffer: Float32Array, key: string, entries: readonly number[], delta = 0) => {
      buffer[statOffsets[key]] = base[statOffsets[key]]
      addStatTotal(buffer, key, entries.reduce((sum, value) => sum + value, 0) + delta)
    }
    for (const er of erChoices(missingEr)) {
      checkCancel?.()
      for (const key of keys) values[key].length = 0
      values[ENERGY_REGEN].length = 0
      for (const value of er.values) values[ENERGY_REGEN].push(value)
      let relevantCount = er.values.length
      working.set(base)
      if (er.total) writeValues(working, ENERGY_REGEN, er.values)
      let damage = score(working)
      // Only one encoded lane changes in a line or tier trial. Restore its
      // exact Float32 value after scoring instead of copying all five Echo rows.
      const scoreOneLane = (key: string, entries: readonly number[], delta = 0) => {
        const offset = statOffsets[key]
        const previous = working[offset]
        writeValues(working, key, entries, delta)
        const result = score(working)
        working[offset] = previous
        return result
      }

      // Rank one minimum-value line against this candidate's mains and ER.
      // Keep that ranking fixed during allocation; ER is utility, not ranked.
      const ranking = damageKeys.map(key => {
        const offset = statOffsets[key]
        const previous = working[offset]
        addStatTotal(working, key, tiers[key][0])
        const gain = score(working) - damage
        working[offset] = previous
        return { key, gain }
      }).sort((a, b) => b.gain - a.gain || a.key.localeCompare(b.key))
      const cappedKeys = new Set(ranking.slice(0, REFERENCE_STEP_MODEL.cappedKeyCount).map(entry => entry.key))
      const maxTiers = Object.fromEntries(damageKeys.map(key => [key, cappedKeys.has(key)
        ? Math.floor((tiers[key].length - 1) * REFERENCE_STEP_MODEL.topKeyUpgradeFraction)
        : tiers[key].length - 1])) as Record<string, number>
      const maxTier = (key: string) => maxTiers[key]

      const addBestLine = (eligible: readonly string[]): boolean => {
        checkCancel?.()
        let selected: string | undefined
        let bestGain = -Infinity
        let selectedDamage = damage
        for (const key of eligible) {
          if (values[key].length >= REFERENCE_STEP_MODEL.maxCopies) continue
          const trialDamage = scoreOneLane(key, values[key], tiers[key][0])!
          const gain = trialDamage - damage
          if (gain > bestGain) {
            selected = key
            bestGain = gain
            selectedDamage = trialDamage
          }
        }
        if (!selected) return false
        values[selected].push(tiers[selected][0])
        writeValues(working, selected, values[selected])
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
        writeValues(working, selected, values[selected])
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
          values[lowestKey][index] = value
        }
        writeValues(working, lowestKey, values[lowestKey])
      }
      damage = score(working)
      while (spent < stepBudget) {
        checkCancel?.()
        let selected: { key: string; index: number; value: number; damage: number } | undefined
        let bestGain = 0
        for (const key of damageKeys) {
          const steps = tiers[key]
          // Identical values of a stat produce identical trials; evaluate one.
          let seenTiers = 0
          let seenTotalCount = 0
          for (let index = 0; index < values[key].length; index += 1) {
            const current = values[key][index]
            const currentTier = steps.indexOf(current)
            const bit = 1 << currentTier
            if (seenTiers & bit) continue
            seenTiers |= bit
            const nextTier = currentTier + 1
            if (nextTier > maxTier(key)) continue
            const next = steps[nextTier]
            const offset = statOffsets[key]
            const previous = working[offset]
            writeValues(working, key, values[key], next - current)
            const total = working[offset]
            let duplicate = false
            for (let seenIndex = 0; seenIndex < seenTotalCount; seenIndex += 1) {
              if (seenTotalsScratch[seenIndex] === total) { duplicate = true; break }
            }
            if (duplicate) { working[offset] = previous; continue }
            seenTotalsScratch[seenTotalCount++] = total
            const trialDamage = score(working)
            working[offset] = previous
            const gain = trialDamage - damage
            if (gain > bestGain) {
              selected = { key, index, value: next, damage: trialDamage }
              bestGain = gain
            }
          }
        }
        if (!selected) break
        const { key, index, value } = selected
        values[key][index] = value
        writeValues(working, key, values[key])
        spent += 1
        damage = selected.damage
      }
      if (refine) {
        // Revisit the greedy result only for shortlisted final candidates. A
        // same-tier line exchange or one-for-one tier transfer keeps both
        // investment budgets fixed, while the rank-based caps and floor stay
        // attached to the original minimum-line ranking for this ER plan.
        for (let pass = 0; pass < stepBudget; pass += 1) {
          checkCancel?.()
          const currentLowest = ranking.filter(({ key }) => values[key].length > 0).at(-1)?.key
          const currentFlatCount = flatKeys.reduce((sum, key) => sum + values[key].length, 0)
          const floorTier = (key: string) => key === currentLowest
            ? Math.ceil((tiers[key].length - 1) * REFERENCE_STEP_MODEL.lowestKeyUpgradeFraction)
            : 0
          const bestMove: { commit: (() => void) | null } = { commit: null }
          let bestDamage = damage + Math.max(1e-7, Math.abs(damage) * 1e-10)
          const trialMove = (changed: readonly string[], commit: () => void, revert: () => void) => {
            const firstOffset = statOffsets[changed[0]]
            const firstPrevious = working[firstOffset]
            const secondOffset = changed.length > 1 ? statOffsets[changed[1]] : -1
            const secondPrevious = secondOffset >= 0 ? working[secondOffset] : 0
            for (const key of changed) writeValues(working, key, values[key])
            const result = score(working)
            working[firstOffset] = firstPrevious
            if (secondOffset >= 0) working[secondOffset] = secondPrevious
            revert()
            if (result > bestDamage) {
              bestDamage = result
              bestMove.commit = commit
            }
          }

          for (const fromKey of damageKeys) {
            for (let fromIndex = 0; fromIndex < values[fromKey].length; fromIndex += 1) {
              const fromValue = values[fromKey][fromIndex]
              const fromTier = tiers[fromKey].indexOf(fromValue)
              // Keep the two capped keys present, and preserve the mandatory
              // flat count when moving one relevant line to another key.
              if (!cappedKeys.has(fromKey) || values[fromKey].length > 1) {
                for (const toKey of damageKeys) {
                  if (toKey === fromKey || values[toKey].length >= REFERENCE_STEP_MODEL.maxCopies || fromTier > maxTier(toKey)) continue
                  if (flatKeys.includes(fromKey) && !flatKeys.includes(toKey)
                    && currentFlatCount <= REFERENCE_STEP_MODEL.minimumRelevantFlats) continue
                  const toValue = tiers[toKey][fromTier]
                  if (toValue == null) continue
                  values[fromKey].splice(fromIndex, 1)
                  values[toKey].push(toValue)
                  const nextLowest = ranking.filter(({ key }) => values[key].length > 0).at(-1)?.key
                  const legalFloor = !nextLowest || values[nextLowest].every(value =>
                    tiers[nextLowest].indexOf(value) >= Math.ceil((tiers[nextLowest].length - 1) * REFERENCE_STEP_MODEL.lowestKeyUpgradeFraction))
                  if (legalFloor) {
                    trialMove([fromKey, toKey], () => {
                      values[fromKey].splice(fromIndex, 1)
                      values[toKey].push(toValue)
                    }, () => {
                      values[toKey].pop()
                      values[fromKey].splice(fromIndex, 0, fromValue)
                    })
                  } else {
                    values[toKey].pop()
                    values[fromKey].splice(fromIndex, 0, fromValue)
                  }
                }
              }
              if (fromTier <= floorTier(fromKey)) continue
              for (const toKey of [...damageKeys, ENERGY_REGEN]) {
                for (let toIndex = 0; toIndex < (values[toKey]?.length ?? 0); toIndex += 1) {
                  if (fromKey === toKey && fromIndex === toIndex) continue
                  const toValue = values[toKey][toIndex]
                  const toTier = tiers[toKey].indexOf(toValue)
                  if (toTier >= (toKey === ENERGY_REGEN ? tiers[toKey].length - 1 : maxTier(toKey))) continue
                  const downgraded = tiers[fromKey][fromTier - 1]
                  const upgraded = tiers[toKey][toTier + 1]
                  values[fromKey][fromIndex] = downgraded
                  values[toKey][toIndex] = upgraded
                  trialMove(fromKey === toKey ? [fromKey] : [fromKey, toKey], () => {
                    values[fromKey][fromIndex] = downgraded
                    values[toKey][toIndex] = upgraded
                  }, () => {
                    values[fromKey][fromIndex] = fromValue
                    values[toKey][toIndex] = toValue
                  })
                }
              }
            }
          }
          if (!bestMove.commit) break
          bestMove.commit()
          for (const key of [...damageKeys, ENERGY_REGEN]) {
            if (values[key]?.length) writeValues(working, key, values[key])
          }
          damage = score(working)
        }
      }
      if (!best || damage > best.damage) best = {
        stats: working.slice(),
        damage,
        values: Object.fromEntries(Object.entries(values)
          .filter(([key, entries]) => key !== ENERGY_REGEN || entries.length > 0)
          .map(([key, entries]) => [key, [...entries]])),
        relevantCount,
        stepIncreases: spent,
      }
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
