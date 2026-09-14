/*
  Author: Runor Ewhro
  Description: Guards cost-relative primary-stat normalization while keeping
               identical substat rolls directly comparable across Echo costs.
*/

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EchoInstance } from '@/domain/entities/runtime'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import {
  cacheEchoMainStatScoreProfile,
  deactivateEchoMainStatScoreProfile,
  getEchoScoringRevision,
  getMaxEchoSc,
  getEchoScrPr,
  getEchoScrs,
  subscribeEchoScoring,
} from '@/data/scoring/echoScoring'
import {
  makeEchoMainStatProfileKey,
  prepareEchoMainStatScoring,
} from '@/data/scoring/echoMainStatProfile'
import { listChsByCos } from '@/domain/services/echoCatalogService'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { makeEnemy, makeResRuntime } from '@/domain/state/defaults'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'
import { runResSmlt } from '@/engine/pipeline'
import { runPrepMainS } from '@/engine/suggestions/mainStat-suggestion/suggestMainStat'

const AUGUSTA_ID = '1306'
const QINGXIAO_ID = '1413'

afterEach(() => {
  deactivateEchoMainStatScoreProfile(AUGUSTA_ID)
  deactivateEchoMainStatScoreProfile(QINGXIAO_ID)
})

function makeEcho(cost: number, primaryKey: string): EchoInstance {
  const definition = listChsByCos(cost)[0]
  if (!definition) throw new Error(`Missing ${cost}-cost Echo fixture.`)

  return {
    uid: `cost-relative-${cost}`,
    id: definition.id,
    set: definition.sets[0] ?? 0,
    mainEcho: cost === 4,
    mainStats: {
      primary: {
        key: primaryKey,
        value: ECHO_MAIN_STATS[cost]?.[primaryKey] ?? 0,
      },
      secondary: { ...ECHO_SIDE_STATS[cost] },
    },
    substats: {
      atkFlat: 60,
      atkPercent: 11.6,
      critDmg: 21,
      critRate: 10.5,
      heavyAtk: 11.6,
    },
  }
}

