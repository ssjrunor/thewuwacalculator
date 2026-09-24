/*
  Author: Runor Ewhro
  Description: Verifies legal substat allocation, shared budgets, and ranking constraints.
*/

import { describe, expect, it } from 'vitest'
import { getSbstStepP, SUBSTAT_KEYS } from '@/data/gameData/catalog/echoStats'
import { listChsByCos } from '@/data/catalog/echoCatalogService'
import type { EchoInstance } from '@/domain/entities/runtime'
import { ECHO_STAT_STRIDE } from '@/engine/optimizer/config/constants'
import { sumEncodedStats } from '@/engine/evaluation/evaluation/stats'
import {
  distributeStepSubstats, prepareStepAllocator, REFERENCE_STEP_MODEL,
  stepSubstatPlan, tierStepIncreases,
} from '@/engine/evaluation/evaluation/stepAllocation'

const tiers = () => Object.fromEntries(SUBSTAT_KEYS.map(key => [key, getSbstStepP(key)]))
const base = () => new Float32Array(ECHO_STAT_STRIDE * 5)
const ids = Int32Array.from([0, 1, 2, 3, 4])
const relevantKeys = ['atkPercent', 'atkFlat', 'critRate', 'critDmg']
// Minimum-line ranking is CR > CD > ATK% > flat ATK, independently of ER.
const score = (stats: Float32Array) => {
  const totals = sumEncodedStats(stats, ids)
  return totals.critRate * 10 + totals.critDmg * 2 + totals.atkP + totals.atkF * 0.05
}
const relevantCount = (values: Record<string, number[]>, keys = relevantKeys) => (
  Object.entries(values).reduce((sum, [key, entries]) => (
    sum + (keys.includes(key) || key === 'energyRegen' ? entries.length : 0)
  ), 0)
)

