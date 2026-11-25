/*
  Author: Runor Ewhro
  description: searches valid build space for baseline, evaluation, and maximum builds.
*/
import type { EchoInstance } from '@/domain/entities/runtime';
import { ECHO_MAIN_STATS, SUBSTAT_KEYS, getSbstStepP } from '@/data/gameData/catalog/echoStats';
import { ECHO_STAT_STRIDE, MAIN_BUFF_LEN } from '@/engine/search/layout/constants';
import type { SuggestContext } from '@/engine/suggestions/types';
import { makeEvaluationCostPlans } from './costPlans';
import { applySetPlan, prepSetPlanFsb } from '@/engine/suggestions/mutate';
import { mkSetPlanCnd } from '@/engine/search/combos/setPlans';
import { ignoresEr } from '@/engine/evaluation/energyRegenPolicy';
import { aggregateSubstats } from '@/engine/evaluation/substatMath';
import type { EvaluationBuildSnapshot, EvaluationSubstatEntry, BuildEvaluation } from './types.ts';
import { addStatTotal, ENERGY_REGEN, gradeForPercent, makeEvaluationInvariantStats, makeEvaluationOverviewStats, makeSubstatPlan, MAXIMUM_SCORING_PARAMS, MAX_ROLLS_PER_KEY, removeSubstatTotals, scorePercent, sumEncodedEnergyRegen, sumSubstats, type EvaluationEchoFrame, type EvaluationScoringParams, type MainStatCandidate, type SubstatCandidate } from './stats.ts';
import { makeEvaluationSearchFrame, echoesMatchSetPlan, enumerateMainStatCandidates, findUsefulStatImpacts, prepareMainEchoChoices, makeEvaluationBuildSnapshot, makeEvaluationEchoFrame, makeMainEchoProfiles, makeReferenceEvaluationEchoes, makeSetSummary, preservedMainEchoFor, retainsUtilityPlan, setEffectSig, utilityPlanFor } from './echoDiscovery.ts';
import { buildEvaluationFeatureBreakdownFromEncoded } from './features.ts';
import { distributeStepSubstats, prepareStepAllocator, stepSubstatPlan } from './stepAllocation';
import { scoreStats, resolveEvaluationStats } from './scoring';
import { mkSuggMainEc } from '@/engine/suggestions/shared';
import { EVALUATION_SEARCH } from './config';


// the 0%/100%/200% anchors depend on the equipped build only through the er
// requirement (`targetEr`), retained maxed utility-set plan, and retained
// team-facing main echo. splitting the anchor search out from active-build
// scoring lets callers cache the expensive search and re-score the live build
// cheaply (see report.ts). the anchor bundle is plain data (no closures / ctx
// references), so a bundle computed against one ctx can be reused to assemble a
// evaluation against another ctx that shares the same anchor inputs.
export interface EvaluationAnchors {
  baselineDamage: number
  referenceDamage: number
  maximumDamage: number
  builds: {
    baselineBuild: EvaluationAnchorBuild
    referenceBuild: EvaluationAnchorBuild
    maximumBuild: EvaluationAnchorBuild
  }
}

