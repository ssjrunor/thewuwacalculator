/*
  Author: Runor Ewhro
  Description: Searches valid build space for baseline, evaluation, and maximum builds.
*/
import type { EchoInstance } from '@/domain/entities/runtime';
import { ECHO_MAIN_STATS, SUBSTAT_KEYS, getSbstStepP } from '@/data/gameData/catalog/echoStats';
import { MAIN_BUFF_LEN } from '@/engine/optimizer/config/constants';
import { mkSuggMainEc } from '@/engine/suggestions/shared';
import type { SuggestContext } from '@/engine/suggestions/types';
import { makeEvaluationCostPlans } from './costPlans';
import { applySetPlan, mkSetPlanCnd, prepSetPlanFsb } from '@/engine/suggestions/mutate';
import { ignoresEr } from '@/engine/evaluation/energyRegenPolicy';
import type { EvaluationBuildSnapshot, EvaluationSubstatEntry, BuildEvaluation } from './types.ts';
import { addStatTotal, EVALUATION_ROLL_SOURCE, effectiveRollCount, ENERGY_REGEN, equivalentRollCounts, gradeForPercent, makeEvaluationInvariantStats, makeEvaluationOverviewStats, makeSubstatPlan, MAXIMUM_ROLL_SOURCE, MAX_ROLLS_PER_KEY, normalizeRollParams, removeSubstatTotals, rollAtQuality, scorePercent, sumEncodedEnergyRegen, sumEncodedStats, sumSubstats, type EvaluationEchoFrame, type EvaluationScoringParams, type MainStatCandidate, type SubstatCandidate } from './stats.ts';
import { echoesMatchSetPlan, enumerateMainStatCandidates, findUsefulStatImpacts, mainEchoChoices, makeEvaluationBuildSnapshot, makeEvaluationEchoFrame, makeMainEchoProfiles, makeReferenceEvaluationEchoes, preservedMainEchoFor, retainsUtilityPlan, setEffectSig, utilityPlanFor } from './echoDiscovery.ts';
import { buildEvaluationFeatureBreakdownFromEncoded } from './features.ts';


// The 0%/100%/200% anchors depend on the equipped build only through the ER
// requirement (`targetEr`), retained maxed utility-set plan, and retained
// team-facing main Echo. Splitting the anchor search out from active-build
// scoring lets callers cache the expensive search and re-score the live build
// cheaply (see report.ts). The anchor bundle is plain data (no closures / ctx
// references), so a bundle computed against one ctx can be reused to assemble a
// evaluation against another ctx that shares the same anchor inputs.
export interface EvaluationAnchors {
  baselineDamage: number
  referenceDamage: number
  maximumDamage: number
  builds: {
    baselineBuild: EvaluationBuildSnapshot
    referenceBuild: EvaluationBuildSnapshot
    maximumBuild: EvaluationBuildSnapshot
  }
}

export interface BuildEvaluationOptions {
  includeFeatures?: boolean
  includeStatRows?: boolean
  includeEvaluationTargets?: boolean
  includeInvariantStats?: boolean
}

export type EvaluationCancelCheck = (() => void) | undefined

const DEFAULT_EVALUATION_OPTIONS: Required<BuildEvaluationOptions> = {
  includeFeatures: true,
  includeStatRows: true,
  includeEvaluationTargets: true,
  includeInvariantStats: true,
}

// Lean report assembly can skip the active build's expensive per-stat
// contribution re-scoring, feature breakdown, and invariant stat tree. Target
// snapshots stay included because they are precomputed in the anchors and the
// full report can reuse the same evaluation without another anchor search.
export const LEAN_SCORE_OPTIONS: BuildEvaluationOptions = {
  includeFeatures: false,
  includeStatRows: false,
  includeEvaluationTargets: true,
  includeInvariantStats: false,
}

const MAIN_IMPACT_STAT_LIMIT = 5
const MAIN_IMPACT_STAT_FLOOR = 4
const MAIN_IMPACT_RATIO_FLOOR = 0.5
const SUBSTAT_IMPACT_STAT_LIMIT = 8
const SUBSTAT_IMPACT_STAT_FLOOR = 5
const SUBSTAT_IMPACT_RATIO_FLOOR = 0.12

// The evaluation is a guidance signal, not an optimizer result. Keep the
// report responsive by searching a beam of promising frame families instead
// of materializing the full legal build space. The frame proxy is deliberately
// cheap and deterministic; lowering either cap is an intentional accuracy /
// latency trade-off.
const APPROXIMATE_FRAME_LIMIT = 128
const APPROXIMATE_MAIN_CANDIDATE_LIMIT = 256

