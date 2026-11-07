/*
  Author: Runor Ewhro
  description: builds suggestion evaluation contexts, runs baseline
               simulations, derives weight maps, and evaluates echo
               combinations for direct and rotation-based suggestions.
*/

import type { FeatureResult } from '@/domain/gameData/contracts'
import type { EffectContext } from '@/domain/gameData/contracts'
import type { WeaponPlanSet } from '@/domain/entities/suggestions'
import type { ResRuntime, ResSeed } from '@/domain/entities/runtime'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { makeRuntimeCat } from '@/engine/services/runtimeSourceService'
import { listSkillsFor } from '@/data/catalog/gameDataService'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import type { OptStatWeight } from '@/engine/search/score/statWeights.ts'
import { makeStatWeights } from '@/engine/search/score/statWeights.ts'
import { isOptDmgSkll } from '@/engine/search/score/eligibility.ts'
import type {
  DrctSuggCtx,
  MainStatSuwo,
  MainStatPrep,
  PrepSetPlanS,
  PrepWeaponPlan,
  RotSuggCtx,
  SetPlanSuggs,
  SuggestContext,
  SuggestInput,
  SuggestionSimulation,
} from '@/engine/suggestions/types'
import { runResSmlt } from '@/engine/pipeline'
import type { SimResult, RotationTargetSimulation } from '@/engine/pipeline/types'
import { stripEchoes } from '@/engine/search/context/runtime'
import { buildSetRows, listDynamicSetStateParts, makeSetMask } from '@/engine/search/encode/sets'
import { mkGnrcMainEc, mkMainEchoRo, encEchoRows } from '@/engine/search/encode/echoes'
import { compOptTgtCt } from '@/engine/search/context/target'
import { packTargetCtx } from '@/engine/search/context/pack'
import { prepareTargetScoring } from '@/engine/search/score/evaluate'
import {
  captureRotationDamagePlan,
  packRotationDamagePlan,
  scoreRotationTeammateDelta,
  getRotationTeamScoringDiagnostics,
} from '@/engine/rotation/damagePlan.ts'
import { countEchoSets, makeCombatEnv } from '@/engine/pipeline/buildCombatContext'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeSkillCtx, prprRtSkll } from '@/engine/pipeline/prepareRuntimeSkill'
import { makeOptContext } from '@/engine/search/context/compiled'
import { selOptTgtSkl, type OptTargetSkill } from '@/engine/search/context/selectedSkill'
import { CTX_FLOATS, MAIN_BUFF_LEN } from '@/engine/search/layout/constants'
import type { PrepOptTgtCt } from '@/engine/search/context/target'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { SkillDef } from '@/domain/entities/stats'
import { makeTeamComp } from '@/engine/gameData/teamComposition'
import { SUGGESTION_SCORE_CACHE_LIMIT } from './config'
import { mainStatEchoCandidates } from './mainStat/utils'
import { prepareRotationCandidatePlan } from '@/engine/rotation/candidatePlan'
import { prepareRotationCandidateStream, getRotationCandidateDiagnostics } from '@/engine/rotation/candidateScorer'

function setRowOpts(input: SuggestInput, runtime: ResRuntime) {
  if (input.setStateMode !== 'resolved') {
    return {}
  }

  return {
    dynamicStateParts: listDynamicSetStateParts(runtime),
  }
}