// retain only the scoring inputs. report-only feature trees and stat rows are
// derived from these when a report requests them.
interface EvaluationAnchorBuild {
  echoes: EchoInstance[]
  stats: Float32Array
  primaryStats: Array<{ key: string; value: number }>
  substats: EvaluationSubstatEntry[]
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

// lean report assembly can skip the active build's expensive per-stat
// contribution re-scoring, feature breakdown, and invariant stat tree. target
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

// bound the candidate beam to keep evaluation responsive; a smaller cap can
// reduce search accuracy.
const APPROXIMATE_FRAME_LIMIT = EVALUATION_SEARCH.frameLimit
// reference tier allocation dominates search time; the maximum pass keeps
// the wider beam because its per-candidate fill is inexpensive.
const REFERENCE_FRAME_LIMIT = EVALUATION_SEARCH.referenceFrameLimit
const APPROXIMATE_MAIN_CANDIDATE_LIMIT = EVALUATION_SEARCH.mainCandidateLimit
const REFERENCE_REFINEMENT_LIMIT = EVALUATION_SEARCH.referenceRefinementLimit

// a reference trial changes only row zero. main-stat permutations with the
// same first row and remaining-row totals have the same prepared score for
// every legal substat allocation in this fixed frame. retain their first
// occurrence so equal-damage ties keep the original echo layout.
function referenceCandidateSignature(stats: Float32Array): string {
  const parts = new Array<string>(ECHO_STAT_STRIDE)
  for (let stat = 0; stat < ECHO_STAT_STRIDE; stat += 1) {
    let fixed = 0
    for (let row = 1; row < 5; row += 1) fixed += stats[row * ECHO_STAT_STRIDE + stat]
    parts[stat] = `${stats[stat]}:${fixed}`
  }
  return parts.join('|')
}

function resolveEvaluationOptions(options: BuildEvaluationOptions = {}): Required<BuildEvaluationOptions> {
  return {
    includeFeatures: options.includeFeatures ?? DEFAULT_EVALUATION_OPTIONS.includeFeatures,
    includeStatRows: options.includeStatRows ?? DEFAULT_EVALUATION_OPTIONS.includeStatRows,
    includeEvaluationTargets: options.includeEvaluationTargets ?? DEFAULT_EVALUATION_OPTIONS.includeEvaluationTargets,
    includeInvariantStats: options.includeInvariantStats ?? DEFAULT_EVALUATION_OPTIONS.includeInvariantStats,
  }
}

function materializeAnchorBuild(
  ctx: SuggestContext,
  anchor: EvaluationAnchorBuild,
  label: string,
  score: number,
  damage: number,
  includeDetails: boolean,
  includeStatRows: boolean,
  includeFeatures: boolean,
): EvaluationBuildSnapshot {
  if (!includeDetails) {
    return {
      label,
      score,
      damage,
      sets: makeSetSummary(Uint8Array.from(anchor.echoes.map((echo) => echo.set)), anchor.echoes),
      echoes: [],
      substatMode: score === 0 ? 'none' : 'generated',
      statRows: [],
      overviewStats: { mainStats: [], secondaryStats: [], dmgMdfrStts: [] },
      features: [],
      featureGroups: { skillTypes: [], tabs: [] },
    }
  }
  const frame = makeEvaluationEchoFrame(ctx, anchor.echoes, mkSuggMainEc(ctx, anchor.echoes))
  // early compact anchors stored this vector as a plain array. IndexedDB can
  // still return one during a hot update, and scoring requires subarray().
  const stats = Float32Array.from(anchor.stats)
  return makeEvaluationBuildSnapshot({
    label,
    score,
    damage,
    echoes: anchor.echoes,
    setRows: frame.sets,
    primaryStats: anchor.primaryStats,
    substats: anchor.substats,
    substatMode: score === 0 ? 'none' : 'generated',
    stats,
    scoreDamage: (buffer) => frame.score(buffer, frame.sets),
    features: includeDetails && includeFeatures
      ? evaluationFeatures(ctx, frame, stats, frame.sets)
      : [],
    overviewStats: includeDetails
      ? evaluationOverview(ctx, frame, stats, frame.sets)
      : { mainStats: [], secondaryStats: [], dmgMdfrStts: [] },
    includeStatRows: includeDetails && includeStatRows,
  })
}

export function materializeEvaluationAnchorBuilds(
  ctx: SuggestContext,
  anchors: EvaluationAnchors,
  options: BuildEvaluationOptions = {},
): {
  baselineBuild: EvaluationBuildSnapshot
  referenceBuild: EvaluationBuildSnapshot
  maximumBuild: EvaluationBuildSnapshot
} {
  const resolved = resolveEvaluationOptions(options)
  const details = resolved.includeEvaluationTargets
  return {
    baselineBuild: materializeAnchorBuild(ctx, anchors.builds.baselineBuild,
      'Baseline build', 0, anchors.baselineDamage, details,
      resolved.includeStatRows, resolved.includeFeatures),
    referenceBuild: materializeAnchorBuild(ctx, anchors.builds.referenceBuild,
      'Reference build', 100, anchors.referenceDamage, details,
      resolved.includeStatRows, resolved.includeFeatures),
    maximumBuild: materializeAnchorBuild(ctx, anchors.builds.maximumBuild,
      'Maximum build', 200, anchors.maximumDamage, details,
      resolved.includeStatRows, resolved.includeFeatures),
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
    frame.echoes,
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
    echoes: frame.echoes,
  })
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
  // er is a hard feasibility constraint. candidate branching reserves its slot
  // separately so an er-scaling resonator does not let er consume one of the
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

