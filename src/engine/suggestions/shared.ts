/*
  Author: Runor Ewhro
  Description: builds suggestion evaluation contexts, runs baseline
               simulations, derives weight maps, and evaluates echo
               combinations for direct and rotation-based suggestions.
*/

import type { FeatureResult } from '@/domain/gameData/contracts'
import type { WeaponPlanSet } from '@/domain/entities/suggestions'
import type { ResRuntime, ResSeed } from '@/domain/entities/runtime'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { makeRuntimeCat } from '@/domain/services/runtimeSourceService'
import { listSkillsFor } from '@/domain/services/gameDataService'
import type { OptStatWeight } from '@/engine/optimizer/search/filtering.ts'
import { makeStatWeights } from '@/engine/optimizer/search/filtering.ts'
import { isOptDmgSkll, isOptRotTgt, sumOptRotDmg } from '@/engine/optimizer/rules/eligibility.ts'
import type {
  DrctSuggCtx,
  MainStatSuwo,
  MainStatPrep,
  RandomPrep,
  PrepSetPlanS,
  PrepWeaponPlan,
  RandSuggsNpt,
  RotSuggCtx,
  SetPlanSuggs,
  SuggestContext,
  SuggestInput,
} from '@/engine/suggestions/types'
import { runResSmlt } from '@/engine/pipeline'
import type { SimResult } from '@/engine/pipeline/types'
import { stripEchoes } from '@/engine/optimizer/compiler/shared'
import { buildSetRows, listDynamicSetStateParts, makeSetMask } from '@/engine/optimizer/encode/sets'
import { mkGnrcMainEc, mkMainEchoRo, encEchoRows } from '@/engine/optimizer/encode/echoes'
import { compOptTgtCt } from '@/engine/optimizer/target/context'
import { packTargetCtx } from '@/engine/optimizer/context/pack'
import { evalTarget } from '@/engine/optimizer/target/evaluate'
import { applyPersRot } from '@/engine/optimizer/rotation/runtime'
import { makeCombatGraph, findCombatPart } from '@/domain/state/combatGraph'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { makeSkillCtx, prprRtSkll } from '@/engine/pipeline/prepareRuntimeSkill'
import { mkPrepRotNvr, runFeatSmlt } from '@/engine/rotation/system'
import { makeOptContext } from '@/engine/optimizer/context/compiled'
import { selOptTgtSkl, type OptTargetSkill } from '@/engine/optimizer/target/selectedSkill'
import { CTX_FLOATS } from '@/engine/optimizer/config/constants'
import type { PrepOptTgtCt } from '@/engine/optimizer/target/context'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { SkillDef } from '@/domain/entities/stats'

interface RotTgtCtx {
  skill: FeatureResult['skill']
  resonatorId: string
  weight: number
}

function setRowOpts(input: SuggestInput, runtime: ResRuntime) {
  if (input.setStateMode !== 'resolved') {
    return {}
  }

  return {
    dynamicStateParts: listDynamicSetStateParts(runtime),
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
    }),
  }
}

function prepSuggSkill(
    runtime: ResRuntime,
    resonatorId: string,
    targetSkill: SkillDef,
    combat: ReturnType<typeof makeCombatEnv>,
): SkillDef {
  const seed = getResSeedBy(resonatorId)
  if (!seed) {
    return targetSkill
  }

  return prprRtSkll(runtime, getBaseSuggSkill(runtime, seed, targetSkill), combat)
}

// create a minimal fallback target skill for rotation suggestion flows
function mkFllbTgt(seedId: string): OptTargetSkill {
  return {
    id: `rotation:${seedId}`,
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
  )
}

// get the direct target feature entry that suggestions should optimize around
export function getLgblDrctE(
    simulation: SimResult,
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
    simulation: SimResult,
    input: SuggestInput,
): number {
  if (input.rotationMode) {
    return sumOptRotDmg(
      simulation.rotations.personal.entries,
      input.runtime.id,
      { includeEchoAttacks: input.includeEchoAttacks },
    )
  }

  return getLgblDrctE(simulation, input)?.avg ?? 0
}

// build the stat-weight map used by suggestion scoring heuristics
export function mkSuggWghtMa(
    simulation: SimResult,
    input: SuggestInput,
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

  // rotation mode blends weights from all eligible rotation targets
  const entries = simulation.rotations.personal.entries.filter((entry) =>
      isOptRotTgt(entry, input.runtime.id, { includeEchoAttacks: input.includeEchoAttacks }),
  )
  if (entries.length === 0) {
    return {}
  }

  // use contribution-based weighting so more important entries influence the map more
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
      finalStats: simulation.finalStats,
      skill: entry.skill,
      enemy: input.enemy,
      level: input.runtime.base.level,
      combat: input.runtime.state.combat,
    })

    mrgWghtMaps(weights, entryWeights, scaled[index] / scaledTotal)
  }

  return weights
}

