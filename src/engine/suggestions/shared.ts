/*
  Author: Runor Ewhro
  Description: Builds suggestion evaluation contexts, runs baseline
               simulations, derives weight maps, and evaluates echo
               combinations for direct and rotation-based suggestions.
*/

import type { FeatureResult } from '@/domain/gameData/contracts'
import { buildRuntimeParticipantLookup } from '@/domain/state/runtimeAdapters'
import type { OptimizerStatWeightMap } from '@/engine/optimizer/search/filtering.ts'
import { buildOptimizerStatWeightMap } from '@/engine/optimizer/search/filtering.ts'
import { isOptimizerRotationTarget, sumOptimizerRotationDamage } from '@/engine/optimizer/rules/eligibility.ts'
import type {
  DirectSuggestionContext,
  MainStatSuggestionsInput,
  PreparedMainStatSuggestionsInput,
  PreparedRandomSuggestionsInput,
  PreparedSetPlanSuggestionsInput,
  RandomSuggestionsInput,
  RotationSuggestionContext,
  SetPlanSuggestionsInput,
  SuggestionEvaluationContext,
  SuggestionsEvaluationInput,
} from '@/engine/suggestions/types'
import { runResonatorSimulation } from '@/engine/pipeline'
import type { SimulationResult } from '@/engine/pipeline/types'
import { stripEchoes } from '@/engine/optimizer/compiler/shared'
import { buildSetRows, buildSetRuntimeMask } from '@/engine/optimizer/encode/sets'
import { buildGenericMainEchoRows, buildMainEchoRows, encodeEchoRows } from '@/engine/optimizer/encode/echoes'
import { compileOptimizerTargetContext } from '@/engine/optimizer/target/context'
import { packTargetContext } from '@/engine/optimizer/context/pack'
import { evalTarget } from '@/engine/optimizer/target/evaluate'
import { applyPersonalRotationItems } from '@/engine/optimizer/rotation/runtime'
import { buildTransientCombatGraph, findCombatParticipantSlotId } from '@/domain/state/combatGraph'
import { buildCombatContext } from '@/engine/pipeline/buildCombatContext'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { buildPreparedRotationEnvironment, runFeatureSimulation } from '@/engine/rotation/system'
import { buildCompiledOptimizerContext } from '@/engine/optimizer/context/compiled'
import { selectOptimizerTargetSkill, type OptimizerTargetSkill } from '@/engine/optimizer/target/selectedSkill'
import { OPTIMIZER_CONTEXT_FLOATS } from '@/engine/optimizer/config/constants'

interface RotationTargetContext {
  skill: FeatureResult['skill']
  resonatorId: string
  weight: number
}

// merge one stat weight map into another with a multiplier applied
function mergeWeightMaps(
    target: OptimizerStatWeightMap,
    source: OptimizerStatWeightMap,
    multiplier: number,
): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + (value ?? 0) * multiplier
  }
}

// create a minimal fallback target skill for rotation suggestion flows
function createFallbackTarget(seedId: string): OptimizerTargetSkill {
  return {
    id: `rotation:${seedId}`,
    tab: 'rotation',
    element: 'physical',
    skillType: [],
    archetype: 'skillDamage',
  }
}

// run a standard simulation for a suggestion input and runtime snapshot
export function runSuggestionSimulation(
    input: SuggestionsEvaluationInput,
    runtime = input.runtime,
): SimulationResult {
  return runResonatorSimulation(
      runtime,
      input.seed,
      input.enemy,
      buildRuntimeParticipantLookup(runtime, input.runtimesById),
      input.selectedTargetsByOwnerKey,
  )
}

// get the direct target feature entry that suggestions should optimize around
export function getEligibleDirectEntry(
    simulation: SimulationResult,
    input: SuggestionsEvaluationInput,
): FeatureResult | null {
  const entries = simulation.allSkills.filter((entry) => (
      entry.aggregationType === 'damage' &&
      entry.resonatorId === input.runtime.id
  ))

  // prefer the explicitly selected target feature when one exists
  if (input.targetFeatureId) {
    const selected = entries.find((entry) => entry.id === input.targetFeatureId)
    if (selected) {
      return selected
    }
  }

  // otherwise fall back to the first eligible damage entry
  return entries[0] ?? null
}