describe('native evaluation slot and step budgets', () => {
  it('counts adjacent legal tiers, including uneven and short tier lists', () => {
    expect(tierStepIncreases(getSbstStepP('critRate'), 6.3)).toBe(0)
    expect(tierStepIncreases(getSbstStepP('critRate'), 6.9)).toBe(1)
    expect(tierStepIncreases(getSbstStepP('critRate'), 10.5)).toBe(7)
    expect(tierStepIncreases(getSbstStepP('atkFlat'), 40)).toBe(1)
    expect(tierStepIncreases(getSbstStepP('atkFlat'), 60)).toBe(3)
    expect(tierStepIncreases(getSbstStepP('hpFlat'), 390)).toBe(2)
    expect(() => tierStepIncreases(getSbstStepP('critRate'), 7)).toThrow('Invalid substat tier')
    expect(REFERENCE_STEP_MODEL.maxRelevantSubstats).toBe(16)
    expect(REFERENCE_STEP_MODEL.maxStepIncreases).toBe(32)
  })

  it('enforces relevant flats and their mandatory upgrades even when the budget is small', () => {
    const catalog = tiers()
    expect(prepareStepAllocator(catalog, [], 32)(base(), 0, score)).toBeNull()
    expect(prepareStepAllocator(catalog, ['critRate', 'critDmg', 'atkPercent'])(base(), 0, score)).toBeNull()
    expect(prepareStepAllocator(catalog, relevantKeys, 3)(base(), 0, score)).toBeNull()
    const result = prepareStepAllocator(catalog, relevantKeys, 4)(base(), 0, score)!
    expect(Object.values(result.values).flat()).toHaveLength(25)
    expect(result.stepIncreases).toBe(4)
    expect(result.values.atkFlat).toEqual([50, 50])
    expect(result.values.energyRegen).toBeUndefined()
    for (const [key, values] of Object.entries(result.values)) {
      expect(values.length).toBeLessThanOrEqual(5)
      if (key !== 'atkFlat') expect(values.every(value => value === catalog[key][0])).toBe(true)
    }
  })

  it('charges ER against both limits and realizes five distinct stats on each Echo', () => {
    const catalog = tiers()
    const allocate = prepareStepAllocator(catalog, relevantKeys)
    for (const missingEr of [0, 23.1]) {
      const result = allocate(base(), missingEr, score)!
      const totals = stepSubstatPlan(result.values)
      expect(totals.reduce((sum, entry) => sum + entry.count, 0)).toBe(25)
      expect(result.relevantCount).toBe(16)
      expect(relevantCount(result.values)).toBe(result.relevantCount)
      expect(result.stepIncreases).toBe(32)
      const measured = Object.entries(result.values).reduce((sum, [key, values]) => (
        sum + values.reduce((cost, value) => cost + tierStepIncreases(catalog[key], value), 0)
      ), 0)
      expect(measured).toBe(result.stepIncreases)
      expect(result.values.atkFlat.length).toBeGreaterThanOrEqual(2)
      expect(result.values.atkFlat.every(value => value >= 50)).toBe(true)
      for (const key of ['critRate', 'critDmg']) {
        expect(result.values[key].every(value => tierStepIncreases(catalog[key], value) <= 2), key).toBe(true)
      }
      for (const [key, values] of Object.entries(result.values)) {
        if (relevantKeys.includes(key) || key === 'energyRegen') continue
        expect(values.every(value => value === catalog[key][0]), key).toBe(true)
      }
      const template = Array.from({ length: 5 }, (_, index) => ({
        uid: `step-test-${index}`, id: listChsByCos(1)[0].id, set: 0, mainEcho: index === 0,
        mainStats: { primary: { key: 'atkPercent', value: 18 }, secondary: { key: 'hpFlat', value: 2280 } }, substats: {},
      } as EchoInstance))
      const echoes = distributeStepSubstats(template, result.values)
      expect(template.every(echo => Object.keys(echo.substats).length === 0)).toBe(true)
      for (const echo of echoes) {
        expect(Object.keys(echo.substats)).toHaveLength(5)
        for (const [key, value] of Object.entries(echo.substats)) expect(catalog[key]).toContain(value)
      }
      for (const row of totals) {
        expect(echoes.reduce((sum, echo) => sum + (echo.substats[row.key] ?? 0), 0)).toBeCloseTo(row.total, 10)
      }
      expect(totals.find(row => row.key === 'energyRegen')?.total ?? 0).toBeGreaterThanOrEqual(missingEr)
    }
  })

  it('preserves the lowest-key floor when ER consumes the rest of the step budget', () => {
    const catalog = tiers()
    const allocate = prepareStepAllocator(catalog, relevantKeys)
    const result = allocate(base(), 56.4000019, score)!
    expect(result.values.energyRegen).toHaveLength(5)
    expect(result.values.energyRegen.reduce((sum, value) => sum + value, 0)).toBeCloseTo(56.4, 8)
    expect(result.values.energyRegen.reduce((sum, value) => sum + tierStepIncreases(catalog.energyRegen, value), 0)).toBe(28)
    expect(result.values.atkFlat).toEqual([50, 50])
    expect(result.stepIncreases).toBe(32)
    expect(relevantCount(result.values)).toBe(16)
    for (const key of ['critRate', 'critDmg']) expect(result.values[key].every(value => value === catalog[key][0])).toBe(true)
    expect(allocate(base(), 56.41, score)).toBeNull()
    expect(allocate(base(), 62.0000019, score)).toBeNull()
  })

  it('ranks non-crit keys too and does not apply damage-ranking caps to ER', () => {
    const rankFlatFirst = (stats: Float32Array) => {
      const t = sumEncodedStats(stats, ids)
      return t.atkF * 10 + t.atkP * 10 + t.critRate + t.critDmg * 0.1
    }
    const result = prepareStepAllocator(tiers(), relevantKeys)(base(), 35, rankFlatFirst)!
    // Flat ATK ranks first: floor(3 * .29) = 0. ATK% ranks second: floor(7 * .29) = 2.
    expect(result.values.atkFlat.every(value => value === 30)).toBe(true)
    expect(result.values.atkPercent.every(value => value <= 7.9)).toBe(true)
    // ER leaves no room for CD. The lowest *present* damage key is therefore CR.
    expect(result.values.critDmg).toHaveLength(0)
    expect(result.values.critRate.length).toBeGreaterThan(0)
    expect(result.values.critRate.every(value => value >= 8.7)).toBe(true)
    expect(result.values.energyRegen.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(35)
    expect(result.stepIncreases).toBeLessThanOrEqual(32)
  })

  it('allows the relevant-flat minimum to span different keys and rounds the lowest floor up', () => {
    const keys = ['atkFlat', 'hpFlat', 'critRate', 'critDmg']
    const diminishingFlats = (stats: Float32Array) => {
      const t = sumEncodedStats(stats, ids)
      return t.critRate * 100 + t.critDmg * 20 + Math.min(t.atkF, 30) * 3 + Math.min(t.hpF, 320) * 0.2
    }
    const result = prepareStepAllocator(tiers(), keys)(base(), 0, diminishingFlats)!
    expect(result.values.atkFlat.length).toBeGreaterThan(0)
    expect(result.values.hpFlat.length).toBeGreaterThan(0)
    // HP ranks last. Every selected HP line must spend ceil(7 / 2) = 4 steps.
    expect(result.values.hpFlat.every(value => value >= 470)).toBe(true)
    expect(result.stepIncreases).toBeLessThanOrEqual(32)
  })

  it('rejects conflicting rank limits instead of silently relaxing them', () => {
    // With only two relevant keys, the lowest selected key also has a top-two
    // cap. Its half-upgrade floor cannot fit under that cap.
    expect(prepareStepAllocator(tiers(), ['critRate', 'atkFlat'])(base(), 0, score)).toBeNull()
  })

  it('never relabels a weak relevant stat as filler to complete the build', () => {
    const allButHp = SUBSTAT_KEYS.filter(key => key !== 'hpFlat' && key !== 'energyRegen')
    expect(prepareStepAllocator(tiers(), allButHp)(base(), 0, score)).toBeNull()
  })
})