function mkSuggFxCtx(
    combat: ReturnType<typeof makeCombatEnv>,
): EffectContext {
  const resDtlsById = getResDtlsBy()
  const graph = combat.graph
  const targetPart = graph.participants[combat.targetSlotId]
  const activePart = graph.participants[graph.activeSlotId] ?? targetPart
  const targetRuntime = targetPart?.runtime ?? combat.runtime
  const activeRuntime = activePart?.runtime ?? combat.runtime
  const teamMemberIds = Array.from(
      new Set(Object.values(graph.participants).map((participant) => participant.resonatorId)),
  )

  return {
    team: makeTeamComp(teamMemberIds),
    source: {
      type: 'resonator',
      id: combat.runtime.id,
      negativeEffectSources: resDtlsById[combat.runtime.id]?.negativeEffectSources,
    },
    target: {
      type: 'resonator',
      id: targetRuntime.id,
      negativeEffectSources: resDtlsById[targetRuntime.id]?.negativeEffectSources,
    },
    sourceRuntime: combat.runtime,
    targetRuntime,
    activeRuntime,
    targetRuntimeId: targetRuntime.id,
    activeResonatorId: activeRuntime.id,
    teamMemberIds,
    echoSetCounts: countEchoSets(combat.runtime.build.echoes),
    selectedTargetsByOwnerKey: {
      ...(targetPart?.slot.routing.selectedTargetsByOwnerKey ?? {}),
    },
    baseStats: combat.baseStats,
    finalStats: combat.finalStats,
    enemy: combat.enemy,
  }
}

// merge one stat weight map into another with a multiplier applied
function mrgWghtMaps(
    target: OptStatWeight,
    source: OptStatWeight,
    multiplier: number,
): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + (value ?? 0) * multiplier
  }
}

function getEchoSkillSourceId(skillId: string): string | null {
  const match = /^echo:([^:]+):/.exec(skillId)
  return match?.[1] ?? null
}

function getBaseSuggSkill(
    runtime: ResRuntime,
    seed: ResSeed,
    targetSkill: SkillDef,
): SkillDef {
  if (targetSkill.tab === 'echoAttacks') {
    const echoId = getEchoSkillSourceId(targetSkill.id)
    const echoSkill = echoId
        ? listSkillsFor('echo', echoId).find((skill) => skill.id === targetSkill.id)
        : null
    if (echoSkill) {
      return echoSkill
    }
  }

  return makeRuntimeCat(runtime, seed).skillsById[targetSkill.id] ?? targetSkill
}

function compSuggTgtCt(input: {
  runtime: ResRuntime
  resonatorId: string
  resSeed?: ResSeed
  skill: SkillDef
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
  selectedTargets?: Record<string, string | null>
}): PrepOptTgtCt {
  const seed = input.resSeed ?? getResSeedBy(input.resonatorId)
  if (!seed) {
    throw new Error(`Missing resonator seed for optimizer id ${input.resonatorId}`)
  }

  const { context: combat } = makeSkillCtx({
    runtime: input.runtime,
    seed,
    enemy: input.enemy,
    runtimesById: input.runtimesById,
    selectedTargets: input.selectedTargets,
  })
  const skill = prprRtSkll(input.runtime, getBaseSuggSkill(input.runtime, seed, input.skill), combat)

  if (skill.visible === false) {
    throw new Error(`Optimizer target skill ${input.skill.id} is not available for runtime ${input.resonatorId}`)
  }

  return {
    skill,
    selectedSkill: selOptTgtSkl(skill),
    combat,
    compiled: makeOptContext({
      resonatorId: input.resonatorId,
      runtime: input.runtime,
      skill,
      finalStats: combat.finalStats,
      enemy: input.enemy,
      combatState: input.runtime.state.combat,
      selectedTargets: combat.graph.participants[combat.targetSlotId]?.slot.routing.selectedTargetsByOwnerKey,
      activeResonatorId: combat.graph.participants[combat.graph.activeSlotId]?.resonatorId,
    }),
  }
}

// create a minimal fallback target skill for rotation suggestion flows
function mkFllbTgt(seedId: string): OptTargetSkill {
  return {
    id: `rotation:${seedId}`,
    label: 'Rotation',
    tab: 'rotation',
    element: 'physical',
    skillType: [],
    archetype: 'skillDamage',
  }
}