function resolveEvaluationOptions(options: BuildEvaluationOptions = {}): Required<BuildEvaluationOptions> {
  return {
    includeFeatures: options.includeFeatures ?? DEFAULT_EVALUATION_OPTIONS.includeFeatures,
    includeStatRows: options.includeStatRows ?? DEFAULT_EVALUATION_OPTIONS.includeStatRows,
    includeEvaluationTargets: options.includeEvaluationTargets ?? DEFAULT_EVALUATION_OPTIONS.includeEvaluationTargets,
    includeInvariantStats: options.includeInvariantStats ?? DEFAULT_EVALUATION_OPTIONS.includeInvariantStats,
  }
}

function stripSnapshotDetails(snapshot: EvaluationBuildSnapshot): EvaluationBuildSnapshot {
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

function evaluationFeatures(ctx: SuggestContext, frame: EvaluationEchoFrame, buffer: Float32Array, setRows: Uint8Array) {
  return buildEvaluationFeatureBreakdownFromEncoded(
    ctx,
    buffer,
    setRows,
    frame.kinds,
    frame.comboIds,
    frame.mainEchoBuffs,
    frame.mainIndex,
  )
}

function evaluationOverview(ctx: SuggestContext, frame: EvaluationEchoFrame, buffer: Float32Array, setRows: Uint8Array) {
  return makeEvaluationOverviewStats({
    ctx,
    stats: buffer,
    setRows,
    kinds: frame.kinds,
    comboIds: frame.comboIds,
    mainEchoBuffs: frame.mainEchoBuffs,
    mainIndex: frame.mainIndex,
  })
}

// Legal evaluation / max roll value per substat. Depends only on static roll
// sources, so it is computed once and shared (read-only) across every anchor
// search and every live re-score instead of being rebuilt per call.
let rollBoundsMemo: Record<string, { evaluation: number; max: number }> | null = null
function getRollBounds(): Record<string, { evaluation: number; max: number }> {
  if (rollBoundsMemo) return rollBoundsMemo
  const evaluationQuality = normalizeRollParams(EVALUATION_ROLL_SOURCE, SUBSTAT_KEYS.length).quality
  const maximumQuality = normalizeRollParams(MAXIMUM_ROLL_SOURCE, SUBSTAT_KEYS.length).quality
  const bounds: Record<string, { evaluation: number; max: number }> = {}
  for (const key of SUBSTAT_KEYS) {
    const steps = getSbstStepP(key)
    bounds[key] = {
      evaluation: rollAtQuality(steps, evaluationQuality),
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
    reserveErSlot?: boolean
  },
): Set<string> {
  const requiresEr = !options.ignoreEr && options.targetEr > 0
  // ER is a hard feasibility constraint. Candidate branching reserves its slot
  // separately so an ER-scaling resonator does not let ER consume one of the
  // damage-stat slots and push a legal stat out of the search.
  const reservesErSlot = requiresEr && options.reserveErSlot === true
  const rankedLimit = Math.max(0, options.limit - (reservesErSlot ? 1 : 0))
  const rankedFloor = Math.min(options.floor, rankedLimit)
  const ranked = [...impacts.entries()]
    .filter(([key, impact]) => impact > 0 && (!reservesErSlot || key !== ENERGY_REGEN))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))

  if (ranked.length <= rankedLimit) {
    const all = new Set(ranked.map(([key]) => key))
    if (requiresEr) {
      all.add(ENERGY_REGEN)
    }
    return all
  }

  const maxImpact = ranked[0]?.[1] ?? 0
  const limited = new Set<string>()
  for (const [key, impact] of ranked) {
    if (
      limited.size < rankedFloor
      || (limited.size < rankedLimit && impact >= maxImpact * options.ratioFloor)
    ) {
      limited.add(key)
    }
  }

  // ER preservation is an anchor constraint, not only a damage-preference stat.
  if (requiresEr) {
    limited.add(ENERGY_REGEN)
  }

  return limited.size > 0 ? limited : new Set(ranked.map(([key]) => key))
}

// The ER total the generated anchor builds must reproduce, taken from the
// equipped build (one of the two ways the equipped build feeds the anchors).
export function evaluationErTarget(
  ctx: SuggestContext,
  equipped: Array<EchoInstance | null>,
): number {
  if (ignoresEr(ctx.runtime.id)) return 0
  const echoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  if (echoes.length === 0) return 0
  const frame = makeEvaluationEchoFrame(ctx, echoes, mkSuggMainEc(ctx, equipped))
  return Math.max(0, sumEncodedStats(frame.stats, frame.comboIds).er)
}

