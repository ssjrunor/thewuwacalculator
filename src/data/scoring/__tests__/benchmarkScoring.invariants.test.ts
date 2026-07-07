/*
  Author: Runor Ewhro
  Description: stable invariants for benchmark scoring internals: request-key
               determinism, anchor cache reuse, and persisted-fixture output
               characterization.
*/

import { describe, expect, it } from 'vitest'
import { listChsByCos } from '@/domain/services/echoCatalogService'
import { getResSeedBy, listResSds } from '@/domain/services/resonatorSeedService'
import { makeEnemy, makeResRuntime, normProfTeam } from '@/domain/state/defaults'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { matRtFromPro } from '@/domain/state/runtimeMaterialization'
import type { ResProf } from '@/domain/entities/profile'
import type { EchoInstance } from '@/domain/entities/runtime'
import { runResSmlt } from '@/engine/pipeline'
import { mkSuggVltnCt } from '@/engine/suggestions/shared'
import type { SuggestContext } from '@/engine/suggestions/types'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import { assembleBenchmark, buildBenchmark, buildBenchmarkAnchors } from '@/data/scoring/benchmark/search.ts'
import {
  getRotScore,
  rotationBuildBenchmarkReport,
  type BuildBenchmark,
} from '@/data/scoring/buildBenchmark.ts'
import { makeBenchmarkKey } from '@/data/scoring/buildBenchmarkKey'
import { applyBenchAsm, BENCH_ENEMY } from '@/modules/calculator/model/benchmarkAssumptions'

