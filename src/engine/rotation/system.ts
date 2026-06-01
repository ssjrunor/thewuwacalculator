/*
  Author: Runor Ewhro
  Description: executes feature and rotation simulations by walking rotation
               nodes, applying runtime changes, resolving feature owners/skills,
               and collecting weighted damage feature rows for personal and
               team rotations.
*/

import type {
  DamageFeature,
  EffectScope,
  FeatDef,
  RotationNode,
  RotVl,
  RtChng,
} from '@/domain/gameData/contracts'
import type { CombatGraph } from '@/domain/entities/combatGraph'
import { findCombatPart, rbldCmbtPart } from '@/domain/state/combatGraph'
import type { ResRuntime, ResSeed, RotationView } from '@/domain/entities/runtime'
import type { SlotId } from '@/domain/entities/session'
import type { SkillAggType, SkillDef } from '@/domain/entities/stats'
import type { EnemyProfile } from '@/domain/entities/appState'
import { makeRuntimeCat } from '@/domain/services/runtimeSourceService'
import { makeTeamComp } from '@/domain/gameData/teamComposition'
import { getNegFfctCm } from '@/domain/gameData/negativeEffects'
import { readRtPath, writeBjctPat, writeRtPath } from '@/domain/gameData/runtimePath'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { cloneSlotRml } from '@/domain/state/defaults'
import { cloneSlotLuo } from '@/domain/state/runtimeMaterialization'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'
import { calcSkillDamage } from '@/engine/formulas/damage'
import { evalCond, evalForm } from '@/engine/effects/evaluator'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext'
import type { CombatContext } from '@/engine/pipeline/types'
import { prprRtSkll } from '@/engine/pipeline/prepareRuntimeSkill'
import { resolveSkill } from '@/engine/pipeline/resolveSkill'

// build the sequence of stack values to use for repeated negative-effect hits
// example: startStacks=5, instances=4, stableWidth=2 becomes [5, 5, 4, 4]
// this lets one feature simulate multiple applications while stacks decay over time
function mkNegFfctStc(startStacks: number, instances: number, stableWidth: number): number[] {
  const nrmlStck = Math.max(0, Math.floor(startStacks))
  const instanceCount = Math.max(1, Math.floor(instances))
  const stableCount = Math.max(1, Math.floor(stableWidth))
  const series: number[] = []

  for (let index = 0; index < instanceCount; index += 1) {
    const stackValue = nrmlStck - Math.floor(index / stableCount)
    if (stackValue <= 0) {
      break
    }

    series.push(stackValue)
  }

  return series
}

