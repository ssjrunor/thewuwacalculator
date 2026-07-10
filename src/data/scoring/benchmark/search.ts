/*
  Author: Runor Ewhro
  Description: Searches valid build space for baseline, benchmark, and maximum builds.
*/
import type { EchoInstance } from '@/domain/entities/runtime';
import { SUBSTAT_KEYS, getSbstStepP } from '@/data/gameData/catalog/echoStats';
import { MAIN_BUFF_LEN } from '@/engine/optimizer/config/constants';
import { mkSuggMainEc } from '@/engine/suggestions/shared';
import type { SuggestContext } from '@/engine/suggestions/types';
import { mkCostPlns } from '@/engine/suggestions/randomEchoes/lib/combinations';
import { applySetPlan, mkSetPlanCnd, prepSetPlanFsb } from '@/engine/suggestions/mutate';
import { ignoresEr } from '@/data/scoring/energyRegenPolicy';
import type { BenchmarkBuildSnapshot, BenchmarkSubstatEntry, BuildBenchmark } from './types.ts';
import { addStatTotal, BENCHMARK_ROLL_SOURCE, effectiveRollCount, ENERGY_REGEN, equivalentRollCounts, gradeForPercent, makeBenchmarkInvariantStats, makeBenchmarkOverviewStats, makeSubstatPlan, MAXIMUM_ROLL_SOURCE, MAX_ROLLS_PER_KEY, normalizeRollParams, removeSubstatTotals, rollAtQuality, scorePercent, sumEncodedEnergyRegen, sumEncodedStats, sumSubstats, type BenchmarkEchoFrame, type BenchmarkScoringParams, type MainStatCandidate, type SubstatCandidate } from './stats.ts';
import { echoesMatchSetPlan, enumerateMainStatCandidates, findUsefulStatImpacts, mainEchoChoices, makeBenchmarkBuildSnapshot, makeBenchmarkEchoFrame, makeMainEchoProfiles, makeReferenceBenchmarkEchoes, preservedMainEchoFor, retainsUtilityPlan, setEffectSig, utilityPlanFor } from './echoDiscovery.ts';
import { buildBenchmarkFeatureBreakdownFromEncoded } from './features.ts';


// The 0%/100%/200% anchors depend on the equipped build only through the ER
// requirement (`targetEr`), retained maxed utility-set plan, and retained
// team-facing main Echo. Splitting the anchor search out from active-build
// scoring lets callers cache the expensive search and re-score the live build
// cheaply (see report.ts). The anchor bundle is plain data (no closures / ctx
// references), so a bundle computed against one ctx can be reused to assemble a
// benchmark against another ctx that shares the same anchor inputs.
export interface BenchmarkAnchors {
  baselineDamage: number
  benchmarkDamage: number
  perfectionDamage: number
  builds: {
    baseline0: BenchmarkBuildSnapshot
    benchmark100: BenchmarkBuildSnapshot
    benchmark200: BenchmarkBuildSnapshot
  }
}

export interface BuildBenchmarkOptions {
  includeFeatures?: boolean
  includeStatRows?: boolean
  includeBenchmarkTargets?: boolean
  includeInvariantStats?: boolean
}

export type BenchCancelCheck = (() => void) | undefined

const DEFAULT_BENCHMARK_OPTIONS: Required<BuildBenchmarkOptions> = {
  includeFeatures: true,
  includeStatRows: true,
  includeBenchmarkTargets: true,
  includeInvariantStats: true,
}

// The score path only needs `percent` + the anchor damages, so it skips the
// active build's expensive per-stat contribution re-scoring, its feature
// breakdown, and the invariant stat tree. Benchmark target snapshots stay
// included because they are precomputed in the anchors (free to attach) and the
// detail/report paths reuse this benchmark to skip the anchor search.
export const LEAN_SCORE_OPTIONS: BuildBenchmarkOptions = {
  includeFeatures: false,
  includeStatRows: false,
  includeBenchmarkTargets: true,
  includeInvariantStats: false,
}