// resolve the main damage figure used to rank suggestions
export function resolveSuggestionDamage(
    simulation: SimulationResult,
    input: SuggestionsEvaluationInput,
): number {
  if (input.rotationMode) {
    return sumOptimizerRotationDamage(simulation.rotations.personal.entries, input.runtime.id)
  }

  return getEligibleDirectEntry(simulation, input)?.avg ?? 0
}

// build the stat-weight map used by suggestion scoring heuristics
export function buildSuggestionWeightMap(
    simulation: SimulationResult,
    input: SuggestionsEvaluationInput,
    bias = 0,
): OptimizerStatWeightMap {
  // direct mode just uses the chosen target entry
  if (!input.rotationMode) {
    const entry = getEligibleDirectEntry(simulation, input)
    if (!entry) {
      return {}
    }

    return buildOptimizerStatWeightMap({
      finalStats: simulation.finalStats,
      skill: entry.skill,
      enemy: input.enemy,
      level: input.runtime.base.level,
      combat: input.runtime.state.combat,
    })
  }

  // rotation mode blends weights from all eligible rotation targets
  const entries = simulation.rotations.personal.entries.filter((entry) =>
      isOptimizerRotationTarget(entry, input.runtime.id),
  )
  if (entries.length === 0) {
    return {}
  }

  // use contribution-based weighting so more important entries influence the map more
  const contributions = entries.map((entry) => Math.max(0, entry.avg * (entry.weight ?? 1)))
  const baseTotal = contributions.reduce((sum, value) => sum + value, 0) || entries.length

  // exponent increases concentration as bias rises
  const exponent = Math.max(0, bias) * 10
  const scaled = contributions.map((value) => Math.pow((value || 1) / baseTotal, exponent || 1))
  const scaledTotal = scaled.reduce((sum, value) => sum + value, 0) || entries.length

  const weights: OptimizerStatWeightMap = {}

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const entryWeights = buildOptimizerStatWeightMap({
      finalStats: simulation.finalStats,
      skill: entry.skill,
      enemy: input.enemy,
      level: input.runtime.base.level,
      combat: input.runtime.state.combat,
    })

    mergeWeightMaps(weights, entryWeights, scaled[index] / scaledTotal)
  }

  return weights
}