// merge two damage result objects into one accumulated result
// this is mainly used when a single feature is simulated several times with
// different stack counts and all those partial outputs need to be summed
function mrgDmgRslts(
  left: ReturnType<typeof calcSkillDamage>,
  right: ReturnType<typeof calcSkillDamage>,
): ReturnType<typeof calcSkillDamage> {
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

export interface RotFeatRow {
  id: string
  featureId: string
  label: string
  tab: string
  multiplier: number
  enabled: boolean
  resonatorId: string
  resName: string
}

// inspector payload used by the rotation inspection surface
// each node type records a different kind of execution detail
export type RotNspcVl =
  | {
  kind: 'feature'
  normal: number
  crit: number
  avg: number
  ggrgType: SkillAggType
}
  | {
  kind: 'condition'
  path: string
  value: string | number | boolean | undefined
}
  | {
  kind: 'repeat'
  times: number
}
  | {
  kind: 'uptime'
  ratio: number
}
  | {
  kind: 'loop'
  markerKind: 'start'
  label: string
  runs: number
}

// one inspection record per node evaluation attempt
// executed=false means the node was skipped by enable/when/loop gating
export interface RotNspcEnt {
  nodeId: string
  nodeType: RotationNode['type']
  executed: boolean
  value?: RotNspcVl
  loopRuns?: Record<string, number>
  loopRunCnts?: Record<string, number>
  runtimeById?: Record<string, ResRuntime>
  selectedTargetsByRuntimeId?: Record<string, Record<string, string | null>>
  enemy?: EnemyProfile
}

interface RotPartStt {
  // owning seed for this participant
  seed: ResSeed

  // current runtime state for this participant
  runtime: ResRuntime

  // combat context resolved against the current graph/enemy
  context: CombatContext
}

// overlay values represent temporary writes made by rotation nodes
// they are not immediately mutating the base graph/runtime directly
type RotVrlyVl = string | number | boolean

interface RotVrlyStt {
  // increments whenever any overlay write happens
  // caches use this to know when they became stale
  version: number

  // temporary runtime-path writes per resonator
  rtPthsByRejq: Record<string, Record<string, RotVrlyVl>>

  // temporary routing-path writes per resonator
  routingPaths: Record<string, Record<string, RotVrlyVl>>

  // temporary enemy writes shared across the run
  enemyPaths: Record<string, RotVrlyVl>
}

export interface PrepRotNvrn {
  prmrResId: string
  prmrSlotId: SlotId
  enemy: EnemyProfile
  graph: CombatGraph

  // cached seed lookup for all possible participants
  seedLookup: Record<string, ResSeed>

  // base contexts for the unmodified prepared graph
  // these are reused while no overlay mutations exist
  baseCntxBymf: Partial<Record<SlotId, CombatContext>>
}

interface RotationExec {
  environment: PrepRotNvrn
  overlay: RotVrlyStt

  // lazily resolved runtime snapshots for the current overlay version
  rslvRtCch: Record<string, { version: number; runtime: ResRuntime }>

  // lazily materialized graph for the current overlay version
  // the graph is only rebuilt when something actually changed
  mtrlGrphVrsn: number
  mtrlGrph: CombatGraph | null

  // branch weight, mainly used by uptime nodes
  weight: number

  // accumulated feature result rows produced so far
  entries: DamageFeature[]

  // optional read-only per-node execution trace used by rotation inspectors
  nspcNtrs: RotNspcEnt[] | null

  // active loop run numbers, keyed by loop id. used by when rules
  actLoopRuns: Record<string, number>
  actLoopRunqi: Record<string, number>
}

// current implementation just respects explicit enabled state on the node
// runtime is accepted for future expansion, even though it is not needed yet
export function isRotNodeOn(runtime: ResRuntime, node: RotationNode): boolean {
  void runtime
  return 'enabled' in node ? node.enabled ?? true : true
}

// extract a node's optional "when" condition no matter which node flavor it came from
// some nodes store condition under when.condition, others directly on condition
function getNodeWhenC(node: RotationNode) {
  return ('when' in node ? node.when?.condition : undefined) ?? ('condition' in node ? node.condition : undefined)
}

// check whether the node's loop filters match the currently active loop run state
// if a node says "only run on loop 2, runs [1,3]" this is where that is enforced
function mtchLoopRunR(state: RotationExec, node: RotationNode): boolean {
  const loopRules = 'when' in node ? node.when?.loops ?? [] : []
  if (loopRules.length === 0) {
    return true
  }

  return loopRules.every((rule) => {
    const activeRun = state.actLoopRuns[rule.loopId]
    return typeof activeRun === 'number' && rule.runs.includes(activeRun)
  })
}

// when writing inspection entries, attach the current loop context so the ui can
// show which loop run produced a given row
function withLoopNspc(
  state: RotationExec,
): Pick<RotNspcEnt, 'loopRuns' | 'loopRunCnts'> {
  return {
    ...(Object.keys(state.actLoopRuns).length > 0 ? { loopRuns: { ...state.actLoopRuns } } : {}),
    ...(Object.keys(state.actLoopRunqi).length > 0 ? { loopRunCnts: { ...state.actLoopRunqi } } : {}),
  }
}

// feature inspectors need the exact state at the selected loop run. capture the
// materialized graph only for feature rows so normal rotation execution stays unchanged.
function withFeatNspc(
  state: RotationExec,
): Pick<RotNspcEnt, 'runtimeById' | 'selectedTargetsByRuntimeId' | 'enemy'> {
  const graph = state.overlay.version === 0 ? getBaseGraph(state) : getMatGrph(state)
  const runtimeById: Record<string, ResRuntime> = {}
  const selectedTargetsByRuntimeId: Record<string, Record<string, string | null>> = {}

  for (const participant of Object.values(graph.participants)) {
    runtimeById[participant.resonatorId] = participant.runtime
    selectedTargetsByRuntimeId[participant.resonatorId] = {
      ...participant.slot.routing.selectedTargetsByOwnerKey,
    }
  }

  return {
    runtimeById,
    selectedTargetsByRuntimeId,
    enemy: getActEnemy(state),
  }
}

// append one inspection entry if inspection mode is enabled
// otherwise return the same state untouched
function ppndNspcEnt(
  state: RotationExec,
  entry: Omit<RotNspcEnt, 'loopRuns' | 'loopRunCnts' | 'runtimeById' | 'selectedTargetsByRuntimeId' | 'enemy'>,
): RotationExec {
  if (!state.nspcNtrs) {
    return state
  }

  return {
    ...state,
    nspcNtrs: [
      ...state.nspcNtrs,
      {
        ...entry,
        ...withLoopNspc(state),
        ...(entry.nodeType === 'feature' ? withFeatNspc(state) : {}),
      },
    ],
  }
}

// resolve a feature node multiplier, defaulting to 1 when unset
export function getFeatNodeM(
  runtime: ResRuntime,
  node: Extract<RotationNode, { type: 'feature' }>,
): number {
  void runtime
  return node.multiplier ?? 1
}

// resolve repeat count if present on a repeat node
export function getRptNodeTm(
  runtime: ResRuntime,
  node: Extract<RotationNode, { type: 'repeat' }>,
): number | undefined {
  void runtime
  return typeof node.times === 'number' ? node.times : undefined
}

// resolve uptime ratio if present on an uptime node
export function getPtmNodeRt(
  runtime: ResRuntime,
  node: Extract<RotationNode, { type: 'uptime' }>,
): number | undefined {
  void runtime
  return typeof node.ratio === 'number' ? node.ratio : undefined
}

// build the evaluator scope used by effect conditions and formulas
// this packages source runtime, target runtime, active runtime, team makeup,
// echo set counts, and optional enemy data into the shape expected by the evaluator
function buildScope(
  runtime: ResRuntime,
  source: FeatDef['source'],
  actRt: ResRuntime = runtime,
  tgtRt: ResRuntime = runtime,
  enemy?: EnemyProfile,
): EffectScope {
  const teamMemIds = Array.from(
    new Set([actRt.id, ...actRt.build.team.filter((memberId): memberId is string => Boolean(memberId))]),
  )
  const team = makeTeamComp(teamMemIds)

  return {
    sourceRuntime: runtime,
    targetRuntime: tgtRt,
    activeRuntime: actRt,
    context: {
      team,
      source,
      sourceRuntime: runtime,
      targetRuntime: tgtRt,
      activeRuntime: actRt,
      targetRuntimeId: tgtRt.id,
      activeResonatorId: actRt.id,
      teamMemberIds: teamMemIds,
      echoSetCounts: countEchoSets(runtime.build.echoes),
      enemy,
    },
  }
}

// central gate used before running a node
// this checks:
// 1. primary runtime exists
// 2. node is enabled
// 3. loop-run filters match
// 4. optional "when" condition passes in the correct scope
function shldRunRotNo(
  state: RotationExec,
  node: RotationNode,
  fallbackResId: string,
): boolean {
  const rotRt = getPrmrRt(state)
  if (!rotRt || !isRotNodeOn(rotRt, node) || !mtchLoopRunR(state, node)) {
    return false
  }

  const whenCond = getNodeWhenC(node)
  if (!whenCond) {
    return true
  }

  const scpResId = resNodeResId(state, node, fallbackResId)
  const participant = getPart(state, scpResId)
  const actRt = getPrmrRt(state) ?? participant?.runtime
  if (!participant || !actRt) {
    return false
  }

  return evalCond(
    whenCond,
    buildScope(
      participant.runtime,
      { type: 'resonator', id: participant.seed.id },
      actRt,
      participant.runtime,
      getActEnemy(state),
    ),
  )
}

// scale either the flat multiplier or each hit entry depending on the skill form
// single-hit/no-hit-table skills scale by their main multiplier
// multi-hit skills scale each hit and then recompute the total multiplier
function scaleSkill(skill: SkillDef, multiplier: number): SkillDef {
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
function slcSkllForFe(skill: SkillDef, feature: FeatDef): SkillDef {
  if (feature.variant !== 'subHit' || typeof feature.hitIndex !== 'number') {
    return skill
  }

  const hit = skill.hits[feature.hitIndex]
  if (!hit) {
    return skill
  }

  const hitTblEnt = skill.hitTable?.[feature.hitIndex]

  return {
    ...skill,
    label: feature.label,
    multiplier: hit.multiplier,
    hits: [{ ...hit, count: 1 }],
    hitTable: hitTblEnt ? [{
      ...hitTblEnt,
      count: 1,
      values: hitTblEnt?.values ?? [],
    }] : undefined,
  }
}

// multiply a full damage result by a branch weight
// used mostly for uptime branches where a node only applies some fraction of the time
function scaleResult(result: ReturnType<typeof calcSkillDamage>, weight: number) {
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
function shldNcldFeat(skill: SkillDef, result: ReturnType<typeof calcSkillDamage>): boolean {
  return !(
    (
      skill.archetype === 'spectroFrazzle' ||
      skill.archetype === 'aeroErosion' ||
      skill.archetype === 'fusionBurst' ||
      skill.archetype === 'glacioChafe' ||
      skill.archetype === 'electroFlare'
    ) &&
    result.avg <= 0
  )
}

// prepare everything a rotation run needs up front:
// - primary slot info
// - enemy
// - graph
// - seed lookup for all participants
// - base combat contexts for every slot
export function mkPrepRotNvr(
  context: CombatContext,
  seed: ResSeed,
): PrepRotNvrn {
  const graph = context.graph
  const prmrPart = graph.participants[context.targetSlotId]
  if (!prmrPart) {
    throw new Error(`Missing primary participant in combat graph for slot ${context.targetSlotId}`)
  }

  const baseCntxBySl: Partial<Record<SlotId, CombatContext>> = {}
  const seedLookup: Record<string, ResSeed> = {
    [seed.id]: seed,
  }

  for (const participant of Object.values(graph.participants)) {
    baseCntxBySl[participant.slotId] = makeCombatEnv({
      graph,
      targetSlotId: participant.slotId,
      enemy: context.enemy,
    })

    if (!seedLookup[participant.resonatorId]) {
      const partSeed = getResSeedBy(participant.resonatorId)
      if (partSeed) {
        seedLookup[participant.resonatorId] = partSeed
      }
    }
  }

  return {
    prmrResId: prmrPart.resonatorId,
    prmrSlotId: context.targetSlotId,
    enemy: context.enemy,
    graph,
    seedLookup,
    baseCntxBymf: baseCntxBySl,
  }
}

// create the initial execution state for one run
// inspection mode is optional and only allocates inspection storage when needed
function mkRotStt(
  environment: PrepRotNvrn,
  inspect = false,
): RotationExec {
  return {
    environment,
    overlay: {
      version: 0,
      rtPthsByRejq: {},
      routingPaths: {},
      enemyPaths: {},
    },
    rslvRtCch: {},
    mtrlGrphVrsn: -1,
    mtrlGrph: null,
    weight: 1,
    entries: [],
    nspcNtrs: inspect ? [] : null,
    actLoopRuns: {},
    actLoopRunqi: {},
  }
}

// shallow-clone execution state for branch evaluation
// branch clones intentionally restart local rows because setup and uptime
// branches merge their outputs back into the parent explicitly later
function cloneRotation(state: RotationExec): RotationExec {
  return {
    ...state,
    entries: [],
    nspcNtrs: state.nspcNtrs ? [] : null,
    actLoopRuns: { ...state.actLoopRuns },
    actLoopRunqi: { ...state.actLoopRunqi },
  }
}

// fetch the runtime of the primary slot for current state
function getPrmrRt(state: RotationExec): ResRuntime | null {
  return getRslvPartR(state, state.environment.prmrResId)
}

// choose the resonator id a node should operate on
// node override wins, then explicit fallback, then primary resonator
function resNodeResId(state: RotationExec, node: RotationNode, fallbackResId: string): string {
  return ('resonatorId' in node ? node.resonatorId : undefined) ?? fallbackResId ?? state.environment.prmrResId
}

// convenience accessor for the immutable base graph stored in the environment
function getBaseGraph(state: RotationExec): CombatGraph {
  return state.environment.graph
}

// read a plain object path from arbitrary data
// this is used for reading overlay enemy paths without needing runtime-specific helpers
function readObjectPath(root: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let cursor = root

  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined
    }

    cursor = (cursor as Record<string, unknown>)[part]
  }

  return cursor
}

// compute the currently active enemy by layering enemy overlay writes over the base enemy
function getActEnemy(state: RotationExec): EnemyProfile {
  const entries = Object.entries(state.overlay.enemyPaths)
  if (entries.length === 0) {
    return state.environment.enemy
  }

  let nextEnemy = state.environment.enemy
  for (const [path, value] of entries) {
    nextEnemy = writeBjctPat(
      nextEnemy as unknown as Record<string, unknown>,
      path.split('.'),
      value,
    ) as unknown as EnemyProfile
  }

  return nextEnemy
}

// path helpers for recognizing special enemy-directed writes
function isEnemySttsP(path: string): boolean {
  return path.replace(/^context\./, '').startsWith('enemy.status.')
}

function isEnemyCmbtP(path: string): boolean {
  return path.replace(/^context\./, '').startsWith('enemy.combat.')
}

function getEnemyPath(path: string): string {
  return path
    .replace(/^context\./, '')
    .replace(/^enemy\./, '')
}

// determine whether a given resonator currently has any active overlay state
function hasVrlyForRe(state: RotationExec, resonatorId: string): boolean {
  return Boolean(
    state.overlay.rtPthsByRejq[resonatorId] ||
    state.overlay.routingPaths[resonatorId],
  )
}

// get the current runtime for one participant after applying overlay writes
// results are cached per overlay version
function getRslvPartR(state: RotationExec, resonatorId: string): ResRuntime | null {
  const slotId = findCombatPart(getBaseGraph(state), resonatorId)
  if (!slotId) {
    return null
  }

  if (!hasVrlyForRe(state, resonatorId)) {
    return getBaseGraph(state).participants[slotId]?.runtime ?? null
  }

  const cached = state.rslvRtCch[resonatorId]
  if (cached?.version === state.overlay.version) {
    return cached.runtime
  }

  const baseRuntime = getBaseGraph(state).participants[slotId]?.runtime
  if (!baseRuntime) {
    return null
  }

  let nextRuntime = baseRuntime
  const runtimePaths = state.overlay.rtPthsByRejq[resonatorId] ?? {}
  for (const [path, value] of Object.entries(runtimePaths)) {
    nextRuntime = writeRtPath(nextRuntime, path, value)
  }

  state.rslvRtCch[resonatorId] = {
    version: state.overlay.version,
    runtime: nextRuntime,
  }

  return nextRuntime
}

// apply routing overlay paths to a cloned routing object
// kept separate from runtime overlay because routing lives in slot state, not runtime state
function applyRtngVrl(
  state: RotationExec,
  resonatorId: string,
  baseRouting: ReturnType<typeof cloneSlotRml>,
): ReturnType<typeof cloneSlotRml> {
  const routingPaths = state.overlay.routingPaths[resonatorId] ?? {}
  let nextRouting = baseRouting

  for (const [path, value] of Object.entries(routingPaths)) {
    nextRouting = writeBjctPat(
      nextRouting as unknown as Record<string, unknown>,
      path.split('.'),
      value,
    ) as unknown as ReturnType<typeof cloneSlotRml>
  }

  return nextRouting
}

// materialize a full graph that reflects the current overlay version
// this only happens when overlay writes exist and some logic needs a real graph
function getMatGrph(state: RotationExec): CombatGraph {
  if (state.overlay.version === 0) {
    return getBaseGraph(state)
  }

  if (state.mtrlGrphVrsn === state.overlay.version && state.mtrlGrph) {
    return state.mtrlGrph
  }

  const baseGraph = getBaseGraph(state)
  const nextGraph: CombatGraph = {
    ...baseGraph,
    participants: {
      ...baseGraph.participants,
    },
  }

  for (const participant of Object.values(baseGraph.participants)) {
    if (!hasVrlyForRe(state, participant.resonatorId)) {
      continue
    }

    const rslvRt = getRslvPartR(state, participant.resonatorId)
    if (!rslvRt) {
      continue
    }

    const nextPart = {
      ...participant,
      slot: {
        ...participant.slot,
        local: cloneSlotLuo(rslvRt.state),
        routing: applyRtngVrl(
          state,
          participant.resonatorId,
          cloneSlotRml(participant.slot.routing),
        ),
      },
      runtime: rslvRt,
      snapshots: {
        ...participant.snapshots,
      },
    }

    nextGraph.participants[participant.slotId] = nextPart
    rbldCmbtPart(nextGraph, participant.slotId)
  }

  state.mtrlGrphVrsn = state.overlay.version
  state.mtrlGrph = nextGraph
  return nextGraph
}

// resolve one participant plus its current combat context
// when overlay writes exist, the context is rebuilt from the materialized graph
// so later nodes always see the latest temporary runtime and enemy state
function getPart(state: RotationExec, resonatorId: string): RotPartStt | null {
  const slotId = findCombatPart(getBaseGraph(state), resonatorId)
  if (!slotId) {
    return null
  }

  const graph = state.overlay.version === 0 ? getBaseGraph(state) : getMatGrph(state)
  const participant = graph.participants[slotId]
  const seed = state.environment.seedLookup[resonatorId] ?? getResSeedBy(resonatorId)
  if (!participant || !seed) {
    return null
  }

  const context = state.overlay.version === 0
    ? state.environment.baseCntxBymf[slotId]
    : makeCombatEnv({
      graph,
      targetSlotId: slotId,
      enemy: getActEnemy(state),
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

// list every graph participant as a RotationParticipantState
function listParts(state: RotationExec): RotPartStt[] {
  const graph = state.overlay.version === 0 ? getBaseGraph(state) : getMatGrph(state)

  return Object.values(graph.participants).flatMap((participant) => {
    const seed = state.environment.seedLookup[participant.resonatorId] ?? getResSeedBy(participant.resonatorId)
    if (!seed) {
      return []
    }

    const context = state.overlay.version === 0
      ? state.environment.baseCntxBymf[participant.slotId]
      : makeCombatEnv({
        graph,
        targetSlotId: participant.slotId,
        enemy: getActEnemy(state),
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

// write one overlay path into state and invalidate any caches that depend on it
// paths are routed into one of:
// - enemy overlay
// - runtime overlay
// - routing overlay
function writeRotVrly(
  state: RotationExec,
  resonatorId: string,
  path: string,
  value: RotVrlyVl,
): RotationExec {
  if (isEnemySttsP(path)) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        enemyPaths: {
          ...state.overlay.enemyPaths,
          [getEnemyPath(path)]: value,
        },
      },
      rslvRtCch: {},
      mtrlGrphVrsn: -1,
      mtrlGrph: null,
    }
  }

  if (isEnemyCmbtP(path)) {
    // enemy combat writes are mirrored onto every participant's runtime.state.combat
    // so combat-dependent formulas can see them through runtime state as expected
    const enemyCmbtPat = getEnemyPath(path)
    const runtimePath = `runtime.state.${enemyCmbtPat}`
    const nextRtPthsBy = { ...state.overlay.rtPthsByRejq }

    for (const participant of Object.values(getBaseGraph(state).participants)) {
      nextRtPthsBy[participant.resonatorId] = {
        ...(nextRtPthsBy[participant.resonatorId] ?? {}),
        [runtimePath]: value,
      }
    }

    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        rtPthsByRejq: nextRtPthsBy,
      },
      rslvRtCch: {},
      mtrlGrphVrsn: -1,
      mtrlGrph: null,
    }
  }

  const nrmlPath = path.replace(/^runtime\./, '')

  if (nrmlPath.startsWith('state.controls.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        rtPthsByRejq: {
          ...state.overlay.rtPthsByRejq,
          [resonatorId]: {
            ...(state.overlay.rtPthsByRejq[resonatorId] ?? {}),
            [`runtime.${nrmlPath}`]: value,
          },
        },
      },
      rslvRtCch: {},
      mtrlGrphVrsn: -1,
      mtrlGrph: null,
    }
  }

  if (nrmlPath.startsWith('state.manualBuffs.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        rtPthsByRejq: {
          ...state.overlay.rtPthsByRejq,
          [resonatorId]: {
            ...(state.overlay.rtPthsByRejq[resonatorId] ?? {}),
            [`runtime.${nrmlPath}`]: value,
          },
        },
      },
      rslvRtCch: {},
      mtrlGrphVrsn: -1,
      mtrlGrph: null,
    }
  }

  if (nrmlPath.startsWith('state.combat.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        rtPthsByRejq: {
          ...state.overlay.rtPthsByRejq,
          [resonatorId]: {
            ...(state.overlay.rtPthsByRejq[resonatorId] ?? {}),
            [`runtime.${nrmlPath}`]: value,
          },
        },
      },
      rslvRtCch: {},
      mtrlGrphVrsn: -1,
      mtrlGrph: null,
    }
  }

  if (nrmlPath.startsWith('base.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        rtPthsByRejq: {
          ...state.overlay.rtPthsByRejq,
          [resonatorId]: {
            ...(state.overlay.rtPthsByRejq[resonatorId] ?? {}),
            [`runtime.${nrmlPath}`]: value,
          },
        },
      },
      rslvRtCch: {},
      mtrlGrphVrsn: -1,
      mtrlGrph: null,
    }
  }

  if (nrmlPath.startsWith('build.weapon.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        rtPthsByRejq: {
          ...state.overlay.rtPthsByRejq,
          [resonatorId]: {
            ...(state.overlay.rtPthsByRejq[resonatorId] ?? {}),
            [`runtime.${nrmlPath}`]: value,
          },
        },
      },
      rslvRtCch: {},
      mtrlGrphVrsn: -1,
      mtrlGrph: null,
    }
  }

  if (nrmlPath.startsWith('build.echoes.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        rtPthsByRejq: {
          ...state.overlay.rtPthsByRejq,
          [resonatorId]: {
            ...(state.overlay.rtPthsByRejq[resonatorId] ?? {}),
            [`runtime.${nrmlPath}`]: value,
          },
        },
      },
      rslvRtCch: {},
      mtrlGrphVrsn: -1,
      mtrlGrph: null,
    }
  }

  if (nrmlPath.startsWith('routing.selectedTargetsByOwnerKey.')) {
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        routingPaths: {
          ...state.overlay.routingPaths,
          [resonatorId]: {
            ...(state.overlay.routingPaths[resonatorId] ?? {}),
            [nrmlPath.replace(/^routing\./, '')]: value,
          },
        },
      },
      rslvRtCch: {},
      mtrlGrphVrsn: -1,
      mtrlGrph: null,
    }
  }

  throw new Error(`Unsupported rotation runtime change path: ${path}`)
}

