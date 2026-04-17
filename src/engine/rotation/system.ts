/*
  Author: Runor Ewhro
  Description: executes feature and rotation simulations by walking rotation
               nodes, applying runtime changes, resolving feature owners/skills,
               and collecting weighted damage feature rows for personal and
               team rotations.
*/

import type {
  DamageFeatureResult,
  EffectEvalScope,
  FeatureDefinition,
  RotationNode,
  RotationValue,
  RuntimeChange,
} from '@/domain/gameData/contracts'
import type { CombatGraph } from '@/domain/entities/combatGraph'
import { findCombatParticipantSlotId, rebuildCombatParticipant } from '@/domain/state/combatGraph'
import type { ResonatorRuntimeState, ResonatorSeed, RotationView } from '@/domain/entities/runtime'
import type { SlotId } from '@/domain/entities/session'
import type { SkillDefinition } from '@/domain/entities/stats'
import type { EnemyProfile } from '@/domain/entities/appState'
import { buildPreparedRuntimeCatalog } from '@/domain/services/runtimeSourceService'
import { buildTeamCompositionInfo } from '@/domain/gameData/teamComposition'
import { getNegativeEffectCombatKey } from '@/domain/gameData/negativeEffects'
import { readRuntimePath, writeObjectPath, writeRuntimePath } from '@/domain/gameData/runtimePath'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { cloneSlotRoutingState } from '@/domain/state/defaults'
import { cloneSlotLocalState } from '@/domain/state/runtimeMaterialization'
import { computeEchoSetCounts } from '@/engine/pipeline/buildCombatContext'
import { computeSkillDamage } from '@/engine/formulas/damage'
import { evaluateCondition, evaluateFormula } from '@/engine/effects/evaluator'
import { buildCombatContext } from '@/engine/pipeline/buildCombatContext'
import type { CombatContext } from '@/engine/pipeline/types'
import { prepareRuntimeSkill } from '@/engine/pipeline/prepareRuntimeSkill'
import { resolveSkill } from '@/engine/pipeline/resolveSkill'

// build a stack progression for negative-effect skills across multiple instances
// stacks decay every stableWidth hits until they reach zero
function buildNegativeEffectStackSeries(startStacks: number, instances: number, stableWidth: number): number[] {
  const normalizedStacks = Math.max(0, Math.floor(startStacks))
  const normalizedInstances = Math.max(1, Math.floor(instances))
  const normalizedStableWidth = Math.max(1, Math.floor(stableWidth))
  const series: number[] = []

  for (let index = 0; index < normalizedInstances; index += 1) {
    const stackValue = normalizedStacks - Math.floor(index / normalizedStableWidth)
    if (stackValue <= 0) {
      break
    }

    series.push(stackValue)
  }

  return series
}

// combine two computeSkillDamage results into one accumulated result
// used when a feature must be evaluated across several stack states
function mergeDamageResults(
    left: ReturnType<typeof computeSkillDamage>,
    right: ReturnType<typeof computeSkillDamage>,
): ReturnType<typeof computeSkillDamage> {
  return {
    normal: left.normal + right.normal,
    crit: left.crit + right.crit,
    avg: left.avg + right.avg,
    subHits: left.subHits.map((hit, index) => ({
      ...hit,
      normal: hit.normal + (right.subHits[index]?.normal ?? 0),
      crit: hit.crit + (right.subHits[index]?.crit ?? 0),
      avg: hit.avg + (right.subHits[index]?.avg ?? 0),
    })),
  }
}

export interface RotationFeatureRow {
  id: string
  featureId: string
  label: string
  tab: string
  multiplier: number
  enabled: boolean
  resonatorId: string
  resonatorName: string
}

interface RotationParticipantState {
  // owning seed for this participant
  seed: ResonatorSeed

  // current runtime state for this participant
  runtime: ResonatorRuntimeState

  // combat context resolved against the current graph/enemy
  context: CombatContext
}

type RotationOverlayValue = string | number | boolean

interface RotationOverlayState {
  version: number
  runtimePathsByResonatorId: Record<string, Record<string, RotationOverlayValue>>
  routingPathsByResonatorId: Record<string, Record<string, RotationOverlayValue>>
}

export interface PreparedRotationEnvironment {
  primaryResonatorId: string
  primarySlotId: SlotId
  enemy: EnemyProfile
  graph: CombatGraph
  // cached seed lookup for all possible participants
  seedLookup: Record<string, ResonatorSeed>

  // base contexts for the unmodified prepared graph
  baseContextsBySlotId: Partial<Record<SlotId, CombatContext>>
}

interface RotationExecState {
  environment: PreparedRotationEnvironment
  overlay: RotationOverlayState

  // lazily resolved runtime snapshots for the current overlay version
  resolvedRuntimeCache: Record<string, { version: number; runtime: ResonatorRuntimeState }>

  // lazily materialized graph for the current overlay version
  materializedGraphVersion: number
  materializedGraph: CombatGraph | null

  // branch weight, mainly used by uptime nodes
  weight: number

  // accumulated feature result rows produced so far
  entries: DamageFeatureResult[]
}