// run a standard simulation for a suggestion input and runtime snapshot
export function runSuggSmlt(
    input: SuggestInput,
    runtime = input.runtime,
): SimResult {
  return runResSmlt(
      runtime,
      input.seed,
      input.enemy,
      makeRuntimeMap(runtime, input.runtimesById),
      input.selectedTargets,
      { combatSetup: input.combatSetup },
  )
}

// get the direct target feature entry that suggestions should optimize around
export function getLgblDrctE(
    simulation: SuggestionSimulation,
    input: SuggestInput,
): FeatureResult | null {
  const entries = simulation.allSkills.filter((entry) => (
      entry.aggregationType === 'damage' &&
      entry.resonatorId === input.runtime.id &&
      isOptDmgSkll(entry.skill, { includeEchoAttacks: input.includeEchoAttacks })
  ))

  // prefer the explicitly selected target feature when one exists
  if (input.tgtFeatId) {
    const selected = entries.find((entry) => entry.id === input.tgtFeatId)
    if (selected) {
      return selected
    }
  }

  // otherwise fall back to the first eligible damage entry
  return entries[0] ?? null
}

// resolve the main damage figure used to rank suggestions
export function resSuggDmg(
    simulation: SuggestionSimulation | null | undefined,
    input: SuggestInput,
): number {
  if (input.rotationMode) {
    const context = mkRotSuggCtx(input, undefined, input.runtime.build.echoes.filter((echo) => echo != null))
    return context ? evalSuggChs(context, input.runtime.build.echoes) : 0
  }

  return simulation ? getLgblDrctE(simulation, input)?.avg ?? 0 : 0
}

// build the stat-weight map used by suggestion scoring heuristics
function mkSuggWghtMa(
    simulation: SuggestionSimulation,
    input: SuggestInput,
    context: SuggestContext,
    bias = 0,
): OptStatWeight {
  // direct mode just uses the chosen target entry
  if (!input.rotationMode) {
    const entry = getLgblDrctE(simulation, input)
    if (!entry) {
      return {}
    }

    return makeStatWeights({
      finalStats: simulation.finalStats,
      skill: entry.skill,
      enemy: input.enemy,
      level: input.runtime.base.level,
      combat: input.runtime.state.combat,
    })
  }

  // use the same surviving targets as candidate scoring. Echo-dependent
  // actions absent from the clean program cannot influence search heuristics.
  const entries = context.mode === 'rotation'
    ? context.sklls.map((skill, index) => ({ skill, avg: context.contextWeight[index] ?? 1, weight: 1 }))
    : []
  if (entries.length === 0) {
    return {}
  }

  // contribution weights give important entries greater influence in the map.
  const cntr = entries.map((entry) => Math.max(0, entry.avg * (entry.weight ?? 1)))
  const baseTotal = cntr.reduce((sum, value) => sum + value, 0) || entries.length

  // exponent increases concentration as bias rises
  const exponent = Math.max(0, bias) * 10
  const scaled = cntr.map((value) => Math.pow((value || 1) / baseTotal, exponent || 1))
  const scaledTotal = scaled.reduce((sum, value) => sum + value, 0) || entries.length

  const weights: OptStatWeight = {}

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const entryWeights = makeStatWeights({
      finalStats: context.sourceFinals,
      skill: entry.skill,
      enemy: input.enemy,
      level: input.runtime.base.level,
      combat: input.runtime.state.combat,
    })

    mrgWghtMaps(weights, entryWeights, scaled[index] / scaledTotal)
  }

  return weights
}