// evaluate one runtime change and apply it to the overlay state
// supports:
// - set
// - toggle
// - add
function applyRtChng(
  state: RotationExec,
  change: RtChng,
  fallbackResId: string,
): RotationExec {
  const tgtResId = change.resonatorId ?? fallbackResId

  if (isEnemySttsP(change.path) || isEnemyCmbtP(change.path)) {
    let nextValue: string | number | boolean

    if (change.type === 'set') {
      nextValue = change.value
    } else if (change.type === 'toggle') {
      nextValue = change.value ?? true
    } else {
      const prmrRt = getPrmrRt(state)
      const current = isEnemySttsP(change.path)
        ? Number(readObjectPath(getActEnemy(state), getEnemyPath(change.path)))
        : prmrRt
          ? Number(readRtPath(prmrRt, `runtime.state.${getEnemyPath(change.path)}`))
          : 0
      nextValue = (Number.isFinite(current) ? current : 0) + change.value
    }

    return writeRotVrly(state, tgtResId, change.path, nextValue)
  }

  const participant = getPart(state, tgtResId)
  if (!participant) {
    return state
  }

  let nextValue: string | number | boolean
  if (change.type === 'set') {
    nextValue = change.value
  } else if (change.type === 'toggle') {
    nextValue = change.value ?? true
  } else {
    const current = Number(readRtPath(participant.runtime, change.path))
    nextValue = (Number.isFinite(current) ? current : 0) + change.value
  }

  return writeRotVrly(state, tgtResId, change.path, nextValue)
}