const MAIN_IMPACT_STAT_LIMIT = 5
const MAIN_IMPACT_STAT_FLOOR = 4
const MAIN_IMPACT_RATIO_FLOOR = 0.5
const SUBSTAT_IMPACT_STAT_LIMIT = 8
const SUBSTAT_IMPACT_STAT_FLOOR = 5
const SUBSTAT_IMPACT_RATIO_FLOOR = 0.12

function resolveBenchmarkOptions(options: BuildBenchmarkOptions = {}): Required<BuildBenchmarkOptions> {
  return {
    includeFeatures: options.includeFeatures ?? DEFAULT_BENCHMARK_OPTIONS.includeFeatures,
    includeStatRows: options.includeStatRows ?? DEFAULT_BENCHMARK_OPTIONS.includeStatRows,
    includeBenchmarkTargets: options.includeBenchmarkTargets ?? DEFAULT_BENCHMARK_OPTIONS.includeBenchmarkTargets,
    includeInvariantStats: options.includeInvariantStats ?? DEFAULT_BENCHMARK_OPTIONS.includeInvariantStats,
  }
}

function stripSnapshotDetails(snapshot: BenchmarkBuildSnapshot): BenchmarkBuildSnapshot {
  return {
    ...snapshot,
    echoes: [],
    sets: [],
    statRows: [],
    overviewStats: {
      mainStats: [],
      secondaryStats: [],
      dmgMdfrStts: [],
    },
    features: [],
    featureGroups: {
      skillTypes: [],
      tabs: [],
    },
  }
}

function benchmarkFeatures(ctx: SuggestContext, frame: BenchmarkEchoFrame, buffer: Float32Array, setRows: Uint8Array) {
  return buildBenchmarkFeatureBreakdownFromEncoded(
    ctx,
    buffer,
    setRows,
    frame.kinds,
    frame.comboIds,
    frame.mainEchoBuffs,
    frame.mainIndex,
  )
}

function benchmarkOverview(ctx: SuggestContext, frame: BenchmarkEchoFrame, buffer: Float32Array, setRows: Uint8Array) {
  return makeBenchmarkOverviewStats({
    ctx,
    stats: buffer,
    setRows,
    kinds: frame.kinds,
    comboIds: frame.comboIds,
    mainEchoBuffs: frame.mainEchoBuffs,
    mainIndex: frame.mainIndex,
  })
}

// Legal benchmark / max roll value per substat. Depends only on static roll
// sources, so it is computed once and shared (read-only) across every anchor
// search and every live re-score instead of being rebuilt per call.
let rollBoundsMemo: Record<string, { benchmark: number; max: number }> | null = null
function getRollBounds(): Record<string, { benchmark: number; max: number }> {
  if (rollBoundsMemo) return rollBoundsMemo
  const benchmarkQuality = normalizeRollParams(BENCHMARK_ROLL_SOURCE, SUBSTAT_KEYS.length).quality
  const maximumQuality = normalizeRollParams(MAXIMUM_ROLL_SOURCE, SUBSTAT_KEYS.length).quality
  const bounds: Record<string, { benchmark: number; max: number }> = {}
  for (const key of SUBSTAT_KEYS) {
    const steps = getSbstStepP(key)
    bounds[key] = {
      benchmark: rollAtQuality(steps, benchmarkQuality),
      max: rollAtQuality(steps, maximumQuality),
    }
  }
  rollBoundsMemo = bounds
  return bounds
}

function limitUsefulStatsByImpact(
  impacts: Map<string, number>,
  options: {
    ignoreEr: boolean
    targetEr: number
    limit: number
    floor: number
    ratioFloor: number
  },
): Set<string> {
  const ranked = [...impacts.entries()]
    .filter(([, impact]) => impact > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))

  if (ranked.length <= options.limit) {
    const all = new Set(ranked.map(([key]) => key))
    if (!options.ignoreEr && options.targetEr > 0) {
      all.add(ENERGY_REGEN)
    }
    return all
  }

  const maxImpact = ranked[0]?.[1] ?? 0
  const limited = new Set<string>()
  for (const [key, impact] of ranked) {
    if (
      limited.size < options.floor
      || (limited.size < options.limit && impact >= maxImpact * options.ratioFloor)
    ) {
      limited.add(key)
    }
  }

  // ER preservation is an anchor constraint, not only a damage-preference stat.
  if (!options.ignoreEr && options.targetEr > 0) {
    limited.add(ENERGY_REGEN)
  }

  return limited.size > 0 ? limited : new Set(ranked.map(([key]) => key))
}