// build the packed direct-target evaluation context used for fast scoring
export function mkDrctSuggCt(
    input: SuggestInput,
    simulation: SuggestionSimulation,
): DrctSuggCtx | null {
  const entry = getLgblDrctE(simulation, input)
  if (!entry) {
    return null
  }

  // strip equipped echoes so candidates are evaluated from a clean baseline
  const runtime = stripEchoes(input.runtime)
  const participants = makeRuntimeMap(runtime, input.runtimesById)

  const prepared = input.includeEchoAttacks && entry.skill.tab === 'echoAttacks'
      ? compSuggTgtCt({
        runtime,
        resonatorId: input.runtime.id,
        resSeed: input.seed,
        skill: entry.skill,
        enemy: input.enemy,
        runtimesById: participants,
        selectedTargets: input.selectedTargets,
      })
      : compOptTgtCt({
        runtime,
        resonatorId: input.runtime.id,
        skillId: entry.skill.id,
        enemy: input.enemy,
        runtimesById: participants,
        selectedTargets: input.selectedTargets,
      })

  const comboSize = Math.max(1, input.runtime.build.echoes.filter((echo) => echo != null).length)
  const setRows = setRowOpts(input, runtime)
  const setRtMask = makeSetMask(runtime, input.setConds, setRows)

  return {
    mode: 'target',
    runtime,
    effectContext: mkSuggFxCtx(prepared.combat),
    selectedSkill: prepared.selectedSkill,
    sourceBaseStats: prepared.combat.baseStats,
    sourceFinals: prepared.combat.finalStats,
    pool: prepared.combat.buffs,
    skll: prepared.skill,
    enemy: input.enemy,
    setRtMask,
    pckdCtx: packTargetCtx({
      compiled: prepared.compiled,
      skill: prepared.skill,
      runtime,
      comboN: comboSize,
      comboK: comboSize,
      comboCount: 1,
      comboBaseIndex: 0,
      lockEchoIdx: -1,
      setRtMask: setRtMask,
    }),
    setConstLut: buildSetRows(runtime, input.setConds, setRows),
  }
}

// build the packed multi-context rotation evaluation context
export function mkRotSuggCtx(
    input: SuggestInput,
    _simulation?: RotationTargetSimulation,
    candidates?: readonly import('@/domain/entities/runtime').EchoInstance[],
): RotSuggCtx | null {
  void _simulation
  const seed = getResSeedBy(input.runtime.id)
  if (!seed) {
    return null
  }

  const captured = captureRotationDamagePlan({
    runtime: input.runtime,
    seed,
    enemy: input.enemy,
    items: input.runtime.rotation.sequence,
    runtimesById: makeRuntimeMap(input.runtime, input.runtimesById),
    selectedTargets: input.selectedTargets ?? {},
    combatSetup: input.combatSetup,
    setConds: input.setConds,
  })
  const { runtime: rotRt, activeContext, targets } = captured

  const fllbSkll = targets[0]
      ? selOptTgtSkl(targets[0].skill)
      : mkFllbTgt(seed.id)

  if (targets.length === 0) {
    return null
  }

  const setRows = setRowOpts(input, rotRt)
  const setRtMask = makeSetMask(rotRt, input.setConds, setRows)
  const packed = packRotationDamagePlan(captured, input.enemy, {
    comboN: 5, comboK: 5, comboCount: 1, setRtMask,
  })

  return {
    mode: 'rotation',
    candidatePlan: prepareRotationCandidatePlan(captured, {
      candidates,
      setControls: Object.fromEntries((setRows.dynamicStateParts ?? []).map(({ setId, partKey }) => {
        const key = `echoSet:${setId}:bonus:${partKey}`
        return [key, input.runtime.state.controls[key]]
      })),
    }),
    runtime: rotRt,
    effectContext: mkSuggFxCtx(activeContext),
    selectedSkill: fllbSkll,
    sourceBaseStats: activeContext.baseStats,
    sourceFinals: activeContext.finalStats,
    contexts: packed.contexts,
    contextStride: CTX_FLOATS,
    contextWeight: packed.contextWeight,
    fixedTeamDamage: captured.fixedTeamDamage,
    teamDamagePlan: captured.teamDamagePlan,
    contextCount: packed.contextWeight.length,
    displayContext: packed.displayContext,
    pool: activeContext.buffs,
    sklls: packed.targets.map((target) => target.skill),
    resIds: packed.targets.map((target) => target.resonatorId),
    enemy: input.enemy,
    setRtMask,
    setConstLut: buildSetRows(rotRt, input.setConds, setRows),
  }
}