// pull all weights toward or away from the average according to bias
export function applyWeightBias(
    weights: OptimizerStatWeightMap,
    bias: number,
): OptimizerStatWeightMap {
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
export function buildDirectSuggestionContext(
    input: MainStatSuggestionsInput | SetPlanSuggestionsInput | RandomSuggestionsInput,
    simulation: SimulationResult,
): DirectSuggestionContext | null {
  const entry = getEligibleDirectEntry(simulation, input)
  if (!entry) {
    return null
  }

  // strip equipped echoes so candidates are evaluated from a clean baseline
  const runtime = stripEchoes(input.runtime)
  const participants = buildRuntimeParticipantLookup(runtime, input.runtimesById)

  const prepared = compileOptimizerTargetContext({
    runtime,
    resonatorId: input.runtime.id,
    skillId: entry.skill.id,
    enemy: input.enemy,
    runtimesById: participants,
    selectedTargetsByOwnerKey: input.selectedTargetsByOwnerKey,
  })

  const comboSize = Math.max(1, input.runtime.build.echoes.filter((echo) => echo != null).length)
  const setRuntimeMask = buildSetRuntimeMask(runtime, input.setConditionals)

  return {
    mode: 'target',
    runtime,
    selectedSkill: prepared.selectedSkill,
    sourceBaseStats: prepared.combat.baseStats,
    sourceFinalStats: prepared.combat.finalStats,
    packedContext: packTargetContext({
      compiled: prepared.compiled,
      skill: prepared.skill,
      runtime,
      comboN: comboSize,
      comboK: comboSize,
      comboCount: 1,
      comboBaseIndex: 0,
      lockedEchoIndex: -1,
      setRuntimeMask,
    }),
    setConstLut: buildSetRows(runtime, input.setConditionals),
  }
}

// extract all rotation feature targets that should contribute to suggestion scoring
function buildRotationTargets(
    simulation: { rotations: { personal: { entries: FeatureResult[] } } },
    resonatorId: string,
): RotationTargetContext[] {
  return simulation.rotations.personal.entries
      .filter((entry) => isOptimizerRotationTarget(entry, resonatorId))
      .map((entry) => ({
        skill: entry.skill,
        resonatorId: entry.resonatorId,
        weight: entry.weight ?? 1,
      }))
}

// build the packed multi-context rotation evaluation context
export function buildRotationSuggestionContext(
    input: MainStatSuggestionsInput | SetPlanSuggestionsInput | RandomSuggestionsInput,
    _simulation: SimulationResult,
): RotationSuggestionContext | null {
  void _simulation
  const seed = getResonatorSeedById(input.runtime.id)
  if (!seed) {
    return null
  }

  // apply the personal rotation to a stripped runtime so setup effects are reflected
  const rotationRuntime = applyPersonalRotationItems(
      stripEchoes(input.runtime),
      input.runtime.rotation.personalItems,
  )
  const participants = buildRuntimeParticipantLookup(rotationRuntime, input.runtimesById)

  // build a transient graph and active combat context for rotation simulation
  const graph = buildTransientCombatGraph({
    activeRuntime: rotationRuntime,
    activeSeed: seed,
    participantRuntimes: participants,
    selectedTargetsByResonatorId: {
      [rotationRuntime.id]: input.selectedTargetsByOwnerKey ?? {},
    },
  })

  const activeContext = buildCombatContext({
    graph,
    targetSlotId: 'active',
    enemy: input.enemy,
  })

  const rotationEnvironment = buildPreparedRotationEnvironment(activeContext, seed)
  const simulated = runFeatureSimulation(activeContext, seed, participants, rotationEnvironment)
  const targets = buildRotationTargets(simulated, input.runtime.id)

  const fallbackSkill = targets[0]
      ? selectOptimizerTargetSkill(targets[0].skill)
      : createFallbackTarget(seed.id)

  if (targets.length === 0) {
    return null
  }

  // cache one combat context per resonator that participates in rotation targets
  const combatByResonatorId: Record<string, ReturnType<typeof buildCombatContext>> = {
    [rotationRuntime.id]: activeContext,
  }

  for (const target of targets) {
    if (combatByResonatorId[target.resonatorId]) {
      continue
    }

    const slotId = findCombatParticipantSlotId(graph, target.resonatorId)
    if (!slotId) {
      continue
    }

    combatByResonatorId[target.resonatorId] = buildCombatContext({
      graph,
      targetSlotId: slotId,
      enemy: input.enemy,
    })
  }

  const setRuntimeMask = buildSetRuntimeMask(rotationRuntime, input.setConditionals)
  const contexts = new Float32Array(targets.length * OPTIMIZER_CONTEXT_FLOATS)
  const contextWeights = new Float32Array(targets.length)

  // pack one optimizer context per rotation target
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]
    const ownerCombat = combatByResonatorId[target.resonatorId] ?? activeContext

    const compiled = buildCompiledOptimizerContext({
      resonatorId: target.resonatorId,
      runtime: ownerCombat.runtime,
      skill: target.skill,
      finalStats: ownerCombat.finalStats,
      enemy: input.enemy,
      combatState: ownerCombat.runtime.state.combat,
    })

    const packedContext = packTargetContext({
      compiled,
      skill: target.skill,
      runtime: ownerCombat.runtime,
      comboN: 5,
      comboK: 5,
      comboCount: 1,
      comboBaseIndex: 0,
      lockedEchoIndex: -1,
      setRuntimeMask,
    })

    contexts.set(packedContext, index * OPTIMIZER_CONTEXT_FLOATS)
    contextWeights[index] = target.weight
  }

  return {
    mode: 'rotation',
    runtime: rotationRuntime,
    selectedSkill: fallbackSkill,
    sourceBaseStats: activeContext.baseStats,
    sourceFinalStats: activeContext.finalStats,
    contexts,
    contextStride: OPTIMIZER_CONTEXT_FLOATS,
    contextWeights,
    contextCount: targets.length,
    setConstLut: buildSetRows(rotationRuntime, input.setConditionals),
  }
}

