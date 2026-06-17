import { describe, expect, it } from 'vitest'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService.ts'
import { ECHO_MAIN_STATS, SUBSTAT_KEYS, getSbstStepP } from '@/data/gameData/catalog/echoStats.ts'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects.ts'
import {
  QUICK_COSTS,
  canMainEchoFitSetPlan,
  fitQuickConfig,
  generateQuickBuild,
  makeQuickConfig,
  maxSubCount,
  normSetPlan,
  setCountOptions,
  setSubCount,
  type SetPreference,
  type QuickSetupConfig,
} from '@/modules/calculator/features/echoes/lib/quickSetup.ts'
import { mkDefEchoNst } from '@/modules/calculator/features/echoes/lib/echoPane.ts'

type EchoShape = {
  id: string
  cost: number
  sets: number[]
}

type CostLayoutEntry = {
  costs: number[]
  weight: number
}

function allSetPlans(maxPieces: number): SetPreference[][] {
  const plans: SetPreference[][] = [[]]

  function walk(startIndex: number, current: SetPreference[], usedPieces: number) {
    if (current.length >= 3) {
      return
    }

    for (let setIndex = startIndex; setIndex < ECHO_SET_DEFS.length; setIndex += 1) {
      const set = ECHO_SET_DEFS[setIndex]
      for (const count of setCountOptions(set.id, maxPieces - usedPieces)) {
        const next = [...current, { setId: set.id, count }]
        plans.push(next)
        walk(setIndex + 1, next, usedPieces + count)
      }
    }
  }

  walk(0, [], 0)
  return plans
}

const SETS_BY_COST = (() => {
  const map = new Map<number, Set<number>>()
  for (const echo of listEchoes()) {
    const sets = map.get(echo.cost) ?? new Set<number>()
    echo.sets.forEach((setId) => sets.add(setId))
    map.set(echo.cost, sets)
  }
  return map
})()

function costLayoutEntries(echoCount: number): CostLayoutEntry[] {
  const entries = new Map<string, CostLayoutEntry>()

  function walk(current: number[]) {
    if (current.length === echoCount) {
      if (current.reduce((sum, cost) => sum + cost, 0) <= 12) {
        const layout = [current[0], ...current.slice(1).sort((left, right) => left - right)]
        const key = layout.join(',')
        const entry = entries.get(key)
        if (entry) {
          entry.weight += 1
        } else {
          entries.set(key, { costs: layout, weight: 1 })
        }
      }
      return
    }

    QUICK_COSTS.forEach((cost) => walk([...current, cost]))
  }

  walk([])
  return [...entries.values()]
}

function uniqueEchoShapes(): EchoShape[] {
  const shapes = new Map<string, EchoShape>()

  for (const echo of listEchoes()) {
    const sets = [...echo.sets].sort((left, right) => left - right)
    const key = `${echo.cost}:${sets.join(',')}`
    if (!shapes.has(key)) {
      shapes.set(key, {
        id: echo.id,
        cost: echo.cost,
        sets,
      })
    }
  }

  return [...shapes.values()]
}

function setCanUseCost(setId: number, cost: number): boolean {
  return SETS_BY_COST.get(cost)?.has(setId) ?? false
}

function oracleMainFitsPlan(
  mainEcho: EchoShape,
  setPreferences: SetPreference[],
  costs: number[],
): boolean {
  if (costs.length === 0 || mainEcho.cost !== costs[0]) {
    return false
  }

  const pieces = setPreferences.flatMap((pref) =>
    Array.from({ length: pref.count }, () => pref.setId),
  )
  const used = new Set<number>()

  function slotFits(slotIndex: number, setId: number): boolean {
    if (slotIndex === 0) {
      return mainEcho.sets.includes(setId)
    }

    return setCanUseCost(setId, costs[slotIndex])
  }

  function assign(pieceIndex: number): boolean {
    if (pieceIndex >= pieces.length) {
      return true
    }

    const setId = pieces[pieceIndex]
    for (let slotIndex = 0; slotIndex < costs.length; slotIndex += 1) {
      if (used.has(slotIndex) || !slotFits(slotIndex, setId)) {
        continue
      }

      used.add(slotIndex)
      if (assign(pieceIndex + 1)) {
        return true
      }
      used.delete(slotIndex)
    }

    return false
  }

  return assign(0)
}

function build(config: QuickSetupConfig = makeQuickConfig()) {
  const echoes = generateQuickBuild(config)
  expect(echoes).toHaveLength(5)
  return echoes
}

function totalCost(echoes: ReturnType<typeof generateQuickBuild>): number {
  return echoes.reduce((sum, echo) => sum + (echo ? (getEchoById(echo.id)?.cost ?? 0) : 0), 0)
}

