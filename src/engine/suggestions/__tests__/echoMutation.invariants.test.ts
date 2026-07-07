/*
  Author: Runor Ewhro
  Description: verifies echo mutation helpers used by random suggestions,
               including main-stat narrowing, set-plan feasibility, loadout
               hashing, and pinned main echo behavior.
*/

import { describe, expect, it } from 'vitest'
import { makeEchoUid } from '@/domain/entities/runtime'
import { listChsByCos } from '@/domain/services/echoCatalogService'
import { ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import {
  applyMainSur,
  mkEchoMainSt,
  mkMainStatPt,
  mkRandEchoLd,
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

  it('pins the selected main echo and set plan into random loadouts', () => {
    // random loadout generation still has hard constraints: requested main echo
    // and set preferences must be satisfied before free slots are filled
    const costThreeEchoes = listChsByCos(3)
    const setId = costThreeEchoes.find((echo) => (
      costThreeEchoes.filter((candidate) => candidate.sets.includes(echo.sets[0] ?? -1)).length >= 2
    ))?.sets[0]

    expect(setId).toBeTruthy()
    if (!setId) {
      return
    }

    const mainEcho = costThreeEchoes.find((echo) => echo.sets.includes(setId))
    expect(mainEcho).toBeTruthy()
    if (!mainEcho) {
      return
    }

    const loadout = mkRandEchoLd({
      costPlan: [3, 3, 1, 1, 1],
      weights: { atkPercent: 1, critRate: 1, critDmg: 1 },
      mainStatCnfg: {
        allowedFilter: new Set(),
        selBonus: null,
      },
      bias: 0.5,
      tgtNrgyRgn: 0,
      rollQuality: 0.3,
      mainEchoId: mainEcho.id,
      setPrefs: [{ setId, count: 2 }],
      fxdPrmrKeys: ['atkPercent', 'critRate', 'atkPercent', 'atkPercent', 'atkPercent'],
    })

    expect(loadout[0]?.id).toBe(mainEcho.id)
    expect(loadout[0]?.set).toBe(setId)
    expect(loadout[1]?.set).toBe(setId)
  })
})