  // er preservation is an anchor constraint, not only a damage-preference stat.
  if (requiresEr) {
    limited.add(ENERGY_REGEN)
  }

  return limited.size > 0 ? limited : new Set(ranked.map(([key]) => key))
}

function frameEnergyRegen(ctx: SuggestContext, frame: EvaluationEchoFrame): number {
  // candidate ER belongs to the compact search model. do not lower a rotation
  // program or construct report rows while considering search frames.
  return resolveEvaluationStats(ctx, {
    stats: frame.stats, sets: frame.sets, kinds: frame.kinds,
    comboIds: frame.comboIds, mainEchoBuffs: frame.mainEchoBuffs, mainIndex: frame.mainIndex,
  })?.er ?? 0
}

// match the representative combat er, including source stats, sets, and the
// main echo effect. candidate er uses that same evaluator snapshot.
export function evaluationErTarget(
  ctx: SuggestContext,
  equipped: Array<EchoInstance | null>,
): number {
  if (ignoresEr(ctx.runtime.id)) return 0
  const echoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  if (echoes.length === 0) return 0
  const frame = makeEvaluationEchoFrame(ctx, echoes, mkSuggMainEc(ctx, equipped))
  return Math.max(0, evaluationOverview(ctx, frame, frame.stats, frame.sets)
    .secondaryStats.find(row => row.key === ENERGY_REGEN)?.total ?? 0)
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
  const selectMainEchoChoices = prepareMainEchoChoices(mainEchoProfiles, requiredMainEcho?.id ?? null)
  const frameDescriptors: Array<{
    costPlan: number[]
    setPlan: EvaluationEchoFrame['setPlan']
    mainEcho: EchoInstance
  }> = []
  const forEachEvaluationFrame = (visit: (frame: EvaluationEchoFrame, index: number) => void, stride = 1): number => {
    // the first pass establishes legal frame identities. later sparse passes
    // reuse them and materialize only sampled frames.
    if (frameDescriptors.length > 0) {
      for (let index = 0; index < frameDescriptors.length; index += stride) {
        const descriptor = frameDescriptors[index]
        const echoes = applySetPlan(descriptor.setPlan,
          makeReferenceEvaluationEchoes(descriptor.costPlan, descriptor.mainEcho),
          { id: descriptor.mainEcho.id, setId: descriptor.mainEcho.set })
          .filter((echo): echo is EchoInstance => echo != null)
        visit(makeEvaluationSearchFrame(ctx, echoes, mkSuggMainEc(ctx, echoes), descriptor.setPlan), index)
      }
      return frameDescriptors.length
    }
    let frameIndex = 0
    for (const costPlan of costPlans) {
      if (requiredMainEchoCost != null && !costPlan.includes(requiredMainEchoCost)) continue
      const reference = makeReferenceEvaluationEchoes(costPlan, null)
      if (reference.length !== 5) continue
      const seenFrames = new Set<string>()
      const isFeasible = prepSetPlanFsb(reference)

      for (const { plan: setPlan, effectSig } of setPlans) {
        if (!isFeasible(setPlan)) continue
        const choices = selectMainEchoChoices(costPlan, setPlan)
        for (const choice of choices) {
          // the frame's `mainSig` is fully determined by the main Echo's own
          // effect class (`choice.effectSig`), the team-facing main-echo buff
          // never depends on the filler echoes or the set assignment, so the real
          // `mainEchoEffectSig` always equals `choice.effectSig`. that makes the
          // whole dedup key knowable before any echo assembly, so the ~95% of
          // (set-effect x main-echo) combos that collapse to an already-seen frame
          // skip the expensive applySetPlan / validity / mkSuggMainEc work.
          const frameSig = `${effectSig}|${choice.effectSig}`
          if (seenFrames.has(frameSig)) continue

          const base = makeReferenceEvaluationEchoes(costPlan, choice.echo)
          if (base.length !== 5) continue
          const echoes = applySetPlan(setPlan, base, { id: choice.echo.id, setId: choice.echo.set }).filter((echo): echo is EchoInstance => echo != null)
          // distinct by id|set (the in-game piece rule): the same id may serve two
          // different sets, but a duplicated id+set pair would waste a slot.
          if (echoes.length !== 5 || new Set(echoes.map((echo) => `${echo.id}|${echo.set}`)).size !== 5) continue
          if (!echoes.some((echo) => echo.mainEcho && echo.id === choice.echo.id)) continue
          if (!echoesMatchSetPlan(echoes, setPlan)) continue

          seenFrames.add(frameSig)
          const index = frameIndex++
          frameDescriptors.push({ costPlan, setPlan, mainEcho: choice.echo })
          if (index % stride === 0) {
            visit(makeEvaluationSearchFrame(ctx, echoes, mkSuggMainEc(ctx, echoes), setPlan), index)
          }
        }
      }
    }
    return frameIndex
  }

  // only 128 frame families can enter the bounded search. keep those frames
  // and their score proxies, releasing every other candidate immediately.
  const frameInfos: Array<{
    echoes: EchoInstance[]
    setPlan: EvaluationEchoFrame['setPlan']
    order: number
  }> = []
  const frameCount = forEachEvaluationFrame((frame) => {
    checkCancel?.()
    const mainsOnly = frame.stats.slice()
    removeSubstatTotals(mainsOnly, sumSubstats(frame.echoes))
    const info = {
      echoes: frame.echoes,
      setPlan: frame.setPlan,
      order: frame.score(mainsOnly, frame.sets),
    }
    const insertAt = frameInfos.findIndex((existing) => existing.order < info.order)
    if (insertAt < 0) frameInfos.push(info)
    else frameInfos.splice(insertAt, 0, info)
    if (frameInfos.length > APPROXIMATE_FRAME_LIMIT) frameInfos.pop()
  })
  if (frameCount === 0) {
    return null
  }

  const noEchoFrame = makeEvaluationSearchFrame(ctx, [], new Float32Array(MAIN_BUFF_LEN))

  const ignoreEr = ignoresEr(ctx.runtime.id)
  const targetEr = evaluationErTarget(ctx, equipped)
  const erInvestment = Math.max(0, targetEr - frameEnergyRegen(ctx, noEchoFrame))

  // native legal tiers for the reference and maximum per-line values.
  const tiers = Object.fromEntries(SUBSTAT_KEYS.map(key => [key, getSbstStepP(key)]))
  const nonErSubKeys = SUBSTAT_KEYS.filter((key) => key !== ENERGY_REGEN)
  const maximumParams = MAXIMUM_SCORING_PARAMS

  // evaluation proposes builds with its compact, bounded heuristic. sample
  // stat impacts within that model and keep its small main/substat shortlist;
  // the selected anchors are rescored with the full rotation at the end.
  const usefulSampleStride = Math.max(1, Math.floor(frameCount / 48))
  const sharedUsefulImpacts = new Map<string, number>()
  forEachEvaluationFrame((frame) => {
    checkCancel?.()
    const mainsOnly = frame.stats.slice()
    removeSubstatTotals(mainsOnly, sumSubstats(frame.echoes))
    for (const { key, impact } of findUsefulStatImpacts(frame, mainsOnly)) {
      sharedUsefulImpacts.set(key, Math.max(sharedUsefulImpacts.get(key) ?? 0, impact))
    }
  }, usefulSampleStride)
  if (ignoreEr) {
    sharedUsefulImpacts.delete(ENERGY_REGEN)
  }
  // rank each candidate family only against stats that are legal in that
  // family. a main-only elemental stat must not consume a substat rank and
  // evict a legal damage roll (brant + team buffs can otherwise lose basic
  // attack dmg from the 200% anchor), and the inverse applies to substat-only
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
    targetEr: erInvestment,
    limit: MAIN_IMPACT_STAT_LIMIT,
    floor: MAIN_IMPACT_STAT_FLOOR,
    ratioFloor: MAIN_IMPACT_RATIO_FLOOR,
    reserveErSlot: true,
  })
  const substatUsefulStats = limitUsefulStatsByImpact(substatUsefulImpacts, {
    ignoreEr,
    targetEr: erInvestment,
    limit: SUBSTAT_IMPACT_STAT_LIMIT,
    floor: SUBSTAT_IMPACT_STAT_FLOOR,
    ratioFloor: SUBSTAT_IMPACT_RATIO_FLOOR,
    reserveErSlot: true,
  })
  const usefulSubKeys = SUBSTAT_KEYS.filter((entry) => substatUsefulStats.has(entry))
  const usefulDamageSubKeys = usefulSubKeys.filter((entry) => entry !== ENERGY_REGEN)
  // use every damage-relevant key for the reference's relevant-line cap. the ranked
  // maximum-search shortlist must not relabel weak damage stats as free filler.
  const referenceRelevantKeys = [...substatUsefulImpacts.keys()].filter(key => key !== ENERGY_REGEN)
  const allocateSteps = prepareStepAllocator(tiers, referenceRelevantKeys)
  const maximumRolls = Object.fromEntries(SUBSTAT_KEYS.map((key) => [key, tiers[key].at(-1) ?? 0]))

  // shared substat search vectors serve every candidate. per-roll Float32Array
  // allocations are the dominant source of gc churn in the greedy fill.
  const firstFrame = makeEvaluationSearchFrame(ctx, frameInfos[0].echoes,
    mkSuggMainEc(ctx, frameInfos[0].echoes), frameInfos[0].setPlan)
  const scratchLen = firstFrame.stats.length
  const workingScratch = new Float32Array(scratchLen)
  const trialScratch = new Float32Array(scratchLen)

  // er is additive in the packed evaluator. resolve the source/set/main-Echo
  // contribution once per frame, then add each candidate's encoded main er.
  const frameErOffsets = new WeakMap<EvaluationEchoFrame, number>()
  const candidateEnergyRegen = (candidate: MainStatCandidate) => {
    let offset = frameErOffsets.get(candidate.frame)
    if (offset == null) {
      offset = frameEnergyRegen(ctx, candidate.frame)
        - sumEncodedEnergyRegen(candidate.frame.stats, candidate.frame.comboIds)
      frameErOffsets.set(candidate.frame, offset)
    }
    return offset + sumEncodedEnergyRegen(candidate.stats, candidate.frame.comboIds)
  }

  const makeCaps = (params: EvaluationScoringParams) => Object.fromEntries(
    SUBSTAT_KEYS.map(key => [key, Math.min(MAX_ROLLS_PER_KEY, params.maxPerSub)]),
  )

  const requiredErSubstats = (
    candidate: MainStatCandidate,
    params: EvaluationScoringParams,
    caps: Record<string, number>,
    rolls: Record<string, number>,
  ): { count: number; total: number } | null => {
    const mainEr = candidateEnergyRegen(candidate)
    const missing = Math.max(0, targetEr - mainEr)
    if (missing <= 0.000001) return { count: 0, total: 0 }

    const roll = rolls[ENERGY_REGEN] ?? 0
    const cap = caps[ENERGY_REGEN] ?? 0
    if (roll <= 0 || cap <= 0) return null

    // `targetEr` is accumulated through float32 echo rows, while legal roll
    // values are ordinary js numbers. compare in roll-count space so a target
    // such as 62.0000019 er remains exactly five legal 12.4 rolls.
    const count = Math.ceil((missing / roll) - 0.000001)
    if (count > cap || count > params.substatGoal) return null
    return { count, total: missing }
  }

  const optimisticSubstatDamage = (
    candidate: MainStatCandidate,
    caps: Record<string, number>,
    er: { count: number; total: number },
    rolls: Record<string, number>,
  ) => {
    const working = workingScratch
    working.set(candidate.stats)
    if (er.total > 0) addStatTotal(working, ENERGY_REGEN, er.total)
    for (const key of nonErSubKeys) {
      const roll = rolls[key] ?? 0
      const cap = substatUsefulStats.has(key) ? (caps[key] ?? 0) : 0
      if (roll <= 0 || cap <= 0) {
        continue
      }
      addStatTotal(working, key, cap * roll)
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
    const scoreCandidate = candidate.frame.prepareFirstLaneScore(candidate.stats)
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
      const effectiveDelta = rawDelta
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

    let workingDamage = scoreCandidate(working)

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
        addStatTotal(trial, key, rawDelta * roll)
        const gain = scoreCandidate(trial) - workingDamage
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
      damage: scoreCandidate(working),
      counts,
      main: candidate,
      // aliases the shared `workingScratch`; only valid until the next trial.
      // `consider` deep-copies this (and the candidate's main stats) when the
      // candidate becomes a new running best.
      stats: working,
    }
  }

  const replayFinalists = ctx.mode === 'rotation' && ctx.preserveEchoStateChanges
  const maximumFinalists: SubstatCandidate[] = []
  const retainCandidate = (candidate: SubstatCandidate): SubstatCandidate => ({
    ...candidate,
    counts: { ...candidate.counts },
    stats: candidate.stats.slice(),
    main: {
      ...candidate.main,
      stats: candidate.main.stats.slice(),
      primaryStats: candidate.main.primaryStats.map(entry => ({ ...entry })),
      mainCounts: { ...candidate.main.mainCounts },
    },
  })

  // compare one main-stat candidate with the current best; prune only when its
  // upper bound cannot win. remaining fill uses the bounded candidate pool.
  const consider = (
    candidate: MainStatCandidate,
    params: EvaluationScoringParams,
    rolls: Record<string, number>,
    best: SubstatCandidate | null,
  ): SubstatCandidate | null => {
    const caps = makeCaps(params)
    const er = requiredErSubstats(candidate, params, caps, rolls)
    if (!er) {
      return best
    }
    const upperBound = optimisticSubstatDamage(candidate, caps, er, rolls)
    const threshold = replayFinalists
      ? maximumFinalists.length === REFERENCE_REFINEMENT_LIMIT ? maximumFinalists.at(-1)!.damage : -Infinity
      : best?.damage
    if (threshold != null && upperBound <= threshold + 0.000001) {
      return best
    }
    const next = buildSubs(candidate, params, caps, er, rolls)
    if (replayFinalists && next && (maximumFinalists.length < REFERENCE_REFINEMENT_LIMIT
      || next.damage > maximumFinalists.at(-1)!.damage)) {
      maximumFinalists.push(retainCandidate(next))
      maximumFinalists.sort((a, b) => b.damage - a.damage)
      if (maximumFinalists.length > REFERENCE_REFINEMENT_LIMIT) maximumFinalists.pop()
    }
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

  const referenceFinalists: SubstatCandidate[] = []
  const retainReference = (candidate: MainStatCandidate, allocation: ReturnType<typeof allocateSteps>): SubstatCandidate => {
    if (!allocation) throw new Error('Cannot retain an empty reference allocation')
    return {
      damage: allocation.damage,
      counts: Object.fromEntries(Object.entries(allocation.values).map(([key, values]) => [key, values.length])),
      values: allocation.values,
      stats: allocation.stats,
      main: { ...candidate, stats: candidate.stats.slice(), primaryStats: candidate.primaryStats.map(stat => ({ ...stat })), mainCounts: { ...candidate.mainCounts } },
    }
  }
  const considerReference = (candidate: MainStatCandidate, best: SubstatCandidate | null): SubstatCandidate | null => {
    // reject impossible er plans before preparing a scorer or trying the
    // damage bound. the tier allocator can never place more than five er lines.
    const missingEr = Math.max(0, targetEr - candidateEnergyRegen(candidate))
    if (missingEr > MAX_ROLLS_PER_KEY * maximumRolls[ENERGY_REGEN] + 1e-5) return best
    const scoreCandidate = candidate.frame.prepareFirstLaneScore(candidate.stats)
    // a generous bound: all keys at five maximum values, ignoring slot and
    // upgrade budgets. include er because some kits convert it into damage.
    const optimistic = candidate.stats.slice()
    for (const key of SUBSTAT_KEYS) addStatTotal(optimistic, key, MAX_ROLLS_PER_KEY * maximumRolls[key])
    if (best && scoreCandidate(optimistic) <= best.damage) return best
    const next = allocateSteps(candidate.stats, missingEr, scoreCandidate, checkCancel)
    if (!next) return best
    if (referenceFinalists.length < REFERENCE_REFINEMENT_LIMIT
      || next.damage > referenceFinalists[referenceFinalists.length - 1].damage) {
      const retained = retainReference(candidate, next)
      const index = referenceFinalists.findIndex(entry => entry.damage < retained.damage)
      if (index < 0) referenceFinalists.push(retained)
      else referenceFinalists.splice(index, 0, retained)
      if (referenceFinalists.length > REFERENCE_REFINEMENT_LIMIT) referenceFinalists.pop()
      if (!best || next.damage > best.damage) return retained
    }
    return best
  }

  // both passes reuse the same bounded main-stat candidate pool. the reference
  // allocates physical slots and tier upgrades; the maximum retains its fill.
  let evaluation: SubstatCandidate | null = null
  let perfection: SubstatCandidate | null = null
  for (const [frameIndex, info] of frameInfos.entries()) {
    checkCancel?.()
    const frame = makeEvaluationSearchFrame(ctx, info.echoes,
      mkSuggMainEc(ctx, info.echoes), info.setPlan)
    const mainsOnly = frame.stats.slice()
    removeSubstatTotals(mainsOnly, sumSubstats(frame.echoes))
    // enumerate this frame's main-stat candidates on demand; the array is
    // released once the frame is processed, so peak memory stays flat.
    const candidates = enumerateMainStatCandidates(frame, mainsOnly, mainUsefulStats)
    const seenReferenceCandidates = frameIndex < REFERENCE_FRAME_LIMIT ? new Set<string>() : null
    let candidateCount = 0
    for (const candidate of candidates) {
      checkCancel?.()
      if (candidateCount >= APPROXIMATE_MAIN_CANDIDATE_LIMIT) break
      candidateCount += 1
      if (seenReferenceCandidates) {
        const signature = referenceCandidateSignature(candidate.stats)
        if (!seenReferenceCandidates.has(signature)) {
          seenReferenceCandidates.add(signature)
          evaluation = considerReference(candidate, evaluation)
        }
      }
      perfection = consider(candidate, maximumParams, maximumRolls, perfection)
    }
  }
  // packed proposals cannot represent every timed equipment state, so replay the retained programs while allocating
  // and comparing both reference anchors
  if (replayFinalists) { evaluation = null; perfection = null }
  for (const finalist of referenceFinalists) {
    checkCancel?.()
    const candidate = replayFinalists ? {
      ...finalist.main,
      frame: makeEvaluationEchoFrame(ctx, finalist.main.frame.echoes,
        mkSuggMainEc(ctx, finalist.main.frame.echoes), finalist.main.frame.setPlan),
    } : finalist.main
    const scoreCandidate = candidate.frame.prepareFirstLaneScore(candidate.stats)
    const refined = allocateSteps(candidate.stats, Math.max(0, targetEr - candidateEnergyRegen(candidate)),
      scoreCandidate, checkCancel, true)
    if (refined && (!evaluation || refined.damage > evaluation.damage + 0.000001)) {
      evaluation = retainReference(candidate, refined)
    }
  }
  if (replayFinalists) {
    for (const finalist of maximumFinalists) {
      checkCancel?.()
      const candidate = { ...finalist.main, frame: makeEvaluationEchoFrame(ctx, finalist.main.frame.echoes,
        mkSuggMainEc(ctx, finalist.main.frame.echoes), finalist.main.frame.setPlan) }
      const caps = makeCaps(maximumParams)
      const er = requiredErSubstats(candidate, maximumParams, caps, maximumRolls)
      if (!er) continue
      const next = buildSubs(candidate, maximumParams, caps, er, maximumRolls)
      if (next && (!perfection || next.damage > perfection.damage + 0.000001)) perfection = retainCandidate(next)
    }
  }
  if (!evaluation || !perfection) return null

  const evaluationSubstats = stepSubstatPlan(evaluation.values!)
  const perfectionSubstats = makeSubstatPlan(
    perfection.counts,
    (key) => maximumRolls[key],
    targetEr > 0 ? {
      [ENERGY_REGEN]: Math.max(
        0,
        targetEr - candidateEnergyRegen(perfection.main),
      ),
    } : {},
  )
  // the bounded search uses its compact ranking model. reported anchors use
  // the same full damage model as the equipped build and feature breakdown.
  const exactDamage = (frame: EvaluationEchoFrame, stats: Float32Array) => scoreStats(
    ctx, stats, frame.sets, frame.kinds, frame.comboIds, frame.mainEchoBuffs, frame.mainIndex, frame.echoes,
  )
  return {
    baselineDamage: exactDamage(noEchoFrame, noEchoFrame.stats),
    referenceDamage: exactDamage(evaluation.main.frame, evaluation.stats),
    maximumDamage: exactDamage(perfection.main.frame, perfection.stats),
    builds: {
      baselineBuild: {
        echoes: noEchoFrame.echoes,
        primaryStats: [],
        substats: [],
        stats: noEchoFrame.stats.slice(),
      },
      referenceBuild: {
        echoes: distributeStepSubstats(evaluation.main.frame.echoes, evaluation.values!),
        primaryStats: evaluation.main.primaryStats,
        substats: evaluationSubstats,
        stats: evaluation.stats.slice(),
      },
      maximumBuild: {
        echoes: perfection.main.frame.echoes,
        primaryStats: perfection.main.primaryStats,
        substats: perfectionSubstats,
        stats: perfection.stats.slice(),
      },
    },
  }
}