// detect whether a runtime change explicitly targets the combat key that stores
// a negative-effect stack count. if so, node-level stack override should not
// override that explicit change
function chngTrgtNegF(change: RtChng, combatKey: string): boolean {
  const nrmlPath = change.path.replace(/^runtime\./, '')

  return nrmlPath === `state.combat.${combatKey}` ||
    (isEnemyCmbtP(change.path) && getEnemyPath(change.path) === `combat.${combatKey}`)
}

// generic object-path reader used for enemy overlay state reads
function readPathValue(value: unknown, path: string): unknown {
  let cursor = value

  for (const key of path.split('.').filter(Boolean)) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined
    }

    cursor = (cursor as Record<string, unknown>)[key]
  }

  return cursor
}

// read the current value addressed by a runtime change after overlays have been applied
// used mainly by inspection mode so the ui can display what a condition node changed
function readRtChngVl(
  state: RotationExec,
  change: RtChng,
  fallbackResId: string,
): string | number | boolean | undefined {
  if (isEnemySttsP(change.path) || isEnemyCmbtP(change.path)) {
    return readPathValue(getActEnemy(state), getEnemyPath(change.path)) as string | number | boolean | undefined
  }

  const tgtResId = change.resonatorId ?? fallbackResId
  const participant = getPart(state, tgtResId)
  if (!participant) {
    return undefined
  }

  return readRtPath(participant.runtime, change.path) as string | number | boolean | undefined
}

