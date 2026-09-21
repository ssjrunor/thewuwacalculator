/*
  Author: Runor Ewhro
  Description: Guards cost-relative primary-stat normalization while keeping
               identical substat rolls directly comparable across Echo costs.
*/

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EchoInstance } from '@/domain/entities/runtime'
import {
  ECHO_MAIN_STATS,
  ECHO_SIDE_STATS,
  SUBSTAT_RANGES,
} from '@/data/gameData/catalog/echoStats'
import {
  cacheEchoMainStatScoreProfile,
  deactivateEchoMainStatScoreProfile,
  getEchoLoadoutScores,
  getEchoScoringRevision,
  getEchoScoringReference,
  getMaxEchoSc,
  getMkScrPrcn,
  getEchoScrPr,
  getEchoScrs,
  subscribeEchoScoring,
} from '@/engine/evaluation/echoScoring'
import {
  makeEchoMainStatProfileKey,
  prepareEchoMainStatScoring,
} from '@/engine/evaluation/echoMainStatProfile'
import { listChsByCos } from '@/data/catalog/echoCatalogService'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, makeResRuntime, mkMaxResRt } from '@/engine/runtime/defaults'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'
import { runResSmlt } from '@/engine/pipeline'
import { runPrepMainS } from '@/engine/suggestions/mainStat-suggestion/suggestMainStat'

const AUGUSTA_ID = '1306'
const QINGXIAO_ID = '1413'
const AEMEATH_ID = '1210'
const JINGRAN_ID = '1212'