// current implementation just respects explicit enabled state on the node
export function isRotationNodeEnabled(runtime: ResonatorRuntimeState, node: RotationNode): boolean {
  void runtime
  return node.enabled ?? true
}

// resolve a feature node multiplier, defaulting to 1 when unset
export function getFeatureNodeMultiplier(
    runtime: ResonatorRuntimeState,
    node: Extract<RotationNode, { type: 'feature' }>,
): number {
  void runtime
  return node.multiplier ?? 1
}

// resolve repeat count if present on a repeat node
export function getRepeatNodeTimes(
    runtime: ResonatorRuntimeState,
    node: Extract<RotationNode, { type: 'repeat' }>,
): number | undefined {
  void runtime
  return typeof node.times === 'number' ? node.times : undefined
}

// resolve uptime ratio if present on an uptime node
export function getUptimeNodeRatio(
    runtime: ResonatorRuntimeState,
    node: Extract<RotationNode, { type: 'uptime' }>,
): number | undefined {
  void runtime
  return typeof node.ratio === 'number' ? node.ratio : undefined
}

// build the effect-evaluation scope used by feature/node conditions and formulas
function buildScope(
    runtime: ResonatorRuntimeState,
    source: FeatureDefinition['source'],
    activeRuntime: ResonatorRuntimeState = runtime,
    targetRuntime: ResonatorRuntimeState = runtime,
): EffectEvalScope {
  const teamMemberIds = Array.from(
      new Set([activeRuntime.id, ...activeRuntime.build.team.filter((memberId): memberId is string => Boolean(memberId))]),
  )
  const team = buildTeamCompositionInfo(teamMemberIds)

  return {
    sourceRuntime: runtime,
    targetRuntime,
    activeRuntime,
    context: {
      team,
      source,
      sourceRuntime: runtime,
      targetRuntime,
      activeRuntime,
      targetRuntimeId: targetRuntime.id,
      activeResonatorId: activeRuntime.id,
      teamMemberIds,
      echoSetCounts: computeEchoSetCounts(runtime.build.echoes),
    },
  }
}

// scale either the flat multiplier or each hit entry depending on the skill form
function scaleSkill(skill: SkillDefinition, multiplier: number): SkillDefinition {
  if (multiplier === 1) {
    return skill
  }

  if (skill.hits.length === 0) {
    return {
      ...skill,
      multiplier: skill.multiplier * multiplier,
    }
  }

  const hits = skill.hits.map((hit) => ({
    ...hit,
    multiplier: hit.multiplier * multiplier,
  }))

  return {
    ...skill,
    multiplier: hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0),
    hits,
  }
}

// for sub-hit features, carve out one concrete hit from the full skill
// otherwise return the skill unchanged
function sliceSkillForFeature(skill: SkillDefinition, feature: FeatureDefinition): SkillDefinition {
  if (feature.variant !== 'subHit' || typeof feature.hitIndex !== 'number') {
    return skill
  }

  const hit = skill.hits[feature.hitIndex]
  if (!hit) {
    return skill
  }

  const hitTableEntry = skill.hitTable?.[feature.hitIndex]

  return {
    ...skill,
    label: feature.label,
    multiplier: hit.multiplier,
    hits: [{ ...hit, count: 1 }],
    hitTable: hitTableEntry ? [{
      ...hitTableEntry,
      count: 1,
      values: hitTableEntry?.values ?? [],
    }] : undefined,
  }
}

// multiply a full damage result by a branch weight
function scaleResult(result: ReturnType<typeof computeSkillDamage>, weight: number) {
  if (weight === 1) {
    return result
  }

  return {
    normal: result.normal * weight,
    crit: result.crit * weight,
    avg: result.avg * weight,
    subHits: result.subHits.map((hit) => ({
      ...hit,
      normal: hit.normal * weight,
      crit: hit.crit * weight,
      avg: hit.avg * weight,
    })),
  }
}

// hide zero-output negative-effect feature rows so empty stack states do not surface in results
function shouldIncludeFeatureResult(skill: SkillDefinition, result: ReturnType<typeof computeSkillDamage>): boolean {
  return !((skill.archetype === 'spectroFrazzle' || skill.archetype === 'aeroErosion' || skill.archetype === 'fusionBurst' || skill.archetype === 'glacioChafe' || skill.archetype === 'electroFlare')
      && result.avg <= 0);
}

// create the base execution state for one rotation run
export function buildPreparedRotationEnvironment(
    context: CombatContext,
    seed: ResonatorSeed,
): PreparedRotationEnvironment {
  const graph = context.graph
  const primaryParticipant = graph.participants[context.targetSlotId]
  if (!primaryParticipant) {
    throw new Error(`Missing primary participant in combat graph for slot ${context.targetSlotId}`)
  }

  const baseContextsBySlotId: Partial<Record<SlotId, CombatContext>> = {}
  const seedLookup: Record<string, ResonatorSeed> = {
    [seed.id]: seed,
  }

  for (const participant of Object.values(graph.participants)) {
    baseContextsBySlotId[participant.slotId] = buildCombatContext({
      graph,
      targetSlotId: participant.slotId,
      enemy: context.enemy,
    })

    if (!seedLookup[participant.resonatorId]) {
      const participantSeed = getResonatorSeedById(participant.resonatorId)
      if (participantSeed) {
        seedLookup[participant.resonatorId] = participantSeed
      }
    }
  }

  return {
    primaryResonatorId: primaryParticipant.resonatorId,
    primarySlotId: context.targetSlotId,
    enemy: context.enemy,
    graph,
    seedLookup,
    baseContextsBySlotId,
  }
}

