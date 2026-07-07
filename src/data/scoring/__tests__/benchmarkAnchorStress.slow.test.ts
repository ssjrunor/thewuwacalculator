/*
  Author: Runor Ewhro
  Description: opt-in long stress test for benchmark anchor stability across
               randomized normal echo builds.
*/

import { describe, expect, it } from 'vitest'
import { listEchoes } from '@/domain/services/echoCatalogService'
import { getResSeedBy, listResSds } from '@/domain/services/resonatorSeedService'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { makeResRuntime } from '@/domain/state/defaults'
import { maxResRt } from '@/domain/gameData/resonatorMax'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import type { EchoDef } from '@/domain/entities/catalog'
import type { EchoInstance, ResRuntime, ResSeed } from '@/domain/entities/runtime'
import { runResSmlt } from '@/engine/pipeline'
import { mkSuggVltnCt } from '@/engine/suggestions/shared'
import type { SuggestContext } from '@/engine/suggestions/types'
import { mkCostPlns } from '@/engine/suggestions/randomEchoes/lib/combinations'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS, SUBSTAT_KEYS, getSbstStepP } from '@/data/gameData/catalog/echoStats'
import { ignoresEr } from '@/data/scoring/energyRegenPolicy'
import { SET_RULES, benchSetConds } from '@/data/scoring/setStatePolicy'
import {
  assembleBenchmark,
  benchmarkErTarget,
  buildBenchmarkAnchors,
  type BenchmarkAnchors,
} from '@/data/scoring/benchmark/search.ts'
import {
  hasNonSelfMainEchoBuff,
  preservedMainEchoFor,
  utilityPlanFor,
} from '@/data/scoring/benchmark/echoDiscovery.ts'
import type { BenchmarkBuildSnapshot } from '@/data/scoring/benchmark/types.ts'
import { isUtilitySet } from '@/domain/gameData/sonataPlan'
import { applyBenchAsm, BENCH_ENEMY } from '@/modules/calculator/model/benchmarkAssumptions'

type Rng = () => number

const TEST_ENV = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}).process?.env ?? {}
const RUN_STRESS = TEST_ENV.WUWA_BENCHMARK_STRESS === '1'
const SCENARIOS_PER_RESONATOR = 20
const BASE_RESONATORS = ['1209', '1306', '1309'] as const
const SEQUENCE_BY_RESONATOR: Record<string, number> = {
  '1209': 0,
  '1306': 6,
  '1309': 6,
}
const TEST_TIMEOUT_MS = 20 * 60 * 1000
const NON_ER_SUBSTATS = () => SUBSTAT_KEYS.filter((key) => key !== 'energyRegen')

function mulberry32(seed: number): Rng {
  // deterministic pseudo-randomness gives broad scenario coverage while keeping
  // stress failures reproducible from the resonator id and scenario index
  let value = seed >>> 0
  return () => {
    value += 0x6D2B79F5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: Rng, values: readonly T[]): T {
  if (values.length === 0) {
    throw new Error('Cannot pick from an empty list')
  }

  return values[Math.floor(rng() * values.length)]
}

function shuffle<T>(rng: Rng, values: readonly T[]): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1))
    const next = result[index]
    result[index] = result[swapIndex]
    result[swapIndex] = next
  }
  return result
}

function round(value: number, places = 4): number {
  return Number(value.toFixed(places))
}

function legalSetIds(resonatorId: string): number[] {
  // stress inputs avoid utility sets and resonators without benchmark set rules
  // so anchor stability is measured on normal damage-build search space only
  return [
    ...new Set((SET_RULES[resonatorId]?.sets ?? [])
      .filter((setId) => setId > 0 && !isUtilitySet(setId))),
  ]
}

function eligibleRandomResonators(): string[] {
  const fixed = new Set<string>(BASE_RESONATORS)
  return listResSds()
    .map((seed) => seed.id)
    .filter((id) =>
      !fixed.has(id)
      && !ignoresEr(id)
      && legalSetIds(id).length > 0
    )
}

function stressRoster(): string[] {
  return [
    ...BASE_RESONATORS,
    ...shuffle(mulberry32(0xC0FFEE), eligibleRandomResonators()).slice(0, 2),
  ]
}