describe('Echo scoring invariants', () => {
  it('gives preferred mains equal value across Echo costs', () => {
    const atkEcho = makeEcho(1, 'atkPercent')
    const critEcho = makeEcho(4, 'critDmg')

    expect(getEchoScrs(AUGUSTA_ID, atkEcho).mainScore).toBeCloseTo(44, 8)
    expect(getEchoScrs(AUGUSTA_ID, critEcho).mainScore).toBeCloseTo(44, 8)
    expect(getEchoScrPr(AUGUSTA_ID, atkEcho)).toBeCloseTo(
      getEchoScrPr(AUGUSTA_ID, critEcho),
      8,
    )
  })

  it('uses a cached simulation profile for cost-relative main scoring', () => {
    cacheEchoMainStatScoreProfile({
      cacheKey: 'echo-score-context',
      charId: AUGUSTA_ID,
      weightsByCost: {
        4: {
          atkPercent: 0.25,
          critDmg: 1,
          critRate: 0.5,
        },
      },
      bestByCost: { 4: ['atkPercent', 'critDmg'] },
    })

    expect(getEchoScrs(AUGUSTA_ID, makeEcho(4, 'critDmg')).mainScore).toBeCloseTo(44, 8)
    expect(getEchoScrs(AUGUSTA_ID, makeEcho(4, 'atkPercent')).mainScore).toBeCloseTo(44, 8)
    expect(getEchoScrs(AUGUSTA_ID, makeEcho(4, 'critRate')).mainScore).toBeCloseTo(22, 8)
  })

  it('gives Qingxiao full credit for the selected Aero main', () => {
    cacheEchoMainStatScoreProfile({
      cacheKey: 'echo-score-qingxiao-aero',
      charId: QINGXIAO_ID,
      weightsByCost: {
        3: {
          aero: 0.9355725877,
          atkPercent: 1,
        },
      },
      bestByCost: { 3: ['aero', 'atkPercent'] },
    })

    const echo = makeEcho(3, 'aero')
    expect(getEchoScrs(QINGXIAO_ID, echo).mainScore).toBeCloseTo(44, 8)
    expect(getEchoScrPr(QINGXIAO_ID, echo)).toBeCloseTo(100, 8)
  })

  it('keeps damage-substat scoring on the static generated weights', () => {
    const echo = makeEcho(3, 'atkPercent')
    echo.substats = {
      atkPercent: 6.4,
      hpPercent: 6.4,
    }
    const staticScore = getEchoScrs(AUGUSTA_ID, echo).subScore

    cacheEchoMainStatScoreProfile({
      cacheKey: 'echo-score-static-substats',
      charId: AUGUSTA_ID,
      weightsByCost: { 3: { atkPercent: 0.8, electro: 1 } },
      bestByCost: { 3: ['electro'] },
    })

    expect(getEchoScrs(AUGUSTA_ID, echo).subScore).toBeCloseTo(staticScore, 8)
  })

  it('omits utility stats from both earned and possible Echo score', () => {
    const echo = makeEcho(1, 'atkPercent')
    echo.substats = {
      critDmg: 21,
      critRate: 10.5,
      atkPercent: 11.6,
      heavyAtk: 11.6,
      energyRegen: 12.4,
    }
    const withoutEr = structuredClone(echo)
    delete withoutEr.substats.energyRegen

    expect(getEchoScrs(AUGUSTA_ID, echo).subScore).toBeCloseTo(
      getEchoScrs(AUGUSTA_ID, withoutEr).subScore,
      8,
    )
    expect(getMaxEchoSc(AUGUSTA_ID, echo)).toBeLessThan(getMaxEchoSc(AUGUSTA_ID))
    expect(getEchoScrPr(AUGUSTA_ID, echo)).toBeCloseTo(100, 8)

    const healingMain = makeEcho(4, 'healingBonus')
    const damageMain = makeEcho(4, 'critDmg')
    expect(getEchoScrs(AUGUSTA_ID, healingMain).mainScore).toBe(0)
    expect(getMaxEchoSc(AUGUSTA_ID, healingMain)).toBeCloseTo(
      getMaxEchoSc(AUGUSTA_ID, damageMain) - 44,
      8,
    )
  })

  it('notifies mounted score displays when a profile becomes active', () => {
    const listener = vi.fn()
    const before = getEchoScoringRevision(AUGUSTA_ID)
    const unsubscribe = subscribeEchoScoring(AUGUSTA_ID, listener)

    cacheEchoMainStatScoreProfile({
      cacheKey: 'echo-score-notification',
      charId: AUGUSTA_ID,
      weightsByCost: { 4: { critDmg: 1 } },
      bestByCost: { 4: ['critDmg'] },
    })

    expect(getEchoScoringRevision(AUGUSTA_ID)).toBe(before + 1)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('keys the profile by the Echo and combat inputs used by suggestions', () => {
    const seed = getResSeedBy(AUGUSTA_ID)
    if (!seed) throw new Error('Missing Augusta fixture.')

    const runtime = makeResRuntime(seed)
    runtime.build.echoes = [makeEcho(4, 'critDmg'), makeEcho(1, 'atkPercent')]
    const edited = structuredClone(runtime)
    const editedEcho = edited.build.echoes[0]
    if (!editedEcho) throw new Error('Missing edited Echo fixture.')

    const sameCostDefinition = listChsByCos(4)[1] ?? listChsByCos(4)[0]
    editedEcho.id = sameCostDefinition.id
    editedEcho.set = sameCostDefinition.sets.at(-1) ?? 0
    editedEcho.mainStats.primary = {
      key: 'critRate',
      value: ECHO_MAIN_STATS[4].critRate,
    }
    editedEcho.substats = { hpFlat: 580 }
    edited.state.controls['echo:changed:main:stacks'] = 3
    edited.state.controls['echoSet:changed:enabled'] = true

    const baseInput = {
      scenarioId: combatScenarioId('echo-score:test'),
      memberId: teamMemberId('echo-score:member'),
      seed,
      enemy: makeEnemy(),
      selectedTargets: {},
    }
    const originalKey = makeEchoMainStatProfileKey({
      ...baseInput,
      runtime,
      runtimesById: { [runtime.id]: runtime },
    })
    const editedKey = makeEchoMainStatProfileKey({
      ...baseInput,
      runtime: edited,
      runtimesById: { [edited.id]: edited },
    })

    expect(editedKey).not.toBe(originalKey)

    const changedCost = structuredClone(edited)
    const changedEcho = changedCost.build.echoes[0]
    if (!changedEcho) throw new Error('Missing cost-change Echo fixture.')
    changedEcho.id = listChsByCos(3)[0].id

    expect(makeEchoMainStatProfileKey({
      ...baseInput,
      runtime: changedCost,
      runtimesById: { [changedCost.id]: changedCost },
    })).not.toBe(originalKey)

  })

  it('uses the Main Stat Suggestions winner and gives its mains full score', async () => {
    const seed = getResSeedBy(AUGUSTA_ID)
    if (!seed) throw new Error('Missing Augusta fixture.')

    const enemy = makeEnemy()
    const runtime = makeResRuntime(seed)
    runtime.build.echoes = [
      makeEcho(4, 'critRate'),
      makeEcho(3, 'electro'),
      makeEcho(3, 'atkPercent'),
      makeEcho(1, 'atkPercent'),
      makeEcho(1, 'atkPercent'),
    ]
    const runtimesById = makeRuntimeMap(runtime, {})
    const simulation = runResSmlt(runtime, seed, enemy, runtimesById, {})
    const listener = vi.fn()
    const unsubscribe = subscribeEchoScoring(AUGUSTA_ID, listener)

    await expect(prepareEchoMainStatScoring({
      scenarioId: combatScenarioId('echo-score:search'),
      memberId: teamMemberId('echo-score:member'),
      runtime,
      seed,
      enemy,
      runtimesById,
      selectedTargets: {},
      simulation,
    }, async (payload) => runPrepMainS(payload))).resolves.not.toBeNull()
    expect(listener).toHaveBeenCalled()
    unsubscribe()

    for (const cost of [1, 3, 4]) {
      const bestScore = Math.max(
        ...Object.keys(ECHO_MAIN_STATS[cost]).map((key) => (
          getEchoScrs(AUGUSTA_ID, makeEcho(cost, key)).mainScore
        )),
      )
      expect(bestScore).toBeCloseTo(44, 8)
    }

    // Every main selected by the optimal 4-3-3-1-1 layout receives full
    // item-quality credit, even when its isolated marginal value is lower.
    expect(getEchoScrs(AUGUSTA_ID, makeEcho(3, 'electro')).mainScore).toBeCloseTo(44, 8)
  })
})
