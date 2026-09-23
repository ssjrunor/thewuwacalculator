/*
  Author: Runor Ewhro
  Description: Builds evaluation alternatives, reports, and rotation-facing results.
*/
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime';
import type { EnemyProfile } from '@/domain/entities/appState';
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats';
import { getEchoById, listChsByCos } from '@/data/catalog/echoCatalogService';
import { encEchoRows } from '@/engine/optimizer/encode/echoes';
import { mkSuggMainEc, mkRotSuggCtx } from '@/engine/suggestions/shared';
import type { SuggestContext } from '@/engine/suggestions/types';
import { scoreStats } from '@/engine/evaluation/evaluation/scoring';
import { getResSeedBy } from '@/data/catalog/resonatorSeedService';
import { listResRttn } from '@/data/catalog/gameDataService';
import { cloneRotationNodes } from '@/domain/entities/inventoryStorage';
import { makeEvaluationCostPlans } from './costPlans';
import { applySetPlan, prepSetPlanFsb } from '@/engine/suggestions/mutate';
import { getEchoSetDe } from '@/data/gameData/echoSets/effects';
import { evaluationSetConditions } from '@/engine/evaluation/setStatePolicy';
import { buildSetRows, type DynamicSetStatePart } from '@/engine/optimizer/encode/sets';
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals';
import type { EvaluationAlternative, EvaluationReportOpts, EvaluationReportSections, EvaluationRotationSummary, EvaluationSetSummary, BuildEvaluation, BuildEvaluationReport, DefRotEvaluationIn } from './types.ts';
import { ENERGY_REGEN, scorePercentX100 } from './stats.ts';
import { cloneEchoSlot, makeSetSummary, preservedMainEchoFor, retainsUtilityPlan, utilityPlanFor } from './echoDiscovery.ts';
import { assembleEvaluation, evaluationErTarget, buildEvaluation, buildEvaluationAnchors, type EvaluationCancelCheck, type EvaluationAnchors, type BuildEvaluationOptions } from './search.ts';
import { makeEvaluationKey } from '@/engine/evaluation/buildEvaluationKey';
import { getGameDataMode } from '@/data/gameData';
import { EVALUATION_ANCHOR_CACHE_REVISION, loadPersistedAnchors, persistAnchor } from './anchorStore.ts';



export function cloneEchoes(equipped: Array<EchoInstance | null>): Array<EchoInstance | null> {
  return equipped.map((echo) => echo ? cloneEchoSlot(echo) : null)
}

// The 0%/100%/200% anchors are the expensive part of a evaluation and depend on
// the equipped build only through the ER target and the retained utility plan.
// We cache the anchor bundle keyed on everything that actually moves it, so a
// build edit that leaves those untouched (substats, main stats, non-utility
// sets) skips the candidate search entirely and only re-scores the live build.
// The cache is also mirrored to IndexedDB (see anchorStore) so the search
// survives worker idle-teardown and page reloads.
// Anchor snapshots include the generated 0/100/200% build details. A small LRU
// avoids pinning dozens of large object graphs after browsing many scenarios.
const MAX_ANCHOR_CACHE_ENTRIES = 2
const anchorCache = new Map<string, EvaluationAnchors>()

const DEFAULT_REPORT_SECTIONS: EvaluationReportSections = {
  rotationFeatures: true,
  upgradePaths: true,
  echoStatsTable: true,
  evaluationTargets: true,
}

function resolveReportSections(options: EvaluationReportOpts = {}): EvaluationReportSections {
  return {
    rotationFeatures: options.sections?.rotationFeatures ?? DEFAULT_REPORT_SECTIONS.rotationFeatures,
    upgradePaths: options.sections?.upgradePaths ?? DEFAULT_REPORT_SECTIONS.upgradePaths,
    echoStatsTable: options.sections?.echoStatsTable ?? DEFAULT_REPORT_SECTIONS.echoStatsTable,
    evaluationTargets: options.sections?.evaluationTargets ?? DEFAULT_REPORT_SECTIONS.evaluationTargets,
  }
}

function reportBuildOptions(options: EvaluationReportOpts = {}): BuildEvaluationOptions {
  const sections = resolveReportSections(options)
  return {
    includeFeatures: sections.rotationFeatures,
    includeStatRows: sections.echoStatsTable,
    includeEvaluationTargets: sections.evaluationTargets,
  }
}

function touchAnchors(key: string): EvaluationAnchors | undefined {
  const cached = anchorCache.get(key)
  if (cached) {
    anchorCache.delete(key)
    anchorCache.set(key, cached)
  }
  return cached
}