// create the base execution state for one rotation run
function buildRotationState(
    environment: PreparedRotationEnvironment,
): RotationExecState {
  return {
    environment,
    overlay: {
      version: 0,
      runtimePathsByResonatorId: {},
      routingPathsByResonatorId: {},
    },
    resolvedRuntimeCache: {},
    materializedGraphVersion: -1,
    materializedGraph: null,
    weight: 1,
    entries: [],
  }
}

// shallow-clone execution state for branch evaluation
function cloneRotationState(state: RotationExecState): RotationExecState {
  return {
    ...state,
    entries: [],
  }
}

// fetch the runtime of the primary slot for current state
function getPrimaryRuntime(state: RotationExecState): ResonatorRuntimeState | null {
  return getResolvedParticipantRuntime(state, state.environment.primaryResonatorId)
}

// choose the resonator id a node should operate on
// node override wins, then explicit fallback, then primary resonator
function resolveNodeResonatorId(state: RotationExecState, node: RotationNode, fallbackResonatorId: string): string {
  return node.resonatorId ?? fallbackResonatorId ?? state.environment.primaryResonatorId
}

function getBaseGraph(state: RotationExecState): CombatGraph {
  return state.environment.graph
}

function hasOverlayForResonator(state: RotationExecState, resonatorId: string): boolean {
  return Boolean(
      state.overlay.runtimePathsByResonatorId[resonatorId]
      || state.overlay.routingPathsByResonatorId[resonatorId],
  )
}

function getResolvedParticipantRuntime(state: RotationExecState, resonatorId: string): ResonatorRuntimeState | null {
  const slotId = findCombatParticipantSlotId(getBaseGraph(state), resonatorId)
  if (!slotId) {
    return null
  }

  if (!hasOverlayForResonator(state, resonatorId)) {
    return getBaseGraph(state).participants[slotId]?.runtime ?? null
  }

  const cached = state.resolvedRuntimeCache[resonatorId]
  if (cached?.version === state.overlay.version) {
    return cached.runtime
  }

  const baseRuntime = getBaseGraph(state).participants[slotId]?.runtime
  if (!baseRuntime) {
    return null
  }

  let nextRuntime = baseRuntime
  const runtimePaths = state.overlay.runtimePathsByResonatorId[resonatorId] ?? {}
  for (const [path, value] of Object.entries(runtimePaths)) {
    nextRuntime = writeRuntimePath(nextRuntime, path, value)
  }

  state.resolvedRuntimeCache[resonatorId] = {
    version: state.overlay.version,
    runtime: nextRuntime,
  }

  return nextRuntime
}

function applyRoutingOverlay(
    state: RotationExecState,
    resonatorId: string,
    baseRouting: ReturnType<typeof cloneSlotRoutingState>,
): ReturnType<typeof cloneSlotRoutingState> {
  const routingPaths = state.overlay.routingPathsByResonatorId[resonatorId] ?? {}
  let nextRouting = baseRouting

  for (const [path, value] of Object.entries(routingPaths)) {
    nextRouting = writeObjectPath(
        nextRouting as unknown as Record<string, unknown>,
        path.split('.'),
        value,
    ) as unknown as ReturnType<typeof cloneSlotRoutingState>
  }

  return nextRouting
}

function getMaterializedGraph(state: RotationExecState): CombatGraph {
  if (state.overlay.version === 0) {
    return getBaseGraph(state)
  }

  if (state.materializedGraphVersion === state.overlay.version && state.materializedGraph) {
    return state.materializedGraph
  }

  const baseGraph = getBaseGraph(state)
  const nextGraph: CombatGraph = {
    ...baseGraph,
    participants: {
      ...baseGraph.participants,
    },
  }

  for (const participant of Object.values(baseGraph.participants)) {
    if (!hasOverlayForResonator(state, participant.resonatorId)) {
      continue
    }

    const resolvedRuntime = getResolvedParticipantRuntime(state, participant.resonatorId)
    if (!resolvedRuntime) {
      continue
    }

    const nextParticipant = {
      ...participant,
      slot: {
        ...participant.slot,
        local: cloneSlotLocalState(resolvedRuntime.state),
        routing: applyRoutingOverlay(
            state,
            participant.resonatorId,
            cloneSlotRoutingState(participant.slot.routing),
        ),
      },
      runtime: resolvedRuntime,
      snapshots: {
        ...participant.snapshots,
      },
    }

    nextGraph.participants[participant.slotId] = nextParticipant
    rebuildCombatParticipant(nextGraph, participant.slotId)
  }

  state.materializedGraphVersion = state.overlay.version
  state.materializedGraph = nextGraph
  return nextGraph
}