// The ER total the generated anchor builds must reproduce, taken from the
// equipped build (one of the two ways the equipped build feeds the anchors).
export function benchmarkErTarget(
  ctx: SuggestContext,
  equipped: Array<EchoInstance | null>,
): number {
  if (ignoresEr(ctx.runtime.id)) return 0
  const echoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  if (echoes.length === 0) return 0
  const frame = makeBenchmarkEchoFrame(ctx, echoes, mkSuggMainEc(ctx, equipped))
  return Math.max(0, sumEncodedStats(frame.stats, frame.comboIds).er)
}

export function buildBenchmarkAnchors(
  ctx: SuggestContext,
  equipped: Array<EchoInstance | null>,
  checkCancel?: BenchCancelCheck,
): BenchmarkAnchors | null {
  const costPlans = mkCostPlns()
  const mainEchoProfiles = makeMainEchoProfiles(ctx)
  const requiredUtilityPlan = utilityPlanFor(equipped)
  const requiredMainEcho = preservedMainEchoFor(equipped)
  const requiredMainEchoCost = requiredMainEcho
    ? mainEchoProfiles.find((profile) => profile.def.id === requiredMainEcho.id)?.def.cost ?? null
    : null
  const setPlans = mkSetPlanCnd(5)
    .filter((plan) => retainsUtilityPlan(plan, requiredUtilityPlan))
    .map((plan) => ({
    plan,
    effectSig: setEffectSig(ctx, plan),
    }))
  const benchmarkFrames = costPlans.flatMap((costPlan) => {
    if (requiredMainEchoCost != null && !costPlan.includes(requiredMainEchoCost)) return []
    const reference = makeReferenceBenchmarkEchoes(costPlan, null)
    if (reference.length !== 5) return []
    const seenFrames = new Set<string>()
    const isFeasible = prepSetPlanFsb(reference)

    return setPlans.flatMap(({ plan: setPlan, effectSig }) => {
      if (!isFeasible(setPlan)) return []
      const choices = mainEchoChoices(mainEchoProfiles, costPlan, setPlan, requiredMainEcho?.id ?? null)
      return choices.flatMap((choice) => {
        // The frame's `mainSig` is fully determined by the main Echo's own
        // effect class (`choice.effectSig`), the team-facing main-Echo buff
        // never depends on the filler echoes or the set assignment, so the real
        // `mainEchoEffectSig` always equals `choice.effectSig`. That makes the
        // whole dedup key knowable before any echo assembly, so the ~95% of
        // (set-effect x main-Echo) combos that collapse to an already-seen frame
        // skip the expensive applySetPlan / validity / mkSuggMainEc work.
        const frameSig = `${effectSig}|${choice.effectSig}`
        if (seenFrames.has(frameSig)) return []

        const base = makeReferenceBenchmarkEchoes(costPlan, choice.echo)
        if (base.length !== 5) return []
        const echoes = applySetPlan(setPlan, base).filter((echo): echo is EchoInstance => echo != null)
        // distinct by id|set (the in-game piece rule): the same id may serve two
        // different sets, but a duplicated id+set pair would waste a slot.
        if (echoes.length !== 5 || new Set(echoes.map((echo) => `${echo.id}|${echo.set}`)).size !== 5) return []
        if (!echoes.some((echo) => echo.mainEcho && echo.id === choice.echo.id)) return []
        if (!echoesMatchSetPlan(echoes, setPlan)) return []

        seenFrames.add(frameSig)
        return [makeBenchmarkEchoFrame(ctx, echoes, mkSuggMainEc(ctx, echoes), setPlan)]
      })
    })
  })
  if (benchmarkFrames.length === 0) {
    return null
  }

  const noEchoFrame = makeBenchmarkEchoFrame(ctx, [], new Float32Array(MAIN_BUFF_LEN))
  const benchmarkBaselineDamage = noEchoFrame.score(noEchoFrame.stats, noEchoFrame.sets)

  const ignoreEr = ignoresEr(ctx.runtime.id)
  const targetEr = benchmarkErTarget(ctx, equipped)

  // legal roll bounds and the benchmark-quality roll for each substat
  const bounds = getRollBounds()
  const benchmarkParams = normalizeRollParams(BENCHMARK_ROLL_SOURCE, SUBSTAT_KEYS.length)
  const maximumParams = normalizeRollParams(MAXIMUM_ROLL_SOURCE, SUBSTAT_KEYS.length)

  // Per-frame search inputs are computed once and reused by both anchor passes.
  // Main-stat candidates are enumerated lazily per frame inside findBestSubstats
  // (see below) rather than materialized into one giant array, so the live set
  // stays at O(one frame) instead of O(all candidates). The search is still an
  // exhaustive branch-and-bound that visits every candidate, and the anchor
  // damages are a max over candidates, so the 0%/100%/200% damages are identical
  // to a fully-materialized search and stay independent of the equipped build.
  // The set of substats/mains that move damage is fixed by the resonator's
  // element, skill types, and base crit; it is invariant across every frame of
  // a single search (verified empirically: exactly one distinct useful set per
  // resonator across all elements / set plans / main Echoes, for frame counts
  // into the thousands). Candidate sets and main Echoes only add FLAT stat
  // contributions; they never introduce a new damage-relevant stat (an
  // off-element set is dead for the resonator) nor permanently remove one (a
  // crit-cap-saturating set just makes an included stat add zero, which the
  // greedy already handles). So we compute one SHARED useful set instead of
  // re-deriving it (~21 scores) on every frame. A superset is always safe here:
  // an over-included stat simply never gets allocated, so we union the result
  // across a wide spread sample of frames to guard against any rare variation
  // while keeping this at O(sample) rather than O(frames) probes.
  const mainsOnlyByFrame = benchmarkFrames.map((frame) => {
    const mainsOnly = frame.stats.slice()
    removeSubstatTotals(mainsOnly, sumSubstats(frame.echoes))
    return mainsOnly
  })
  const usefulSampleStride = Math.max(1, Math.floor(benchmarkFrames.length / 48))
  const sharedUsefulImpacts = new Map<string, number>()
  for (let index = 0; index < benchmarkFrames.length; index += usefulSampleStride) {
    for (const { key, impact } of findUsefulStatImpacts(benchmarkFrames[index], mainsOnlyByFrame[index])) {
      sharedUsefulImpacts.set(key, Math.max(sharedUsefulImpacts.get(key) ?? 0, impact))
    }
  }
  if (ignoreEr) {
    sharedUsefulImpacts.delete(ENERGY_REGEN)
  }
  const mainUsefulStats = limitUsefulStatsByImpact(sharedUsefulImpacts, {
    ignoreEr,
    targetEr,
    limit: MAIN_IMPACT_STAT_LIMIT,
    floor: MAIN_IMPACT_STAT_FLOOR,
    ratioFloor: MAIN_IMPACT_RATIO_FLOOR,
  })
  const substatUsefulStats = limitUsefulStatsByImpact(sharedUsefulImpacts, {
    ignoreEr,
    targetEr,
    limit: SUBSTAT_IMPACT_STAT_LIMIT,
    floor: SUBSTAT_IMPACT_STAT_FLOOR,
    ratioFloor: SUBSTAT_IMPACT_RATIO_FLOOR,
  })
  const usefulSubKeys = SUBSTAT_KEYS.filter((entry) => substatUsefulStats.has(entry))
  const usefulDamageSubKeys = usefulSubKeys.filter((entry) => entry !== ENERGY_REGEN)
  const benchmarkRolls = Object.fromEntries(usefulSubKeys.map((key) => [key, bounds[key]?.benchmark ?? 0]))
  const maximumRolls = Object.fromEntries(usefulSubKeys.map((key) => [key, bounds[key]?.max ?? 0]))

  const frameInfos = benchmarkFrames.map((frame, index) => {
    const mainsOnly = mainsOnlyByFrame[index]
    // mains-only score is a cheap proxy used only to visit promising frames
    // first so the running best prunes more candidates; it never changes which
    // candidate wins.
    return { frame, mainsOnly, usefulStats: mainUsefulStats, order: frame.score(mainsOnly, frame.sets) }
  })
  frameInfos.sort((left, right) => right.order - left.order)

  // shared scratch vectors for the substat search; reused across every candidate
  // to avoid allocating a fresh Float32Array per trial roll (the dominant source
  // of GC churn in the greedy fill).
  const scratchLen = benchmarkFrames[0].stats.length
  const workingScratch = new Float32Array(scratchLen)
  const trialScratch = new Float32Array(scratchLen)

  // Compose normalized substat roll counts: free/filler rolls across every
  // substat category, caps reduced by matching main stats, and the remaining
  // budget greedily assigned to the best damage stats.
  const makeCaps = (candidate: MainStatCandidate, params: BenchmarkScoringParams) => {
    const caps: Record<string, number> = {}
    for (const key of usefulSubKeys) {
      const mainDeduction = (candidate.mainCounts[key] ?? 0) * params.deductionPerMain
      const cap = Math.max(params.baselineFreeRolls, params.maxPerSub - mainDeduction)
      caps[key] = key === ENERGY_REGEN && targetEr > 0
        ? MAX_ROLLS_PER_KEY
        : Math.min(MAX_ROLLS_PER_KEY, Math.max(0, cap))
    }
    return caps
  }

  const requiredErSubstats = (
    candidate: MainStatCandidate,
    params: BenchmarkScoringParams,
    caps: Record<string, number>,
    rolls: Record<string, number>,
  ): { count: number; total: number } | null => {
    const mainEr = sumEncodedEnergyRegen(candidate.stats, candidate.frame.comboIds)
    const missing = Math.max(0, targetEr - mainEr)
    if (missing <= 0.000001) return { count: 0, total: 0 }

    const roll = rolls[ENERGY_REGEN] ?? 0
    const cap = caps[ENERGY_REGEN] ?? 0
    if (roll <= 0 || cap <= 0) return null

    const count = Math.ceil((missing - 0.000001) / roll)
    if (count > cap || count > params.substatGoal + 0.0001) return null
    return { count, total: missing }
  }

  const optimisticSubstatDamage = (
    candidate: MainStatCandidate,
    params: BenchmarkScoringParams,
    caps: Record<string, number>,
    er: { count: number; total: number },
    rolls: Record<string, number>,
  ) => {
    const working = workingScratch
    working.set(candidate.stats)
    if (er.total > 0) addStatTotal(working, ENERGY_REGEN, er.total)
    for (const key of usefulDamageSubKeys) {
      const roll = rolls[key] ?? 0
      const cap = caps[key] ?? 0
      if (roll <= 0 || cap <= 0) {
        continue
      }
      addStatTotal(working, key, effectiveRollCount(cap, params) * roll)
    }
    return candidate.frame.score(working, candidate.frame.sets)
  }

  const buildSubs = (
    candidate: MainStatCandidate,
    params: BenchmarkScoringParams,
    caps: Record<string, number>,
    er: { count: number; total: number },
    rolls: Record<string, number>,
  ): SubstatCandidate | null => {
    const counts: Record<string, number> = {}
    const working = workingScratch
    working.set(candidate.stats)

    let usedRolls = 0
    const applyRawCount = (key: string, nextCount: number) => {
      const currentCount = counts[key] ?? 0
      const boundedNext = Math.max(0, Math.min(caps[key] ?? 0, nextCount))
      const rawDelta = boundedNext - currentCount
      if (rawDelta <= 0) {
        return 0
      }
      const prevEffective = effectiveRollCount(currentCount, params)
      const nextEffective = effectiveRollCount(boundedNext, params)
      const effectiveDelta = nextEffective - prevEffective
      counts[key] = boundedNext
      addStatTotal(working, key, effectiveDelta * (rolls[key] ?? 0))
      usedRolls += rawDelta
      return rawDelta
    }

    if (er.count > 0) {
      counts[ENERGY_REGEN] = er.count
      addStatTotal(working, ENERGY_REGEN, er.total)
      usedRolls += er.count
    }

    for (const key of usefulDamageSubKeys) {
      applyRawCount(key, Math.min(params.freeRolls, caps[key] ?? 0))
    }
    let workingDamage = candidate.frame.score(working, candidate.frame.sets)

    while (usedRolls < params.substatGoal - 0.0001) {
      const step = Math.min(1, params.substatGoal - usedRolls)
      let bestKey: string | null = null
      let bestGain = 0
      for (const key of usefulDamageSubKeys) {
        const currentCount = counts[key] ?? 0
        const nextCount = Math.min(caps[key] ?? 0, currentCount + step)
        const rawDelta = nextCount - currentCount
        const roll = rolls[key] ?? 0
        if (rawDelta <= 0 || roll <= 0) {
          continue
        }
        const trial = trialScratch
        trial.set(working)
        const prevEffective = effectiveRollCount(currentCount, params)
        const nextEffective = effectiveRollCount(nextCount, params)
        addStatTotal(trial, key, (nextEffective - prevEffective) * roll)
        const gain = candidate.frame.score(trial, candidate.frame.sets) - workingDamage
        if (gain > bestGain) {
          bestGain = gain
          bestKey = key
        }
      }
      if (!bestKey) {
        break
      }
      applyRawCount(bestKey, (counts[bestKey] ?? 0) + step)
      workingDamage += bestGain
    }

    return {
      damage: candidate.frame.score(working, candidate.frame.sets),
      counts,
      main: candidate,
      // Aliases the shared `workingScratch`; only valid until the next trial.
      // `consider` deep-copies this (and the candidate's main stats) when the
      // candidate becomes a new running best.
      stats: working,
    }
  }

  // Try one main-stat candidate against one pass's running best, applying the
  // branch-and-bound prune. Returns the (possibly updated) best. The prune only
  // skips candidates whose valid upper bound can't beat the current best, so the
  // returned maximum is exact regardless of visit order.
  const consider = (
    candidate: MainStatCandidate,
    params: BenchmarkScoringParams,
    rolls: Record<string, number>,
    best: SubstatCandidate | null,
  ): SubstatCandidate | null => {
    const caps = makeCaps(candidate, params)
    const er = requiredErSubstats(candidate, params, caps, rolls)
    if (!er) {
      return best
    }
    const upperBound = optimisticSubstatDamage(candidate, params, caps, er, rolls)
    if (best && upperBound <= best.damage + 0.000001) {
      return best
    }
    const next = buildSubs(candidate, params, caps, er, rolls)
    if (next && (!best || next.damage > best.damage)) {
      // `next.stats` and `next.main.{stats,primaryStats,mainCounts}` alias live
      // scratch / generator buffers that the next iteration overwrites, so
      // capture a durable copy now that this candidate is the running best.
      return {
        damage: next.damage,
        counts: next.counts,
        stats: next.stats.slice(),
        main: {
          ...next.main,
          stats: next.main.stats.slice(),
          primaryStats: next.main.primaryStats.map((entry) => ({ ...entry })),
          mainCounts: { ...next.main.mainCounts },
        },
      }
    }
    return best
  }

  // Both passes (benchmark-quality and perfection-quality rolls) search the
  // identical candidate set and differ only in roll values/budget, so we
  // enumerate each frame's main-stat candidates once and advance both running
  // bests in the same loop. This halves main-stat enumeration vs. two separate
  // passes while keeping peak memory at O(one frame). Each pass still visits its
  // candidates in exactly the same order as before (same frame order, same
  // per-frame order; the other pass's work never touches this pass's best), so
  // the resulting anchors are byte-identical to the two-pass version.
  let benchmark: SubstatCandidate | null = null
  let perfection: SubstatCandidate | null = null
  for (const info of frameInfos) {
    checkCancel?.()
    // enumerate this frame's main-stat candidates on demand; the array is
    // released once the frame is processed, so peak memory stays flat.
    const candidates = enumerateMainStatCandidates(info.frame, info.mainsOnly, info.usefulStats)
    for (const candidate of candidates) {
      checkCancel?.()
      benchmark = consider(candidate, benchmarkParams, benchmarkRolls, benchmark)
      perfection = consider(candidate, maximumParams, maximumRolls, perfection)
    }
  }
  if (!benchmark || !perfection) return null

  const benchmarkSubstats = makeSubstatPlan(
    benchmark.counts,
    (key) => bounds[key].benchmark,
    benchmarkParams,
    targetEr > 0 ? {
      [ENERGY_REGEN]: Math.max(
        0,
        targetEr - sumEncodedStats(benchmark.main.stats, benchmark.main.frame.comboIds).er,
      ),
    } : {},
  )
  const perfectionSubstats = makeSubstatPlan(
    perfection.counts,
    (key) => bounds[key].max,
    maximumParams,
    targetEr > 0 ? {
      [ENERGY_REGEN]: Math.max(
        0,
        targetEr - sumEncodedStats(perfection.main.stats, perfection.main.frame.comboIds).er,
      ),
    } : {},
  )
  const baselineSubstats: BenchmarkSubstatEntry[] = []

  return {
    baselineDamage: benchmarkBaselineDamage,
    benchmarkDamage: benchmark.damage,
    perfectionDamage: perfection.damage,
    builds: {
      baseline0: makeBenchmarkBuildSnapshot({
        label: 'Benchmark 0% build',
        score: 0,
        damage: benchmarkBaselineDamage,
        echoes: noEchoFrame.echoes,
        setRows: noEchoFrame.sets,
        primaryStats: [],
        substats: baselineSubstats,
        substatMode: 'none',
        stats: noEchoFrame.stats,
        scoreDamage: (buffer) => noEchoFrame.score(buffer, noEchoFrame.sets),
        features: benchmarkFeatures(ctx, noEchoFrame, noEchoFrame.stats, noEchoFrame.sets),
        overviewStats: benchmarkOverview(ctx, noEchoFrame, noEchoFrame.stats, noEchoFrame.sets),
      }),
      benchmark100: makeBenchmarkBuildSnapshot({
        label: 'Benchmark 100% build',
        score: 100,
        damage: benchmark.damage,
        echoes: benchmark.main.frame.echoes,
        setRows: benchmark.main.frame.sets,
        primaryStats: benchmark.main.primaryStats,
        substats: benchmarkSubstats,
        substatMode: 'generated',
        stats: benchmark.stats,
        scoreDamage: (buffer) => benchmark.main.frame.score(buffer, benchmark.main.frame.sets),
        features: benchmarkFeatures(ctx, benchmark.main.frame, benchmark.stats, benchmark.main.frame.sets),
        overviewStats: benchmarkOverview(ctx, benchmark.main.frame, benchmark.stats, benchmark.main.frame.sets),
      }),
      benchmark200: makeBenchmarkBuildSnapshot({
        label: 'Benchmark 200% build',
        score: 200,
        damage: perfection.damage,
        echoes: perfection.main.frame.echoes,
        setRows: perfection.main.frame.sets,
        primaryStats: perfection.main.primaryStats,
        substats: perfectionSubstats,
        substatMode: 'generated',
        stats: perfection.stats,
        scoreDamage: (buffer) => perfection.main.frame.score(buffer, perfection.main.frame.sets),
        features: benchmarkFeatures(ctx, perfection.main.frame, perfection.stats, perfection.main.frame.sets),
        overviewStats: benchmarkOverview(ctx, perfection.main.frame, perfection.stats, perfection.main.frame.sets),
      }),
    },
  }
}