// In-memory LRU insert only, used both for freshly computed anchors and for
// entries rehydrated from disk (which must not be written straight back).
function cacheAnchors(key: string, anchors: EvaluationAnchors): EvaluationAnchors {
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
function rememberAnchors(key: string, anchors: EvaluationAnchors): EvaluationAnchors {
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

// Echo payloads are the live build input to the evaluation score, but they are
// not the input to the anchor search once the anchor-specific channels below
// have been separated. Keep runtime state and team composition in the key,
// while removing nested Echo instances that would otherwise make every stat
// edit look like a new anchor problem.
function stripEchoesForAnchorKey(runtime: ResRuntime): ResRuntime {
  return {
    ...runtime,
    build: {
      ...runtime.build,
      echoes: [],
    },
    teamRuntimes: runtime.teamRuntimes.map((member) => member ? {
      ...member,
      build: {
        ...member.build,
        echoes: [],
      },
    } : null) as ResRuntime['teamRuntimes'],
  }
}

function stripContextEchoesForAnchorKey(ctx: SuggestContext): SuggestContext {
  return {
    ...ctx,
    runtime: stripEchoesForAnchorKey(ctx.runtime),
    effectContext: {
      ...ctx.effectContext,
      sourceRuntime: stripEchoesForAnchorKey(ctx.effectContext.sourceRuntime),
      targetRuntime: stripEchoesForAnchorKey(ctx.effectContext.targetRuntime),
      activeRuntime: ctx.effectContext.activeRuntime
        ? stripEchoesForAnchorKey(ctx.effectContext.activeRuntime)
        : undefined,
    },
  }
}

export function evaluationAnchorCacheKey(
  ctx: SuggestContext,
  runtime: ResRuntime,
  enemy: EnemyProfile,
): string {
  const equipped = runtime.build.echoes
  const utilityPlan = utilityPlanFor(equipped)
  return makeEvaluationKey({
    kind: 'evaluation-anchors',
    revision: EVALUATION_ANCHOR_CACHE_REVISION,
    gameDataMode: getGameDataMode(),
    // The suggestion context already contains the compiled team effects used
    // by the anchor search. Its raw runtime references are normalized above;
    // retaining runtimesById here would reintroduce every teammate Echo stat as
    // a false cache dependency.
    context: stripContextEchoesForAnchorKey(ctx),
    runtime: stripEchoesForAnchorKey(runtime),
    enemy,
    // the channels through which the equipped build *does* reach the anchors:
    targetEr: evaluationErTarget(ctx, equipped),
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

// Build a evaluation reusing cached anchors when the anchor inputs are unchanged.
// `runtime` here is the evaluation runtime (default rotation), so user rotation
// edits don't fragment the cache.
function cachedEvaluationAnchors(
  ctx: SuggestContext,
  runtime: ResRuntime,
  enemy: EnemyProfile,
  checkCancel?: EvaluationCancelCheck,
): EvaluationAnchors | null {
  const equipped = runtime.build.echoes
  const key = evaluationAnchorCacheKey(ctx, runtime, enemy)
  const cached = touchAnchors(key)
  if (cached) return cached
  const anchors = buildEvaluationAnchors(ctx, equipped, checkCancel)
  if (!anchors) return null
  return rememberAnchors(key, anchors)
}

export function scoreEchoAlternative(
  ctx: SuggestContext,
  equipped: Array<EchoInstance | null>,
): { damage: number; sets: EvaluationSetSummary[] } | null {
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
  alternatives: EvaluationAlternative[],
  ctx: SuggestContext,
  evaluation: BuildEvaluation,
  baseDamage: number,
  currentScore: number,
  echoes: Array<EchoInstance | null>,
  meta: Pick<EvaluationAlternative,
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

  const score = scorePercentX100(result.damage, evaluation)
  alternatives.push({
    ...meta,
    fromSets: meta.fromSets?.map((set) => ({ ...set })),
    toSets: meta.toSets?.map((set) => ({ ...set })) ?? result.sets.map((set) => ({ ...set })),
    damage: result.damage,
    damageDelta: result.damage - baseDamage,
    damageDeltaPct: baseDamage > 0 ? ((result.damage - baseDamage) / baseDamage) * 100 : 0,
    score,
    scoreDelta: score - currentScore,
  })
}

export function buildEvaluationAlternatives(
  inputCtx: SuggestContext,
  equipped: Array<EchoInstance | null>,
  evaluation: BuildEvaluation,
  limit?: number,
  checkCancel?: EvaluationCancelCheck,
): EvaluationAlternative[] {
  const ctx = inputCtx
  const resultLimit = typeof limit === 'number' ? Math.max(0, Math.floor(limit)) : 12
  if (resultLimit === 0) return []
  // Alternatives are ranked after scoring. A small deterministic evaluation
  // budget prevents a report from cloning and simulating every legal swap just
  // to return a handful of rows. This is intentionally lossy for latency.
  const evaluationLimit = Math.max(24, Math.min(96, resultLimit * 6))
  let evaluations = 0
  const takeEvaluation = (): boolean => {
    if (evaluations >= evaluationLimit) return false
    evaluations += 1
    return true
  }
  const baseDamage = evaluation.userDamage
  const currentScore = evaluation.percent * 100
  const alternatives: EvaluationAlternative[] = []
  const preservesEr = evaluationErTarget(ctx, equipped) > 0

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
      if (!takeEvaluation()) break

      const nextEchoes = cloneEchoes(equipped)
      const nextEcho = nextEchoes[slotIndex]
      if (!nextEcho) {
        continue
      }
      nextEcho.mainStats.primary = { key, value }
      nextEcho.mainStats.secondary = { ...secondary }
      pushAlternative(alternatives, ctx, evaluation, baseDamage, currentScore, nextEchoes, {
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
    if (evaluations >= evaluationLimit) break
  }

  const emptySlot = equipped.findIndex((echo) => echo == null)
  if (emptySlot >= 0) {
    const equippedEchoes = equipped.filter((echo): echo is EchoInstance => echo != null)
    const forcedMainEcho = equippedEchoes.find((echo) => echo.mainEcho) ?? null
    const forcedMainCost = forcedMainEcho ? getEchoById(forcedMainEcho.id)?.cost ?? null : null
    const currentCosts = equippedEchoes
      .map((echo) => getEchoById(echo.id)?.cost ?? 0)
      .filter((cost) => cost > 0)
    const validPlans = makeEvaluationCostPlans(forcedMainCost)
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
        if (!takeEvaluation()) break
        const nextEchoes = cloneEchoes(equipped)
        nextEchoes[emptySlot] = {
          uid: `evaluation-alternative-${cost}-${key}`,
          id: definition.id,
          set,
          mainEcho: false,
          mainStats: {
            primary: { key, value },
            secondary: { ...secondary },
          },
          substats: {},
        }
        pushAlternative(alternatives, ctx, evaluation, baseDamage, currentScore, nextEchoes, {
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
      if (evaluations >= evaluationLimit) break
    }
  }

  const equippedEchoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  if (equippedEchoes.length > 0) {
    const requiredUtilityPlan = utilityPlanFor(equipped)
    const activeSets = evaluation.builds.active.sets
    const activeSetSig = activeSets.map((set) => `${set.setId}:${set.pieces}`).join('|')
    const forcedMainEcho = equippedEchoes.find((echo) => echo.mainEcho) ?? null
    const seenPlans = new Set<string>()
    const targetPlans = [
      evaluation.builds.referenceBuild.sets,
      evaluation.builds.maximumBuild.sets,
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

      pushAlternative(alternatives, ctx, evaluation, baseDamage, currentScore, nextEchoes, {
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

  const byTransition = new Map<string, EvaluationAlternative>()
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
  return sorted.slice(0, resultLimit)
}

export function buildEvaluationReport(
  inputCtx: SuggestContext,
  equipped: Array<EchoInstance | null>,
  options: EvaluationReportOpts = {},
  existingAnchors?: EvaluationAnchors | null,
  rotation: EvaluationRotationSummary | null = null,
  checkCancel?: EvaluationCancelCheck,
): BuildEvaluationReport | null {
  const ctx = inputCtx
  const sections = resolveReportSections(options)
  const evaluation = existingAnchors
    ? assembleEvaluation(ctx, equipped, existingAnchors, reportBuildOptions(options))
    : buildEvaluation(ctx, equipped, undefined, reportBuildOptions(options), checkCancel)
  if (!evaluation) {
    return null
  }

  return {
    evaluation,
    alternatives: sections.upgradePaths
      ? buildEvaluationAlternatives(ctx, equipped, evaluation, options.alternativesLimit, checkCancel)
      : [],
    rotation,
  }
}

export function rotationBuildEvaluationReport(
  input: DefRotEvaluationIn,
  options: EvaluationReportOpts = {},
  checkCancel?: EvaluationCancelCheck,
): BuildEvaluationReport | null {
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

  const evaluationRuntime: ResRuntime = {
    ...runtime,
    rotation: {
      ...runtime.rotation,
      sequence: cloneRotationNodes(defaultRotation.items),
    },
  }
  const utilityPlan = utilityPlanFor(runtime.build.echoes)
  const setConds = evaluationSetConditions(runtime.id, {
    preservedUtilityPlan: utilityPlan,
    preservedUtilityControls: runtime.state.controls,
  })

  const context = mkRotSuggCtx({
    scenarioId: input.scenarioId,
    memberId: input.memberId,
    runtime: evaluationRuntime,
    seed,
    enemy,
    runtimesById: { ...runtimesById, [runtime.id]: runtime },
    selectedTargets: {},
    setConds,
    tgtFeatId: null,
    rotationMode: true,
  }, simulation)

  if (!context) {
    return null
  }

  const evaluationContext = withUtilitySetRows(context, evaluationRuntime, setConds, utilityPlan)
  const includeRotationDetails = options.sections?.rotationFeatures ?? true
  // Report jobs are assembled from the same anchor contract used by the report
  // sections, so the report remains the single evaluation computation path.
  const anchors = cachedEvaluationAnchors(
    evaluationContext,
    evaluationRuntime,
    enemy,
    checkCancel,
  )
  if (!anchors) {
    return null
  }

  return buildEvaluationReport(
    evaluationContext,
    runtime.build.echoes,
    options,
    anchors,
    includeRotationDetails ? {
      id: defaultRotation.id,
      name: defaultRotation.label,
      resonatorId: runtime.id,
      items: cloneRotationNodes(defaultRotation.items),
    } : null,
    checkCancel,
  )
}