function maxedRuntime(seed: ResSeed, sequence: number): ResRuntime {
  const runtime = applyBenchAsm(makeResRuntime(seed))
  const maxed = maxResRt(runtime, getResDtlsBy()[seed.id], { targetSequence: sequence })
  return applyBenchAsm(maxed)
}

function echoPool(cost: number, setId: number, mainEcho: boolean): EchoDef[] {
  return listEchoes()
    .filter((echo) =>
      echo.cost === cost
      && echo.sets.includes(setId)
      && !echo.sets.some(isUtilitySet)
      && (!mainEcho || !hasNonSelfMainEchoBuff(echo.id)),
    )
}

function randomPrimary(rng: Rng, cost: number): { key: string; value: number } {
  const entries = Object.entries(ECHO_MAIN_STATS[cost] ?? {})
    .filter(([key]) => key !== 'energyRegen')
  const [key, value] = pick(rng, entries)
  return { key, value }
}

function randomSubstats(rng: Rng): Record<string, number> {
  const result: Record<string, number> = {}
  for (const key of shuffle(rng, NON_ER_SUBSTATS()).slice(0, 5)) {
    const steps = getSbstStepP(key)
    result[key] = pick(rng, steps)
  }
  return result
}

function randomEchoes(resonatorId: string, scenarioIndex: number): Array<EchoInstance | null> {
  // randomized builds vary cost plan, set, main stat, and substats, but exclude
  // energy regen so the expected anchor input stays intentionally constant
  const rng = mulberry32(0x51A7E000 ^ Number(resonatorId) ^ scenarioIndex)
  const setIds = legalSetIds(resonatorId)
  const costPlan = pick(rng, mkCostPlns())

  return costPlan.map((cost, slot) => {
    const mainEcho = slot === 0
    const setId = pick(rng, setIds)
    const pool = echoPool(cost, setId, mainEcho)
    const echo = pick(rng, pool)
    const primary = randomPrimary(rng, cost)

    return {
      uid: `stress-${resonatorId}-${scenarioIndex}-${slot}`,
      id: echo.id,
      set: setId,
      mainEcho,
      mainStats: {
        primary,
        secondary: { ...ECHO_SIDE_STATS[cost] },
      },
      substats: randomSubstats(rng),
    }
  })
}

function buildContext(seed: ResSeed, runtime: ResRuntime): SuggestContext {
  // stress scoring uses rotation-mode context with benchmark assumptions applied
  // so exhaustive anchors match the app's default benchmark report path
  const runtimesById = makeRuntimeMap(runtime)
  const simulation = runResSmlt(runtime, seed, BENCH_ENEMY, runtimesById, {})
  const context = mkSuggVltnCt({
    runtime,
    seed,
    enemy: BENCH_ENEMY,
    runtimesById,
    selectedTargets: {},
    setConds: benchSetConds(runtime.id),
    setStateMode: 'resolved',
    tgtFeatId: null,
    rotationMode: true,
  }, simulation)

  if (!context) {
    throw new Error(`No benchmark context for ${runtime.id}`)
  }

  return context
}

function buildSignature(build: BenchmarkBuildSnapshot) {
  return {
    damage: round(build.damage, 2),
    score: round(build.score, 4),
    sets: build.sets.map((set) => `${set.setId}:${set.pieces}`).sort(),
    mainEcho: build.echoes.find((echo) => echo.mainEcho)?.echoId ?? null,
    costs: build.echoes.map((echo) => echo.cost).sort((left, right) => left - right),
    stats: build.statRows
      .filter((row) => row.total !== 0 || row.substatCount !== 0 || row.mainCount !== 0)
      .map((row) => [
        row.key,
        round(row.mainCount, 4),
        round(row.substatCount, 4),
        round(row.total, 4),
      ].join(':'))
      .sort(),
  }
}

function anchorSignature(anchors: BenchmarkAnchors) {
  return {
    baselineDamage: round(anchors.baselineDamage, 2),
    benchmarkDamage: round(anchors.benchmarkDamage, 2),
    perfectionDamage: round(anchors.perfectionDamage, 2),
    baseline0: buildSignature(anchors.builds.baseline0),
    benchmark100: buildSignature(anchors.builds.benchmark100),
    benchmark200: buildSignature(anchors.builds.benchmark200),
  }
}