// resolve a participant and its current combat context from the graph
function getParticipant(state: RotationExecState, resonatorId: string): RotationParticipantState | null {
  const slotId = findCombatParticipantSlotId(getBaseGraph(state), resonatorId)
  if (!slotId) {
    return null
  }

  const graph = state.overlay.version === 0 ? getBaseGraph(state) : getMaterializedGraph(state)
  const participant = graph.participants[slotId]
  const seed = state.environment.seedLookup[resonatorId] ?? getResonatorSeedById(resonatorId)
  if (!participant || !seed) {
    return null
  }

  const context = state.overlay.version === 0
      ? state.environment.baseContextsBySlotId[slotId]
      : buildCombatContext({
        graph,
        targetSlotId: slotId,
        enemy: state.environment.enemy,
      })

  if (!context) {
    return null
  }

  return {
    seed,
    runtime: participant.runtime,
    context,
  }
}

// list every graph participant as a rotation participant state
function listParticipants(state: RotationExecState): RotationParticipantState[] {
  const graph = state.overlay.version === 0 ? getBaseGraph(state) : getMaterializedGraph(state)

  return Object.values(graph.participants).flatMap((participant) => {
    const seed = state.environment.seedLookup[participant.resonatorId] ?? getResonatorSeedById(participant.resonatorId)
    if (!seed) {
      return []
    }

    const context = state.overlay.version === 0
        ? state.environment.baseContextsBySlotId[participant.slotId]
        : buildCombatContext({
          graph,
          targetSlotId: participant.slotId,
          enemy: state.environment.enemy,
        })

    if (!context) {
      return []
    }

    return [{
      seed,
      runtime: participant.runtime,
      context,
    }]
  })
}

function writeRotationOverlayPath(
    state: RotationExecState,
    resonatorId: string,
    path: string,
    value: RotationOverlayValue,
): RotationExecState {
  const normalizedPath = path.replace(/^runtime\./, '')

  if (normalizedPath.startsWith('state.controls.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        runtimePathsByResonatorId: {
          ...state.overlay.runtimePathsByResonatorId,
          [resonatorId]: {
            ...(state.overlay.runtimePathsByResonatorId[resonatorId] ?? {}),
            [`runtime.${normalizedPath}`]: value,
          },
        },
      },
      resolvedRuntimeCache: {},
      materializedGraphVersion: -1,
      materializedGraph: null,
    }
  }

  if (normalizedPath.startsWith('state.manualBuffs.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        runtimePathsByResonatorId: {
          ...state.overlay.runtimePathsByResonatorId,
          [resonatorId]: {
            ...(state.overlay.runtimePathsByResonatorId[resonatorId] ?? {}),
            [`runtime.${normalizedPath}`]: value,
          },
        },
      },
      resolvedRuntimeCache: {},
      materializedGraphVersion: -1,
      materializedGraph: null,
    }
  }

  if (normalizedPath.startsWith('state.combat.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        runtimePathsByResonatorId: {
          ...state.overlay.runtimePathsByResonatorId,
          [resonatorId]: {
            ...(state.overlay.runtimePathsByResonatorId[resonatorId] ?? {}),
            [`runtime.${normalizedPath}`]: value,
          },
        },
      },
      resolvedRuntimeCache: {},
      materializedGraphVersion: -1,
      materializedGraph: null,
    }
  }

  if (normalizedPath.startsWith('base.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        runtimePathsByResonatorId: {
          ...state.overlay.runtimePathsByResonatorId,
          [resonatorId]: {
            ...(state.overlay.runtimePathsByResonatorId[resonatorId] ?? {}),
            [`runtime.${normalizedPath}`]: value,
          },
        },
      },
      resolvedRuntimeCache: {},
      materializedGraphVersion: -1,
      materializedGraph: null,
    }
  }

  if (normalizedPath.startsWith('build.weapon.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        runtimePathsByResonatorId: {
          ...state.overlay.runtimePathsByResonatorId,
          [resonatorId]: {
            ...(state.overlay.runtimePathsByResonatorId[resonatorId] ?? {}),
            [`runtime.${normalizedPath}`]: value,
          },
        },
      },
      resolvedRuntimeCache: {},
      materializedGraphVersion: -1,
      materializedGraph: null,
    }
  }

  if (normalizedPath.startsWith('build.echoes.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        runtimePathsByResonatorId: {
          ...state.overlay.runtimePathsByResonatorId,
          [resonatorId]: {
            ...(state.overlay.runtimePathsByResonatorId[resonatorId] ?? {}),
            [`runtime.${normalizedPath}`]: value,
          },
        },
      },
      resolvedRuntimeCache: {},
      materializedGraphVersion: -1,
      materializedGraph: null,
    }
  }

  if (normalizedPath.startsWith('routing.selectedTargetsByOwnerKey.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        routingPathsByResonatorId: {
          ...state.overlay.routingPathsByResonatorId,
          [resonatorId]: {
            ...(state.overlay.routingPathsByResonatorId[resonatorId] ?? {}),
            [normalizedPath.replace(/^routing\./, '')]: value,
          },
        },
      },
      resolvedRuntimeCache: {},
      materializedGraphVersion: -1,
      materializedGraph: null,
    }
  }

  throw new Error(`Unsupported rotation runtime change path: ${path}`)
}

