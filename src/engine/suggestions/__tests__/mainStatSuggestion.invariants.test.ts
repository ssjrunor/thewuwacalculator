/*
  Author: Runor Ewhro
  Description: Verifies worker-cloned main-stat and Sonata candidates retain
               canonical simulation scores and legal search-space membership.
*/

import { describe, expect, it } from 'vitest'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'
import type { EchoInstance } from '@/domain/entities/runtime'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import { makeEnemy, mkMaxResRt } from '@/domain/state/defaults'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { mkPrepMainSt, mkPrepSetPla, resSuggDmg, runSuggSmlt } from '@/engine/suggestions/shared'
import { runMainStats, runSetPlanqc } from '@/engine/suggestions/core'
import { applyMainSta } from '@/engine/suggestions/mainStat-suggestion/utils'
import { applySetPlan } from '@/engine/suggestions/mutate'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { sggsSetPlns } from '@/engine/suggestions/setPlan-suggestion/suggestSetPlan'

describe('main-stat suggestion worker payload', () => {
  it.each([true, false])('returns canonical Galbrena scores after structured clone (rotation: %s)', (rotationMode) => {
    const seed = getResSeedBy('1208')
    if (!seed) throw new Error('Missing Galbrena fixture')
    const runtime = mkMaxResRt(seed, 6)
    runtime.build.echoes = ['6000120', '6000068', '6000169', '6000112', '6000167'].map((id, index): EchoInstance => {
      const definition = getEchoById(id)
      if (!definition) throw new Error(`Missing Echo ${id}`)
      const cost = definition.cost
      const primaryKey = cost === 4 ? 'critDmg' : cost === 3 ? 'fusion' : 'atkPercent'
      return {
        uid: `galbrena-main-${index}`, id, set: index === 0 || index === 3 ? 18 : 22,
        mainEcho: index === 0,
        mainStats: {
          primary: { key: primaryKey, value: ECHO_MAIN_STATS[cost][primaryKey] },
          secondary: { ...ECHO_SIDE_STATS[cost] },
        },
        substats: { critRate: 10.5, critDmg: 21, atkPercent: 11.6, heavyAtk: 11.6, energyRegen: 12.4 },
      }
    })
    const input = {
      scenarioId: combatScenarioId('suggestions:main-parity'), memberId: teamMemberId(runtime.id),
      runtime, seed, enemy: makeEnemy(), runtimesById: makeRuntimeMap(runtime),
      selectedTargets: {}, tgtFeatId: 'damage:1208018', rotationMode,
      includeEchoAttacks: true, topK: 3,
    }
    const simulation = runSuggSmlt(input)
    const prepared = mkPrepMainSt(input, simulation)
    if (!prepared) throw new Error('Failed to prepare main-stat suggestions')
    // Worker transfer must retain every input needed for finalist simulation.
    const transferred = structuredClone(prepared)
    expect(transferred.scoringInput.runtime.id).toBe('1208')
    expect(transferred.scoringInput.includeEchoAttacks).toBe(true)
    const results = runMainStats(transferred)
    expect(results).toHaveLength(3)
    expect(results[0].damage).toBeGreaterThanOrEqual(resSuggDmg(simulation, input) - 1e-6)
    results.forEach((result, index) => {
      const candidate = { ...input, runtime: { ...runtime, build: { ...runtime.build, echoes: applyMainSta(result.recipes, runtime.build.echoes) } } }
      expect(result.damage).toBeCloseTo(resSuggDmg(runSuggSmlt(candidate), candidate), 8)
      if (index) expect(result.damage).toBeLessThanOrEqual(results[index - 1].damage)
    })
    const preparedSets = mkPrepSetPla({ ...input, includeEchoAttacks: undefined }, simulation)
    if (!preparedSets) throw new Error('Failed to prepare Sonata suggestions')
    const setResults = runSetPlanqc(structuredClone(preparedSets))
    expect(setResults.length).toBeGreaterThan(0)
    // Changing Echo bodies during full simulation must not reintroduce plans
    // suppressed by the original isolated useful-piece comparisons.
    const isolated = sggsSetPlns({
      ctx: rotationMode ? null : preparedSets.context,
      rotationCtx: rotationMode ? preparedSets.context : null,
      fivePcSets: ECHO_SET_DEFS.filter((set) => set.setMax === 5).map((set) => set.id),
      thrPcSets: ECHO_SET_DEFS.filter((set) => set.setMax === 3).map((set) => set.id),
      exhaustive: true, qppdChs: runtime.build.echoes,
    }).results
    const signature = (plan: typeof setResults[number]['setPlan']) => JSON.stringify(plan)
    const usefulSignatures = new Set(isolated.map((result) => signature(result.setPlan)))
    for (const result of setResults) {
      expect(usefulSignatures.has(signature(result.setPlan))).toBe(true)
      const candidate = { ...input, runtime: { ...runtime, build: { ...runtime.build, echoes: applySetPlan(result.setPlan, runtime.build.echoes) } } }
      expect(result.avgDamage).toBeCloseTo(resSuggDmg(runSuggSmlt(candidate), candidate), 8)
    }
  }, 30_000)
})