// pull all weights toward or away from the average according to bias
export function applyWghtBia(
    weights: OptStatWeight,
    bias: number,
): OptStatWeight {
  const entries = Object.entries(weights)
  if (entries.length === 0) {
    return weights
  }

  const avg = entries.reduce((sum, [, value]) => sum + (value ?? 0), 0) / entries.length

  return Object.fromEntries(
      entries.map(([key, value]) => [
        key,
        Math.max(0.05, avg + (((value ?? 0) - avg) * Math.max(0, Math.min(1, bias)))),
      ]),
  )
}

// build the packed direct-target evaluation context used for fast scoring
export function mkDrctSuggCt(
    input: MainStatSuwo | SetPlanSuggs | RandSuggsNpt,
    simulation: SimResult,
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

// extract all rotation feature targets that should contribute to suggestion scoring
function mkRotTrgt(
    simulation: { rotations: { personal: { entries: FeatureResult[] } } },
    resonatorId: string,
    includeEchoAttacks = false,
): RotTgtCtx[] {
  return simulation.rotations.personal.entries
      .filter((entry) => isOptRotTgt(entry, resonatorId, { includeEchoAttacks }))
      .map((entry) => ({
        skill: entry.skill,
        resonatorId: entry.resonatorId,
        weight: entry.weight ?? 1,
      }))
}

// build the packed multi-context rotation evaluation context
export function mkRotSuggCtx(
    input: MainStatSuwo | SetPlanSuggs | RandSuggsNpt,
    simulation: SimResult,
): RotSuggCtx | null {
  const seed = getResSeedBy(input.runtime.id)
  if (!seed) {
    return null
  }

  // apply the personal rotation to a stripped runtime so setup effects are reflected
  const rotRt = applyPersRot(
      stripEchoes(input.runtime),
      input.runtime.rotation.personalItems,
      { ignoreLoops: true },
  )
  const participants = makeRuntimeMap(rotRt, input.runtimesById)

  // build a transient graph and active combat context for rotation simulation
  const graph = makeCombatGraph({
    actRt: rotRt,
    activeSeed: seed,
    partRts: participants,
    targetsByRes: {
      [rotRt.id]: input.selectedTargets ?? {},
    },
  })

  const activeContext = makeCombatEnv({
    graph,
    targetSlotId: 'active',
    enemy: input.enemy,
  })

  const rotNvrn = mkPrepRotNvr(activeContext, seed)
  const simulated = runFeatSmlt(activeContext, seed, participants, rotNvrn, undefined, {
    mode: 'personal',
    detail: 'summary',
  })
  const targets = input.includeEchoAttacks
      ? [
        ...mkRotTrgt(simulated, input.runtime.id),
        ...mkRotTrgt(simulation, input.runtime.id, true)
          .filter((target) => target.skill.tab === 'echoAttacks'),
      ]
      : mkRotTrgt(simulated, input.runtime.id)

  const fllbSkll = targets[0]
      ? selOptTgtSkl(targets[0].skill)
      : mkFllbTgt(seed.id)

  if (targets.length === 0) {
    return null
  }

  // cache one combat context per resonator that participates in rotation targets
  const cmbtByResId: Record<string, ReturnType<typeof makeCombatEnv>> = {
    [rotRt.id]: activeContext,
  }

  for (const target of targets) {
    if (cmbtByResId[target.resonatorId]) {
      continue
    }

    const slotId = findCombatPart(graph, target.resonatorId)
    if (!slotId) {
      continue
    }

    cmbtByResId[target.resonatorId] = makeCombatEnv({
      graph,
      targetSlotId: slotId,
      enemy: input.enemy,
    })
  }

  const setRows = setRowOpts(input, rotRt)
  const setRtMask = makeSetMask(rotRt, input.setConds, setRows)
  const contexts = new Float32Array(targets.length * CTX_FLOATS)
  const contextWeight = new Float32Array(targets.length)

  // pack one optimizer context per rotation target
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]
    const ownerCombat = cmbtByResId[target.resonatorId] ?? activeContext

    const skill = input.includeEchoAttacks && target.skill.tab === 'echoAttacks'
        ? prepSuggSkill(ownerCombat.runtime, target.resonatorId, target.skill, ownerCombat)
        : target.skill

    const compiled = makeOptContext({
      resonatorId: target.resonatorId,
      runtime: ownerCombat.runtime,
      skill,
      finalStats: ownerCombat.finalStats,
      enemy: input.enemy,
      combatState: ownerCombat.runtime.state.combat,
    })

    const pckdCtx = packTargetCtx({
      compiled,
      skill,
      runtime: ownerCombat.runtime,
      comboN: 5,
      comboK: 5,
      comboCount: 1,
      comboBaseIndex: 0,
      lockEchoIdx: -1,
      setRtMask: setRtMask,
    })

    targets[index] = {
      ...target,
      skill,
    }
    contexts.set(pckdCtx, index * CTX_FLOATS)
    contextWeight[index] = target.weight
  }

  return {
    mode: 'rotation',
    runtime: rotRt,
    selectedSkill: fllbSkll,
    sourceBaseStats: activeContext.baseStats,
    sourceFinals: activeContext.finalStats,
    contexts,
    contextStride: CTX_FLOATS,
    contextWeight: contextWeight,
    contextCount: targets.length,
    pool: activeContext.buffs,
    sklls: targets.map((target) => target.skill),
    resIds: targets.map((target) => target.resonatorId),
    enemy: input.enemy,
    setRtMask,
    setConstLut: buildSetRows(rotRt, input.setConds, setRows),
  }
}