// resolve a RotationValue into a concrete numeric value
// priority is:
// 1. explicit override argument
// 2. raw numeric literal
// 3. formula evaluation through the effect evaluator
function evalRotVl(
  value: RotVl,
  runtime: ResRuntime,
  source: FeatDef['source'],
  override?: number,
  actRt: ResRuntime = runtime,
  tgtRt: ResRuntime = runtime,
  enemy?: EnemyProfile,
): number {
  if (typeof override === 'number' && Number.isFinite(override)) {
    return override
  }

  if (typeof value === 'number') {
    return value
  }

  return evalForm(value, buildScope(runtime, source, actRt, tgtRt, enemy))
}

// lookup helpers against the prepared runtime catalog
function findFeature(runtime: ResRuntime, seed: ResSeed, featureId: string): FeatDef | null {
  return makeRuntimeCat(runtime, seed).featuresById[featureId] ?? null
}

function findSkill(runtime: ResRuntime, seed: ResSeed, skillId: string): SkillDef | null {
  return makeRuntimeCat(runtime, seed).skillsById[skillId] ?? null
}

// resolve which participant owns a feature
// the preferred resonator is checked first, then all participants are scanned
function findFeatOwn(
  state: RotationExec,
  featureId: string,
  prfrResId: string,
): { participant: RotPartStt; feature: FeatDef } | null {
  const preferred = getPart(state, prfrResId)
  if (preferred) {
    const feature = findFeature(preferred.runtime, preferred.seed, featureId)
    if (feature) {
      return { participant: preferred, feature }
    }
  }

  for (const participant of listParts(state)) {
    const feature = findFeature(participant.runtime, participant.seed, featureId)
    if (feature) {
      return { participant, feature }
    }
  }

  return null
}

// resolve final enabled + multiplier state for one feature node
function resFeatNodeS(
  runtime: ResRuntime,
  node: Extract<RotationNode, { type: 'feature' }>,
): { enabled: boolean; multiplier: number } {
  return {
    enabled: isRotNodeOn(runtime, node) && (node.enabled ?? true),
    multiplier: getFeatNodeM(runtime, node),
  }
}