function firstMainKey(cost: number): string {
  return Object.keys(ECHO_MAIN_STATS[cost] ?? {})[0] ?? 'atkPercent'
}

function catalogEcho(cost: number) {
  const echo = listEchoes().find((entry) => entry.cost === cost)
  if (!echo) {
    throw new Error(`missing cost ${cost} echo`)
  }
  return echo
}

function echoInstance(cost: number, index: number, substats: Record<string, number>): EchoInstance {
  const base = mkDefEchoNst(catalogEcho(cost).id, index, null)
  if (!base) {
    throw new Error(`missing default echo for cost ${cost}`)
  }

  return {
    ...base,
    mainStats: {
      ...base.mainStats,
      primary: {
        key: firstMainKey(cost),
        value: ECHO_MAIN_STATS[cost]?.[firstMainKey(cost)] ?? base.mainStats.primary.value,
      },
    },
    substats,
  }
}

describe('quick echo setup generator', () => {
  it('defaults empty builds to five echoes and clamps direct config to at least one', () => {
    expect(makeQuickConfig([null, null, null, null, null]).echoCount).toBe(5)
    expect(fitQuickConfig({ ...makeQuickConfig(), echoCount: 0 }).echoCount).toBe(1)
  })

  it('allows the pinned main echo to be any catalog cost', () => {
    const mainEcho = listEchoes().find((echo) => echo.cost !== 4)
    expect(mainEcho).toBeTruthy()

    const config = {
      ...makeQuickConfig(),
      mainEchoId: mainEcho?.id ?? null,
    }

    const echoes = build(config)

    expect(echoes[0]?.id).toBe(mainEcho?.id)
    expect(echoes[0]?.mainEcho).toBe(true)
    expect(totalCost(echoes)).toBeLessThanOrEqual(12)
  })

  it('uses the selected echo count and slot costs', () => {
    const config = {
      ...makeQuickConfig(),
      echoCount: 3,
      slots: [
        { cost: 4, mainStat: firstMainKey(4) },
        { cost: 3, mainStat: firstMainKey(3) },
        { cost: 1, mainStat: firstMainKey(1) },
        { cost: 1, mainStat: null },
        { cost: 1, mainStat: null },
      ],
    }

    const echoes = build(config)

    expect(echoes.slice(0, 3).every(Boolean)).toBe(true)
    expect(echoes.slice(3).every((echo) => echo == null)).toBe(true)
    expect(echoes.slice(0, 3).map((echo) => getEchoById(echo?.id ?? '')?.cost)).toEqual([4, 3, 1])
    expect(totalCost(echoes)).toBe(8)
  })

  it('applies multiple substat templates by multiplier and fills the remainder', () => {
    const [first, second] = SUBSTAT_KEYS
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()

    const firstValue = getSbstStepP(first)[0] ?? 0
    const secondValue = getSbstStepP(second)[1] ?? getSbstStepP(second)[0] ?? 0
    const config = {
      ...makeQuickConfig(),
      echoCount: 5,
      substatGroups: [
        { count: 2, substats: [{ key: first, value: firstValue }] },
        { count: 3, substats: [{ key: second, value: secondValue }] },
      ],
    }

    const echoes = build(config)

    expect(echoes.slice(0, 2).every((echo) => echo?.substats[first] === firstValue)).toBe(true)
    expect(echoes.slice(2, 5).every((echo) => echo?.substats[second] === secondValue)).toBe(true)
  })

  it('lets a substat template request a larger multiplier by splitting other templates', () => {
    const [first, second] = SUBSTAT_KEYS
    const config = {
      ...makeQuickConfig(),
      echoCount: 5,
      substatGroups: [
        { count: 3, substats: [{ key: first, value: getSbstStepP(first)[0] ?? 0 }] },
        { count: 2, substats: [{ key: second, value: getSbstStepP(second)[0] ?? 0 }] },
      ],
    }

    expect(maxSubCount(config, 1)).toBe(4)

    const next = setSubCount(config, 1, 4)

    expect(next.substatGroups.map((group) => group.count)).toEqual([1, 4])
  })

  it('initializes from the current echo build with deduped substat templates', () => {
    const [first, second] = SUBSTAT_KEYS
    const firstValue = getSbstStepP(first)[0] ?? 0
    const secondValue = getSbstStepP(second)[0] ?? 0
    const shared = { [first]: firstValue, [second]: secondValue }
    const unique = { [first]: getSbstStepP(first)[1] ?? firstValue }
    const current = [
      echoInstance(4, 0, shared),
      echoInstance(3, 1, shared),
      echoInstance(1, 2, unique),
      null,
      null,
    ]

    const config = makeQuickConfig(current)

    expect(config.echoCount).toBe(3)
    expect(config.mainEchoId).toBe(current[0]?.id)
    expect(config.slots.slice(0, 3).map((slot) => slot.cost)).toEqual([4, 3, 1])
    expect(config.slots.slice(0, 3).map((slot) => slot.mainStat)).toEqual([
      firstMainKey(4),
      firstMainKey(3),
      firstMainKey(1),
    ])
    expect(config.substatGroups.map((group) => group.count).sort()).toEqual([1, 2])
  })

  it('enumerates every Sonata preference shape the quick setup controls can express', () => {
    const outcomeCounts: Record<number, number> = {}

    for (let echoCount = 1; echoCount <= 5; echoCount += 1) {
      const plans = allSetPlans(echoCount)
      outcomeCounts[echoCount] = plans.length

      for (const plan of plans) {
        expect(normSetPlan(plan, echoCount)).toEqual(plan)
        expect(plan.length).toBeLessThanOrEqual(3)
        expect(plan.reduce((sum, pref) => sum + pref.count, 0)).toBeLessThanOrEqual(echoCount)
        for (const pref of plan) {
          expect(setCountOptions(pref.setId, echoCount)).toContain(pref.count)
        }
      }
    }

    expect(outcomeCounts).toEqual({
      1: 2,
      2: 27,
      3: 57,
      4: 362,
      5: 812,
    })
  })

  it('maps all set plan, slot cost, and main echo outcomes against an independent oracle', () => {
    const echoShapes = uniqueEchoShapes()
    const mismatches: Array<{
      echoCount: number
      costs: number[]
      mainEcho: EchoShape
      plan: SetPreference[]
      actual: boolean
      expected: boolean
    }> = []
    const outcomes = {
      checked: 0,
      valid: 0,
      invalid: 0,
    }

    for (let echoCount = 1; echoCount <= 5; echoCount += 1) {
      const plans = allSetPlans(echoCount)
      const layouts = costLayoutEntries(echoCount)

      for (const { costs, weight } of layouts) {
        const candidates = echoShapes.filter((shape) => shape.cost === costs[0])

        for (const plan of plans) {
          for (const mainEcho of candidates) {
            const expected = oracleMainFitsPlan(mainEcho, plan, costs)

            outcomes.checked += weight
            if (expected) {
              outcomes.valid += weight
            } else {
              outcomes.invalid += weight
            }
          }
        }
      }
    }

    expect(outcomes).toEqual({
      checked: 4644744,
      valid: 2042459,
      invalid: 2602285,
    })

    for (let echoCount = 1; echoCount <= 5; echoCount += 1) {
      const plans = allSetPlans(echoCount)
      const layouts = costLayoutEntries(echoCount)

      for (const { costs } of layouts) {
        const candidates = echoShapes.filter((shape) => shape.cost === costs[0])

        for (const plan of plans) {
          const validRep = candidates.find((mainEcho) => oracleMainFitsPlan(mainEcho, plan, costs))
          const invalidRep = candidates.find((mainEcho) => !oracleMainFitsPlan(mainEcho, plan, costs))

          for (const mainEcho of [validRep, invalidRep]) {
            if (!mainEcho) {
              continue
            }

            const actual = canMainEchoFitSetPlan(mainEcho.id, plan, costs)
            const expected = oracleMainFitsPlan(mainEcho, plan, costs)
            if (actual !== expected && mismatches.length < 20) {
              mismatches.push({ echoCount, costs, mainEcho, plan, actual, expected })
            }
          }
        }
      }
    }

    expect(mismatches).toEqual([])
  }, 15000)

  it('treats an invalid pinned main echo as unset during generation', () => {
    const onePc = ECHO_SET_DEFS.find((set) => set.setMax === 1)
    expect(onePc).toBeTruthy()

    const validMain = listEchoes().find((echo) => echo.sets.includes(onePc?.id ?? 0))
    expect(validMain).toBeTruthy()

    const invalidMain = listEchoes().find((echo) =>
      echo.cost === validMain?.cost &&
      !echo.sets.includes(onePc?.id ?? 0),
    )
    expect(invalidMain).toBeTruthy()

    const echoes = generateQuickBuild({
      ...makeQuickConfig(),
      echoCount: 1,
      mainEchoId: invalidMain?.id ?? null,
      setPreferences: [{ setId: onePc?.id ?? 0, count: 1 }],
      slots: [
        { cost: validMain?.cost ?? 4, mainStat: null },
        { cost: 1, mainStat: null },
        { cost: 1, mainStat: null },
        { cost: 1, mainStat: null },
        { cost: 1, mainStat: null },
      ],
    })

    expect(echoes[0]?.id).not.toBe(invalidMain?.id)
    expect(echoes[0]?.set).toBe(onePc?.id)
    expect(getEchoById(echoes[0]?.id ?? '')?.sets).toContain(onePc?.id)
  })
})