// evaluate and apply one runtime change node into the rotation state
function applyRuntimeChange(
    state: RotationExecState,
    change: RuntimeChange,
    fallbackResonatorId: string,
): RotationExecState {
  const targetResonatorId = change.resonatorId ?? fallbackResonatorId

  const participant = getParticipant(state, targetResonatorId)
  if (!participant) {
    return state
  }

  let nextValue: string | number | boolean
  if (change.type === 'set') {
    nextValue = change.value
  } else if (change.type === 'toggle') {
    nextValue = change.value ?? true
  } else {
    const current = Number(readRuntimePath(participant.runtime, change.path))
    nextValue = (Number.isFinite(current) ? current : 0) + change.value
  }

  return writeRotationOverlayPath(state, targetResonatorId, change.path, nextValue)
}

// resolve a RotationValue into a concrete numeric value
// override takes priority, then raw number, then formula evaluation
function evaluateRotationValue(
    value: RotationValue,
    runtime: ResonatorRuntimeState,
    source: FeatureDefinition['source'],
    override?: number,
    activeRuntime: ResonatorRuntimeState = runtime,
    targetRuntime: ResonatorRuntimeState = runtime,
): number {
  if (typeof override === 'number' && Number.isFinite(override)) {
    return override
  }

  if (typeof value === 'number') {
    return value
  }

  return evaluateFormula(value, buildScope(runtime, source, activeRuntime, targetRuntime))
}

// lookup helpers against the merged runtime/seed catalog
function findFeature(runtime: ResonatorRuntimeState, seed: ResonatorSeed, featureId: string): FeatureDefinition | null {
  return buildPreparedRuntimeCatalog(runtime, seed).featuresById[featureId] ?? null
}

function findSkill(runtime: ResonatorRuntimeState, seed: ResonatorSeed, skillId: string): SkillDefinition | null {
  return buildPreparedRuntimeCatalog(runtime, seed).skillsById[skillId] ?? null
}

// resolve which participant owns a feature, preferring the requested resonator first
function findFeatureOwner(
    state: RotationExecState,
    featureId: string,
    preferredResonatorId: string,
): { participant: RotationParticipantState; feature: FeatureDefinition } | null {
  const preferred = getParticipant(state, preferredResonatorId)
  if (preferred) {
    const feature = findFeature(preferred.runtime, preferred.seed, featureId)
    if (feature) {
      return { participant: preferred, feature }
    }
  }

  for (const participant of listParticipants(state)) {
    const feature = findFeature(participant.runtime, participant.seed, featureId)
    if (feature) {
      return { participant, feature }
    }
  }

  return null
}

// resolve enable/multiplier state for one feature node
function resolveFeatureNodeState(
    runtime: ResonatorRuntimeState,
    node: Extract<RotationNode, { type: 'feature' }>,
): { enabled: boolean; multiplier: number } {
  return {
    enabled: isRotationNodeEnabled(runtime, node) && (node.enabled ?? true),
    multiplier: getFeatureNodeMultiplier(runtime, node),
  }
}