// execute one feature node
// high-level flow:
// 1. apply node-local changes into a temporary state
// 2. resolve feature owner
// 3. validate feature/skill visibility
// 4. compute damage, including negative-effect stack series when needed
// 5. append result row
// 6. optionally execute feature.after follow-up nodes
function runFeatNode(
  state: RotationExec,
  node: Extract<RotationNode, { type: 'feature' }>,
  fallbackResId: string,
): RotationExec {
  const ownResId = resNodeResId(state, node, fallbackResId)

  // node.changes are applied before evaluating this feature,
  // so the feature sees the updated local overlay state
  const lclFeatStt = (node.changes ?? []).reduce(
    (nextState, change) => applyRtChng(nextState, change, ownResId),
    state,
  )

  const featureData = findFeatOwn(lclFeatStt, node.featureId, ownResId)
  if (!featureData) {
    return ppndNspcEnt(lclFeatStt, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const { participant, feature } = featureData
  const prmrRt = getPrmrRt(lclFeatStt) ?? participant.runtime
  const featureScope = buildScope(
    participant.runtime,
    feature.source,
    prmrRt,
    participant.runtime,
    getActEnemy(lclFeatStt),
  )

  if (!evalCond(feature.condition, featureScope)) {
    return ppndNspcEnt(lclFeatStt, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const nodeState = resFeatNodeS(prmrRt, node)
  if (!nodeState.enabled) {
    return ppndNspcEnt(lclFeatStt, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const skill = findSkill(participant.runtime, participant.seed, feature.skillId)
  if (!skill) {
    return ppndNspcEnt(lclFeatStt, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const skillResult = prprRtSkll(participant.runtime, skill, {
    ...participant.context,
    graph: lclFeatStt.overlay.version === 0 ? getBaseGraph(lclFeatStt) : getMatGrph(lclFeatStt),
    targetSlotId:
      findCombatPart(getBaseGraph(lclFeatStt), participant.seed.id) ?? lclFeatStt.environment.prmrSlotId,
  })

  if (skillResult.visible === false) {
    return ppndNspcEnt(lclFeatStt, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const ftrdSkll = slcSkllForFe(skillResult, feature)
  const scaledSkill = scaleSkill(ftrdSkll, nodeState.multiplier)

  // negative-effect skills depend on stack count in combat state
  // this block supports:
  // - explicit node stack override
  // - explicit node changes that already modify stack state
  // - multi-instance repeated evaluation with stack decay
  const negFfctCmbtK = getNegFfctCm(scaledSkill.archetype)
  const hasTtchNegFf = negFfctCmbtK
    ? (node.changes ?? []).some((change) => chngTrgtNegF(change, negFfctCmbtK))
    : false

  const negFfctStckV =
    !hasTtchNegFf &&
    typeof node.negativeEffectStacks === 'number' &&
    Number.isFinite(node.negativeEffectStacks)
      ? Math.max(0, Math.floor(node.negativeEffectStacks))
      : null

  const negFfctNstn =
    typeof node.negativeEffectInstances === 'number' && Number.isFinite(node.negativeEffectInstances)
      ? Math.max(1, Math.floor(node.negativeEffectInstances))
      : 1

  const negFfctStblW =
    typeof node.negativeEffectStableWidth === 'number' && Number.isFinite(node.negativeEffectStableWidth)
      ? Math.max(1, Math.floor(node.negativeEffectStableWidth))
      : 1

  const baseCmbtStt = participant.runtime.state.combat

  const wghtRslt = scaleResult(
    negFfctCmbtK
      ? (() => {
        const startStacks = negFfctStckV ?? Math.max(0, Math.floor(baseCmbtStt[negFfctCmbtK] ?? 0))
        const stackSeries = mkNegFfctStc(
          startStacks,
          negFfctNstn,
          negFfctStblW,
        )

        if (stackSeries.length === 0) {
          return calcSkillDamage(
            participant.context.finalStats,
            scaledSkill,
            participant.context.enemy,
            participant.runtime.base.level,
            {
              ...baseCmbtStt,
              [negFfctCmbtK]: 0,
            },
          )
        }

        return stackSeries.reduce<ReturnType<typeof calcSkillDamage> | null>((total, stackValue) => {
          const nextResult = calcSkillDamage(
            participant.context.finalStats,
            scaledSkill,
            participant.context.enemy,
            participant.runtime.base.level,
            {
              ...baseCmbtStt,
              [negFfctCmbtK]: stackValue,
            },
          )

          return total ? mrgDmgRslts(total, nextResult) : nextResult
        }, null) ?? calcSkillDamage(
          participant.context.finalStats,
          scaledSkill,
          participant.context.enemy,
          participant.runtime.base.level,
          baseCmbtStt,
        )
      })()
      : calcSkillDamage(
        participant.context.finalStats,
        scaledSkill,
        participant.context.enemy,
        participant.runtime.base.level,
        baseCmbtStt,
      ),
    state.weight,
  )

  if (!shldNcldFeat(scaledSkill, wghtRslt)) {
    return ppndNspcEnt(lclFeatStt, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const nextState: RotationExec = {
    ...lclFeatStt,
    entries: [
      ...lclFeatStt.entries,
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
        normal: wghtRslt.normal,
        crit: wghtRslt.crit,
        avg: wghtRslt.avg,
        subHits: wghtRslt.subHits,
        ...(Object.keys(lclFeatStt.actLoopRuns).length > 0 ? { loopRuns: { ...lclFeatStt.actLoopRuns } } : {}),
        ...(Object.keys(lclFeatStt.actLoopRunqi).length > 0 ? { loopRunCounts: { ...lclFeatStt.actLoopRunqi } } : {}),
      },
    ],
  }

  const nspcStt = ppndNspcEnt(nextState, {
    nodeId: node.id,
    nodeType: node.type,
    executed: true,
    value: {
      kind: 'feature',
      normal: wghtRslt.normal,
      crit: wghtRslt.crit,
      avg: wghtRslt.avg,
      ggrgType: scaledSkill.aggregationType,
    },
  })

  // some features append follow-up nodes after they fire
  if (!feature.after?.length) {
    return nspcStt
  }

  return runRotTms(nspcStt, feature.after, participant.seed.id)
}

// execute a condition node by applying all runtime changes
// note: this node's gating is handled by shouldRunRotationNode before calling here
function runCondNode(
  state: RotationExec,
  node: Extract<RotationNode, { type: 'condition' }>,
  fallbackResId: string,
): RotationExec {
  const scpResId = resNodeResId(state, node, fallbackResId)
  const participant = getPart(state, scpResId)
  if (!participant) {
    return ppndNspcEnt(state, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const nextState = node.changes.reduce(
    (nextState, change) => applyRtChng(nextState, change, scpResId),
    state,
  )
  const prmrChng = node.changes[0]

  return ppndNspcEnt(nextState, {
    nodeId: node.id,
    nodeType: node.type,
    executed: true,
    ...(prmrChng
      ? {
        value: {
          kind: 'condition',
          path: prmrChng.path,
          value: readRtChngVl(nextState, prmrChng, scpResId),
        } as const,
      }
      : {}),
  })
}

// execute a repeat node by running its child items several times
function runRptNode(
  state: RotationExec,
  node: Extract<RotationNode, { type: 'repeat' }>,
  fallbackResId: string,
): RotationExec {
  const scpResId = resNodeResId(state, node, fallbackResId)
  const participant = getPart(state, scpResId)
  const rotRt = getPrmrRt(state)
  if (!participant || !rotRt) {
    return ppndNspcEnt(state, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const times = Math.max(
    0,
    Math.floor(
      evalRotVl(
        node.times,
        participant.runtime,
        { type: 'resonator', id: participant.seed.id },
        getRptNodeTm(rotRt, node),
        rotRt,
        participant.runtime,
        getActEnemy(state),
      ),
    ),
  )

  let nextState = state
  for (let index = 0; index < times; index += 1) {
    nextState = runRotTms(nextState, node.items, scpResId)
  }

  return ppndNspcEnt(nextState, {
    nodeId: node.id,
    nodeType: node.type,
    executed: true,
    value: {
      kind: 'repeat',
      times,
    },
  })
}

// helper for setup lists used by uptime nodes
// setup can mutate overlay state before the weighted uptime branch is evaluated
// for setup-only usage, branch entries are ignored and only resulting state is carried forward
function runStpTms(
  state: RotationExec,
  items: RotationNode[] | undefined,
  fallbackResId: string,
): RotationExec {
  if (!items?.length) {
    return state
  }

  let nextState = state

  for (const item of items) {
    if (!shldRunRotNo(nextState, item, fallbackResId)) {
      nextState = ppndNspcEnt(nextState, {
        nodeId: item.id,
        nodeType: item.type,
        executed: false,
      })
      continue
    }

    if (item.type === 'feature') {
      nextState = runFeatNode(nextState, item, fallbackResId)
      continue
    }

    if (item.type === 'condition') {
      nextState = runCondNode(nextState, item, fallbackResId)
      continue
    }

    if (item.type === 'repeat') {
      nextState = runRptNode(nextState, item, fallbackResId)
      continue
    }

    if (item.type === 'uptime') {
      const scpResId = resNodeResId(nextState, item, fallbackResId)
      const participant = getPart(nextState, scpResId)
      const prmrRt = getPrmrRt(nextState)
      if (!participant || !prmrRt) {
        nextState = ppndNspcEnt(nextState, {
          nodeId: item.id,
          nodeType: item.type,
          executed: true,
        })
        continue
      }

      const ratio = Math.max(
        0,
        Math.min(
          1,
          evalRotVl(
            item.ratio,
            participant.runtime,
            { type: 'resonator', id: participant.seed.id },
            getPtmNodeRt(prmrRt, item),
            prmrRt,
            participant.runtime,
            getActEnemy(nextState),
          ),
        ),
      )

      // setup items only need to carry forward the resulting overlay/cache state here
      if (ratio > 0) {
        let branchState = cloneRotation(nextState)
        branchState = runStpTms(branchState, item.setup, scpResId)
        branchState = runStpTms(branchState, item.items, scpResId)
        nextState = {
          ...nextState,
          overlay: branchState.overlay,
          rslvRtCch: branchState.rslvRtCch,
          mtrlGrphVrsn: branchState.mtrlGrphVrsn,
          mtrlGrph: branchState.mtrlGrph,
        }
      }

      nextState = ppndNspcEnt(nextState, {
        nodeId: item.id,
        nodeType: item.type,
        executed: true,
        value: {
          kind: 'uptime',
          ratio,
        },
      })
    }

    if (item.type === 'loop') {
      nextState = ppndNspcEnt(nextState, {
        nodeId: item.id,
        nodeType: item.type,
        executed: true,
        ...(item.kind === 'start'
          ? {
            value: {
              kind: 'loop',
              markerKind: 'start',
              label: item.label ?? 'Loop',
              runs: Math.max(1, Math.floor(item.runs ?? 1)),
            } as const,
          }
          : {}),
      })
      continue
    }
  }

  return nextState
}

// execute an uptime node by running its child list inside a weighted branch
// branch entries are merged back into the parent, but the parent's own weight remains unchanged
function runPtmNode(
  state: RotationExec,
  node: Extract<RotationNode, { type: 'uptime' }>,
  fallbackResId: string,
): RotationExec {
  const scpResId = resNodeResId(state, node, fallbackResId)
  const participant = getPart(state, scpResId)
  const rotRt = getPrmrRt(state)
  if (!participant || !rotRt) {
    return ppndNspcEnt(state, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const ratio = Math.max(
    0,
    Math.min(
      1,
      evalRotVl(
        node.ratio,
        participant.runtime,
        { type: 'resonator', id: participant.seed.id },
        getPtmNodeRt(rotRt, node),
        rotRt,
        participant.runtime,
        getActEnemy(state),
      ),
    ),
  )

  if (ratio <= 0) {
    return ppndNspcEnt(state, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
      value: {
        kind: 'uptime',
        ratio,
      },
    })
  }

  let branchState = cloneRotation(state)
  branchState = runStpTms(branchState, node.setup, scpResId)
  branchState = {
    ...branchState,
    weight: state.weight * ratio,
    entries: [],
  }

  const result = runRotTms(branchState, node.items, scpResId)

  return ppndNspcEnt({
    ...state,
    entries: [...state.entries, ...result.entries],
    nspcNtrs: state.nspcNtrs
      ? [...state.nspcNtrs, ...(result.nspcNtrs ?? [])]
      : null,
  }, {
    nodeId: node.id,
    nodeType: node.type,
    executed: true,
    value: {
      kind: 'uptime',
      ratio,
    },
  })
}

// find the matching loop-end node for a given loop-start node within the same items list
function findLoopEndN(
  items: RotationNode[],
  startNode: Extract<RotationNode, { type: 'loop'; kind: 'start' }>,
): number | null {
  const foundIndex = items.findIndex((item) =>
    item.type === 'loop' &&
    item.kind === 'end' &&
    item.loopId === startNode.loopId,
  )

  return foundIndex >= 0 ? foundIndex : null
}

// move one step forward in a circular loop item list
function getNextLoopC(items: RotationNode[], index: number): number {
  return items.length > 0 ? (index + 1) % items.length : 0
}

// helper to check whether a loop boundary belongs to the given loop id
function isLoopBndrFo(
  node: RotationNode,
  loopId: string,
): boolean { return node.type === 'loop' && node.loopId === loopId }

interface RotLoopFrm {
  items: RotationNode[]
  startIndex: number
  loopId: string
  cursor: number
  run: number
  runs: number
  fallbackResId: string
}

// create a loop execution frame from a loop-start node
function mkLoopFrm(
  items: RotationNode[],
  startIndex: number,
  fallbackResId: string,
): RotLoopFrm | null {
  const startNode = items[startIndex]
  if (!startNode || startNode.type !== 'loop' || startNode.kind !== 'start') {
    return null
  }

  const runs = Math.max(1, Math.floor(startNode.runs ?? 1))
  return {
    items,
    startIndex,
    loopId: startNode.loopId,
    cursor: getNextLoopC(items, startIndex),
    run: 1,
    runs,
    fallbackResId: fallbackResId,
  }
}

// stamp the current loop-run bookkeeping into state
function setActLoopRu(state: RotationExec, frame: RotLoopFrm): RotationExec {
  return {
    ...state,
    actLoopRuns: {
      ...state.actLoopRuns,
      [frame.loopId]: frame.run,
    },
    actLoopRunqi: {
      ...state.actLoopRunqi,
      [frame.loopId]: frame.runs,
    },
  }
}

// finish the current top loop frame
// either:
// - advance to the next run of that loop, or
// - remove the loop from active bookkeeping if fully done
function fnshLoopFrm(
  state: RotationExec,
  stack: RotLoopFrm[],
): { state: RotationExec; stack: RotLoopFrm[] } {
  const frame = stack[stack.length - 1]
  if (!frame) {
    return { state, stack }
  }

  const parentStack = stack.slice(0, -1)
  if (frame.run < frame.runs) {
    const nextFrame = {
      ...frame,
      cursor: getNextLoopC(frame.items, frame.startIndex),
      run: frame.run + 1,
    }
    return {
      state: setActLoopRu(state, nextFrame),
      stack: [...parentStack, nextFrame],
    }
  }

  const { [frame.loopId]: _removedRun, ...rmnnLoopRuns } = state.actLoopRuns
  const { [frame.loopId]: rmvd, ...rmnnLoopRunC } = state.actLoopRunqi
  void _removedRun
  void rmvd
  return {
    state: {
      ...state,
      actLoopRuns: rmnnLoopRuns,
      actLoopRunqi: rmnnLoopRunC,
    },
    stack: parentStack,
  }
}

// replace the current top loop frame with an updated one
function rplcTopLoopF(stack: RotLoopFrm[], frame: RotLoopFrm): RotLoopFrm[] {
  return [...stack.slice(0, -1), frame]
}

// advance the current top frame's cursor by one item
function dvncTopLoopF(stack: RotLoopFrm[]): RotLoopFrm[] {
  const frame = stack[stack.length - 1]
  if (!frame) {
    return stack
  }

  return rplcTopLoopF(stack, {
    ...frame,
    cursor: getNextLoopC(frame.items, frame.cursor),
  })
}

// detect whether a loop id is already active somewhere in the current nested stack
// this prevents recursively re-entering the same loop id
function stckHasLoopI(stack: RotLoopFrm[], loopId: string): boolean {
  return stack.some((frame) => frame.loopId === loopId)
}

// execute one loop block using an explicit frame stack
// this supports nested loops while keeping each loop's current run and cursor separate
function runLoopNode(
  state: RotationExec,
  items: RotationNode[],
  startIndex: number,
  fallbackResId: string,
): RotationExec {
  const initialFrame = mkLoopFrm(items, startIndex, fallbackResId)
  if (!initialFrame) {
    return state
  }

  let nextState = setActLoopRu(state, initialFrame)
  let stack: RotLoopFrm[] = [initialFrame]

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    if (!frame || frame.items.length === 0 || frame.cursor === frame.startIndex) {
      const finished = fnshLoopFrm(nextState, stack)
      nextState = finished.state
      stack = finished.stack
      continue
    }

    const item = frame.items[frame.cursor]
    if (!item) {
      const finished = fnshLoopFrm(nextState, stack)
      nextState = finished.state
      stack = finished.stack
      continue
    }

    // encountering the matching loop boundary means this run finished
    if (isLoopBndrFo(item, frame.loopId)) {
      const finished = fnshLoopFrm(nextState, stack)
      nextState = finished.state
      stack = finished.stack
      continue
    }

    if (item.type === 'loop') {
      // i used explicit frames here rather than recursion so the
      // interpreter can keep a mutable cursor, run counter, and trace stream
      // alive without relying on js call-stack depth
      if (!shldRunRotNo(nextState, item, frame.fallbackResId)) {
        nextState = ppndNspcEnt(nextState, {
          nodeId: item.id,
          nodeType: item.type,
          executed: false,
        })
        stack = dvncTopLoopF(stack)
        continue
      }

      nextState = ppndNspcEnt(nextState, {
        nodeId: item.id,
        nodeType: item.type,
        executed: true,
        ...(item.kind === 'start'
          ? {
            value: {
              kind: 'loop',
              markerKind: 'start',
              label: item.label ?? 'Loop',
              runs: Math.max(1, Math.floor(item.runs ?? 1)),
            } as const,
          }
          : {}),
      })

      if (item.kind === 'start') {
        // prevent looping back into the same loop id from inside itself
        if (stckHasLoopI(stack, item.loopId)) {
          const finished = fnshLoopFrm(nextState, stack)
          nextState = finished.state
          stack = finished.stack
          continue
        }

        const nstdStartNdx = frame.cursor
        const nestedFrame = mkLoopFrm(frame.items, nstdStartNdx, frame.fallbackResId)
        stack = dvncTopLoopF(stack)
        if (nestedFrame) {
          nextState = setActLoopRu(nextState, nestedFrame)
          stack = [...stack, nestedFrame]
        }
        continue
      }

      stack = dvncTopLoopF(stack)
      continue
    }

    if (!shldRunRotNo(nextState, item, frame.fallbackResId)) {
      nextState = ppndNspcEnt(nextState, {
        nodeId: item.id,
        nodeType: item.type,
        executed: false,
      })
      stack = dvncTopLoopF(stack)
      continue
    }

    if (item.type === 'feature') {
      nextState = runFeatNode(nextState, item, frame.fallbackResId)
    } else if (item.type === 'condition') {
      nextState = runCondNode(nextState, item, frame.fallbackResId)
    } else if (item.type === 'repeat') {
      nextState = runRptNode(nextState, item, frame.fallbackResId)
    } else if (item.type === 'uptime') {
      nextState = runPtmNode(nextState, item, frame.fallbackResId)
    }

    stack = dvncTopLoopF(stack)
  }

  return nextState
}

// main rotation interpreter
// walks nodes in order and updates execution state as each node resolves
export function runRotTms(
  state: RotationExec,
  items: RotationNode[],
  fallbackResId: string = state.environment.prmrResId,
): RotationExec {
  let nextState = state

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item) {
      continue
    }

    if (!shldRunRotNo(nextState, item, fallbackResId)) {
      nextState = ppndNspcEnt(nextState, {
        nodeId: item.id,
        nodeType: item.type,
        executed: false,
      })
      continue
    }

    if (item.type === 'feature') {
      nextState = runFeatNode(nextState, item, fallbackResId)
      continue
    }

    if (item.type === 'condition') {
      nextState = runCondNode(nextState, item, fallbackResId)
      continue
    }

    if (item.type === 'repeat') {
      nextState = runRptNode(nextState, item, fallbackResId)
      continue
    }

    if (item.type === 'uptime') {
      nextState = runPtmNode(nextState, item, fallbackResId)
      continue
    }

    if (item.type === 'loop') {
      nextState = ppndNspcEnt(nextState, {
        nodeId: item.id,
        nodeType: item.type,
        executed: true,
        ...(item.kind === 'start'
          ? {
            value: {
              kind: 'loop',
              markerKind: 'start',
              label: item.label ?? 'Loop',
              runs: Math.max(1, Math.floor(item.runs ?? 1)),
            } as const,
          }
          : {}),
      })

      // end markers are only meaningful inside runLoopNode
      if (item.kind === 'end') {
        continue
      }

      const endIndex = findLoopEndN(items, item)
      nextState = runLoopNode(nextState, items, index, fallbackResId)

      // jump past the explicit loop body so the outer iterator does not reprocess it
      if (endIndex !== null && endIndex > index) {
        index = endIndex
        continue
      }

      // if there is no matching end marker, treat the rest of the list as consumed by the loop runner
      return nextState
    }
  }

  return nextState
}

// recursively collect ui-friendly feature rows from a rotation node tree
// this is for display only and does not execute the rotation
function vstFeatRows(
  items: RotationNode[],
  rows: RotFeatRow[],
  runtime: ResRuntime,
  runtimesById: Record<string, ResRuntime>,
  seedLookup: Record<string, ResSeed>,
  fallbackResId: string,
): void {
  for (const item of items) {
    const resonatorId = ('resonatorId' in item ? item.resonatorId : undefined) ?? fallbackResId

    if (item.type === 'feature') {
      const rowSeed = seedLookup[resonatorId]
      const rowRuntime = resonatorId === runtime.id ? runtime : runtimesById[resonatorId] ?? null
      const feature = rowRuntime && rowSeed ? findFeature(rowRuntime, rowSeed, item.featureId) : null
      const skill = feature && rowRuntime && rowSeed ? findSkill(rowRuntime, rowSeed, feature.skillId) : null

      if (feature && skill && rowSeed) {
        const skillResult = resolveSkill(rowRuntime, skill)
        const nodeState = resFeatNodeS(runtime, item)
        rows.push({
          id: item.id,
          featureId: feature.id,
          label: skillResult.tab === 'negativeEffect' ? skillResult.label : feature.label,
          tab: skillResult.tab,
          multiplier: nodeState.multiplier,
          enabled: nodeState.enabled,
          resonatorId: rowSeed.id,
          resName: rowSeed.name,
        })
      }
      continue
    }

    if (item.type === 'repeat') {
      vstFeatRows(item.items, rows, runtime, runtimesById, seedLookup, resonatorId)
      continue
    }

    if (item.type === 'uptime') {
      vstFeatRows(item.setup ?? [], rows, runtime, runtimesById, seedLookup, resonatorId)
      vstFeatRows(item.items, rows, runtime, runtimesById, seedLookup, resonatorId)
    }
  }
}

// list feature rows for either personal or team rotation views
export function listRotFeatR(
  seed: ResSeed,
  runtime: ResRuntime,
  runtimesById: Record<string, ResRuntime> = {},
  seedLookup: Record<string, ResSeed> = { [seed.id]: seed },
  mode: Exclude<RotationView, 'saved'> = runtime.rotation.view === 'team' ? 'team' : 'personal',
): RotFeatRow[] {
  const rows: RotFeatRow[] = []

  if (mode === 'team') {
    vstFeatRows(runtime.rotation.teamItems, rows, runtime, runtimesById, seedLookup, seed.id)
    return rows
  }

  vstFeatRows(runtime.rotation.personalItems, rows, runtime, runtimesById, seedLookup, seed.id)
  return rows
}

// evaluate all direct features attached to the active runtime itself
// this does not walk rotation nodes. it simply evaluates the direct feature catalog
export function mkDrctFeatRs(
  context: CombatContext,
  seed: ResSeed,
): DamageFeature[] {
  const actCat = makeRuntimeCat(context.runtime, seed)

  return actCat.features
    .filter((feature) => feature.variant !== 'subHit')
    .map((feature) => {
      const actRt = context.graph.participants[context.graph.activeSlotId]?.runtime ?? context.runtime
      const scope = buildScope(context.runtime, feature.source, actRt, context.runtime, context.enemy)
      if (!evalCond(feature.condition, scope)) {
        return null
      }

      const skill = actCat.skillsById[feature.skillId]
      if (!skill) {
        return null
      }

      const skillResult = prprRtSkll(context.runtime, skill, context)
      if (skillResult.visible === false) {
        return null
      }

      const ftrdSkll = slcSkllForFe(skillResult, feature)

      const result = calcSkillDamage(
        context.finalStats,
        ftrdSkll,
        context.enemy,
        context.runtime.base.level,
        context.runtime.state.combat,
      )
      if (!shldNcldFeat(ftrdSkll, result)) {
        return null
      }

      return {
        id: feature.id,
        resonatorId: seed.id,
        resonatorName: seed.name,
        feature,
        skill: ftrdSkll,
        archetype: ftrdSkll.archetype,
        aggregationType: ftrdSkll.aggregationType,
        multiplier: 1,
        weight: 1,
        normal: result.normal,
        crit: result.crit,
        avg: result.avg,
        subHits: result.subHits,
      }
    })
    .filter((entry): entry is DamageFeature => entry !== null)
}

// run the full feature simulation surface:
// 1. evaluate direct features for the active runtime
// 2. execute the personal rotation list
// 3. execute the team rotation list
export function runFeatSmlt(
  context: CombatContext,
  seed: ResSeed,
  runtimesById: Record<string, ResRuntime> = {},
  environment?: PrepRotNvrn,
  drctFeats?: DamageFeature[],
): {
  allFeatures: DamageFeature[]
  rotations: {
    personal: {
      entries: DamageFeature[]
    }
    team: {
      entries: DamageFeature[]
    }
  }
} {
  void runtimesById

  const allFeatures = drctFeats ?? mkDrctFeatRs(context, seed)
  const prepNvrn = environment ?? mkPrepRotNvr(context, seed)

  // execute both personal and team rotation lists against fresh root states
  const persStt = mkRotStt(prepNvrn)
  const persRslt = runRotTms(persStt, context.runtime.rotation.personalItems)

  const teamState = mkRotStt(prepNvrn)
  const teamResult = runRotTms(teamState, context.runtime.rotation.teamItems)

  return {
    allFeatures,
    rotations: {
      personal: {
        entries: persRslt.entries,
      },
      team: {
        entries: teamResult.entries,
      },
    },
  }
}

// run the same rotation interpreter in inspection mode
// instead of only feature result rows, this also records per-node execution metadata
export function runRotNspc(
  context: CombatContext,
  seed: ResSeed,
  runtimesById: Record<string, ResRuntime> = {},
  environment?: PrepRotNvrn,
): {
  rotations: {
    personal: {
      entries: RotNspcEnt[]
    }
    team: {
      entries: RotNspcEnt[]
    }
  }
} {
  void runtimesById

  const prepNvrn = environment ?? mkPrepRotNvr(context, seed)
  const persStt = mkRotStt(prepNvrn, true)
  const persRslt = runRotTms(persStt, context.runtime.rotation.personalItems)

  const teamState = mkRotStt(prepNvrn, true)
  const teamResult = runRotTms(teamState, context.runtime.rotation.teamItems)

  return {
    rotations: {
      personal: {
        entries: persRslt.nspcNtrs ?? [],
      },
      team: {
        entries: teamResult.nspcNtrs ?? [],
      },
    },
  }
}