// choose the correct evaluation context based on direct or rotation mode
export function mkSuggVltnCt(
    input: SuggestInput,
    simulation: SuggestionSimulation,
    candidates?: readonly import('@/domain/entities/runtime').EchoInstance[],
): SuggestContext | null {
  return input.rotationMode
      ? mkRotSuggCtx(input, simulation, candidates)
      : mkDrctSuggCt(input, simulation)
}

export function mkPrepMainSt(
    input: MainStatSuwo,
    simulation: SuggestionSimulation,
): MainStatPrep | null {
  const scoringInput: SuggestInput = {
    ...input,
    setStateMode: 'resolved',
    includeEchoAttacks: input.includeEchoAttacks ?? true,
  }
  const context = mkSuggVltnCt(scoringInput, simulation, input.rotationMode ? mainStatEchoCandidates(input.runtime.build.echoes) : undefined)
  if (!context) {
    return null
  }

  return {
    scoringInput,
    scenarioId: input.scenarioId,
    memberId: input.memberId,
    context,
    rotationMode: input.rotationMode,
    qppdChs: input.runtime.build.echoes,
    charId: input.runtime.id,
    statWeight: mkSuggWghtMa(simulation, scoringInput, context),
    topK: input.topK,
  }
}

export function mkPrepSetPla(
    input: SetPlanSuggs,
    simulation: SuggestionSimulation,
): PrepSetPlanS | null {
  const scoringInput: SuggestInput = { ...input, includeEchoAttacks: input.includeEchoAttacks ?? true }
  const context = mkSuggVltnCt(input, simulation)
  if (!context) {
    return null
  }

  return {
    scoringInput,
    scenarioId: input.scenarioId,
    memberId: input.memberId,
    context,
    rotationMode: input.rotationMode,
    qppdChs: input.runtime.build.echoes,
    topK: input.topK,
  }
}

// remove equipped weapon state from the baseline before weapon candidates run
// each candidate adds its own base atk, secondary stat, and passive controls later.
function dropWpnCtl(
    controls: ResRuntime['state']['controls'],
): ResRuntime['state']['controls'] {
  return Object.fromEntries(
      Object.entries(controls).filter(([key]) => !key.startsWith('weapon:')),
  )
}

// strip the current equipped weapon from the suggestion baseline
// weapon suggestions reapply each candidate from a neutral weapon state.
function mkNoWpnNpt<T extends SuggestInput>(input: T): T {
  const rt = input.runtime

  return {
    ...input,
    runtime: {
      ...rt,
      build: {
        ...rt.build,
        weapon: {
          ...rt.build.weapon,
          id: null,
          baseAtk: 0,
        },
      },
      state: {
        ...rt.state,
        controls: dropWpnCtl(rt.state.controls),
      },
    },
  }
}

export function mkPrepWpnSu(
    input: (MainStatSuwo | SetPlanSuggs) & { weapon: WeaponPlanSet },
    simulation: SuggestionSimulation,
): PrepWeaponPlan | null {
  const clean = mkNoWpnNpt(input)
  const context = mkSuggVltnCt({
    ...clean,
    setStateMode: 'resolved',
  }, simulation)
  if (!context) {
    return null
  }

  return {
    scenarioId: input.scenarioId,
    memberId: input.memberId,
    runtime: clean.runtime,
    context,
    qppdChs: input.runtime.build.echoes,
    seed: input.seed,
    enemy: input.enemy,
    runtimesById: input.runtimesById,
    selectedTargets: input.selectedTargets,
    includeEchoAttacks: input.includeEchoAttacks,
    combatSetup: input.combatSetup,
    setConds: input.setConds,
    weaponType: input.seed.weaponType,
    level: input.runtime.build.weapon.level,
    rank: input.runtime.build.weapon.rank,
    settings: input.weapon,
    topK: input.topK,
  }
}