// execute one feature node and append its result row
function runFeatureNode(
    state: RotationExecState,
    node: Extract<RotationNode, { type: 'feature' }>,
    fallbackResonatorId: string,
): RotationExecState {
  const ownerResonatorId = resolveNodeResonatorId(state, node, fallbackResonatorId)
  const localFeatureState = (node.changes ?? []).reduce(
      (nextState, change) => applyRuntimeChange(nextState, change, ownerResonatorId),
      state,
  )
  const featureData = findFeatureOwner(localFeatureState, node.featureId, ownerResonatorId)
  if (!featureData) {
    return state
  }

  const { participant, feature } = featureData
  const primaryRuntime = getPrimaryRuntime(localFeatureState) ?? participant.runtime
  const featureScope = buildScope(participant.runtime, feature.source, primaryRuntime, participant.runtime)
  if (!evaluateCondition(feature.condition, featureScope)) {
    return state
  }

  const nodeState = resolveFeatureNodeState(primaryRuntime, node)
  if (!nodeState.enabled) {
    return state
  }

  const skill = findSkill(participant.runtime, participant.seed, feature.skillId)
  if (!skill) {
    return state
  }

  const resolvedSkill = prepareRuntimeSkill(participant.runtime, skill, {
    ...participant.context,
    graph: localFeatureState.overlay.version === 0 ? getBaseGraph(localFeatureState) : getMaterializedGraph(localFeatureState),
    targetSlotId:
        findCombatParticipantSlotId(getBaseGraph(localFeatureState), participant.seed.id) ?? localFeatureState.environment.primarySlotId,
  })
  if (resolvedSkill.visible === false) {
    return state
  }

  const featuredSkill = sliceSkillForFeature(resolvedSkill, feature)
  const scaledSkill = scaleSkill(featuredSkill, nodeState.multiplier)

  // special handling for negative-effect skills whose output depends on combat stack state
  const negativeEffectCombatKey = getNegativeEffectCombatKey(scaledSkill.archetype)
  const negativeEffectStacksOverride =
      typeof node.negativeEffectStacks === 'number' && Number.isFinite(node.negativeEffectStacks)
          ? Math.max(0, Math.floor(node.negativeEffectStacks))
          : null
  const negativeEffectInstances =
      typeof node.negativeEffectInstances === 'number' && Number.isFinite(node.negativeEffectInstances)
          ? Math.max(1, Math.floor(node.negativeEffectInstances))
          : 1
  const negativeEffectStableWidth =
      typeof node.negativeEffectStableWidth === 'number' && Number.isFinite(node.negativeEffectStableWidth)
          ? Math.max(1, Math.floor(node.negativeEffectStableWidth))
          : 1
  const baseCombatState = participant.runtime.state.combat

  const weightedResult = scaleResult(
      negativeEffectCombatKey
          ? (() => {
            const startStacks = negativeEffectStacksOverride ?? Math.max(0, Math.floor(baseCombatState[negativeEffectCombatKey] ?? 0))
            const stackSeries = buildNegativeEffectStackSeries(
                startStacks,
                negativeEffectInstances,
                negativeEffectStableWidth,
            )

            if (stackSeries.length === 0) {
              return computeSkillDamage(
                  participant.context.finalStats,
                  scaledSkill,
                  participant.context.enemy,
                  participant.runtime.base.level,
                  {
                    ...baseCombatState,
                    [negativeEffectCombatKey]: 0,
                  },
              )
            }

            return stackSeries.reduce<ReturnType<typeof computeSkillDamage> | null>((total, stackValue) => {
              const nextResult = computeSkillDamage(
                  participant.context.finalStats,
                  scaledSkill,
                  participant.context.enemy,
                  participant.runtime.base.level,
                  {
                    ...baseCombatState,
                    [negativeEffectCombatKey]: stackValue,
                  },
              )

              return total ? mergeDamageResults(total, nextResult) : nextResult
            }, null) ?? computeSkillDamage(
                participant.context.finalStats,
                scaledSkill,
                participant.context.enemy,
                participant.runtime.base.level,
                baseCombatState,
            )
          })()
          : computeSkillDamage(
              participant.context.finalStats,
              scaledSkill,
              participant.context.enemy,
              participant.runtime.base.level,
              baseCombatState,
          ),
      state.weight,
  )

  if (!shouldIncludeFeatureResult(scaledSkill, weightedResult)) {
    return state
  }

  const nextState: RotationExecState = {
    ...state,
    entries: [
      ...state.entries,
      {
        id: `${node.id}:${feature.id}`,
        nodeId: node.id,
        resonatorId: participant.seed.id,
        resonatorName: participant.seed.name,
        feature,
        skill: scaledSkill,
        archetype: scaledSkill.archetype,
        aggregationType: scaledSkill.aggregationType,
        multiplier: nodeState.multiplier,
        weight: state.weight,
        normal: weightedResult.normal,
        crit: weightedResult.crit,
        avg: weightedResult.avg,
        subHits: weightedResult.subHits,
      },
    ],
  }

  // some features append follow-up rotation nodes after they execute
  if (!feature.after?.length) {
    return nextState
  }

  return runRotationItems(nextState, feature.after, participant.seed.id)
}

// execute a condition node by applying all runtime changes if the condition passes
function runConditionNode(
    state: RotationExecState,
    node: Extract<RotationNode, { type: 'condition' }>,
    fallbackResonatorId: string,
): RotationExecState {
  const scopeResonatorId = resolveNodeResonatorId(state, node, fallbackResonatorId)
  const participant = getParticipant(state, scopeResonatorId)
  if (!participant) {
    return state
  }

  return node.changes.reduce(
      (nextState, change) => applyRuntimeChange(nextState, change, scopeResonatorId),
      state,
  )
}

// execute a repeat node by running its child items several times
function runRepeatNode(
    state: RotationExecState,
    node: Extract<RotationNode, { type: 'repeat' }>,
    fallbackResonatorId: string,
): RotationExecState {
  const scopeResonatorId = resolveNodeResonatorId(state, node, fallbackResonatorId)
  const participant = getParticipant(state, scopeResonatorId)
  const rotationRuntime = getPrimaryRuntime(state)
  if (!participant || !rotationRuntime) {
    return state
  }

  const times = Math.max(
      0,
      Math.floor(
          evaluateRotationValue(
              node.times,
              participant.runtime,
              { type: 'resonator', id: participant.seed.id },
              getRepeatNodeTimes(rotationRuntime, node),
              rotationRuntime,
              participant.runtime,
          ),
      ),
  )

  let nextState = state
  for (let index = 0; index < times; index += 1) {
    nextState = runRotationItems(nextState, node.items, scopeResonatorId)
  }

  return nextState
}

