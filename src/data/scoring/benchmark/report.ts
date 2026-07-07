/*
  Author: Runor Ewhro
  Description: Builds benchmark alternatives, reports, and rotation-facing results.
*/
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime';
import type { EnemyProfile } from '@/domain/entities/appState';
import { SUBSTAT_KEYS, ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats';
import { getEchoById, listChsByCos } from '@/domain/services/echoCatalogService';
import { encEchoRows } from '@/engine/optimizer/encode/echoes';
import { mkSuggMainEc, mkSuggVltnCt } from '@/engine/suggestions/shared';
import type { SuggestContext } from '@/engine/suggestions/types';
import { scoreStats } from '@/data/scoring/benchmark/scoring';
import { getResSeedBy } from '@/domain/services/resonatorSeedService';
import { listResRttn } from '@/domain/services/gameDataService';
import { cloneRotNds } from '@/domain/entities/inventoryStorage';
import { mkCostPlns } from '@/engine/suggestions/randomEchoes/lib/combinations';
import { applySetPlan, prepSetPlanFsb } from '@/engine/suggestions/mutate';
import { getEchoSetDe } from '@/data/gameData/echoSets/effects';
import { benchSetConds } from '@/data/scoring/setStatePolicy';
import { buildSetRows, type DynamicSetStatePart } from '@/engine/optimizer/encode/sets';
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals';
import type { BenchmarkAlternative, BenchmarkReportOpts, BenchmarkReportSections, BenchmarkRotationSummary, BenchmarkSetSummary, BuildBenchmark, BuildBenchmarkReport, DefRotBenchIn } from './types.ts';
import { BENCHMARK_ROLL_SOURCE, ENERGY_REGEN, MAXIMUM_ROLL_SOURCE, normalizeRollParams, roundStat, scorePercentX100 } from './stats.ts';
import { cloneEchoSlot, makeSetSummary, preservedMainEchoFor, retainsUtilityPlan, utilityPlanFor } from './echoDiscovery.ts';
import { assembleBenchmark, benchmarkErTarget, buildBenchmark, buildBenchmarkAnchors, LEAN_SCORE_OPTIONS, type BenchCancelCheck, type BenchmarkAnchors, type BuildBenchmarkOptions } from './search.ts';
import { makeBenchmarkKey } from '@/data/scoring/buildBenchmarkKey';
import { loadPersistedAnchors, persistAnchor } from './anchorStore.ts';



export function cloneEchoes(equipped: Array<EchoInstance | null>): Array<EchoInstance | null> {
  return equipped.map((echo) => echo ? cloneEchoSlot(echo) : null)
}

// The 0%/100%/200% anchors are the expensive part of a benchmark and depend on
// the equipped build only through the ER target and the retained utility plan.
// We cache the anchor bundle keyed on everything that actually moves it, so a
// build edit that leaves those untouched (substats, main stats, non-utility
// sets) skips the candidate search entirely and only re-scores the live build.
// The cache is also mirrored to IndexedDB (see anchorStore) so the search
// survives worker idle-teardown and page reloads.
const MAX_ANCHOR_CACHE_ENTRIES = 24
const anchorCache = new Map<string, BenchmarkAnchors>()

const DEFAULT_REPORT_SECTIONS: BenchmarkReportSections = {
  rotationFeatures: true,
  upgradePaths: true,
  echoStatsTable: true,
  benchmarkTargets: true,
}

function resolveReportSections(options: BenchmarkReportOpts = {}): BenchmarkReportSections {
  return {
    rotationFeatures: options.sections?.rotationFeatures ?? DEFAULT_REPORT_SECTIONS.rotationFeatures,
    upgradePaths: options.sections?.upgradePaths ?? DEFAULT_REPORT_SECTIONS.upgradePaths,
    echoStatsTable: options.sections?.echoStatsTable ?? DEFAULT_REPORT_SECTIONS.echoStatsTable,
    benchmarkTargets: options.sections?.benchmarkTargets ?? DEFAULT_REPORT_SECTIONS.benchmarkTargets,
  }
}

function reportBuildOptions(options: BenchmarkReportOpts = {}): BuildBenchmarkOptions {
  const sections = resolveReportSections(options)
  return {
    includeFeatures: sections.rotationFeatures,
    includeStatRows: sections.echoStatsTable,
    includeBenchmarkTargets: sections.benchmarkTargets,
  }
}

function touchAnchors(key: string): BenchmarkAnchors | undefined {
  const cached = anchorCache.get(key)
  if (cached) {
    anchorCache.delete(key)
    anchorCache.set(key, cached)
  }
  return cached
}

// In-memory LRU insert only, used both for freshly computed anchors and for
// entries rehydrated from disk (which must not be written straight back).
function cacheAnchors(key: string, anchors: BenchmarkAnchors): BenchmarkAnchors {
  anchorCache.delete(key)
  anchorCache.set(key, anchors)
  while (anchorCache.size > MAX_ANCHOR_CACHE_ENTRIES) {
    const oldest = anchorCache.keys().next().value
    if (!oldest) break
    anchorCache.delete(oldest)
  }
  return anchors
}

// Cache a newly computed bundle and mirror it to disk for later sessions.
function rememberAnchors(key: string, anchors: BenchmarkAnchors): BenchmarkAnchors {
  cacheAnchors(key, anchors)
  persistAnchor(key, anchors)
  return anchors
}

// Load persisted anchors into the in-memory cache once, before the first search.
// Runs at the worker boundary (the only async seam), so the synchronous compute
// path below stays unchanged. Re-inserting oldest-first preserves LRU order, and
// we never clobber an entry already computed this session.
let anchorHydration: Promise<void> | null = null
export function ensureAnchorStoreHydrated(): Promise<void> {
  if (!anchorHydration) {
    anchorHydration = loadPersistedAnchors()
      .then((entries) => {
        for (const [key, anchors] of entries) {
          if (!anchorCache.has(key)) {
            cacheAnchors(key, anchors)
          }
        }
      })
      .catch(() => { /* persistence is best-effort; ignore load failures */ })
  }
  return anchorHydration
}

function anchorCacheKey(
  ctx: SuggestContext,
  runtime: ResRuntime,
  enemy: EnemyProfile,
  runtimesById: Record<string, ResRuntime>,
): string {
  const equipped = runtime.build.echoes
  const utilityPlan = utilityPlanFor(equipped)
  return makeBenchmarkKey({
    kind: 'benchmark-anchors-v3',
    // strip echoes: their substats / main stats / non-preserved sets and main
    // Echoes do not move the anchors.
    runtime: { ...runtime, build: { ...runtime.build, echoes: [] } },
    enemy,
    runtimesById,
    // the channels through which the equipped build *does* reach the anchors:
    targetEr: benchmarkErTarget(ctx, equipped),
    utility: utilityPlan
      .map((entry) => `${entry.setId}:${entry.pieces}`)
      .sort(),
    utilityStates: utilityStateSignature(runtime, utilityPlan),
    mainEcho: preservedMainEchoFor(equipped)?.id ?? null,
  })
}

function utilityStateParts(utilityPlan: ReturnType<typeof utilityPlanFor>): DynamicSetStatePart[] {
  return utilityPlan.flatMap((entry) => {
    const set = getEchoSetDe(entry.setId)
    if (!set || entry.pieces !== set.setMax) return []
    return Object.keys(set.states).map((partKey) => ({ setId: entry.setId, partKey }))
  })
}

function utilityStateSignature(
  runtime: ResRuntime,
  utilityPlan: ReturnType<typeof utilityPlanFor>,
): string[] {
  return utilityStateParts(utilityPlan)
    .map((part) => {
      const key = `echoSet:${part.setId}:bonus:${part.partKey}`
      return `${key}:${String(runtime.state.controls[key] ?? '')}`
    })
    .sort()
}

function withUtilitySetRows(
  ctx: SuggestContext,
  runtime: ResRuntime,
  setConds: SntSetConds,
  utilityPlan: ReturnType<typeof utilityPlanFor>,
): SuggestContext {
  const dynamicStateParts = utilityStateParts(utilityPlan)
  if (dynamicStateParts.length === 0) {
    return ctx
  }

  return {
    ...ctx,
    setConstLut: buildSetRows(runtime, setConds, { dynamicStateParts }),
  }
}

// Build a benchmark reusing cached anchors when the anchor inputs are unchanged.
// `runtime` here is the benchmark runtime (default rotation), so user rotation
// edits don't fragment the cache.
function cachedBuildBenchmark(
  ctx: SuggestContext,
  runtime: ResRuntime,
  enemy: EnemyProfile,
  runtimesById: Record<string, ResRuntime>,
  options: BuildBenchmarkOptions = {},
  checkCancel?: BenchCancelCheck,
): BuildBenchmark | null {
  const equipped = runtime.build.echoes
  const key = anchorCacheKey(ctx, runtime, enemy, runtimesById)
  const cached = touchAnchors(key)
  if (cached) {
    return assembleBenchmark(ctx, equipped, cached, options)
  }
  const anchors = buildBenchmarkAnchors(ctx, equipped, checkCancel)
  if (!anchors) return null
  rememberAnchors(key, anchors)
  return assembleBenchmark(ctx, equipped, anchors, options)
}

export function scoreEchoAlternative(
  ctx: SuggestContext,
  equipped: Array<EchoInstance | null>,
): { damage: number; sets: BenchmarkSetSummary[] } | null {
  const echoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  if (echoes.length === 0) {
    return null
  }

  const mainEchoBuffs = mkSuggMainEc(ctx, equipped)
  const { stats, sets, kinds } = encEchoRows(echoes, ctx.selectedSkill, 'self')
  const comboIds = Int32Array.from(echoes.map((_, index) => index))
  const mainIndex = Math.max(0, echoes.findIndex((echo) => echo.mainEcho))
  return {
    damage: scoreStats(ctx, stats, sets, kinds, comboIds, mainEchoBuffs, mainIndex),
    sets: makeSetSummary(sets, echoes),
  }
}

export function pushAlternative(
  alternatives: BenchmarkAlternative[],
  ctx: SuggestContext,
  benchmark: BuildBenchmark,
  baseDamage: number,
  currentScore: number,
  echoes: Array<EchoInstance | null>,
  meta: Pick<BenchmarkAlternative,
    | 'kind'
    | 'operation'
    | 'cost'
    | 'from'
    | 'to'
    | 'fromPrimary'
    | 'toPrimary'
    | 'fromSecondaryKey'
    | 'toSecondaryKey'
    | 'fromSets'
    | 'toSets'
  >,
): void {
  const result = scoreEchoAlternative(ctx, echoes)
  if (!result) {
    return
  }

  const score = scorePercentX100(result.damage, benchmark)
  alternatives.push({
    ...meta,
    fromSets: meta.fromSets?.map((set) => ({ ...set })),
    toSets: meta.toSets?.map((set) => ({ ...set })) ?? result.sets.map((set) => ({ ...set })),
    damage: roundStat(result.damage),
    damageDelta: roundStat(result.damage - baseDamage),
    damageDeltaPct: baseDamage > 0 ? roundStat(((result.damage - baseDamage) / baseDamage) * 100) : 0,
    score: roundStat(score),
    scoreDelta: roundStat(score - currentScore),
  })
}

export function buildBenchmarkAlternatives(
  inputCtx: SuggestContext,
  equipped: Array<EchoInstance | null>,
  benchmark: BuildBenchmark,
  limit?: number,
  checkCancel?: BenchCancelCheck,
): BenchmarkAlternative[] {
  const ctx = inputCtx
  const baseDamage = benchmark.userDamage
  const currentScore = benchmark.percent * 100
  const alternatives: BenchmarkAlternative[] = []
  const preservesEr = benchmarkErTarget(ctx, equipped) > 0

  for (let slotIndex = 0; slotIndex < equipped.length; slotIndex += 1) {
    checkCancel?.()
    const echo = equipped[slotIndex]
    if (!echo) {
      continue
    }

    const cost = getEchoById(echo.id)?.cost ?? 0
    const secondary = ECHO_SIDE_STATS[cost]
    if (!secondary) {
      continue
    }
    if (preservesEr && echo.mainStats.primary.key === ENERGY_REGEN) {
      continue
    }
    const legalMains = Object.entries(ECHO_MAIN_STATS[cost] ?? {})
    for (const [key, value] of legalMains) {
      checkCancel?.()
      if (key === echo.mainStats.primary.key && value === echo.mainStats.primary.value) {
        continue
      }

      const nextEchoes = cloneEchoes(equipped)
      const nextEcho = nextEchoes[slotIndex]
      if (!nextEcho) {
        continue
      }
      nextEcho.mainStats.primary = { key, value }
      nextEcho.mainStats.secondary = { ...secondary }
      pushAlternative(alternatives, ctx, benchmark, baseDamage, currentScore, nextEchoes, {
        kind: 'mainStatSwap',
        operation: 'swap',
        cost,
        from: echo.mainStats.primary.key,
        to: key,
        fromPrimary: { ...echo.mainStats.primary },
        toPrimary: { key, value },
        fromSecondaryKey: echo.mainStats.secondary.key,
        toSecondaryKey: secondary.key,
      })
    }
  }

  const emptySlot = equipped.findIndex((echo) => echo == null)
  if (emptySlot >= 0) {
    const equippedEchoes = equipped.filter((echo): echo is EchoInstance => echo != null)
    const forcedMainEcho = equippedEchoes.find((echo) => echo.mainEcho) ?? null
    const forcedMainCost = forcedMainEcho ? getEchoById(forcedMainEcho.id)?.cost ?? null : null
    const currentCosts = equippedEchoes
      .map((echo) => getEchoById(echo.id)?.cost ?? 0)
      .filter((cost) => cost > 0)
    const validPlans = mkCostPlns(forcedMainCost)
    // id|set uniqueness (the in-game piece rule): an id is only "taken" for the
    // set it sits in, so the same id stays available for a different set.
    const usedKeys = new Set(equippedEchoes.map((echo) => `${echo.id}|${echo.set}`))
    const setCounts = new Map<number, number>()
    for (const echo of equippedEchoes) {
      if (echo.set > 0) {
        setCounts.set(echo.set, (setCounts.get(echo.set) ?? 0) + 1)
      }
    }
    const preferredSet = [...setCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] ?? 0

    const isSubsetOfPlan = (costs: number[], plan: number[]) => {
      const remaining = [...plan]
      for (const cost of costs) {
        const index = remaining.indexOf(cost)
        if (index < 0) return false
        remaining.splice(index, 1)
      }
      return true
    }

    for (const cost of Object.keys(ECHO_MAIN_STATS).map(Number).sort((left, right) => right - left)) {
      checkCancel?.()
      if (!validPlans.some((plan) => isSubsetOfPlan([...currentCosts, cost], plan))) {
        continue
      }

      const definitions = listChsByCos(cost)
      const definition = definitions.find((entry) => (
        preferredSet > 0 && entry.sets.includes(preferredSet) && !usedKeys.has(`${entry.id}|${preferredSet}`)
      )) ?? definitions.find((entry) => !usedKeys.has(`${entry.id}|${entry.sets[0] ?? 0}`))
        ?? definitions.find((entry) => preferredSet > 0 && entry.sets.includes(preferredSet))
        ?? definitions[0]
      const secondary = ECHO_SIDE_STATS[cost]
      if (!definition || !secondary) {
        continue
      }
      const set = preferredSet > 0 && definition.sets.includes(preferredSet)
        ? preferredSet
        : (definition.sets[0] ?? 0)

      for (const [key, value] of Object.entries(ECHO_MAIN_STATS[cost] ?? {})) {
        checkCancel?.()
        const nextEchoes = cloneEchoes(equipped)
        nextEchoes[emptySlot] = {
          uid: `benchmark-alternative-${cost}-${key}`,
          id: definition.id,
          set,
          mainEcho: false,
          mainStats: {
            primary: { key, value },
            secondary: { ...secondary },
          },
          substats: {},
        }
        pushAlternative(alternatives, ctx, benchmark, baseDamage, currentScore, nextEchoes, {
          kind: 'mainStatAdd',
          operation: 'add',
          cost,
          from: null,
          to: key,
          fromPrimary: null,
          toPrimary: { key, value },
          fromSecondaryKey: null,
          toSecondaryKey: secondary.key,
        })
      }
    }
  }

  const equippedEchoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  if (equippedEchoes.length > 0) {
    const requiredUtilityPlan = utilityPlanFor(equipped)
    const activeSets = benchmark.builds.active.sets
    const activeSetSig = activeSets.map((set) => `${set.setId}:${set.pieces}`).join('|')
    const forcedMainEcho = equippedEchoes.find((echo) => echo.mainEcho) ?? null
    const seenPlans = new Set<string>()
    const targetPlans = [
      benchmark.builds.benchmark100.sets,
      benchmark.builds.benchmark200.sets,
    ]
    const isFeasible = prepSetPlanFsb(equippedEchoes)

    for (const targetPlan of targetPlans) {
      checkCancel?.()
      const setPlan = targetPlan.map((set) => ({ setId: set.setId, pieces: set.pieces }))
      if (setPlan.length === 0) continue
      if (!retainsUtilityPlan(setPlan, requiredUtilityPlan)) continue
      if (!isFeasible(setPlan)) continue
      const nextEchoes = applySetPlan(setPlan, equippedEchoes)
        .filter((echo): echo is EchoInstance => echo != null)
      if (nextEchoes.length !== equippedEchoes.length) continue
      if (new Set(nextEchoes.map((echo) => `${echo.id}|${echo.set}`)).size !== nextEchoes.length) continue
      if (forcedMainEcho && !nextEchoes.some((echo) => echo.mainEcho && echo.id === forcedMainEcho.id)) continue

      const { sets } = encEchoRows(nextEchoes, ctx.selectedSkill, 'self')
      const nextSets = makeSetSummary(sets, nextEchoes)
      if (!retainsUtilityPlan(nextSets, requiredUtilityPlan)) continue
      const nextSetSig = nextSets.map((set) => `${set.setId}:${set.pieces}`).join('|')
      if (nextSetSig === activeSetSig || seenPlans.has(nextSetSig)) continue
      seenPlans.add(nextSetSig)

      pushAlternative(alternatives, ctx, benchmark, baseDamage, currentScore, nextEchoes, {
        kind: 'sonataSet',
        operation: 'set',
        cost: 0,
        from: activeSetSig || null,
        to: nextSetSig || null,
        fromPrimary: null,
        toPrimary: null,
        fromSecondaryKey: null,
        toSecondaryKey: null,
        fromSets: activeSets,
        toSets: nextSets,
      })
    }
  }

  const byTransition = new Map<string, BenchmarkAlternative>()
  for (const alternative of alternatives) {
    const transition = alternative.kind === 'sonataSet'
      ? `set:${alternative.from ?? 'none'}:${alternative.to ?? 'none'}`
      : [
          alternative.operation,
          alternative.cost,
          alternative.fromPrimary?.key ?? 'none',
          alternative.fromSecondaryKey ?? 'none',
          alternative.toPrimary?.key ?? 'none',
          alternative.toSecondaryKey ?? 'none',
        ].join(':')
    const existing = byTransition.get(transition)
    if (!existing || alternative.damageDelta > existing.damageDelta) {
      byTransition.set(transition, alternative)
    }
  }

  const sorted = [...byTransition.values()]
    .sort((left, right) => right.damageDelta - left.damageDelta || right.scoreDelta - left.scoreDelta)
  return typeof limit === 'number'
    ? sorted.slice(0, Math.max(0, limit))
    : sorted
}

export function buildBenchmarkReport(
  inputCtx: SuggestContext,
  equipped: Array<EchoInstance | null>,
  options: BenchmarkReportOpts = {},
  existingBenchmark?: BuildBenchmark | null,
  rotation: BenchmarkRotationSummary | null = null,
  checkCancel?: BenchCancelCheck,
): BuildBenchmarkReport | null {
  const ctx = inputCtx
  const sections = resolveReportSections(options)
  const benchmark = existingBenchmark
    ? assembleBenchmark(ctx, equipped, {
        baselineDamage: existingBenchmark.baselineDamage,
        benchmarkDamage: existingBenchmark.benchmarkDamage,
        perfectionDamage: existingBenchmark.perfectionDamage,
        builds: {
          baseline0: existingBenchmark.builds.baseline0,
          benchmark100: existingBenchmark.builds.benchmark100,
          benchmark200: existingBenchmark.builds.benchmark200,
        },
      }, reportBuildOptions(options))
    : buildBenchmark(ctx, equipped, undefined, reportBuildOptions(options), checkCancel)
  if (!benchmark) {
    return null
  }

  return {
    benchmark,
    alternatives: sections.upgradePaths
      ? buildBenchmarkAlternatives(ctx, equipped, benchmark, options.alternativesLimit, checkCancel)
      : [],
    rotation,
  }
}

export function rotationBuildBenchmark({
                                         runtime,
                                         simulation,
                                         enemy,
                                         runtimesById,
                                       }: DefRotBenchIn): BuildBenchmark | null {
  if (!simulation) {
    return null
  }

  const seed = getResSeedBy(runtime.id)
  if (!seed) {
    return null
  }

  const defaultRotation = seed.rotations?.[0] ?? listResRttn(runtime.id)[0] ?? null
  if (!defaultRotation?.items.length) {
    return null
  }

  const benchmarkRuntime: ResRuntime = {
    ...runtime,
    rotation: {
      ...runtime.rotation,
      view: 'personal',
      personalItems: cloneRotNds(defaultRotation.items),
    },
  }
  const utilityPlan = utilityPlanFor(runtime.build.echoes)
  const setConds = benchSetConds(runtime.id, {
    preservedUtilityPlan: utilityPlan,
    preservedUtilityControls: runtime.state.controls,
  })

  const context = mkSuggVltnCt({
    runtime: benchmarkRuntime,
    seed,
    enemy,
    runtimesById,
    selectedTargets: {},
    setConds,
    tgtFeatId: null,
    rotationMode: true,
  }, simulation)

  return context
    ? cachedBuildBenchmark(withUtilitySetRows(context, benchmarkRuntime, setConds, utilityPlan), benchmarkRuntime, enemy, runtimesById, LEAN_SCORE_OPTIONS)
    : null
}

export function rotationBuildBenchmarkReport(
  input: DefRotBenchIn,
  options: BenchmarkReportOpts = {},
  existingBenchmark?: BuildBenchmark | null,
  checkCancel?: BenchCancelCheck,
): BuildBenchmarkReport | null {
  const { runtime, simulation, enemy, runtimesById } = input
  if (!simulation) {
    return null
  }

  const seed = getResSeedBy(runtime.id)
  if (!seed) {
    return null
  }

  const defaultRotation = seed.rotations?.[0] ?? listResRttn(runtime.id)[0] ?? null
  if (!defaultRotation?.items.length) {
    return null
  }

  const benchmarkRuntime: ResRuntime = {
    ...runtime,
    rotation: {
      ...runtime.rotation,
      view: 'personal',
      personalItems: cloneRotNds(defaultRotation.items),
    },
  }
  const utilityPlan = utilityPlanFor(runtime.build.echoes)
  const setConds = benchSetConds(runtime.id, {
    preservedUtilityPlan: utilityPlan,
    preservedUtilityControls: runtime.state.controls,
  })

  const context = mkSuggVltnCt({
    runtime: benchmarkRuntime,
    seed,
    enemy,
    runtimesById,
    selectedTargets: {},
    setConds,
    tgtFeatId: null,
    rotationMode: true,
  }, simulation)

  return context ? buildBenchmarkReport(
    withUtilitySetRows(context, benchmarkRuntime, setConds, utilityPlan),
    runtime.build.echoes,
    options,
    existingBenchmark,
    {
      id: defaultRotation.id,
      name: defaultRotation.label,
      resonatorId: runtime.id,
      items: cloneRotNds(defaultRotation.items),
    },
    checkCancel,
  ) : null
}

export interface DefaultRotationBenchmarkResult {
  benchmark: BuildBenchmark | null
  score: number | null
  report?: BuildBenchmarkReport | null
}

export function getDefaultRotationBenchmarkScore(input: DefRotBenchIn): DefaultRotationBenchmarkResult {
  const seed = getResSeedBy(input.runtime.id)
  const defaultRotation = seed?.rotations?.[0] ?? listResRttn(input.runtime.id)[0] ?? null
  if (!defaultRotation?.items.length) {
    return {
      benchmark: null,
      score: 0,
    }
  }

  const benchmark = rotationBuildBenchmark(input)
  return {
    benchmark,
    score: benchmark ? benchmark.percent * 100 : null,
  }
}

export function getRotScore(input: DefRotBenchIn): number | null {
  return getDefaultRotationBenchmarkScore(input).score
}

export function logBuildBenchmarkResult(
  benchmark: BuildBenchmark | null,
  runtimeId: string,
): BuildBenchmark | null {
  if (!benchmark) {
    console.info('[build benchmark] No benchmark available for active resonator.')
    return benchmark
  }

  const seed = getResSeedBy(runtimeId)
  const benchmarkParams = normalizeRollParams(BENCHMARK_ROLL_SOURCE, SUBSTAT_KEYS.length)
  const maximumParams = normalizeRollParams(MAXIMUM_ROLL_SOURCE, SUBSTAT_KEYS.length)
  const header = `[build benchmark] ${seed?.name ?? runtimeId} ${roundStat(benchmark.percent * 100)}% ${benchmark.grade}`
  console.groupCollapsed(header)
  console.table([
    { build: '0%', damage: roundStat(benchmark.baselineDamage), score: 0, quality: 0, rollGoal: 0, freeRolls: 0 },
    { build: 'Active', damage: roundStat(benchmark.userDamage), score: roundStat(benchmark.percent * 100) },
    {
      build: '100%',
      damage: roundStat(benchmark.benchmarkDamage),
      score: 100,
      quality: benchmarkParams.quality,
      rollGoal: roundStat(benchmarkParams.substatGoal),
      freeRolls: roundStat(benchmarkParams.freeRolls),
    },
    {
      build: '200%',
      damage: roundStat(benchmark.perfectionDamage),
      score: 200,
      quality: maximumParams.quality,
      rollGoal: roundStat(maximumParams.substatGoal),
      freeRolls: roundStat(maximumParams.freeRolls),
    },
  ])
  console.log('Active build', benchmark.builds.active)
  console.log('Benchmark 100% build', benchmark.builds.benchmark100)
  console.log('Benchmark 200% build', benchmark.builds.benchmark200)
  console.groupEnd()
  return benchmark
}

export function logActiveBuildBenchmark(input: DefRotBenchIn): BuildBenchmark | null {
  const benchmark = rotationBuildBenchmark(input)
  return logBuildBenchmarkResult(benchmark, input.runtime.id)
}