// Re-score the live build against precomputed anchors. This is the cheap path:
// one active frame + one score + the active-build snapshot, no candidate search.
export function assembleBenchmark(
  ctx: SuggestContext,
  equipped: Array<EchoInstance | null>,
  anchors: BenchmarkAnchors,
  options: BuildBenchmarkOptions = {},
): BuildBenchmark {
  const resolvedOptions = resolveBenchmarkOptions(options)
  const equippedEchoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  const hasEquippedEchoes = equippedEchoes.length > 0
  const noEchoFrame = makeBenchmarkEchoFrame(ctx, [], new Float32Array(MAIN_BUFF_LEN))
  const activeFrame = hasEquippedEchoes
    ? makeBenchmarkEchoFrame(ctx, equippedEchoes, mkSuggMainEc(ctx, equipped))
    : null
  const activeEvalFrame = activeFrame ?? noEchoFrame
  const activeEchoes = activeFrame ? activeFrame.echoes : []
  const activeStats = activeFrame ? activeFrame.stats : noEchoFrame.stats
  const activeSetRows = activeFrame ? activeFrame.sets : noEchoFrame.sets
  const userDamage = activeEvalFrame.score(activeStats, activeSetRows)

  const totals = sumSubstats(activeEchoes)
  const currentRollCounts = equivalentRollCounts(totals)
  const activePrimaryStats = activeEchoes.map((echo) => ({ ...echo.mainStats.primary }))

  const rollBounds = getRollBounds()

  const activeSubstats = Object.entries(totals)
    .filter(([, total]) => total > 0)
    .map(([key, total]) => ({
      key,
      count: currentRollCounts[key] ?? 0,
      effectiveCount: currentRollCounts[key] ?? 0,
      rollValue: rollBounds[key]?.benchmark ?? 0,
      total,
    }))
    .sort((left, right) => right.total - left.total)

  const percent = scorePercent(userDamage, anchors.baselineDamage, anchors.benchmarkDamage, anchors.perfectionDamage)

  return {
    userDamage,
    baselineDamage: anchors.baselineDamage,
    benchmarkDamage: anchors.benchmarkDamage,
    perfectionDamage: anchors.perfectionDamage,
    percent,
    grade: gradeForPercent(percent * 100),
    invariantStats: resolvedOptions.includeInvariantStats
      ? makeBenchmarkInvariantStats(ctx.sourceFinals)
      : [],
    builds: {
      baseline0: anchors.builds.baseline0,
      active: makeBenchmarkBuildSnapshot({
        label: 'Active build',
        score: percent * 100,
        damage: userDamage,
        echoes: activeEchoes,
        setRows: activeSetRows,
        primaryStats: activePrimaryStats,
        substats: activeSubstats,
        substatMode: 'equipped',
        stats: activeStats,
        scoreDamage: (buffer) => activeEvalFrame.score(buffer, activeSetRows),
        features: resolvedOptions.includeFeatures
          ? benchmarkFeatures(ctx, activeEvalFrame, activeStats, activeSetRows)
          : [],
        overviewStats: benchmarkOverview(ctx, activeEvalFrame, activeStats, activeSetRows),
        includeStatRows: resolvedOptions.includeStatRows,
      }),
      benchmark100: resolvedOptions.includeBenchmarkTargets
        ? anchors.builds.benchmark100
        : stripSnapshotDetails(anchors.builds.benchmark100),
      benchmark200: resolvedOptions.includeBenchmarkTargets
        ? anchors.builds.benchmark200
        : stripSnapshotDetails(anchors.builds.benchmark200),
    },
  }
}

export function buildBenchmark(
  inputCtx: SuggestContext,
  equipped: Array<EchoInstance | null>,
  anchors?: BenchmarkAnchors | null,
  options: BuildBenchmarkOptions = {},
  checkCancel?: BenchCancelCheck,
): BuildBenchmark | null {
  const resolved = anchors ?? buildBenchmarkAnchors(inputCtx, equipped, checkCancel)
  if (!resolved) {
    return null
  }
  return assembleBenchmark(inputCtx, equipped, resolved, options)
}