// helper for setup lists used by uptime nodes
// setup nodes may mutate graph state before the weighted branch is evaluated
function runSetupItems(
    state: RotationExecState,
    items: RotationNode[] | undefined,
    fallbackResonatorId: string,
): RotationExecState {
  if (!items?.length) {
    return state
  }

  let nextState = state

  for (const item of items) {
    const rotationRuntime = getPrimaryRuntime(nextState)
    if (!rotationRuntime || !isRotationNodeEnabled(rotationRuntime, item)) {
      continue
    }

    if (item.type === 'feature') {
      nextState = runFeatureNode(nextState, item, fallbackResonatorId)
      continue
    }

    if (item.type === 'condition') {
      nextState = runConditionNode(nextState, item, fallbackResonatorId)
      continue
    }

    if (item.type === 'repeat') {
      nextState = runRepeatNode(nextState, item, fallbackResonatorId)
      continue
    }

    if (item.type === 'uptime') {
      const scopeResonatorId = resolveNodeResonatorId(nextState, item, fallbackResonatorId)
      const participant = getParticipant(nextState, scopeResonatorId)
      const primaryRuntime = getPrimaryRuntime(nextState)
      if (!participant || !primaryRuntime) {
        continue
      }

      const ratio = Math.max(
          0,
          Math.min(
              1,
              evaluateRotationValue(
                  item.ratio,
                  participant.runtime,
                  { type: 'resonator', id: participant.seed.id },
                  getUptimeNodeRatio(primaryRuntime, item),
                  primaryRuntime,
                  participant.runtime,
              ),
          ),
      )

      // setup items only need to carry forward resulting graph state here
      if (ratio > 0) {
        let branchState = cloneRotationState(nextState)
        branchState = runSetupItems(branchState, item.setup, scopeResonatorId)
        branchState = runSetupItems(branchState, item.items, scopeResonatorId)
        nextState = {
          ...nextState,
          overlay: branchState.overlay,
          resolvedRuntimeCache: branchState.resolvedRuntimeCache,
          materializedGraphVersion: branchState.materializedGraphVersion,
          materializedGraph: branchState.materializedGraph,
        }
      }
    }
  }

  return nextState
}

// execute an uptime node by running its child list in a weighted branch
function runUptimeNode(
    state: RotationExecState,
    node: Extract<RotationNode, { type: 'uptime' }>,
    fallbackResonatorId: string,
): RotationExecState {
  const scopeResonatorId = resolveNodeResonatorId(state, node, fallbackResonatorId)
  const participant = getParticipant(state, scopeResonatorId)
  const rotationRuntime = getPrimaryRuntime(state)
  if (!participant || !rotationRuntime) {
    return state
  }

  const ratio = Math.max(
      0,
      Math.min(
          1,
          evaluateRotationValue(
              node.ratio,
              participant.runtime,
              { type: 'resonator', id: participant.seed.id },
              getUptimeNodeRatio(rotationRuntime, node),
              rotationRuntime,
              participant.runtime,
          ),
      ),
  )
  if (ratio <= 0) {
    return state
  }

  let branchState = cloneRotationState(state)
  branchState = runSetupItems(branchState, node.setup, scopeResonatorId)
  branchState = {
    ...branchState,
    weight: state.weight * ratio,
    entries: [],
  }

  const result = runRotationItems(branchState, node.items, scopeResonatorId)

  return {
    ...state,
    entries: [...state.entries, ...result.entries],
  }
}

// main rotation interpreter
// walks nodes in order and updates execution state as each node resolves
export function runRotationItems(
    state: RotationExecState,
    items: RotationNode[],
    fallbackResonatorId: string = state.environment.primaryResonatorId,
): RotationExecState {
  let nextState = state

  for (const item of items) {
    const rotationRuntime = getPrimaryRuntime(nextState)
    if (!rotationRuntime || !isRotationNodeEnabled(rotationRuntime, item)) {
      continue
    }

    if (item.type === 'feature') {
      nextState = runFeatureNode(nextState, item, fallbackResonatorId)
      continue
    }

    if (item.type === 'condition') {
      nextState = runConditionNode(nextState, item, fallbackResonatorId)
      continue
    }

    if (item.type === 'repeat') {
      nextState = runRepeatNode(nextState, item, fallbackResonatorId)
      continue
    }

    if (item.type === 'uptime') {
      nextState = runUptimeNode(nextState, item, fallbackResonatorId)
    }
  }

  return nextState
}

