/*
  Author: Runor Ewhro
  Description: verifies durable main-stat and set-plan Echo mutation helpers.
*/

import { describe, expect, it } from 'vitest'
import { makeEchoUid } from '@/domain/entities/runtime'
import { getEchoSets, listChsByCos } from '@/data/catalog/echoCatalogService'
import { ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import {
  applyMainSur,
  applySetPlan,
  mkEchoMainSt,
  mkMainStatPt,
  mkSetPlanCnd,
  prepSetPlanFsb,
} from '@/engine/suggestions/mutate'

describe('echo mutation invariants', () => {
  it('narrows bonus main stat options to the selected attribute', () => {
    const options = mkMainStatPt(3, {
      allowedFilter: new Set(['bonus']),
      selBonus: 'spectro',
    })

    expect(options.map((entry) => entry.key)).toEqual(['spectro'])
  })

  it('rebuilds equipped echoes with the requested primary stat', () => {
    // main-stat replacement should touch only the primary stat/value pair; the
    // equipped echo identity, secondary stat, and rolled substats must survive
    const definition = listChsByCos(3)[0]
    expect(definition).toBeTruthy()

    const updated = applyMainSur([
      null,
      {
        uid: makeEchoUid(),
        id: definition.id,
        set: definition.sets[0] ?? 0,
        mainEcho: false,
        mainStats: {
          primary: { key: 'atkPercent', value: 30 },
          secondary: { ...ECHO_SIDE_STATS[3] },
        },
        substats: { critRate: 10.5 },
      },
    ], [
      null,
      'energyRegen',
    ])

    expect(updated[1]?.mainStats.primary.key).toBe('energyRegen')
    expect(updated[1]?.mainStats.primary.value).toBe(32)
    expect(updated[1]?.mainStats.secondary).toEqual(ECHO_SIDE_STATS[3])
    expect(updated[1]?.substats).toEqual({ critRate: 10.5 })
  })

  it('includes both full and mixed set plans for five-slot builds', () => {
    const plans = mkSetPlanCnd(5)

    expect(plans.some((plan) => plan.length === 1 && plan[0]?.pieces === 5)).toBe(true)
    expect(plans.some((plan) => (
      plan.length === 2 &&
      plan.some((entry) => entry.pieces === 2) &&
      plan.some((entry) => entry.pieces === 3)
    ))).toBe(true)
  })

  it('reuses prepared feasibility across set plans', () => {
    // feasibility preparation is separated from plan enumeration so many set
    // plans can be checked without repeatedly scanning the same echo list
    const definitions = listChsByCos(1).slice(0, 5)
    const echoes = definitions.map((definition) => ({
      uid: makeEchoUid(),
      id: definition.id,
      set: definition.sets[0] ?? 0,
      mainEcho: false,
      mainStats: {
        primary: { key: 'atkPercent', value: 18 },
        secondary: { ...ECHO_SIDE_STATS[1] },
      },
      substats: {},
    }))
    const isFeasible = prepSetPlanFsb(echoes)

    expect(mkSetPlanCnd(5).some(isFeasible)).toBe(true)
  })

  it('replaces an incompatible main echo for full mixed set plans', () => {
    // Rustfire only exists on sets 34/35. A full 2pc + 3pc plan for other sets
    // must replace it instead of rewriting its active set and keeping its buff.
    const rustfire = listChsByCos(4).find((definition) => definition.id === '6000217')
    expect(rustfire?.sets).toEqual([34, 35])

    const costs = [4, 3, 3, 1, 1]
    const echoes = costs.map((cost, index) => {
      const definition = index === 0
          ? rustfire
          : listChsByCos(cost).find((entry) => entry.id !== '6000217')

      expect(definition).toBeTruthy()
      if (!definition) {
        throw new Error(`Missing echo definition for cost ${cost}`)
      }

      return {
        uid: makeEchoUid(),
        id: definition.id,
        set: definition.sets[0] ?? 0,
        mainEcho: index === 0,
        mainStats: {
          primary: { key: 'atkPercent', value: 30 },
          secondary: { ...ECHO_SIDE_STATS[cost] },
        },
        substats: {},
      }
    })

    const planned = applySetPlan([
      { setId: 2, pieces: 2 },
      { setId: 20, pieces: 3 },
    ], echoes)

    expect(planned[0]?.id).not.toBe('6000217')
    expect(planned[0]?.set === 2 || planned[0]?.set === 20).toBe(true)
    for (const echo of planned) {
      expect(echo).toBeTruthy()
      if (echo) {
        expect(getEchoSets(echo.id)).toContain(echo.set)
      }
    }
  })

  it('treats reordered same-cost main stat layouts as identical', () => {
    // the main-stat signature describes available slot stats, not inventory
    // order, so same-cost echoes must hash the same after reordering
    const definitions = listChsByCos(1).slice(0, 2)
    expect(definitions).toHaveLength(2)

    const buildA = [
      {
        uid: makeEchoUid(),
        id: definitions[0].id,
        set: definitions[0].sets[0] ?? 0,
        mainEcho: false,
        mainStats: {
          primary: { key: 'atkPercent', value: 18 },
          secondary: { ...ECHO_SIDE_STATS[1] },
        },
        substats: {},
      },
      {
        uid: makeEchoUid(),
        id: definitions[1].id,
        set: definitions[1].sets[0] ?? 0,
        mainEcho: false,
        mainStats: {
          primary: { key: 'hpPercent', value: 22.8 },
          secondary: { ...ECHO_SIDE_STATS[1] },
        },
        substats: {},
      },
    ]

    const buildB = [buildA[1], buildA[0]]

    expect(mkEchoMainSt(buildA)).toBe(mkEchoMainSt(buildB))
  })

})