// choose the correct evaluation context based on direct or rotation mode
export function mkSuggVltnCt(
    input: MainStatSuwo | SetPlanSuggs | RandSuggsNpt,
    simulation: SimResult,
): SuggestContext | null {
  return input.rotationMode
      ? mkRotSuggCtx(input, simulation)
      : mkDrctSuggCt(input, simulation)
}

export function mkPrepMainSt(
    input: MainStatSuwo,
    simulation: SimResult,
): MainStatPrep | null {
  const context = mkSuggVltnCt({
    ...input,
    setStateMode: 'resolved',
  }, simulation)
  if (!context) {
    return null
  }

  return {
    context,
    rotationMode: input.rotationMode,
    qppdChs: input.runtime.build.echoes,
    charId: input.runtime.id,
    statWeight: mkSuggWghtMa(simulation, input),
    topK: input.topK,
  }
}

export function mkPrepSetPla(
    input: SetPlanSuggs,
    simulation: SimResult,
): PrepSetPlanS | null {
  const context = mkSuggVltnCt(input, simulation)
  if (!context) {
    return null
  }

  return {
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
    simulation: SimResult,
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
    context,
    qppdChs: input.runtime.build.echoes,
    weaponType: input.seed.weaponType,
    level: input.runtime.build.weapon.level,
    rank: input.runtime.build.weapon.rank,
    settings: input.weapon,
    topK: input.topK,
  }
}

export function mkPrepRandSu(
    input: RandSuggsNpt,
    simulation: SimResult,
): RandomPrep | null {
  const context = mkSuggVltnCt(input, simulation)
  if (!context) {
    return null
  }

  const rawWeightMap = mkSuggWghtMa(simulation, input, input.settings.bias)

  return {
    context,
    qppdChs: input.runtime.build.echoes,
    runtimeId: input.runtime.id,
    rawWeightMap,
    statWeight: applyWghtBia(rawWeightMap, input.settings.bias),
    settings: input.settings,
    resultsLimit: input.resultsLimit,
    candCnt: input.candCnt,
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

// evaluate a candidate echo loadout when main-echo buffs are already prepared
export function evalSuggChsW(
    context: SuggestContext,
    echoes: Array<import('@/domain/entities/runtime').EchoInstance | null>,
    mainEchoBuffs: Float32Array,
): number {
  const concrete = echoes.filter((echo): echo is NonNullable<typeof echo> => echo != null)
  if (concrete.length === 0) {
    return 0
  }

  // build the encoded optimizer-friendly row data for this candidate
  const comboIds = Int32Array.from(concrete.map((_, index) => index))
  const mainIndex = Math.max(0, concrete.findIndex((echo) => echo.mainEcho))
  const encoded = encEchoRows(concrete, context.selectedSkill, 'self')

  // direct mode evaluates against a single packed target context
  if (context.mode === 'target') {
    return evalTarget({
      context: context.pckdCtx,
      stats: encoded.stats,
      setConstLut: context.setConstLut,
      mainEchoBuffs: mainEchoBuffs,
      sets: encoded.sets,
      kinds: encoded.kinds,
      comboIds,
      mainIndex,
    })?.damage ?? 0
  }

  // rotation mode evaluates against all packed contexts and sums weighted damage
  let total = 0
  for (let index = 0; index < context.contextCount; index += 1) {
    const slice = context.contexts.subarray(
        index * context.contextStride,
        (index + 1) * context.contextStride,
    )

    const damage = evalTarget({
      context: slice,
      stats: encoded.stats,
      setConstLut: context.setConstLut,
      mainEchoBuffs: mainEchoBuffs,
      sets: encoded.sets,
      kinds: encoded.kinds,
      comboIds,
      mainIndex,
    })?.damage ?? 0

    total += damage * (context.contextWeight[index] ?? 1)
  }

  return total
}

// evaluate a candidate echo loadout from scratch, including main-echo buff rows
export function evalSuggChs(
    context: SuggestContext,
    echoes: Array<import('@/domain/entities/runtime').EchoInstance | null>,
): number {
  return evalSuggChsW(
      context,
      echoes,
      mkSuggMainEc(context, echoes),
  )
}