afterEach(() => {
  deactivateEchoMainStatScoreProfile(AUGUSTA_ID)
  deactivateEchoMainStatScoreProfile(QINGXIAO_ID)
  deactivateEchoMainStatScoreProfile(AEMEATH_ID)
  deactivateEchoMainStatScoreProfile(JINGRAN_ID)
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

  it('normalizes character-specific substat ceilings before adding main-stat points', () => {
    const jingranBestRoll = makeEcho(4, 'healingBonus')
    jingranBestRoll.substats = { critRate: SUBSTAT_RANGES.critRate.max }
    const aemeathBestRoll = makeEcho(4, 'healingBonus')
    aemeathBestRoll.substats = { critDmg: SUBSTAT_RANGES.critDmg.max }

    expect(getEchoScrs(JINGRAN_ID, jingranBestRoll).subScore).toBeCloseTo(
      SUBSTAT_RANGES.critDmg.max,
      8,
    )
    expect(getEchoScrs(AEMEATH_ID, aemeathBestRoll).subScore).toBeCloseTo(
      SUBSTAT_RANGES.critDmg.max,
      8,
    )

    cacheEchoMainStatScoreProfile({
      cacheKey: 'echo-score-jingran-main',
      charId: JINGRAN_ID,
      weightsByCost: { 4: { critDmg: 1 } },
      bestByCost: { 4: ['critDmg'] },
    })
    cacheEchoMainStatScoreProfile({
      cacheKey: 'echo-score-aemeath-main',
      charId: AEMEATH_ID,
      weightsByCost: { 4: { critDmg: 1 } },
      bestByCost: { 4: ['critDmg'] },
    })

    const jingranEcho = makeEcho(4, 'critDmg')
    jingranEcho.substats = {
      critDmg: 13.8,
      hpPercent: 7.9,
      energyRegen: 7.6,
      heavyAtk: 7.1,
      critRate: 6.9,
    }
    const aemeathEcho = makeEcho(4, 'critDmg')
    aemeathEcho.substats = {
      critDmg: 13.8,
      energyRegen: 7.6,
      atkPercent: 7.1,
      resonanceLiberation: 7.1,
      critRate: 6.9,
    }

    expect(getEchoScrPr(JINGRAN_ID, jingranEcho)).toBeCloseTo(79.3157433, 6)
    expect(getEchoScrPr(AEMEATH_ID, aemeathEcho)).toBeCloseTo(78.107284, 6)
  })

  it('uses one attainable five-Echo reference and does not reward redundant HP', () => {
    cacheEchoMainStatScoreProfile({
      cacheKey: 'echo-score-five-echo-reference',
      charId: JINGRAN_ID,
      weightsByCost: {
        4: { critDmg: 1 },
        3: { fusion: 1 },
        1: { hpPercent: 1 },
      },
      bestByCost: {
        4: ['critDmg'],
        3: ['fusion'],
        1: ['hpPercent'],
      },
      mainCountsByCost: {
        4: { critDmg: 1 },
        3: { fusion: 2 },
        1: { hpPercent: 2 },
      },
      idealSubstatCounts: {
        critRate: 5,
        critDmg: 5,
        resonanceLiberation: 5,
        basicAtk: 5,
        heavyAtk: 4,
        hpPercent: 1,
      },
    })

    const mains = [
      [4, 'critDmg'],
      [3, 'fusion'],
      [3, 'fusion'],
      [1, 'hpPercent'],
      [1, 'hpPercent'],
    ] as const
    const reference = mains.map(([cost, main], index) => {
      const echo = makeEcho(cost, main)
      echo.uid = `reference-${index}`
      echo.substats = {
        critRate: SUBSTAT_RANGES.critRate.max,
        critDmg: SUBSTAT_RANGES.critDmg.max,
        resonanceLiberation: SUBSTAT_RANGES.resonanceLiberation.max,
        basicAtk: SUBSTAT_RANGES.basicAtk.max,
        [index === 0 ? 'hpPercent' : 'heavyAtk']:
          SUBSTAT_RANGES[index === 0 ? 'hpPercent' : 'heavyAtk'].max,
      }
      return echo
    })

    for (const score of getEchoLoadoutScores(JINGRAN_ID, reference)) {
      expect(score).toBeCloseTo(100, 8)
    }
    expect(getMkScrPrcn(JINGRAN_ID, reference)).toBeCloseTo(100, 8)

    const reversedScores = getEchoLoadoutScores(JINGRAN_ID, [...reference].reverse())
    expect(Object.fromEntries([...reference].reverse().map((echo, index) => [
      echo.uid,
      reversedScores[index],
    ]))).toEqual(Object.fromEntries(reference.map((echo) => [echo.uid, 100])))

    const redundantHp = structuredClone(reference)
    delete redundantHp[1].substats.heavyAtk
    redundantHp[1].substats.hpPercent = SUBSTAT_RANGES.hpPercent.max
    expect(getEchoLoadoutScores(JINGRAN_ID, redundantHp).some((score) => (
      score != null && score < 100
    ))).toBe(true)
    expect(getMkScrPrcn(JINGRAN_ID, redundantHp)).toBeLessThan(100)

    const splitHp = structuredClone(reference)
    splitHp[0].substats.hpPercent = SUBSTAT_RANGES.hpPercent.max / 2
    delete splitHp[1].substats.heavyAtk
    splitHp[1].substats.hpPercent = SUBSTAT_RANGES.hpPercent.max / 2
    const splitScores = getEchoLoadoutScores(JINGRAN_ID, splitHp)
    expect(splitScores[0]).toBeCloseTo(splitScores[1] ?? 0, 8)
    expect(splitScores[0]).toBeGreaterThan(90)
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
    const rollEdited = structuredClone(runtime)
    const rollEditedEcho = rollEdited.build.echoes[0]
    if (!rollEditedEcho) throw new Error('Missing roll-edited Echo fixture.')
    rollEditedEcho.substats = { hpFlat: 580 }

    expect(makeEchoMainStatProfileKey({
      ...baseInput,
      runtime: rollEdited,
      runtimesById: { [rollEdited.id]: rollEdited },
    })).toBe(originalKey)

    const mainEdited = structuredClone(rollEdited)
    const mainEditedEcho = mainEdited.build.echoes[0]
    if (!mainEditedEcho) throw new Error('Missing main-edited Echo fixture.')
    mainEditedEcho.mainStats.primary = {
      key: 'critRate',
      value: ECHO_MAIN_STATS[4].critRate,
    }

    expect(makeEchoMainStatProfileKey({
      ...baseInput,
      runtime: mainEdited,
      runtimesById: { [mainEdited.id]: mainEdited },
    })).not.toBe(originalKey)

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

  it('builds Jingran a cap-aware 25-roll reference', async () => {
    const seed = getResSeedBy(JINGRAN_ID)
    if (!seed) throw new Error('Missing Jingran fixture.')

    const enemy = makeEnemy()
    const runtime = mkMaxResRt(seed)
    const mainLayout = [
      [4, 'critDmg'],
      [1, 'hpPercent'],
      [1, 'hpPercent'],
      [1, 'atkPercent'],
      [4, 'critDmg'],
    ] as const
    const costOffsets = new Map<number, number>()
    runtime.build.echoes = mainLayout.map(([cost, main], index) => {
      const echo = makeEcho(cost, main)
      const offset = costOffsets.get(cost) ?? 0
      const definition = listChsByCos(cost)[offset]
      if (!definition) throw new Error(`Missing distinct ${cost}-cost Echo fixture.`)
      costOffsets.set(cost, offset + 1)
      echo.uid = `jingran-main-layout-${index}`
      echo.id = definition.id
      echo.set = definition.sets[0] ?? 0
      echo.mainEcho = index === 0
      echo.substats = {}
      return echo
    })
    const runtimesById = makeRuntimeMap(runtime, {})
    const simulation = runResSmlt(runtime, seed, enemy, runtimesById, {})

    await prepareEchoMainStatScoring({
      scenarioId: combatScenarioId('echo-score:jingran-reference'),
      memberId: teamMemberId('echo-score:jingran-member'),
      runtime,
      seed,
      enemy,
      runtimesById,
      selectedTargets: {},
      simulation,
    }, async (payload) => runPrepMainS(payload))

    const reference = getEchoScoringReference(JINGRAN_ID)
    expect(reference).not.toBeNull()
    expect(Object.values(reference?.idealSubstatCounts ?? {}).reduce(
      (sum, count) => sum + count,
      0,
    )).toBe(25)
    expect((reference?.idealSubstatCounts.hpPercent ?? 0)
      + (reference?.idealSubstatCounts.hpFlat ?? 0)).toBeGreaterThan(0)
    const hpPercentCount = reference?.idealSubstatCounts.hpPercent ?? 0
    expect(reference?.idealSubstatValues.hpPercent ?? 0).toBeLessThan(
      hpPercentCount * SUBSTAT_RANGES.hpPercent.max,
    )

    const hpValues = [7.9, 7.9, 7.9, 8.6, 8.6]
    const hpLoadout = (reference?.referenceEchoes ?? []).map((echo, index) => ({
      ...echo,
      uid: `jingran-hp-credit-${index}`,
      mainStats: {
        primary: { ...echo.mainStats.primary },
        secondary: { ...echo.mainStats.secondary },
      },
      substats: { hpPercent: hpValues[index] },
    }))
    const noHpLoadout = hpLoadout.map((echo) => ({ ...echo, substats: {} }))
    const hpScores = getEchoLoadoutScores(JINGRAN_ID, hpLoadout)
    const noHpScores = getEchoLoadoutScores(JINGRAN_ID, noHpLoadout)
    for (let index = 0; index < hpLoadout.length; index += 1) {
      expect(hpScores[index] ?? 0).toBeGreaterThan(noHpScores[index] ?? 0)
    }

    const referenceRuntime = structuredClone(runtime)
    referenceRuntime.build.echoes = (reference?.referenceEchoes ?? []).map((echo, index) => ({
      ...echo,
      uid: `jingran-reference-${index}`,
      mainStats: {
        primary: { ...echo.mainStats.primary },
        secondary: { ...echo.mainStats.secondary },
      },
      substats: { ...echo.substats },
    }))
    expect(referenceRuntime.build.echoes).toHaveLength(5)
    expect(referenceRuntime.build.echoes.every((echo) => (
      echo != null && Object.keys(echo.substats).length === 5
    ))).toBe(true)
    for (const score of getEchoLoadoutScores(JINGRAN_ID, referenceRuntime.build.echoes)) {
      expect(score).toBeCloseTo(100, 8)
    }
    expect(getMkScrPrcn(JINGRAN_ID, referenceRuntime.build.echoes)).toBeCloseTo(100, 8)

    // Once the family's useful target is covered, adding more HP can only
    // redistribute credit among pieces, never increase total earned points.
    const capLoadout = hpLoadout.map((echo) => ({
      ...echo,
      substats: { hpPercent: (reference?.idealSubstatValues.hpPercent ?? 0) / 5 },
    }))
    const excessLoadout = capLoadout.map((echo) => ({
      ...echo,
      substats: { hpPercent: SUBSTAT_RANGES.hpPercent.max },
    }))
    expect(getMkScrPrcn(JINGRAN_ID, excessLoadout)).toBeCloseTo(
      getMkScrPrcn(JINGRAN_ID, capLoadout),
      8,
    )
    const referenceRuntimes = makeRuntimeMap(referenceRuntime, {})
    const referenceSimulation = runResSmlt(
      referenceRuntime,
      seed,
      enemy,
      referenceRuntimes,
      {},
    )
    expect(referenceSimulation.finalStats.hp.final).toBeGreaterThanOrEqual(49_000)
    expect(referenceSimulation.finalStats.hp.final).toBeLessThanOrEqual(51_200)
  })
})