// compute equipped damage without searching anchors or materializing report snapshots.
export function evaluateEquippedDamage(ctx: SuggestContext, equipped: Array<EchoInstance | null>): number {
  const echoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  const frame = makeEvaluationEchoFrame(ctx, echoes, echoes.length ? mkSuggMainEc(ctx, equipped) : new Float32Array(MAIN_BUFF_LEN))
  return frame.score(frame.stats, frame.sets)
}

// the equipped build's damage and its per-feature split, with no anchor search.
export function equippedFeatureBreakdown(ctx: SuggestContext, equipped: Array<EchoInstance | null>) {
  const echoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  const frame = makeEvaluationEchoFrame(ctx, echoes, echoes.length ? mkSuggMainEc(ctx, equipped) : new Float32Array(MAIN_BUFF_LEN))
  return { damage: frame.score(frame.stats, frame.sets), features: evaluationFeatures(ctx, frame, frame.stats, frame.sets) }
}

// re-score the live build against precomputed anchors. this is the cheap path:
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

  const { totals, counts: currentRollCounts } = aggregateSubstats(activeEchoes)
  const activePrimaryStats = activeEchoes.map((echo) => ({ ...echo.mainStats.primary }))

  const activeSubstats = Object.entries(totals)
    .filter(([, total]) => total > 0)
    .map(([key, total]) => ({
      key,
      count: currentRollCounts[key] ?? 0,
      effectiveCount: currentRollCounts[key] ?? 0,
      rollValue: (currentRollCounts[key] ?? 0) > 0 ? total / currentRollCounts[key] : 0,
      total,
    }))
    .sort((left, right) => right.total - left.total)

  const percent = scorePercent(userDamage, anchors.baselineDamage, anchors.referenceDamage, anchors.maximumDamage)
  const anchorBuilds = materializeEvaluationAnchorBuilds(ctx, anchors, options)

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
      baselineBuild: anchorBuilds.baselineBuild,
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
      referenceBuild: anchorBuilds.referenceBuild,
      maximumBuild: anchorBuilds.maximumBuild,
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