// build main-echo buff rows for the current suggestion candidate loadout
export function mkSuggMainEc(
    context: SuggestContext,
    echoes: Array<import('@/domain/entities/runtime').EchoInstance | null>,
): Float32Array {
  const concrete = echoes.filter((echo): echo is NonNullable<typeof echo> => echo != null)

  if (context.mode === 'target') {
    return mkMainEchoRo({
      echoes: concrete,
      runtime: context.runtime,
      sourceBaseStats: context.sourceBaseStats,
      sourceFinals: context.sourceFinals,
      selectedSkill: context.selectedSkill,
    })
  }

  return mkGnrcMainEc({
    echoes: concrete,
    runtime: context.runtime,
    sourceBaseStats: context.sourceBaseStats,
    sourceFinals: context.sourceFinals,
  })
}

export function mkNeutralSuggMainEc(
    echoes: Array<import('@/domain/entities/runtime').EchoInstance | null>,
): Float32Array {
  const concreteCount = echoes.filter((echo) => echo != null).length
  return new Float32Array(concreteCount * MAIN_BUFF_LEN)
}

const targetScorers = new WeakMap<SuggestContext, ReturnType<typeof prepareTargetScoring>>()
const rotationStreams = new WeakMap<RotSuggCtx, ReturnType<typeof prepareRotationCandidateStream>>()
export interface SuggestionScoreCandidate {
  echoes: Array<import('@/domain/entities/runtime').EchoInstance | null>
  mainEchoBuffs: Float32Array
  selfMainEchoEffects?: boolean
}
interface SuggestionScores {
  values: Map<string, number>
  calls: number
  hits: number
  scoringMs: number
}
const suggestionScores = new WeakMap<SuggestContext, SuggestionScores>()
function scoresFor(context: SuggestContext): SuggestionScores {
  let scores = suggestionScores.get(context)
  if (!scores) {
    scores = { values: new Map(), calls: 0, hits: 0, scoringMs: 0 }
    suggestionScores.set(context, scores)
  }
  return scores
}
export function suggestionCandidateKey(candidate: SuggestionScoreCandidate): string {
  return JSON.stringify([
    candidate.echoes.map((echo) => echo && [echo.id, echo.set, echo.mainEcho, echo.mainStats, echo.substats]),
    Array.from(candidate.mainEchoBuffs),
    candidate.selfMainEchoEffects ?? true,
  ])
}
export function retainSuggestionScores(context: SuggestContext, candidates: SuggestionScoreCandidate[], values: number[]): void {
  const scores = scoresFor(context)
  candidates.forEach((candidate, index) => {
    let key: string
    if (context.mode === 'rotation' && context.candidatePlan) {
      let stream = rotationStreams.get(context)
      if (!stream) { stream = prepareRotationCandidateStream(context.candidatePlan); rotationStreams.set(context, stream) }
      stream.load(candidate.echoes, candidate.selfMainEchoEffects)
      key = `numeric:${stream.key()}`
    } else key = suggestionCandidateKey(candidate)
    if (scores.values.size >= SUGGESTION_SCORE_CACHE_LIMIT) scores.values.delete(scores.values.keys().next().value!)
    scores.values.set(key, values[index]!)
  })
}
export function getSuggestionScoringDiagnostics(context: SuggestContext) {
  const scores = suggestionScores.get(context)
  return {
    candidateCalls: scores?.calls ?? 0, candidateCacheHits: scores?.hits ?? 0,
    retainedCandidates: scores?.values.size ?? 0, scoringMs: scores?.scoringMs ?? 0,
    packedScoring: targetScorers.get(context)?.diagnostics ?? null,
    compiledScoring: getRotationCandidateDiagnostics(context.mode === 'rotation' ? context.candidatePlan : undefined),
    teammateScoring: getRotationTeamScoringDiagnostics(context.mode === 'rotation' ? context.teamDamagePlan : undefined),
  }
}