// choose the correct evaluation context based on direct or rotation mode
export function buildSuggestionEvaluationContext(
    input: MainStatSuggestionsInput | SetPlanSuggestionsInput | RandomSuggestionsInput,
    simulation: SimulationResult,
): SuggestionEvaluationContext | null {
  return input.rotationMode
      ? buildRotationSuggestionContext(input, simulation)
      : buildDirectSuggestionContext(input, simulation)
}

export function buildPreparedMainStatSuggestionsInput(
    input: MainStatSuggestionsInput,
    simulation: SimulationResult,
): PreparedMainStatSuggestionsInput | null {
  const context = buildSuggestionEvaluationContext(input, simulation)
  if (!context) {
    return null
  }

  return {
    context,
    rotationMode: input.rotationMode,
    equippedEchoes: input.runtime.build.echoes,
    charId: input.runtime.id,
    statWeight: buildSuggestionWeightMap(simulation, input),
    topK: input.topK,
  }
}

export function buildPreparedSetPlanSuggestionsInput(
    input: SetPlanSuggestionsInput,
    simulation: SimulationResult,
): PreparedSetPlanSuggestionsInput | null {
  const context = buildSuggestionEvaluationContext(input, simulation)
  if (!context) {
    return null
  }

  return {
    context,
    rotationMode: input.rotationMode,
    equippedEchoes: input.runtime.build.echoes,
    topK: input.topK,
  }
}

export function buildPreparedRandomSuggestionsInput(
    input: RandomSuggestionsInput,
    simulation: SimulationResult,
): PreparedRandomSuggestionsInput | null {
  const context = buildSuggestionEvaluationContext(input, simulation)
  if (!context) {
    return null
  }

  const rawWeightMap = buildSuggestionWeightMap(simulation, input, input.settings.bias)

  return {
    context,
    equippedEchoes: input.runtime.build.echoes,
    runtimeId: input.runtime.id,
    rawWeightMap,
    statWeight: applyWeightBias(rawWeightMap, input.settings.bias),
    settings: input.settings,
    resultsLimit: input.resultsLimit,
    candidateCount: input.candidateCount,
  }
}

// build main-echo buff rows for the current suggestion candidate loadout
export function buildSuggestionMainEchoBuffs(
    context: SuggestionEvaluationContext,
    echoes: Array<import('@/domain/entities/runtime').EchoInstance | null>,
): Float32Array {
  const concrete = echoes.filter((echo): echo is NonNullable<typeof echo> => echo != null)

  if (context.mode === 'target') {
    return buildMainEchoRows({
      echoes: concrete,
      runtime: context.runtime,
      sourceBaseStats: context.sourceBaseStats,
      sourceFinalStats: context.sourceFinalStats,
      selectedSkill: context.selectedSkill,
    })
  }

  return buildGenericMainEchoRows({
    echoes: concrete,
    runtime: context.runtime,
    sourceBaseStats: context.sourceBaseStats,
    sourceFinalStats: context.sourceFinalStats,
  })
}

// evaluate a candidate echo loadout when main-echo buffs are already prepared
export function evaluateSuggestionEchoesWithBuffs(
    context: SuggestionEvaluationContext,
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
  const encoded = encodeEchoRows(concrete, context.selectedSkill, 'self')

  // direct mode evaluates against a single packed target context
  if (context.mode === 'target') {
    return evalTarget({
      context: context.packedContext,
      stats: encoded.stats,
      setConstLut: context.setConstLut,
      mainEchoBuffs,
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
      mainEchoBuffs,
      sets: encoded.sets,
      kinds: encoded.kinds,
      comboIds,
      mainIndex,
    })?.damage ?? 0

    total += damage * (context.contextWeights[index] ?? 1)
  }

  return total
}

// evaluate a candidate echo loadout from scratch, including main-echo buff rows
export function evaluateSuggestionEchoes(
    context: SuggestionEvaluationContext,
    echoes: Array<import('@/domain/entities/runtime').EchoInstance | null>,
): number {
  return evaluateSuggestionEchoesWithBuffs(
      context,
      echoes,
      buildSuggestionMainEchoBuffs(context, echoes),
  )
}