// recursively collect UI-friendly feature rows from a rotation node tree
function visitFeatureRows(
    items: RotationNode[],
    rows: RotationFeatureRow[],
    runtime: ResonatorRuntimeState,
    runtimesById: Record<string, ResonatorRuntimeState>,
    seedLookup: Record<string, ResonatorSeed>,
    fallbackResonatorId: string,
): void {
  for (const item of items) {
    const resonatorId = item.resonatorId ?? fallbackResonatorId

    if (item.type === 'feature') {
      const rowSeed = seedLookup[resonatorId]
      const rowRuntime = resonatorId === runtime.id ? runtime : runtimesById[resonatorId] ?? null
      const feature = rowRuntime && rowSeed ? findFeature(rowRuntime, rowSeed, item.featureId) : null
      const skill = feature && rowRuntime && rowSeed ? findSkill(rowRuntime, rowSeed, feature.skillId) : null

      if (feature && skill && rowSeed) {
        const resolvedSkill = resolveSkill(rowRuntime, skill)
        const nodeState = resolveFeatureNodeState(runtime, item)
        rows.push({
          id: item.id,
          featureId: feature.id,
          label: resolvedSkill.tab === 'negativeEffect' ? resolvedSkill.label : feature.label,
          tab: resolvedSkill.tab,
          multiplier: nodeState.multiplier,
          enabled: nodeState.enabled,
          resonatorId: rowSeed.id,
          resonatorName: rowSeed.name,
        })
      }
      continue
    }

    if (item.type === 'repeat') {
      visitFeatureRows(item.items, rows, runtime, runtimesById, seedLookup, resonatorId)
      continue
    }

    if (item.type === 'uptime') {
      visitFeatureRows(item.setup ?? [], rows, runtime, runtimesById, seedLookup, resonatorId)
      visitFeatureRows(item.items, rows, runtime, runtimesById, seedLookup, resonatorId)
    }
  }
}

// list feature rows for either personal or team rotation views
export function listRotationFeatureRows(
    seed: ResonatorSeed,
    runtime: ResonatorRuntimeState,
    runtimesById: Record<string, ResonatorRuntimeState> = {},
    seedLookup: Record<string, ResonatorSeed> = { [seed.id]: seed },
    mode: Exclude<RotationView, 'saved'> = runtime.rotation.view === 'team' ? 'team' : 'personal',
): RotationFeatureRow[] {
  const rows: RotationFeatureRow[] = []

  if (mode === 'team') {
    visitFeatureRows(runtime.rotation.teamItems, rows, runtime, runtimesById, seedLookup, seed.id)
    return rows
  }

  visitFeatureRows(runtime.rotation.personalItems, rows, runtime, runtimesById, seedLookup, seed.id)
  return rows
}

export function buildDirectFeatureResults(
    context: CombatContext,
    seed: ResonatorSeed,
): DamageFeatureResult[] {
  const activeCatalog = buildPreparedRuntimeCatalog(context.runtime, seed)

  return activeCatalog.features
      .filter((feature) => feature.variant !== 'subHit')
      .map((feature) => {
        const activeRuntime = context.graph.participants[context.graph.activeSlotId]?.runtime ?? context.runtime
        const scope = buildScope(context.runtime, feature.source, activeRuntime, context.runtime)
        if (!evaluateCondition(feature.condition, scope)) {
          return null
        }

        const skill = activeCatalog.skillsById[feature.skillId]
        if (!skill) {
          return null
        }

        const resolvedSkill = prepareRuntimeSkill(context.runtime, skill, context)
        if (resolvedSkill.visible === false) {
          return null
        }

        const featuredSkill = sliceSkillForFeature(resolvedSkill, feature)

        const result = computeSkillDamage(
            context.finalStats,
            featuredSkill,
            context.enemy,
            context.runtime.base.level,
            context.runtime.state.combat,
        )
        if (!shouldIncludeFeatureResult(featuredSkill, result)) {
          return null
        }

        return {
          id: feature.id,
          resonatorId: seed.id,
          resonatorName: seed.name,
          feature,
          skill: featuredSkill,
          archetype: featuredSkill.archetype,
          aggregationType: featuredSkill.aggregationType,
          multiplier: 1,
          weight: 1,
          normal: result.normal,
          crit: result.crit,
          avg: result.avg,
          subHits: result.subHits,
        }
      })
      .filter((entry): entry is DamageFeatureResult => entry !== null)
}

// run the complete feature simulation surface:
// 1. evaluate all direct features for the active runtime
// 2. execute personal rotation nodes
// 3. execute team rotation nodes
export function runFeatureSimulation(
    context: CombatContext,
    seed: ResonatorSeed,
    runtimesById: Record<string, ResonatorRuntimeState> = {},
    environment?: PreparedRotationEnvironment,
    directFeatures?: DamageFeatureResult[],
): {
  allFeatures: DamageFeatureResult[]
  rotations: {
    personal: {
      entries: DamageFeatureResult[]
    }
    team: {
      entries: DamageFeatureResult[]
    }
  }
} {
  void runtimesById

  const allFeatures = directFeatures ?? buildDirectFeatureResults(context, seed)
  const preparedEnvironment = environment ?? buildPreparedRotationEnvironment(context, seed)

  // execute both personal and team rotation lists against fresh root states
  const personalState = buildRotationState(preparedEnvironment)
  const personalResult = runRotationItems(personalState, context.runtime.rotation.personalItems)

  const teamState = buildRotationState(preparedEnvironment)
  const teamResult = runRotationItems(teamState, context.runtime.rotation.teamItems)

  return {
    allFeatures,
    rotations: {
      personal: {
        entries: personalResult.entries,
      },
      team: {
        entries: teamResult.entries,
      },
    },
  }
}