export function buildEvaluationAnchors(
  ctx: SuggestContext,
  equipped: Array<EchoInstance | null>,
  checkCancel?: EvaluationCancelCheck,
): EvaluationAnchors | null {
  const costPlans = makeEvaluationCostPlans()
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
  const evaluationFrames = costPlans.flatMap((costPlan) => {
    if (requiredMainEchoCost != null && !costPlan.includes(requiredMainEchoCost)) return []
    const reference = makeReferenceEvaluationEchoes(costPlan, null)
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

        const base = makeReferenceEvaluationEchoes(costPlan, choice.echo)
        if (base.length !== 5) return []
        const echoes = applySetPlan(setPlan, base).filter((echo): echo is EchoInstance => echo != null)
        // distinct by id|set (the in-game piece rule): the same id may serve two
        // different sets, but a duplicated id+set pair would waste a slot.
        if (echoes.length !== 5 || new Set(echoes.map((echo) => `${echo.id}|${echo.set}`)).size !== 5) return []
        if (!echoes.some((echo) => echo.mainEcho && echo.id === choice.echo.id)) return []
        if (!echoesMatchSetPlan(echoes, setPlan)) return []

        seenFrames.add(frameSig)
        return [makeEvaluationEchoFrame(ctx, echoes, mkSuggMainEc(ctx, echoes), setPlan)]
      })
    })
  })
  if (evaluationFrames.length === 0) {
    return null
  }

  const noEchoFrame = makeEvaluationEchoFrame(ctx, [], new Float32Array(MAIN_BUFF_LEN))
  const evaluationBaselineDamage = noEchoFrame.score(noEchoFrame.stats, noEchoFrame.sets)

  const ignoreEr = ignoresEr(ctx.runtime.id)
  const targetEr = evaluationErTarget(ctx, equipped)

  // legal roll bounds and the evaluation-quality roll for each substat
  const bounds = getRollBounds()
  const evaluationParams = normalizeRollParams(EVALUATION_ROLL_SOURCE, SUBSTAT_KEYS.length)
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
  const mainsOnlyByFrame = evaluationFrames.map((frame) => {
    const mainsOnly = frame.stats.slice()
    removeSubstatTotals(mainsOnly, sumSubstats(frame.echoes))
    return mainsOnly
  })
  const usefulSampleStride = Math.max(1, Math.floor(evaluationFrames.length / 48))
  const sharedUsefulImpacts = new Map<string, number>()
  for (let index = 0; index < evaluationFrames.length; index += usefulSampleStride) {
    for (const { key, impact } of findUsefulStatImpacts(evaluationFrames[index], mainsOnlyByFrame[index])) {
      sharedUsefulImpacts.set(key, Math.max(sharedUsefulImpacts.get(key) ?? 0, impact))
    }
  }
  if (ignoreEr) {
    sharedUsefulImpacts.delete(ENERGY_REGEN)
  }
  // Rank each candidate family only against stats that are legal in that
  // family. A main-only elemental stat must not consume a substat rank and
  // evict a legal damage roll (Brant + team buffs can otherwise lose Basic
  // Attack DMG from the 200% anchor), and the inverse applies to substat-only
  // damage types during main-stat enumeration.
  const legalMainStats = new Set(
    Object.values(ECHO_MAIN_STATS).flatMap((stats) => Object.keys(stats)),
  )
  const mainUsefulImpacts = new Map(
    [...sharedUsefulImpacts].filter(([key]) => legalMainStats.has(key)),
  )
  const substatUsefulImpacts = new Map(
    [...sharedUsefulImpacts].filter(([key]) => SUBSTAT_KEYS.includes(key)),
  )
  const mainUsefulStats = limitUsefulStatsByImpact(mainUsefulImpacts, {
    ignoreEr,
    targetEr,
    limit: MAIN_IMPACT_STAT_LIMIT,
    floor: MAIN_IMPACT_STAT_FLOOR,
    ratioFloor: MAIN_IMPACT_RATIO_FLOOR,
    reserveErSlot: true,
  })
  const substatUsefulStats = limitUsefulStatsByImpact(substatUsefulImpacts, {
    ignoreEr,
    targetEr,
    limit: SUBSTAT_IMPACT_STAT_LIMIT,
    floor: SUBSTAT_IMPACT_STAT_FLOOR,
    ratioFloor: SUBSTAT_IMPACT_RATIO_FLOOR,
    reserveErSlot: true,
  })
  const usefulSubKeys = SUBSTAT_KEYS.filter((entry) => substatUsefulStats.has(entry))
  const usefulDamageSubKeys = usefulSubKeys.filter((entry) => entry !== ENERGY_REGEN)
  const evaluationRolls = Object.fromEntries(usefulSubKeys.map((key) => [key, bounds[key]?.evaluation ?? 0]))
  const maximumRolls = Object.fromEntries(usefulSubKeys.map((key) => [key, bounds[key]?.max ?? 0]))

  const frameInfos = evaluationFrames.map((frame, index) => {
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
  const scratchLen = evaluationFrames[0].stats.length
  const workingScratch = new Float32Array(scratchLen)
  const trialScratch = new Float32Array(scratchLen)

  // Compose normalized substat roll counts: free/filler rolls across every
  // substat category, caps reduced by matching main stats, and the remaining
  // budget greedily assigned to the best damage stats.
  const makeCaps = (candidate: MainStatCandidate, params: EvaluationScoringParams) => {
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
    params: EvaluationScoringParams,
    caps: Record<string, number>,
    rolls: Record<string, number>,
  ): { count: number; total: number } | null => {
    const mainEr = sumEncodedEnergyRegen(candidate.stats, candidate.frame.comboIds)
    const missing = Math.max(0, targetEr - mainEr)
    if (missing <= 0.000001) return { count: 0, total: 0 }

    const roll = rolls[ENERGY_REGEN] ?? 0
    const cap = caps[ENERGY_REGEN] ?? 0
    if (roll <= 0 || cap <= 0) return null

    // `targetEr` is accumulated through Float32 echo rows, while legal roll
    // values are ordinary JS numbers. Compare in roll-count space so a target
    // such as 62.0000019 ER remains exactly five legal 12.4 rolls instead of
    // being rounded up to an impossible sixth roll.
    const count = Math.ceil((missing / roll) - 0.000001)
    if (count > cap || count > params.substatGoal + 0.0001) return null
    return { count, total: missing }
  }

  const optimisticSubstatDamage = (
    candidate: MainStatCandidate,
    params: EvaluationScoringParams,
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
    params: EvaluationScoringParams,
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
    params: EvaluationScoringParams,
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

  // Both passes (evaluation-quality and perfection-quality rolls) search the
  // identical bounded candidate set and differ only in roll values/budget, so
  // each frame's main-stat candidates are enumerated once. This halves main
  // stat enumeration vs. two separate passes while keeping peak memory at
  // O(one frame). The bounded beam is intentional: the report favors a fast,
  // useful estimate over exhaustive accuracy.
  let evaluation: SubstatCandidate | null = null
  let perfection: SubstatCandidate | null = null
  const frameBeam = frameInfos.slice(0, APPROXIMATE_FRAME_LIMIT)
  for (const info of frameBeam) {
    checkCancel?.()
    // enumerate this frame's main-stat candidates on demand; the array is
    // released once the frame is processed, so peak memory stays flat.
    const candidates = enumerateMainStatCandidates(info.frame, info.mainsOnly, info.usefulStats)
    let candidateCount = 0
    for (const candidate of candidates) {
      checkCancel?.()
      if (candidateCount >= APPROXIMATE_MAIN_CANDIDATE_LIMIT) break
      candidateCount += 1
      evaluation = consider(candidate, evaluationParams, evaluationRolls, evaluation)
      perfection = consider(candidate, maximumParams, maximumRolls, perfection)
    }
  }
  if (!evaluation || !perfection) return null

  const evaluationSubstats = makeSubstatPlan(
    evaluation.counts,
    (key) => bounds[key].evaluation,
    evaluationParams,
    targetEr > 0 ? {
      [ENERGY_REGEN]: Math.max(
        0,
        targetEr - sumEncodedStats(evaluation.main.stats, evaluation.main.frame.comboIds).er,
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
  const baselineSubstats: EvaluationSubstatEntry[] = []

  return {
    baselineDamage: evaluationBaselineDamage,
    referenceDamage: evaluation.damage,
    maximumDamage: perfection.damage,
    builds: {
      baselineBuild: makeEvaluationBuildSnapshot({
        label: 'Baseline build',
        score: 0,
        damage: evaluationBaselineDamage,
        echoes: noEchoFrame.echoes,
        setRows: noEchoFrame.sets,
        primaryStats: [],
        substats: baselineSubstats,
        substatMode: 'none',
        stats: noEchoFrame.stats,
        scoreDamage: (buffer) => noEchoFrame.score(buffer, noEchoFrame.sets),
        features: evaluationFeatures(ctx, noEchoFrame, noEchoFrame.stats, noEchoFrame.sets),
        overviewStats: evaluationOverview(ctx, noEchoFrame, noEchoFrame.stats, noEchoFrame.sets),
      }),
      referenceBuild: makeEvaluationBuildSnapshot({
        label: 'Reference build',
        score: 100,
        damage: evaluation.damage,
        echoes: evaluation.main.frame.echoes,
        setRows: evaluation.main.frame.sets,
        primaryStats: evaluation.main.primaryStats,
        substats: evaluationSubstats,
        substatMode: 'generated',
        stats: evaluation.stats,
        scoreDamage: (buffer) => evaluation.main.frame.score(buffer, evaluation.main.frame.sets),
        features: evaluationFeatures(ctx, evaluation.main.frame, evaluation.stats, evaluation.main.frame.sets),
        overviewStats: evaluationOverview(ctx, evaluation.main.frame, evaluation.stats, evaluation.main.frame.sets),
      }),
      maximumBuild: makeEvaluationBuildSnapshot({
        label: 'Maximum build',
        score: 200,
        damage: perfection.damage,
        echoes: perfection.main.frame.echoes,
        setRows: perfection.main.frame.sets,
        primaryStats: perfection.main.primaryStats,
        substats: perfectionSubstats,
        substatMode: 'generated',
        stats: perfection.stats,
        scoreDamage: (buffer) => perfection.main.frame.score(buffer, perfection.main.frame.sets),
        features: evaluationFeatures(ctx, perfection.main.frame, perfection.stats, perfection.main.frame.sets),
        overviewStats: evaluationOverview(ctx, perfection.main.frame, perfection.stats, perfection.main.frame.sets),
      }),
    },
  }
}

// Re-score the live build against precomputed anchors. This is the cheap path:
// one active frame + one score + the active-build snapshot, no candidate search.
export function assembleEvaluation(
  ctx: SuggestContext,
  equipped: Array<EchoInstance | null>,
  anchors: EvaluationAnchors,
  options: BuildEvaluationOptions = {},
): BuildEvaluation {
  const resolvedOptions = resolveEvaluationOptions(options)
  const equippedEchoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  const hasEquippedEchoes = equippedEchoes.length > 0
  const noEchoFrame = makeEvaluationEchoFrame(ctx, [], new Float32Array(MAIN_BUFF_LEN))
  const activeFrame = hasEquippedEchoes
    ? makeEvaluationEchoFrame(ctx, equippedEchoes, mkSuggMainEc(ctx, equipped))
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
      rollValue: rollBounds[key]?.evaluation ?? 0,
      total,
    }))
    .sort((left, right) => right.total - left.total)

  const percent = scorePercent(userDamage, anchors.baselineDamage, anchors.referenceDamage, anchors.maximumDamage)

  return {
    userDamage,
    baselineDamage: anchors.baselineDamage,
    referenceDamage: anchors.referenceDamage,
    maximumDamage: anchors.maximumDamage,
    percent,
    grade: gradeForPercent(percent * 100),
    invariantStats: resolvedOptions.includeInvariantStats
      ? makeEvaluationInvariantStats(ctx.sourceFinals)
      : [],
    builds: {
      baselineBuild: anchors.builds.baselineBuild,
      active: makeEvaluationBuildSnapshot({
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
          ? evaluationFeatures(ctx, activeEvalFrame, activeStats, activeSetRows)
          : [],
        overviewStats: evaluationOverview(ctx, activeEvalFrame, activeStats, activeSetRows),
        includeStatRows: resolvedOptions.includeStatRows,
      }),
      referenceBuild: resolvedOptions.includeEvaluationTargets
        ? anchors.builds.referenceBuild
        : stripSnapshotDetails(anchors.builds.referenceBuild),
      maximumBuild: resolvedOptions.includeEvaluationTargets
        ? anchors.builds.maximumBuild
        : stripSnapshotDetails(anchors.builds.maximumBuild),
    },
  }
}

export function buildEvaluation(
  inputCtx: SuggestContext,
  equipped: Array<EchoInstance | null>,
  anchors?: EvaluationAnchors | null,
  options: BuildEvaluationOptions = {},
  checkCancel?: EvaluationCancelCheck,
): BuildEvaluation | null {
  const resolved = anchors ?? buildEvaluationAnchors(inputCtx, equipped, checkCancel)
  if (!resolved) {
    return null
  }
  return assembleEvaluation(inputCtx, equipped, resolved, options)
}