// evaluate a candidate echo loadout when main-echo buffs are already prepared
export function evalSuggChsW(
    context: SuggestContext,
    echoes: Array<import('@/domain/entities/runtime').EchoInstance | null>,
    mainEchoBuffs: Float32Array,
    selfMainEchoEffects = true,
    mainEchoEnabled = true,
): number {
  const concrete = echoes.filter((echo): echo is NonNullable<typeof echo> => echo != null)
  if (concrete.length === 0 && context.mode === 'target') {
    return 0
  }
  const scores = scoresFor(context)
  scores.calls += 1
  if (context.mode === 'rotation' && context.candidatePlan) {
    const startedAt = performance.now()
    let stream = rotationStreams.get(context)
    if (!stream) { stream = prepareRotationCandidateStream(context.candidatePlan); rotationStreams.set(context, stream) }
    stream.load(echoes, selfMainEchoEffects, mainEchoEnabled)
    const key = `numeric:${stream.key()}`
    const cached = scores.values.get(key)
    if (cached !== undefined) { scores.hits++; scores.scoringMs += performance.now() - startedAt; return cached }
    const value = stream.score()
    scores.scoringMs += performance.now() - startedAt
    if (scores.values.size >= SUGGESTION_SCORE_CACHE_LIMIT) scores.values.delete(scores.values.keys().next().value!)
    scores.values.set(key, value)
    return value
  }
  const cacheKey = suggestionCandidateKey({ echoes, mainEchoBuffs, selfMainEchoEffects })
  const known = scores.values.get(cacheKey)
  if (known !== undefined) {
    scores.hits += 1
    return known
  }
  const startedAt = performance.now()

  // build the encoded optimizer-friendly row data for this candidate
  const comboIds = Int32Array.from(concrete.map((_, index) => index))
  const mainIndex = Math.max(0, concrete.findIndex((echo) => echo.mainEcho))
  const encoded = encEchoRows(concrete, context.selectedSkill, 'self')


  // context decoding is fixed for the search. each candidate totals its Echo
  // rows and set counts once, then shares them across every rotation target.
  let prepareFrame = targetScorers.get(context)
  if (!prepareFrame) {
    const contexts = context.mode === 'target' ? [context.pckdCtx] : Array.from(
      { length: context.contextCount }, (_, index) => context.contexts.subarray(
        index * context.contextStride, (index + 1) * context.contextStride,
      ),
    )
    prepareFrame = prepareTargetScoring(
      contexts, context.setConstLut,
      context.mode === 'rotation' ? context.contextWeight : undefined,
      context.mode === 'rotation' ? context.fixedTeamDamage : 0,
      true,
    )
    targetScorers.set(context, prepareFrame)
  }
  const candidateMainBuffs = mainEchoBuffs.length > 0
    ? mainEchoBuffs
    : new Float32Array(MAIN_BUFF_LEN)
  const score = prepareFrame({
    mainEchoBuffs: candidateMainBuffs, sets: encoded.sets, kinds: encoded.kinds, comboIds, mainIndex,
  })
  const value = score(encoded.stats) + (context.mode === 'rotation'
    ? scoreRotationTeammateDelta(context.teamDamagePlan, concrete)
    : 0)
  scores.scoringMs += performance.now() - startedAt
  if (scores.values.size >= SUGGESTION_SCORE_CACHE_LIMIT) scores.values.delete(scores.values.keys().next().value!)
  scores.values.set(cacheKey, value)
  return value
}

// evaluate a candidate echo loadout from scratch, including main-echo buff rows
export function evalSuggChs(
    context: SuggestContext,
    echoes: Array<import('@/domain/entities/runtime').EchoInstance | null>,
): number {
  return evalSuggChsW(
      context,
      echoes,
      context.mode === 'rotation' && context.candidatePlan ? new Float32Array(0) : mkSuggMainEc(context, echoes),
  )
}