const prodAppLoaders = import.meta.glob('../../../../prod-app.json', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

const loadProdApp = prodAppLoaders['../../../../prod-app.json']
const AUGUSTA_ID = '1306'

function buildInvariantEchoes(subKey: string): Array<EchoInstance | null> {
  // anchors should be reusable across different substat layouts, so this keeps
  // cost and main-stat structure stable while swapping one rolled substat family
  const spec: Array<[number, string]> = [
    [4, 'critRate'],
    [4, 'critDmg'],
    [3, 'atkPercent'],
    [1, 'atkPercent'],
    [1, 'atkPercent'],
  ]

  return spec.map(([cost, mainKey], slot) => {
    const definition = listChsByCos(cost)[0]
    const mainVal = ECHO_MAIN_STATS[cost]?.[mainKey] ?? Object.values(ECHO_MAIN_STATS[cost] ?? {})[0] ?? 0

    return {
      uid: `cache-${cost}-${slot}`,
      id: definition.id,
      set: 0,
      mainEcho: cost === 4 && slot === 0,
      mainStats: {
        primary: { key: mainKey, value: mainVal },
        secondary: { ...ECHO_SIDE_STATS[cost] },
      },
      substats: { [subKey]: 9, atkPercent: 6 },
    } as EchoInstance
  })
}

function benchmarkContextFor(seedId: string, echoes: Array<EchoInstance | null>): SuggestContext | null {
  // benchmark anchors are built from suggestion context; the fixture therefore
  // runs the same simulation path the app uses before entering scoring helpers
  const enemy = makeEnemy()
  const seed = listResSds().find((entry) => entry.id === seedId)
  if (!seed) {
    return null
  }

  const runtime = makeResRuntime(seed)
  runtime.build.echoes = echoes
  const simulation = runResSmlt(runtime, seed, enemy, makeRuntimeMap(runtime, {}), {})

  return mkSuggVltnCt({
    runtime,
    seed,
    enemy,
    runtimesById: {},
    selectedTargets: {},
    tgtFeatId: null,
    rotationMode: false,
  }, simulation)
}

function round(value: number, places: number): number {
  return Number(value.toFixed(places))
}

function materialize(profile: ResProf) {
  // persisted fixtures are profile-shaped, not runtime-shaped, so this mirrors
  // production hydration before scoring them
  const seed = getResSeedBy(profile.resonatorId)
  if (!seed) {
    throw new Error(`missing seed ${profile.resonatorId}`)
  }

  const runtime = matRtFromPro({
    seed,
    profile,
    slotId: 'active',
    localState: profile.runtime.local,
    teamSlots: normProfTeam(profile.resonatorId, profile.runtime.team),
    rotation: profile.runtime.rotation,
  })

  return { profile, runtime, seed }
}

async function loadFixtureProfiles(): Promise<ResProf[]> {
  // local fixture coverage is optional: pull the named augusta fixture and a
  // small deterministic slice from the prod snapshot when that file exists
  const profiles: ResProf[] = []

  if (loadProdApp) {
    const snapshot = JSON.parse(await loadProdApp()) as {
      calculator: { profiles: Record<string, ResProf> }
    }
    const augusta = snapshot.calculator.profiles[AUGUSTA_ID]
    if (augusta) {
      profiles.push(augusta)
    }
    profiles.push(
      ...Object.values(snapshot.calculator.profiles)
        .filter((profile) => profile.resonatorId !== AUGUSTA_ID)
        .sort((left, right) => left.resonatorId.localeCompare(right.resonatorId))
        .slice(0, 2),
    )
  }

  return profiles
}

function buildSignature(build: BuildBenchmark['builds']['benchmark100']) {
  // signatures intentionally ignore echo uids and ordering noise, leaving only
  // the benchmark-relevant build shape and stat totals
  return {
    sets: build.sets.map((set) => `${set.setId}:${set.pieces}`).sort(),
    mainEcho: build.echoes.find((echo) => echo.mainEcho)?.echoId ?? null,
    costs: build.echoes.map((echo) => echo.cost).sort((left, right) => left - right),
    substats: build.statRows
      .filter((row) => row.substatCount > 0)
      .map((row) => `${row.key}:${round(row.substatCount, 3)}:${round(row.total, 3)}`)
      .sort(),
  }
}

function echoSlot(
  id: string,
  set: number,
  mainEcho: boolean,
  primary: EchoInstance['mainStats']['primary'],
  secondary: EchoInstance['mainStats']['secondary'],
  substats: EchoInstance['substats'] = {},
): EchoInstance {
  return {
    uid: `benchmark-main-preserve-${id}-${mainEcho ? 'main' : 'slot'}`,
    id,
    set,
    mainEcho,
    mainStats: {
      primary: { ...primary },
      secondary: { ...secondary },
    },
    substats: { ...substats },
  }
}

function fingerprint(benchmark: BuildBenchmark) {
  // numeric fields are rounded so snapshots catch meaningful benchmark drift
  // without failing on tiny floating-point serialization differences
  return {
    percent: round(benchmark.percent * 100, 4),
    grade: benchmark.grade,
    userDamage: round(benchmark.userDamage, 2),
    baselineDamage: round(benchmark.baselineDamage, 2),
    benchmarkDamage: round(benchmark.benchmarkDamage, 2),
    perfectionDamage: round(benchmark.perfectionDamage, 2),
    benchmark100: buildSignature(benchmark.builds.benchmark100),
    benchmark200: buildSignature(benchmark.builds.benchmark200),
  }
}

async function runBenchmark(profile: ResProf) {
  // report scoring and direct score scoring should agree for the same hydrated
  // input, which protects the report-only breakdown path from diverging
  const { runtime, seed } = materialize(profile)
  const enemy = makeEnemy()
  const runtimesById = makeRuntimeMap(runtime)
  const simulation = runResSmlt(
    runtime,
    seed,
    enemy,
    runtimesById,
    profile.runtime.routing.selectedTargetsByOwnerKey,
  )
  const input = { runtime, simulation, enemy, runtimesById }
  const report = rotationBuildBenchmarkReport(input)
  if (!report) {
    throw new Error(`no benchmark for ${profile.resonatorId}`)
  }

  return { input, report }
}

const norm = (value: unknown) => JSON.parse(
  JSON.stringify(value, (key, entry) => (key === 'uid' ? undefined : entry)),
)

describe('benchmark scoring invariants', () => {
  it('builds compact deterministic request keys', () => {
    const left = makeBenchmarkKey({ runtime: { id: 'fixture-a', level: 90 }, values: new Float32Array([1, 2, 3]) })
    const right = makeBenchmarkKey({ values: new Float32Array([1, 2, 3]), runtime: { level: 90, id: 'fixture-a' } })

    expect(left).toBe(right)
    expect(left.length).toBeLessThan(40)
    expect(makeBenchmarkKey({ id: 'fixture-a', level: 90 })).not.toBe(makeBenchmarkKey({ id: 'fixture-a', level: 80 }))
  })

  it('hashes typed-array views by their visible window rather than the shared backing buffer', () => {
    const shared = new Uint8Array([1, 2, 3, 4]).buffer

    expect(
      makeBenchmarkKey({ values: new Uint8Array(shared, 0, 3) }),
    ).toBe(
      makeBenchmarkKey({ values: new Uint8Array([1, 2, 3]) }),
    )
    expect(
      makeBenchmarkKey({ values: new Uint8Array(shared, 0, 3) }),
    ).not.toBe(
      makeBenchmarkKey({ values: new Uint8Array(shared, 1, 3) }),
    )
  })

  it('remains deterministic for circular object graphs', () => {
    const left: Record<string, unknown> = { id: 'fixture-a' }
    left.self = left

    const right: Record<string, unknown> = {}
    right.self = right
    right.id = 'fixture-a'

    expect(makeBenchmarkKey(left)).toBe(makeBenchmarkKey(right))
  })

  it('reuses one build anchor set to score another build without changing the result', () => {
    // anchor generation is expensive; this proves cached anchors can be reused
    // when the target context is the same but equipped substats differ
    const seedIds = listResSds().slice(0, 5).map((seed) => seed.id)
    let checked = 0

    for (const seedId of seedIds) {
      const buildA = buildInvariantEchoes('critRate')
      const buildB = buildInvariantEchoes('critDmg')
      const ctxA = benchmarkContextFor(seedId, buildA)
      const ctxB = benchmarkContextFor(seedId, buildB)
      if (!ctxA || !ctxB) {
        continue
      }

      const anchorsA = buildBenchmarkAnchors(ctxA, buildA)
      const full = buildBenchmark(ctxB, buildB)
      if (!anchorsA || !full) {
        continue
      }
      checked += 1

      const cached = assembleBenchmark(ctxB, buildB, anchorsA)

      expect(cached.baselineDamage).toBe(full.baselineDamage)
      expect(cached.benchmarkDamage).toBe(full.benchmarkDamage)
      expect(cached.perfectionDamage).toBe(full.perfectionDamage)
      expect(norm(cached.builds.baseline0)).toEqual(norm(full.builds.baseline0))
      expect(norm(cached.builds.benchmark100)).toEqual(norm(full.builds.benchmark100))
      expect(norm(cached.builds.benchmark200)).toEqual(norm(full.builds.benchmark200))
      expect(cached.userDamage).toBe(full.userDamage)
      expect(cached.percent).toBe(full.percent)
      expect(cached.grade).toBe(full.grade)
      expect(norm(cached.builds.active)).toEqual(norm(full.builds.active))
    }

    expect(checked).toBeGreaterThan(0)
  }, 120000)

  it.runIf(Boolean(loadProdApp))(
    'pins scoring fingerprints for representative persisted fixtures',
    async () => {
      const profiles = await loadFixtureProfiles()
      expect(profiles.length).toBeGreaterThan(0)

      const fingerprints = []
      for (const profile of profiles) {
        const { input, report } = await runBenchmark(profile)
        fingerprints.push(fingerprint(report.benchmark))
        expect(getRotScore(input)).toBeCloseTo(report.benchmark.percent * 100, 4)
      }

      expect(fingerprints).toMatchSnapshot()
    },
    120000,
  )

  it('keeps a non-4-cost main echo as the generated benchmark main when its buffs win', () => {
    // some resonators prefer a nonstandard main echo because its own buff is
    // stronger than raw cost assumptions, so benchmark generation must preserve it
    const seed = getResSeedBy('1506')
    if (!seed) throw new Error('missing Phoebe seed')

    const runtime = applyBenchAsm(makeResRuntime(seed))
    runtime.build.echoes = [
      echoSlot('6000104', 11, true, { key: 'spectro', value: 30 }, { key: 'atkFlat', value: 100 }),
      echoSlot('6000071', 11, false, { key: 'atkPercent', value: 18 }, { key: 'hpFlat', value: 2280 }),
      echoSlot('6000093', 11, false, { key: 'atkPercent', value: 18 }, { key: 'hpFlat', value: 2280 }),
      echoSlot('6000092', 11, false, { key: 'critDmg', value: 44 }, { key: 'atkFlat', value: 150 }),
      echoSlot('6000096', 11, false, { key: 'spectro', value: 30 }, { key: 'atkFlat', value: 100 }),
    ]

    const runtimesById = makeRuntimeMap(runtime)
    const simulation = runResSmlt(runtime, seed, BENCH_ENEMY, runtimesById, {})
    const report = rotationBuildBenchmarkReport({
      runtime,
      simulation,
      enemy: BENCH_ENEMY,
      runtimesById,
    })

    expect(report?.benchmark.builds.benchmark100.echoes.find((echo) => echo.mainEcho)?.echoId).toBe('6000104')
    expect(report?.benchmark.builds.benchmark200.echoes.find((echo) => echo.mainEcho)?.echoId).toBe('6000104')
  })
})