function anchorInputSignature(ctx: SuggestContext, equipped: Array<EchoInstance | null>) {
  // if these inputs change, anchor differences may be legitimate; keeping them
  // fixed lets the test isolate accidental anchor drift
  return {
    targetEr: round(benchmarkErTarget(ctx, equipped), 4),
    utility: utilityPlanFor(equipped)
      .map((entry) => `${entry.setId}:${entry.pieces}`)
      .sort(),
    mainEcho: preservedMainEchoFor(equipped)?.id ?? null,
  }
}

function expectStableAnchors(resonatorId: string): void {
  // only the first and final scenario rebuild anchors; all middle scenarios use
  // the cached reference to prove scoring remains valid across randomized builds
  const seed = getResSeedBy(resonatorId)
  if (!seed) {
    throw new Error(`Missing stress seed ${resonatorId}`)
  }

  const sequence = SEQUENCE_BY_RESONATOR[resonatorId] ?? 6
  let reference: ReturnType<typeof anchorSignature> | null = null
  let referenceAnchors: BenchmarkAnchors | null = null
  let referenceInput: ReturnType<typeof anchorInputSignature> | null = null
  let checked = 0

  for (let scenario = 0; scenario < SCENARIOS_PER_RESONATOR; scenario += 1) {
    const runtime = maxedRuntime(seed, sequence)
    runtime.build.echoes = randomEchoes(resonatorId, scenario)

    const context = buildContext(seed, runtime)
    const equipped = runtime.build.echoes
    const inputSignature = anchorInputSignature(context, equipped)
    expect(inputSignature.targetEr).toBe(0)
    expect(inputSignature.utility).toEqual([])
    expect(inputSignature.mainEcho).toBeNull()

    if (!referenceInput) {
      referenceInput = inputSignature
    } else {
      expect(inputSignature).toEqual(referenceInput)
    }

    if (!referenceAnchors || scenario === SCENARIOS_PER_RESONATOR - 1) {
      const anchors = buildBenchmarkAnchors(context, equipped)
      if (!anchors) {
        throw new Error(`No benchmark anchors for ${resonatorId} scenario ${scenario}`)
      }

      expect(anchors.baselineDamage).toBeLessThanOrEqual(anchors.benchmarkDamage)
      expect(anchors.benchmarkDamage).toBeLessThanOrEqual(anchors.perfectionDamage)

      const signature = anchorSignature(anchors)
      if (!reference) {
        reference = signature
        referenceAnchors = anchors
      } else {
        expect(signature).toEqual(reference)
      }
    }

    if (!referenceAnchors) {
      throw new Error(`Missing reference anchors for ${resonatorId}`)
    }

    const score = assembleBenchmark(context, equipped, referenceAnchors)
    expect(Number.isFinite(score.userDamage)).toBe(true)
    expect(Number.isFinite(score.percent)).toBe(true)
    expect(score.baselineDamage).toBe(referenceAnchors.baselineDamage)
    expect(score.benchmarkDamage).toBe(referenceAnchors.benchmarkDamage)
    expect(score.perfectionDamage).toBe(referenceAnchors.perfectionDamage)
    checked += 1
  }

  expect(checked).toBe(SCENARIOS_PER_RESONATOR)
}

describe.runIf(RUN_STRESS)('benchmark anchor stress', () => {
  const roster = stressRoster()

  it('selects the fixed plus deterministic random resonator roster', () => {
    expect(roster).toHaveLength(5)
    expect(roster.slice(0, 3)).toEqual([...BASE_RESONATORS])
  })

  it.each(roster)('keeps %s anchors stable across randomized echo scenarios', (resonatorId) => {
    expectStableAnchors(resonatorId)
  }, TEST_TIMEOUT_MS)
})

describe.skipIf(RUN_STRESS)('benchmark anchor stress', () => {
  it('is opt-in because it performs 100 exhaustive benchmark searches', () => {
    expect(TEST_ENV.WUWA_BENCHMARK_STRESS).not.toBe('1')
  })
})
