/*
  Author: Runor Ewhro
  Description: executes feature and rotation simulations by walking rotation
               nodes, applying runtime changes, resolving feature owners/skills,
               and collecting weighted damage feature rows for rotation
               programs.
*/

import type {
  DamageFeature,
  EffectScope,
  FeatDef,
  RotationNode,
  RotVl,
  RtChng,
  SourceState,
} from '@/domain/gameData/contracts'
import {
  extractLoopExecutionBody,
  readPassForks,
  resolveLoopPassBody,
} from '@/domain/gameData/loopPasses.ts'
import { stripRotationNotes } from '@/domain/gameData/rotationNotes.ts'
import {
  normalizeFeatureAttachments,
  stripFeatureAttachments,
  type RotFeatureNode,
} from '@/domain/gameData/rotationAttached.ts'
import {
  getRotFormulaStatKey,
  ROT_FORMULA_STAT_DEFS,
  type RotFormulaStatKey,
  type RotFormulaStats,
} from '@/domain/gameData/rotationFormulaStats'
import type { CombatGraph, SlotId } from '@/domain/entities/combatGraph'
import { findCombatPart, rbldCmbtPart } from '@/domain/state/combatGraph'
import type { ResRuntime, ResSeed } from '@/domain/entities/runtime'
import type { DamageResult, SkillAggType, SkillDef } from '@/domain/entities/stats'
import type { EnemyProfile } from '@/domain/entities/appState'
import {
  listEquippedSourceStates,
  makeRuntimeCat,
} from '@/domain/services/runtimeSourceService'
import { makeTeamComp } from '@/domain/gameData/teamComposition'
import {
  getNegFfctCm,
  getNegFfctEn,
  negEffectsFor,
} from '@/domain/gameData/negativeEffects'
import { getTuneStrainMaxForTeam } from '@/domain/gameData/tuneStrain'
import { getSrcNumMax } from '@/domain/gameData/controlOptions'
import { readRtPath, writeBjctPat, writeRtPath } from '@/domain/gameData/runtimePath'
import { listStatesFor } from '@/domain/services/gameDataService'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { cloneSlotRml } from '@/domain/state/defaults'
import { cloneSlotLuo } from '@/domain/state/runtimeMaterialization'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'
import {
  calcNumericSkillDamage,
  calcNumericPlaneSkillDamage,
  calcNumericPlaneSkillDamageScoreInto,
  calcPackedSkillDamageScoreInto,
  resolveNumericEffectiveStats,
  type CalcSkillDamageOptions,
  type DamageCombatState,
} from '@/engine/formulas/damage'
import {
  NUMERIC_FINAL_CELL_COUNT,
  finalAttributeCell,
  finalCoreCell,
  finalSkillTypeCell,
  finalTopCell,
} from '@/engine/rotation/numericLayout.ts'
import { evalCond, evalForm } from '@/engine/effects/evaluator'
import { getNumericCombatTeam } from '@/engine/pipeline/buildCombatContext'
import type { CombatContext } from '@/engine/pipeline/types'
import { prprRtSkll } from '@/engine/pipeline/prepareRuntimeSkill'
import { resolveSkill } from '@/engine/pipeline/resolveSkill'
import {
  compileRotationPlan,
  ROT_FLAG_ENABLED,
  ROT_OP_CONDITION,
  ROT_OP_FEATURE,
  ROT_OP_NOTE,
  ROT_OP_REPEAT,
  ROT_OP_UPTIME,
  ROT_VALUE_BOOLEAN,
  ROT_VALUE_DEFAULT,
  ROT_VALUE_NUMBER,
  ROT_VALUE_STRING,
  ROT_WRITE_ADD,
  ROT_WRITE_TOGGLE,
  type CompiledRotationBlock,
  type CompiledRotationPlan,
} from '@/engine/rotation/compiler.ts'
import {
  checkpointNumericTeam,
  evaluateNumericCondition,
  forkNumericTeam,
  materializeNumericCombat,
  readNumericRuntime,
  setNumericActiveLane,
  writeNumericEffectScale,
  writeNumericEnemy,
  writeNumericRoute,
  writeNumericRuntime,
  syncNumericTeam,
  type NumericTeamState,
  prepareNumericSkill,
  rollbackNumericTeam,
} from '@/engine/effects/numericTeam.ts'
import type {
  DamageInvocation,
  DetailedRunOpts,
  InspectEntry,
  NumericScore,
  ProgramOpts,
  ProgramResult,
  RunDetail,
  RunMetrics,
  SimulationOpts,
} from '@/engine/rotation/runTypes.ts'
export type {
  DamageInvocation,
  DetailedRunOpts,
  InspectEntry,
  InspectValue,
  NumericScore,
  ProgramOpts,
  ProgramResult,
  RunDetail,
  RunMetrics,
  SimulationOpts,
} from '@/engine/rotation/runTypes.ts'

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
  left: DamageResult,
  right: DamageResult,
): DamageResult {
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

type RotNspcSnapshot = Pick<
  InspectEntry,
  'runtimeById' | 'selectedTargetsByRuntimeId' | 'activeResonatorId' | 'enemy'
>

interface RotPartStt {
  // owning seed for this participant
  seed: ResSeed

  // current runtime state for this participant
  runtime: ResRuntime

  // fixed packed participant lane
  lane: number
}

type RotPartRt = Pick<RotPartStt, 'seed' | 'runtime'>

// overlay values represent temporary writes made by rotation nodes
// they are not immediately mutating the base graph/runtime directly
type RotVrlyVl = string | number | boolean
const ROT_FORMULA_INDEX = new Map(
  ROT_FORMULA_STAT_DEFS.map((definition, index) => [definition.key, index]),
)

interface RotVrlyStt {
  // increments whenever any overlay write happens
  // retained for trace identity and branch comparison
  version: number

  // Runtime and combat revisions are deliberately separate. Formula-only
  // writes must not invalidate a materialized team graph or combat contexts.
  runtimeVersion: number
  combatVersion: number

  // temporary runtime-path writes per resonator
  rtPthsByRejq: Record<string, Record<string, RotVrlyVl>>

  // temporary routing-path writes per resonator
  routingPaths: Record<string, Record<string, RotVrlyVl>>

  // temporary enemy writes shared across the run
  enemyPaths: Record<string, RotVrlyVl>

  // temporary active-resonator selection used by active/activeOther effect scopes
  activeResonatorId?: string

  // partial uptime setup writes leave marker/state conditions truthy for body
  // evaluation while scaling any data-driven effects gated by those paths.
  effectScalesByRuntimePath: Record<string, Record<string, number>>
}

export interface RunEnvironment {
  prmrResId: string
  prmrSlotId: SlotId
  enemy: EnemyProfile
  graph: CombatGraph

  // cached seed lookup for all possible participants
  seedLookup: Record<string, ResSeed>
  catalogByResonator: Record<string, ReturnType<typeof makeRuntimeCat>>

  // authored numeric bounds are cached by the same target path condition
  // nodes write, so execution does not rebuild source catalogs per node
  stateDefsByResonator: Record<string, Record<string, SourceState>>
  enemyStateDefs: Record<string, SourceState>
  numericBase: NumericTeamState

  kernelMetrics: {
    scalarFeatures: number
  }
}

const preparedRotationProgramBrand: unique symbol = Symbol('PreparedRotationProgram')
const preparedRotationProgramCache = new WeakMap<RotationNode[], PreparedRotationProgram>()

/**
 * Opaque execution input produced by `prepareRotationProgram`.
 *
 * Keeping the normalized items behind a readonly branded wrapper prevents a
 * raw authored node array from being passed to the executor by accident.
 */
export interface PreparedRotationProgram {
  readonly items: readonly RotationNode[]
  readonly plan: CompiledRotationPlan
  readonly [preparedRotationProgramBrand]: true
}

interface RotationExec {
  environment: RunEnvironment
  program: CompiledRotationPlan | null
  overlay: RotVrlyStt
  /** Score/tape execution mutates one compact shadow; branches clone it once. */
  mutableOverlay: boolean
  numericTeam: NumericTeamState
  formulaRegisters: Float64Array

  // lazily resolved runtime snapshots for the current overlay version
  rslvRtCch: Record<string, { version: number; runtime: ResRuntime }>

  // lazily materialized graph for the current overlay version
  // the graph is only rebuilt when something actually changed
  mtrlGrphVrsn: number
  mtrlGrph: CombatGraph | null
  dirtyGraphIds: Set<string>

  // branch weight kept for result aggregation paths that explicitly weight rows
  weight: number

  // summary runs keep numeric totals but skip per-hit detail allocation
  detail: RunDetail

  // inspection snapshots are only needed by the state browser, not loop traces
  inspectSnapshots: boolean

  // Consecutive feature rows commonly observe the same immutable overlay.
  // Share that snapshot instead of allocating participant/routing maps per row.
  nspcSnapshotCache: WeakMap<RotVrlyStt, RotNspcSnapshot>

  // accumulated feature result rows produced so far
  entries: DamageFeature[]
  captureEntries: boolean

  // Rowless execution accumulates directly into one Float64 triple per team
  // member. It is intentionally allocation-free inside the feature hot path.
  scoreIds: readonly string[]
  scoreIndexById: Record<string, number>
  scoreValues: Float64Array | null
  normalizedScoreValues: Float64Array | null
  /** Optional rowless aggregation filter; null preserves the general score API. */
  scoreAggregationType: SkillAggType | null

  // Six reusable scalar cells: one accumulated triple and one evaluation
  // triple. Score-only execution never allocates a DamageResult or sub-hit row.
  damageScratch: Float64Array
  formulaFinalScratch: Float64Array
  combatScratch: DamageCombatState
  combatBaseByLane: DamageCombatState[]
  combatBaseRevisionByLane: Int32Array
  activeEnemyCache: { version: number; value: EnemyProfile }
  onDamageInvocation?: (invocation: DamageInvocation) => void

  // optional read-only per-node execution trace used by rotation inspectors
  nspcNtrs: InspectEntry[] | null

  // active loop run numbers, keyed by loop id, for trace/display context
  actLoopRuns: Record<string, number>
  actLoopRunqi: Record<string, number>
  /*
    Product of the enclosing loops' run counts, kept in step with
    `actLoopRunqi`. Every damage evaluation reads it, so it is maintained at
    loop boundaries rather than recomputed per feature.
  */
  loopDivisor: number

  /*
    Monotonic id so damage consumers can tell one feature's hits apart. It is a
    shared box rather than a field because scoped branches clone the state and
    their invocations still have to be distinguishable from the parent's.
  */
  invocationGroup: { value: number }
  /** Shared counter box so scoped branches contribute to one execution. */
  metrics: RunMetrics
}

function dmgOptionsFor(detail: RunDetail): CalcSkillDamageOptions | undefined {
  return detail === 'summary' ? { includeSubHits: false } : undefined
}

export function isRotNodeOn(runtime: ResRuntime, node: RotationNode): boolean {
  void runtime
  return 'enabled' in node ? node.enabled ?? true : true
}

// when writing inspection entries, attach the current loop context so the ui can
// show which loop run produced a given row
function withLoopNspc(
  state: RotationExec,
): Pick<InspectEntry, 'loopRuns' | 'loopRunCnts'> {
  return {
    ...(Object.keys(state.actLoopRuns).length > 0 ? { loopRuns: { ...state.actLoopRuns } } : {}),
    ...(Object.keys(state.actLoopRunqi).length > 0 ? { loopRunCnts: { ...state.actLoopRunqi } } : {}),
  }
}

// feature inspectors need the exact state at the selected loop run. capture the
// materialized graph only for feature rows so normal rotation execution stays unchanged.
function withFeatNspc(
  state: RotationExec,
): RotNspcSnapshot {
  if (!state.inspectSnapshots) {
    return {}
  }

  const cached = state.nspcSnapshotCache.get(state.overlay)
  if (cached) {
    return cached
  }

  const graph = state.overlay.combatVersion === 0 ? getBaseGraph(state) : getMatGrph(state)
  const runtimeById: Record<string, ResRuntime> = {}
  const selectedTargetsByRuntimeId: Record<string, Record<string, string | null>> = {}

  for (const participant of Object.values(graph.participants)) {
    runtimeById[participant.resonatorId] = participant.runtime
    selectedTargetsByRuntimeId[participant.resonatorId] = {
      ...participant.slot.routing.selectedTargetsByOwnerKey,
    }
  }

  const snapshot: RotNspcSnapshot = {
    runtimeById,
    selectedTargetsByRuntimeId,
    activeResonatorId: getActResId(state),
    enemy: getActEnemy(state),
  }
  state.nspcSnapshotCache.set(state.overlay, snapshot)
  return snapshot
}

// append one inspection entry if inspection mode is enabled
// otherwise return the same state untouched
function ppndNspcEnt(
  state: RotationExec,
  entry: Omit<InspectEntry, 'loopRuns' | 'loopRunCnts' | 'runtimeById' | 'selectedTargetsByRuntimeId' | 'activeResonatorId' | 'enemy'>,
): RotationExec {
  if (!state.nspcNtrs) {
    return state
  }

  state.nspcNtrs.push({
    ...entry,
    ...withLoopNspc(state),
    ...(entry.nodeType === 'feature' ? withFeatNspc(state) : {}),
  })
  return state
}

// resolve a feature node multiplier, defaulting to 1 when unset
export function featureMultiplier(
  runtime: ResRuntime,
  node: Extract<RotationNode, { type: 'feature' }>,
): number {
  void runtime
  return node.multiplier ?? 1
}

// resolve repeat count if present on a repeat node
export function repeatTimes(
  runtime: ResRuntime,
  node: Extract<RotationNode, { type: 'repeat' }>,
): number | undefined {
  void runtime
  return typeof node.times === 'number' ? node.times : undefined
}

// resolve uptime ratio if present on an uptime node
export function uptimeRatio(
  runtime: ResRuntime,
  node: Extract<RotationNode, { type: 'repeat' | 'uptime' }>,
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

/** Direct node gating reads enabled; authored condition nodes execute separately. */
function shldRunRotNo(
  node: RotationNode,
  compiledFlags?: number,
): boolean {
  return compiledFlags !== undefined
    ? Boolean(compiledFlags & ROT_FLAG_ENABLED)
    : !('enabled' in node && node.enabled === false)
}

function sumSkillHits(skill: Pick<SkillDef, 'hits'>): number {
  return skill.hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0)
}

function addSkillMv(skill: SkillDef, value: number): SkillDef {
  const delta = value / 100
  if (delta === 0 || skill.multiplier <= 0) {
    return skill
  }

  if (skill.hits.length === 0) {
    return {
      ...skill,
      multiplier: skill.multiplier + delta,
    }
  }

  const scale = (skill.multiplier + delta) / skill.multiplier
  const hits = skill.hits.map((hit) => ({
    ...hit,
    multiplier: hit.multiplier * scale,
  }))

  return {
    ...skill,
    multiplier: sumSkillHits({ hits }),
    hits,
  }
}

function scaleSkillMv(skill: SkillDef, value: number): SkillDef {
  const scale = 1 + value / 100
  if (scale === 1) {
    return skill
  }

  if (skill.hits.length === 0) {
    return {
      ...skill,
      multiplier: skill.multiplier * scale,
    }
  }

  const hits = skill.hits.map((hit) => ({
    ...hit,
    multiplier: hit.multiplier * scale,
  }))

  return {
    ...skill,
    multiplier: sumSkillHits({ hits }),
    hits,
  }
}

function applyFormulaMv(skill: SkillDef, formula: RotFormulaStats): SkillDef {
  const mvAdd = formula.mvAdd ?? 0
  const mvScale = formula.mvScale ?? 0

  if (mvAdd === 0 && mvScale === 0) {
    return skill
  }

  const scale = 1 + mvScale / 100

  if (isNegFfctArch(skill.archetype) && typeof skill.fixedMv === 'number') {
    return {
      ...skill,
      fixedMv: (skill.fixedMv + mvAdd) * scale,
    }
  }

  if ((skill.archetype === 'tuneRupture' || skill.archetype === 'hack') && skill.hits.length === 0) {
    const current = skill.tuneRuptureScale ?? 16
    return {
      ...skill,
      tuneRuptureScale: (current + mvAdd) * scale,
    }
  }

  return scaleSkillMv(addSkillMv(skill, mvAdd), mvScale)
}

function applyFormulaToSkill(skill: SkillDef, formula: RotFormulaStats): SkillDef {
  let nextSkill = applyFormulaMv(skill, formula)

  if ((formula.fixedDmg ?? 0) !== 0) {
    nextSkill = {
      ...nextSkill,
      fixedDmg: (nextSkill.fixedDmg ?? 0) + (formula.fixedDmg ?? 0),
    }
  }

  if ((formula.fixedMv ?? 0) !== 0 && isNegFfctArch(nextSkill.archetype)) {
    nextSkill = {
      ...nextSkill,
      fixedMv: (nextSkill.fixedMv ?? 0) + (formula.fixedMv ?? 0),
    }
  }

  if (nextSkill.archetype === 'tuneRupture') {
    return {
      ...nextSkill,
      tuneRuptureCritRate: (nextSkill.tuneRuptureCritRate ?? 0) + (formula.critRate ?? 0) / 100,
      tuneRuptureCritDmg: (nextSkill.tuneRuptureCritDmg ?? 1) + (formula.critDmg ?? 0) / 100,
    }
  }

  if (isNegFfctArch(nextSkill.archetype)) {
    return {
      ...nextSkill,
      negativeEffectCritRate: (nextSkill.negativeEffectCritRate ?? 0) + (formula.critRate ?? 0) / 100,
      negativeEffectCritDmg: (nextSkill.negativeEffectCritDmg ?? 1) + (formula.critDmg ?? 0) / 100,
    }
  }

  return nextSkill
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
    multiplier: sumSkillHits({ hits }),
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
function scaleResult(result: DamageResult, weight: number) {
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
// the archetype set is the same one the score path gates on, so both readings
// of one execution keep agreeing when a negative effect is added
function shldNcldFeat(skill: SkillDef, result: DamageResult): boolean {
  return !(getNegFfctCm(skill.archetype) && result.avg <= 0)
}

function runtimeStatePathKey(path: string): string {
  return `runtime.${path.replace(/^runtime\./, '')}`
}

function enemyStatePathKey(path: string): string {
  return path.replace(/^context\./, '')
}

function stateDefsByPath(
  states: SourceState[],
  pathKey: (path: string) => string,
): Record<string, SourceState> {
  const definitions: Record<string, SourceState> = {}
  for (const state of states) {
    definitions[pathKey(state.path)] ??= state
  }
  return definitions
}

// prepare everything a rotation run needs up front:
// - primary slot info
// - enemy
// - graph
// - seed lookup for all participants
export function prepareRunEnv(
  context: CombatContext,
  seed: ResSeed,
): RunEnvironment {
  const graph = context.graph
  const prmrPart = graph.participants[context.targetSlotId]
  if (!prmrPart) {
    throw new Error(`Missing primary participant in combat graph for slot ${context.targetSlotId}`)
  }

  const seedLookup: Record<string, ResSeed> = {
    [seed.id]: seed,
  }
  const stateDefsByResonator: Record<string, Record<string, SourceState>> = {}
  const catalogByResonator: Record<string, ReturnType<typeof makeRuntimeCat>> = {}

  for (const participant of Object.values(graph.participants)) {
    let partSeed: ResSeed | null | undefined = seedLookup[participant.resonatorId]
    if (!partSeed) {
      partSeed = getResSeedBy(participant.resonatorId)
      if (partSeed) {
        seedLookup[participant.resonatorId] = partSeed
      }
    }

    stateDefsByResonator[participant.resonatorId] = stateDefsByPath(
      listEquippedSourceStates(participant.runtime, partSeed),
      runtimeStatePathKey,
    )
    catalogByResonator[participant.resonatorId] = makeRuntimeCat(participant.runtime, partSeed)
  }

  return {
    prmrResId: prmrPart.resonatorId,
    prmrSlotId: context.targetSlotId,
    enemy: context.enemy,
    graph,
    seedLookup,
    catalogByResonator,
    stateDefsByResonator,
    enemyStateDefs: stateDefsByPath(
      listStatesFor('enemy', context.enemy.id),
      enemyStatePathKey,
    ),
    numericBase: getNumericCombatTeam({
      graph,
      targetSlotId: context.targetSlotId,
      enemy: context.enemy,
    }),
    kernelMetrics: {
      scalarFeatures: 0,
    },
  }
}

// create the initial execution state for one run
// inspection mode is optional and only allocates inspection storage when needed
function mkRotStt(
  environment: RunEnvironment,
  program: CompiledRotationPlan | null,
  inspect = false,
  options: {
    detail?: RunDetail
    includeSnapshots?: boolean
    captureEntries?: boolean
    scoreAggregationType?: SkillAggType | null
  } = {},
): RotationExec {
  const captureEntries = options.captureEntries ?? true
  const scoreIds = captureEntries
    ? []
    : Object.values(environment.graph.participants).map((participant) => participant.resonatorId)
  return {
    environment,
    program,
    overlay: {
      version: 0,
      runtimeVersion: 0,
      combatVersion: 0,
      rtPthsByRejq: {},
      routingPaths: {},
      enemyPaths: {},
      activeResonatorId: undefined,
      effectScalesByRuntimePath: {},
    },
    mutableOverlay: !captureEntries && !inspect,
    numericTeam: forkNumericTeam(environment.numericBase),
    formulaRegisters: new Float64Array(ROT_FORMULA_STAT_DEFS.length),
    rslvRtCch: {},
    mtrlGrphVrsn: -1,
    mtrlGrph: null,
    dirtyGraphIds: new Set(),
    weight: 1,
    detail: options.detail ?? 'full',
    inspectSnapshots: options.includeSnapshots ?? false,
    nspcSnapshotCache: new WeakMap(),
    entries: [],
    captureEntries,
    scoreIds,
    scoreIndexById: Object.fromEntries(scoreIds.map((id, index) => [id, index])),
    scoreValues: captureEntries ? null : new Float64Array((scoreIds.length + 1) * 3),
    normalizedScoreValues: captureEntries ? null : new Float64Array((scoreIds.length + 1) * 3),
    scoreAggregationType: options.scoreAggregationType ?? null,
    damageScratch: new Float64Array(6),
    formulaFinalScratch: new Float64Array(NUMERIC_FINAL_CELL_COUNT),
    combatScratch: {},
    combatBaseByLane: environment.numericBase.program.laneIds.map(() => ({})),
    combatBaseRevisionByLane: new Int32Array(
      environment.numericBase.program.laneIds.length,
    ).fill(-1),
    activeEnemyCache: { version: -1, value: environment.enemy },
    onDamageInvocation: undefined,
    nspcNtrs: inspect ? [] : null,
    actLoopRuns: {},
    actLoopRunqi: {},
    loopDivisor: 1,
    invocationGroup: { value: 0 },
    metrics: {
      numericForks: 1,
      numericCheckpoints: 0,
      objectOverlayCopies: 0,
      runtimeMaterializations: 0,
      graphMaterializations: 0,
      legacyConditionEvaluations: 0,
      scalarFeatures: 0,
      capturedEntries: 0,
    },
  }
}

// Preparation removes display-only nodes. Structural compatibility migration
// happens once during hydration/import, never while executing a rotation.
export function prepareRotationProgram(items: RotationNode[]): PreparedRotationProgram {
  const cached = preparedRotationProgramCache.get(items)
  if (cached) return cached
  const normalized = stripRotationNotes(items)
  const prepared = Object.freeze({
    items: Object.freeze(normalized),
    plan: compileRotationPlan(normalized),
    [preparedRotationProgramBrand]: true as const,
  })
  preparedRotationProgramCache.set(items, prepared)
  return prepared
}

// Execute one prepared authored program. Callers choose the program explicitly;
// program selection belongs to callers; preparation only normalizes the AST.
export function executeRotationProgram(
  environment: RunEnvironment,
  program: PreparedRotationProgram,
  options: ProgramOpts = {},
): ProgramResult {
  const executionState = mkRotStt(environment, program.plan, options.inspect ?? false, {
      detail: options.detail,
      includeSnapshots: options.includeSnapshots,
      captureEntries: options.captureEntries,
    })
  executionState.onDamageInvocation = options.onDamageInvocation
  const result = runRotTimes(
    executionState,
    program.items,
    options.fallbackResonatorId,
  )

  return {
    entries: result.entries,
    inspection: result.nspcNtrs ?? [],
    metrics: result.metrics,
  }
}

/**
 * Execute the exact same compiled program without allocating feature rows,
 * sub-hit arrays, effective-stat registers, or inspection data.
 */
export function executeRotationScore(
  environment: RunEnvironment,
  program: PreparedRotationProgram,
  options: { aggregationType?: SkillAggType } = {},
): NumericScore {
  const result = runRotTimes(
    mkRotStt(environment, program.plan, false, {
      detail: 'summary',
      captureEntries: false,
      scoreAggregationType: options.aggregationType ?? null,
    }),
    program.items,
  )
  const values = result.scoreValues ?? new Float64Array(0)
  const normalizedValues = result.normalizedScoreValues ?? new Float64Array(0)
  const resonators = result.scoreIds.map((id, index) => ({
    id,
    normal: values[(index + 1) * 3] ?? 0,
    crit: values[(index + 1) * 3 + 1] ?? 0,
    avg: values[(index + 1) * 3 + 2] ?? 0,
  }))
  const normalizedResonators = result.scoreIds.map((id, index) => ({
    id,
    normal: normalizedValues[(index + 1) * 3] ?? 0,
    crit: normalizedValues[(index + 1) * 3 + 1] ?? 0,
    avg: normalizedValues[(index + 1) * 3 + 2] ?? 0,
  }))
  return {
    total: {
      normal: values[0] ?? 0,
      crit: values[1] ?? 0,
      avg: values[2] ?? 0,
    },
    resonators,
    normalizedTotal: {
      normal: normalizedValues[0] ?? 0,
      crit: normalizedValues[1] ?? 0,
      avg: normalizedValues[2] ?? 0,
    },
    normalizedResonators,
    metrics: result.metrics,
  }
}

// shallow-clone execution state for branch evaluation
// branch clones intentionally restart local rows because setup and uptime
// branches merge their outputs back into the parent explicitly later
function cloneRotation(
  state: RotationExec,
  options: { shareNumericTeam?: boolean } = {},
): RotationExec {
  if (options.shareNumericTeam) state.metrics.numericCheckpoints += 1
  else state.metrics.numericForks += 1
  if (state.mutableOverlay) state.metrics.objectOverlayCopies += 1
  return {
    ...state,
    overlay: state.mutableOverlay ? cloneMutableOverlay(state.overlay) : state.overlay,
    numericTeam: options.shareNumericTeam ? state.numericTeam : forkNumericTeam(state.numericTeam),
    formulaRegisters: state.formulaRegisters.slice(),
    entries: [],
    scoreValues: state.scoreValues ? new Float64Array(state.scoreValues.length) : null,
    normalizedScoreValues: state.normalizedScoreValues
      ? new Float64Array(state.normalizedScoreValues.length)
      : null,
    nspcNtrs: state.nspcNtrs ? [] : null,
    actLoopRuns: { ...state.actLoopRuns },
    actLoopRunqi: { ...state.actLoopRunqi },
    dirtyGraphIds: new Set(state.dirtyGraphIds),
    activeEnemyCache: { ...state.activeEnemyCache },
    combatBaseByLane: state.combatBaseByLane.map(() => ({})),
    combatBaseRevisionByLane: new Int32Array(state.combatBaseRevisionByLane.length).fill(-1),
  }
}

function cloneNestedOverlay<T extends RotVrlyVl>(
  values: Record<string, Record<string, T>>,
): Record<string, Record<string, T>> {
  return Object.fromEntries(
    Object.entries(values).map(([ownerId, entries]) => [ownerId, { ...entries }]),
  )
}

function cloneMutableOverlay(overlay: RotVrlyStt): RotVrlyStt {
  return {
    ...overlay,
    rtPthsByRejq: cloneNestedOverlay(overlay.rtPthsByRejq),
    routingPaths: cloneNestedOverlay(overlay.routingPaths),
    enemyPaths: { ...overlay.enemyPaths },
    effectScalesByRuntimePath: cloneNestedOverlay(overlay.effectScalesByRuntimePath),
  }
}

function writeMutableNested<T extends RotVrlyVl>(
  values: Record<string, Record<string, T>>,
  ownerId: string,
  path: string,
  value: T,
): void {
  const owner = values[ownerId] ?? (values[ownerId] = {})
  owner[path] = value
}

function mergeNumericScore(state: RotationExec, scopedState: RotationExec): void {
  if (state.scoreValues && scopedState.scoreValues) {
    for (let index = 0; index < state.scoreValues.length; index += 1) {
      state.scoreValues[index] += scopedState.scoreValues[index] ?? 0
    }
  }
  if (state.normalizedScoreValues && scopedState.normalizedScoreValues) {
    for (let index = 0; index < state.normalizedScoreValues.length; index += 1) {
      state.normalizedScoreValues[index] += scopedState.normalizedScoreValues[index] ?? 0
    }
  }
}

function mkLoopDivisor(runCounts: Record<string, number>): number {
  let divisor = 1
  for (const runs of Object.values(runCounts)) {
    divisor *= Math.max(1, Math.floor(runs))
  }
  return divisor
}

function activeLoopDivisor(state: RotationExec): number {
  return state.loopDivisor
}

/** Accumulate one exact damage triple into both supported loop readings. */
function addNumericScore(
  state: RotationExec,
  scoreIndex: number,
  normal: number,
  crit: number,
  avg: number,
): void {
  const offset = (scoreIndex + 1) * 3
  const add = (values: Float64Array, scale: number): void => {
    values[0] += normal * scale
    values[1] += crit * scale
    values[2] += avg * scale
    values[offset] += normal * scale
    values[offset + 1] += crit * scale
    values[offset + 2] += avg * scale
  }
  if (state.scoreValues) add(state.scoreValues, 1)
  if (state.normalizedScoreValues) add(state.normalizedScoreValues, 1 / activeLoopDivisor(state))
}

/*
  A scoped branch can produce more rows than an argument list can carry: a
  repeat body inside a many-pass loop reaches that on its own. Append them one
  by one rather than spreading the whole array into `push`.
*/
function appendAll<T>(target: T[], source: readonly T[]): void {
  for (let index = 0; index < source.length; index += 1) {
    target.push(source[index]!)
  }
}

function mergeScopedRotRslt(
  state: RotationExec,
  scopedState: RotationExec,
): RotationExec {
  appendAll(state.entries, scopedState.entries)
  mergeNumericScore(state, scopedState)
  if (state.nspcNtrs && scopedState.nspcNtrs) {
    appendAll(state.nspcNtrs, scopedState.nspcNtrs)
  }

  return state
}

function diffFlatOverlay<T extends RotVrlyVl>(
  before: Record<string, T> | undefined,
  after: Record<string, T> | undefined,
): Record<string, T> {
  const changes: Record<string, T> = {}
  if (!after) {
    return changes
  }

  for (const [path, value] of Object.entries(after)) {
    if (!Object.is(before?.[path], value)) {
      changes[path] = value
    }
  }

  return changes
}

function diffNestedOverlay<T extends RotVrlyVl>(
  before: Record<string, Record<string, T>>,
  after: Record<string, Record<string, T>>,
): Record<string, Record<string, T>> {
  const changes: Record<string, Record<string, T>> = {}

  for (const [ownerId, values] of Object.entries(after)) {
    const ownerChanges = diffFlatOverlay(before[ownerId], values)
    if (Object.keys(ownerChanges).length > 0) {
      changes[ownerId] = ownerChanges
    }
  }

  return changes
}

function mergeNestedOverlay<T extends RotVrlyVl>(
  current: Record<string, Record<string, T>>,
  changes: Record<string, Record<string, T>>,
): Record<string, Record<string, T>> {
  let next = current

  for (const [ownerId, values] of Object.entries(changes)) {
    next = {
      ...next,
      [ownerId]: {
        ...(next[ownerId] ?? {}),
        ...values,
      },
    }
  }

  return next
}

function mergePtmBodyOverlay(
  state: RotationExec,
  setupState: RotationExec,
  resultState: RotationExec,
): RotationExec {
  const runtimeChanges = diffNestedOverlay(setupState.overlay.rtPthsByRejq, resultState.overlay.rtPthsByRejq)
  const routingChanges = diffNestedOverlay(setupState.overlay.routingPaths, resultState.overlay.routingPaths)
  const enemyChanges = diffFlatOverlay(setupState.overlay.enemyPaths, resultState.overlay.enemyPaths)
  const formulaRegisters = state.formulaRegisters.slice()
  let formulaChanged = false
  for (let index = 0; index < formulaRegisters.length; index += 1) {
    if (Object.is(setupState.formulaRegisters[index], resultState.formulaRegisters[index])) continue
    formulaRegisters[index] = resultState.formulaRegisters[index] ?? 0
    formulaChanged = true
  }
  const effectScaleChanges = diffNestedOverlay(
    setupState.overlay.effectScalesByRuntimePath,
    resultState.overlay.effectScalesByRuntimePath,
  )
  const activeChanged = !Object.is(setupState.overlay.activeResonatorId, resultState.overlay.activeResonatorId)
  const hasChanges =
    activeChanged ||
    Object.keys(runtimeChanges).length > 0 ||
    Object.keys(routingChanges).length > 0 ||
    Object.keys(enemyChanges).length > 0 ||
    formulaChanged ||
    Object.keys(effectScaleChanges).length > 0

  if (!hasChanges) {
    return state
  }

  const hasRuntimeChanges = Object.keys(runtimeChanges).length > 0
  const hasCombatChanges =
    activeChanged ||
    hasRuntimeChanges ||
    Object.keys(routingChanges).length > 0 ||
    Object.keys(enemyChanges).length > 0 ||
    Object.keys(effectScaleChanges).length > 0

  const numericTeam = state.mutableOverlay
    ? state.numericTeam
    : forkNumericTeam(state.numericTeam)
  if (activeChanged && resultState.overlay.activeResonatorId) {
    setNumericActiveLane(numericTeam, resultState.overlay.activeResonatorId)
  }
  for (const [resonatorId, changes] of Object.entries(runtimeChanges)) {
    for (const [path, value] of Object.entries(changes)) {
      writeNumericRuntime(numericTeam, resonatorId, path, value)
    }
  }
  for (const [path, value] of Object.entries(enemyChanges)) {
    writeNumericEnemy(numericTeam, path, value)
  }
  for (const [resonatorId, changes] of Object.entries(routingChanges)) {
    for (const [path, value] of Object.entries(changes)) {
      const prefix = 'selectedTargetsByOwnerKey.'
      if (path.startsWith(prefix)) {
        writeNumericRoute(
          numericTeam,
          resonatorId,
          path.slice(prefix.length),
          typeof value === 'string' ? value : null,
        )
      }
    }
  }
  for (const [resonatorId, changes] of Object.entries(effectScaleChanges)) {
    for (const [path, value] of Object.entries(changes)) {
      writeNumericEffectScale(numericTeam, resonatorId, path, value)
    }
  }

  if (state.mutableOverlay) {
    for (const [resonatorId, changes] of Object.entries(runtimeChanges)) {
      for (const [path, value] of Object.entries(changes)) {
        writeMutableNested(state.overlay.rtPthsByRejq, resonatorId, path, value)
      }
      state.dirtyGraphIds.add(resonatorId)
    }
    for (const [resonatorId, changes] of Object.entries(routingChanges)) {
      for (const [path, value] of Object.entries(changes)) {
        writeMutableNested(state.overlay.routingPaths, resonatorId, path, value)
      }
      state.dirtyGraphIds.add(resonatorId)
    }
    Object.assign(state.overlay.enemyPaths, enemyChanges)
    for (const [resonatorId, changes] of Object.entries(effectScaleChanges)) {
      for (const [path, value] of Object.entries(changes)) {
        writeMutableNested(state.overlay.effectScalesByRuntimePath, resonatorId, path, value)
      }
    }
    state.formulaRegisters = formulaRegisters
    state.overlay.version += 1
    state.overlay.runtimeVersion += hasRuntimeChanges ? 1 : 0
    state.overlay.combatVersion += hasCombatChanges ? 1 : 0
    if (activeChanged) state.overlay.activeResonatorId = resultState.overlay.activeResonatorId
    state.mtrlGrphVrsn = -1
    return state
  }

  return {
    ...state,
    numericTeam,
    formulaRegisters,
    overlay: {
      ...state.overlay,
      version: state.overlay.version + 1,
      runtimeVersion: state.overlay.runtimeVersion + (hasRuntimeChanges ? 1 : 0),
      combatVersion: state.overlay.combatVersion + (hasCombatChanges ? 1 : 0),
      rtPthsByRejq: mergeNestedOverlay(state.overlay.rtPthsByRejq, runtimeChanges),
      routingPaths: mergeNestedOverlay(state.overlay.routingPaths, routingChanges),
      enemyPaths: {
        ...state.overlay.enemyPaths,
        ...enemyChanges,
      },
      activeResonatorId: activeChanged ? resultState.overlay.activeResonatorId : state.overlay.activeResonatorId,
      effectScalesByRuntimePath: mergeNestedOverlay(state.overlay.effectScalesByRuntimePath, effectScaleChanges),
    },
    mtrlGrphVrsn: -1,
    dirtyGraphIds: new Set([
      ...state.dirtyGraphIds,
      ...Object.keys(runtimeChanges),
      ...Object.keys(routingChanges),
    ]),
  }
}

function getPrmrRt(state: RotationExec): ResRuntime | null {
  return getRslvPartR(state, state.environment.prmrResId)
}

// active-targeted effects resolve through the combat graph, but rotations can
// temporarily move the active slot without mutating the user's saved team setup.
function getActResId(state: RotationExec): string {
  return state.overlay.activeResonatorId ?? state.environment.prmrResId
}

function getActRt(state: RotationExec): ResRuntime | null {
  return getRslvPartR(state, getActResId(state)) ?? getPrmrRt(state)
}

function getRotFormula(state: RotationExec, key: RotFormulaStatKey): number {
  const value = state.formulaRegisters[ROT_FORMULA_INDEX.get(key) ?? -1]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function hasRotFormulaStats(state: RotationExec): boolean {
  return state.formulaRegisters.some((value) => Number.isFinite(value) && value !== 0)
}

function materializeFormulaStats(state: RotationExec): RotFormulaStats {
  const formula: RotFormulaStats = {}
  for (let index = 0; index < ROT_FORMULA_STAT_DEFS.length; index += 1) {
    const value = state.formulaRegisters[index] ?? 0
    if (value !== 0) formula[ROT_FORMULA_STAT_DEFS[index]!.key] = value
  }
  return formula
}

function isNegFfctArch(archetype: SkillDef['archetype']): boolean {
  return Boolean(getNegFfctCm(archetype))
}

function applyFormulaToFinalPlane(
  state: RotationExec,
  lane: number,
  skill: SkillDef,
): Float64Array {
  syncNumericTeam(state.numericTeam)
  const output = state.formulaFinalScratch
  const sourceOffset = lane * NUMERIC_FINAL_CELL_COUNT
  output.set(state.numericTeam.finals.subarray(sourceOffset, sourceOffset + NUMERIC_FINAL_CELL_COUNT))
  const formula = materializeFormulaStats(state)
  output[finalCoreCell('atk', 'final')]! +=
    output[finalCoreCell('atk', 'base')]! * ((formula.atkPercent ?? 0) / 100) + (formula.atkFlat ?? 0)
  output[finalCoreCell('hp', 'final')]! +=
    output[finalCoreCell('hp', 'base')]! * ((formula.hpPercent ?? 0) / 100) + (formula.hpFlat ?? 0)
  output[finalCoreCell('def', 'final')]! +=
    output[finalCoreCell('def', 'base')]! * ((formula.defPercent ?? 0) / 100) + (formula.defFlat ?? 0)
  output[finalTopCell('energyRegen')]! += formula.energyRegen ?? 0
  output[finalTopCell('healingBonus')]! += formula.healingBonus ?? 0
  output[finalTopCell('shieldBonus')]! += formula.shieldBonus ?? 0
  output[finalTopCell('amplify')]! += formula.dmgAmp ?? 0
  output[finalTopCell('dmgVuln')]! += formula.dmgVuln ?? 0
  output[finalTopCell('tuneBreakBoost')]! += formula.tuneBreakBoost ?? 0
  output[finalTopCell('finalDmg')]! += formula.finalDmg ?? 0
  output[finalTopCell('flatDmg')]! += formula.flatDmg ?? 0
  output[finalAttributeCell('all', 'resShred')]! += formula.resIgnore ?? 0

  if (skill.archetype === 'skillDamage') {
    output[finalTopCell('critRate')]! += formula.critRate ?? 0
    output[finalTopCell('critDmg')]! += formula.critDmg ?? 0
    output[finalTopCell('dmgBonus')]! += formula.dmgBonus ?? 0
  } else if (skill.archetype === 'tuneRupture' || skill.archetype === 'hack') {
    output[finalSkillTypeCell(skill.archetype, 'dmgBonus')]! += formula.dmgBonus ?? 0
  } else if (isNegFfctArch(skill.archetype)) {
    output[finalTopCell('defShred')]! += formula.defIgnore ?? 0
    const seen = new Set<SkillDef['skillType'][number]>()
    for (const skillType of skill.skillType) {
      if (skillType === 'all' || seen.has(skillType)) continue
      seen.add(skillType)
      output[finalSkillTypeCell(skillType, 'dmgBonus')]! += formula.dmgBonus ?? 0
    }
  }
  if (!isNegFfctArch(skill.archetype)) {
    output[finalTopCell('defIgnore')]! += formula.defIgnore ?? 0
  }
  return output
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
  if (state.activeEnemyCache.version === state.overlay.combatVersion) {
    return state.activeEnemyCache.value
  }

  let nextEnemy = state.environment.enemy
  for (const [path, value] of entries) {
    nextEnemy = writeBjctPat(
      nextEnemy as unknown as Record<string, unknown>,
      path.split('.'),
      value,
    ) as unknown as EnemyProfile
  }
  state.activeEnemyCache = { version: state.overlay.combatVersion, value: nextEnemy }
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
  if (cached?.version === state.overlay.runtimeVersion) {
    return cached.runtime
  }

  const baseRuntime = getBaseGraph(state).participants[slotId]?.runtime
  if (!baseRuntime) {
    return null
  }

  let nextRuntime = baseRuntime
  state.metrics.runtimeMaterializations += 1
  const runtimePaths = state.overlay.rtPthsByRejq[resonatorId] ?? {}
  for (const [path, value] of Object.entries(runtimePaths)) {
    nextRuntime = writeRtPath(nextRuntime, path, value)
  }

  state.rslvRtCch[resonatorId] = {
    version: state.overlay.runtimeVersion,
    runtime: nextRuntime,
  }

  return nextRuntime
}

const resolvedRuntimeMapCache = new WeakMap<
  RotationExec,
  { runtimeVersion: number; combatVersion: number; runtimesById: Record<string, ResRuntime> }
>()

function getRslvRtLkp(state: RotationExec): Record<string, ResRuntime> {
  const cached = resolvedRuntimeMapCache.get(state)
  if (
    cached?.runtimeVersion === state.overlay.runtimeVersion
    && cached.combatVersion === state.overlay.combatVersion
  ) return cached.runtimesById

  const runtimesById = Object.fromEntries(
    Object.values(getBaseGraph(state).participants).flatMap((participant) => {
      const runtime = getRslvPartR(state, participant.resonatorId)
      return runtime ? [[participant.resonatorId, runtime]] : []
    }),
  )
  resolvedRuntimeMapCache.set(state, {
    runtimeVersion: state.overlay.runtimeVersion,
    combatVersion: state.overlay.combatVersion,
    runtimesById,
  })
  return runtimesById
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

// Materialize a full graph only for requested inspector snapshots. Calculation
// and score execution never use this compatibility path.
function getMatGrph(state: RotationExec): CombatGraph {
  if (state.overlay.combatVersion === 0) {
    return getBaseGraph(state)
  }

  if (state.mtrlGrphVrsn === state.overlay.combatVersion && state.mtrlGrph) {
    return state.mtrlGrph
  }

  const baseGraph = getBaseGraph(state)
  state.metrics.graphMaterializations += 1
  const activeSlotId = findCombatPart(baseGraph, getActResId(state)) ?? baseGraph.activeSlotId
  const previousGraph = state.mtrlGrph
  const graphSource = previousGraph ?? baseGraph
  const nextGraph: CombatGraph = {
    ...graphSource,
    activeSlotId,
    effectScalesByRuntimePath: state.overlay.effectScalesByRuntimePath,
    participants: {
      ...graphSource.participants,
    },
  }

  for (const baseParticipant of Object.values(baseGraph.participants)) {
    if (
      previousGraph
        ? !state.dirtyGraphIds.has(baseParticipant.resonatorId)
        : !hasVrlyForRe(state, baseParticipant.resonatorId)
    ) {
      continue
    }

    const rslvRt = getRslvPartR(state, baseParticipant.resonatorId)
    if (!rslvRt) {
      continue
    }

    const participant = graphSource.participants[baseParticipant.slotId] ?? baseParticipant

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

  state.mtrlGrphVrsn = state.overlay.combatVersion
  state.mtrlGrph = nextGraph
  state.dirtyGraphIds.clear()
  return nextGraph
}

function getPart(state: RotationExec, resonatorId: string): RotPartStt | null {
  const slotId = findCombatPart(getBaseGraph(state), resonatorId)
  if (!slotId) {
    return null
  }

  const graph = getBaseGraph(state)
  const participant = graph.participants[slotId]
  const seed = state.environment.seedLookup[resonatorId] ?? getResSeedBy(resonatorId)
  if (!participant || !seed) {
    return null
  }

  const runtimeWrites = state.overlay.rtPthsByRejq[resonatorId]
  const needsProjection = runtimeWrites && Object.keys(runtimeWrites).some((path) => (
    path.startsWith('runtime.base.')
    || path.startsWith('runtime.build.')
    || path.startsWith('runtime.state.manualBuffs.skill')
  ))

  return {
    seed,
    runtime: needsProjection ? getRslvPartR(state, resonatorId) ?? participant.runtime : participant.runtime,
    lane: state.numericTeam.program.laneById[resonatorId] ?? -1,
  }
}

/**
 * Resolve only the runtime/seed pair. Conditions, loop gates, and authored
 * state writes do not consume calculated combat stats, so forcing a complete
 * effect graph and combat context for them is pure overhead.
 */
function getPartRt(state: RotationExec, resonatorId: string): RotPartRt | null {
  const slotId = findCombatPart(getBaseGraph(state), resonatorId)
  if (!slotId) return null

  const runtime = getRslvPartR(state, resonatorId)
  const seed = state.environment.seedLookup[resonatorId] ?? getResSeedBy(resonatorId)
  return runtime && seed ? { runtime, seed } : null
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
  const nrmlPath = path.replace(/^runtime\./, '')
  const formulaKey = getRotFormulaStatKey(path)

  if (formulaKey) {
    const nextValue = typeof value === 'number' && Number.isFinite(value) ? value : 0
    if (Object.is(getRotFormula(state, formulaKey), nextValue)) return state

    state.formulaRegisters[ROT_FORMULA_INDEX.get(formulaKey) ?? -1] = nextValue
    if (state.mutableOverlay) {
      state.overlay.version += 1
      return state
    }
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
      },
    }
  }

  if (nrmlPath === 'rotation.activeResonatorId') {
    const activeResonatorId =
      typeof value === 'string' && findCombatPart(getBaseGraph(state), value)
        ? value
        : state.environment.prmrResId
    if (getActResId(state) === activeResonatorId) return state
    setNumericActiveLane(state.numericTeam, activeResonatorId)

    if (state.mutableOverlay) {
      state.overlay.version += 1
      state.overlay.combatVersion += 1
      state.overlay.activeResonatorId = activeResonatorId
      state.mtrlGrphVrsn = -1
      return state
    }

    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        combatVersion: state.overlay.combatVersion + 1,
        activeResonatorId,
      },
      mtrlGrphVrsn: -1,
    }
  }

  if (isEnemySttsP(path)) {
    if (Object.is(readObjectPath(getActEnemy(state), getEnemyPath(path)), value)) return state
    const enemyPath = getEnemyPath(path)
    writeNumericEnemy(state.numericTeam, enemyPath, value)
    if (state.mutableOverlay) {
      state.overlay.version += 1
      state.overlay.combatVersion += 1
      state.overlay.enemyPaths[enemyPath] = value
      state.mtrlGrphVrsn = -1
      return state
    }
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        combatVersion: state.overlay.combatVersion + 1,
        enemyPaths: {
          ...state.overlay.enemyPaths,
          [enemyPath]: value,
        },
      },
      mtrlGrphVrsn: -1,
    }
  }

  if (isEnemyCmbtP(path)) {
    // enemy combat writes are mirrored onto every participant's runtime.state.combat
    // so combat-dependent formulas can see them through runtime state as expected
    const enemyCmbtPat = getEnemyPath(path)
    const runtimePath = `runtime.state.${enemyCmbtPat}`
    const primaryRuntime = getPrmrRt(state)
    if (primaryRuntime && Object.is(readRtPath(primaryRuntime, runtimePath), value)) return state
    const nextRtPthsBy = { ...state.overlay.rtPthsByRejq }
    const writesByResonator: Record<string, RotVrlyVl> = {}

    for (const participant of Object.values(getBaseGraph(state).participants)) {
      nextRtPthsBy[participant.resonatorId] = {
        ...(nextRtPthsBy[participant.resonatorId] ?? {}),
        [runtimePath]: value,
      }
      writesByResonator[participant.resonatorId] = value
    }

    const nextRuntimeVersion = state.overlay.runtimeVersion + 1
    for (const resonatorId of Object.keys(writesByResonator)) {
      writeNumericRuntime(state.numericTeam, resonatorId, runtimePath, value)
    }

    if (state.mutableOverlay) {
      for (const resonatorId of Object.keys(writesByResonator)) {
        writeMutableNested(state.overlay.rtPthsByRejq, resonatorId, runtimePath, value)
        state.dirtyGraphIds.add(resonatorId)
      }
      state.overlay.version += 1
      state.overlay.runtimeVersion += 1
      state.overlay.combatVersion += 1
      state.rslvRtCch = {}
      state.mtrlGrphVrsn = -1
      return state
    }

    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        runtimeVersion: nextRuntimeVersion,
        combatVersion: state.overlay.combatVersion + 1,
        rtPthsByRejq: nextRtPthsBy,
      },
      rslvRtCch: {},
      mtrlGrphVrsn: -1,
      dirtyGraphIds: new Set([
        ...state.dirtyGraphIds,
        ...Object.keys(writesByResonator),
      ]),
    }
  }

  const writesRuntime =
    nrmlPath.startsWith('state.controls.') ||
    nrmlPath.startsWith('state.manualBuffs.') ||
    nrmlPath.startsWith('state.combat.') ||
    nrmlPath.startsWith('base.') ||
    nrmlPath.startsWith('build.weapon.') ||
    nrmlPath.startsWith('build.echoes.')

  if (writesRuntime) {
    const runtimePath = `runtime.${nrmlPath}`
    const currentRegister = readNumericRuntime(state.numericTeam, resonatorId, runtimePath)
    if (currentRegister.found && Object.is(currentRegister.value, value)) return state
    const nextRuntimeVersion = state.overlay.runtimeVersion + 1
    writeNumericRuntime(state.numericTeam, resonatorId, runtimePath, value)
    if (state.mutableOverlay) {
      writeMutableNested(state.overlay.rtPthsByRejq, resonatorId, runtimePath, value)
      state.overlay.version += 1
      state.overlay.runtimeVersion = nextRuntimeVersion
      state.overlay.combatVersion += 1
      state.rslvRtCch = {}
      state.mtrlGrphVrsn = -1
      state.dirtyGraphIds.add(resonatorId)
      return state
    }
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        runtimeVersion: nextRuntimeVersion,
        combatVersion: state.overlay.combatVersion + 1,
        rtPthsByRejq: {
          ...state.overlay.rtPthsByRejq,
          [resonatorId]: {
            ...(state.overlay.rtPthsByRejq[resonatorId] ?? {}),
            [runtimePath]: value,
          },
        },
      },
      rslvRtCch: {},
      mtrlGrphVrsn: -1,
      dirtyGraphIds: new Set(state.dirtyGraphIds).add(resonatorId),
    }
  }

  if (nrmlPath.startsWith('routing.selectedTargetsByOwnerKey.')) {
    const ownerKey = nrmlPath.slice('routing.selectedTargetsByOwnerKey.'.length)
    writeNumericRoute(
      state.numericTeam,
      resonatorId,
      ownerKey,
      typeof value === 'string' ? value : null,
    )
    const routingPath = nrmlPath.replace(/^routing\./, '')
    if (state.mutableOverlay) {
      writeMutableNested(state.overlay.routingPaths, resonatorId, routingPath, value)
      state.overlay.version += 1
      state.overlay.combatVersion += 1
      state.mtrlGrphVrsn = -1
      state.dirtyGraphIds.add(resonatorId)
      return state
    }
    return {
      ...state,
      overlay: {
        ...state.overlay,
        version: state.overlay.version + 1,
        combatVersion: state.overlay.combatVersion + 1,
        routingPaths: {
          ...state.overlay.routingPaths,
          [resonatorId]: {
            ...(state.overlay.routingPaths[resonatorId] ?? {}),
            [routingPath]: value,
          },
        },
      },
      mtrlGrphVrsn: -1,
      dirtyGraphIds: new Set(state.dirtyGraphIds).add(resonatorId),
    }
  }

  throw new Error(`Unsupported rotation runtime change path: ${path}`)
}

interface NumericStateBounds {
  min?: number
  max?: number
}

function boundsForStateDefinition(
  state: RotationExec,
  definition: SourceState | undefined,
  resonatorId: string,
  resolvedParticipant?: RotPartRt,
): NumericStateBounds | null {
  if (!definition || (definition.kind !== 'stack' && definition.kind !== 'number')) {
    return null
  }

  const min = definition.kind === 'stack' ? definition.min ?? 0 : definition.min
  if (!definition.maxWhen?.length) {
    return {
      min,
      max: definition.max,
    }
  }

  const participant = resolvedParticipant ?? getPartRt(state, resonatorId)
  if (!participant) {
    return null
  }

  const activeRuntime = getActResId(state) === resonatorId
    ? participant.runtime
    : getActRt(state) ?? participant.runtime
  return {
    min,
    max: getSrcNumMax(
      participant.runtime,
      participant.runtime,
      definition,
      activeRuntime,
    ),
  }
}

function enemyChangeBounds(
  state: RotationExec,
  path: string,
  resonatorId: string,
): NumericStateBounds | null {
  const enemyPath = getEnemyPath(path)
  const primaryRuntime = getPrmrRt(state)

  if (primaryRuntime && enemyPath === 'status.tuneStrain') {
    return {
      min: 0,
      max: getTuneStrainMaxForTeam(primaryRuntime),
    }
  }

  if (primaryRuntime && enemyPath.startsWith('combat.')) {
    const key = enemyPath.slice('combat.'.length)
    const negativeEffect = negEffectsFor(primaryRuntime, getRslvRtLkp(state))
      .find((entry) => entry.key === key)
    if (negativeEffect) {
      return {
        min: 0,
        max: negativeEffect.max,
      }
    }
  }

  return boundsForStateDefinition(
    state,
    state.environment.enemyStateDefs[enemyStatePathKey(path)],
    resonatorId,
  )
}

function clampAuthoredStateValue(
  state: RotationExec,
  path: string,
  resonatorId: string,
  value: string | number | boolean,
  resolvedParticipant?: RotPartRt,
): string | number | boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return value
  }

  const bounds = isEnemySttsP(path) || isEnemyCmbtP(path)
    ? enemyChangeBounds(state, path, resonatorId)
    : boundsForStateDefinition(
        state,
        state.environment.stateDefsByResonator[resonatorId]?.[runtimeStatePathKey(path)],
        resonatorId,
        resolvedParticipant,
      )

  if (!bounds) {
    return value
  }

  const aboveMin = bounds.min == null ? value : Math.max(value, bounds.min)
  return bounds.max == null ? aboveMin : Math.min(aboveMin, bounds.max)
}

function normalizeAuthoredSelectWrite(
  state: RotationExec,
  path: string,
  resonatorId: string,
  value: string | number | boolean | undefined,
): string | number | boolean {
  const definition = state.environment.stateDefsByResonator[resonatorId]?.[
    runtimeStatePathKey(path)
  ]
  if (definition?.kind !== 'select') {
    return value ?? ''
  }

  const normalized = value === '' || value === undefined
    ? definition.defaultValue
    : value
  if (normalized === undefined) {
    return ''
  }

  const optionIds = [
    ...(definition.options ?? []),
    ...(definition.optionsWhen ?? []).flatMap((entry) => entry.options),
  ].map((option) => option.id)
  const numericOptions = optionIds.length > 0 && optionIds.every((id) => (
    id.trim() !== '' && Number.isFinite(Number(id))
  ))
  if (numericOptions && typeof normalized === 'string' && normalized.trim() !== '') {
    const numericValue = Number(normalized)
    if (optionIds.includes(normalized) && Number.isFinite(numericValue)) {
      return numericValue
    }
  }

  return normalized
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
  return applyRtWrite(
    state,
    change.type,
    change.path,
    change.value,
    change.resonatorId ?? fallbackResId,
  )
}

function applyRtWrite(
  state: RotationExec,
  type: RtChng['type'],
  path: string,
  value: string | number | boolean | undefined,
  tgtResId: string,
): RotationExec {
  const formulaKey = getRotFormulaStatKey(path)

  if (formulaKey) {
    const nextValue =
      type === 'add'
        ? getRotFormula(state, formulaKey) + Number(value ?? 0)
        : type === 'toggle'
          ? Number(value ?? true)
          : Number(value)

    return writeRotVrly(
      state,
      tgtResId,
      path,
      Number.isFinite(nextValue) ? nextValue : 0,
    )
  }

  if (isEnemySttsP(path) || isEnemyCmbtP(path)) {
    let nextValue: string | number | boolean

    if (type === 'set') {
      nextValue = value as string | number | boolean
    } else if (type === 'toggle') {
      nextValue = value ?? true
    } else {
      const prmrRt = getPrmrRt(state)
      const current = isEnemySttsP(path)
        ? Number(readObjectPath(getActEnemy(state), getEnemyPath(path)))
        : prmrRt
          ? Number(readRtPath(prmrRt, `runtime.state.${getEnemyPath(path)}`))
          : 0
      nextValue = (Number.isFinite(current) ? current : 0) + Number(value ?? 0)
    }

    nextValue = clampAuthoredStateValue(state, path, tgtResId, nextValue)
    return writeRotVrly(state, tgtResId, path, nextValue)
  }

  const lane = state.numericTeam.program.laneById[tgtResId]
  if (lane === undefined) {
    return state
  }

  let nextValue: string | number | boolean
  if (type === 'set') {
    nextValue = value as string | number | boolean
  } else if (type === 'toggle') {
    nextValue = value ?? true
  } else {
    const numeric = readNumericRuntime(state.numericTeam, tgtResId, path)
    const fallbackRuntime = numeric.found ? null : getPartRt(state, tgtResId)?.runtime
    const current = Number(numeric.found
      ? numeric.value
      : fallbackRuntime
        ? readRtPath(fallbackRuntime, path)
        : 0)
    nextValue = (Number.isFinite(current) ? current : 0) + Number(value ?? 0)
  }

  nextValue = normalizeAuthoredSelectWrite(state, path, tgtResId, nextValue)
  nextValue = clampAuthoredStateValue(
    state,
    path,
    tgtResId,
    nextValue,
    undefined,
  )
  return writeRotVrly(state, tgtResId, path, nextValue)
}

// detect whether a runtime change explicitly targets the combat key that stores
// a negative-effect stack count. if so, node-level stack override should not
// override that explicit change
function chngTrgtNegF(
  change: RtChng,
  combatKey: string,
  changedResonatorId: string,
  featureResonatorId: string,
): boolean {
  const nrmlPath = change.path.replace(/^runtime\./, '')

  return (nrmlPath === `state.combat.${combatKey}` && changedResonatorId === featureResonatorId) ||
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

function scaleRtChng(
  state: RotationExec,
  change: RtChng,
  fallbackResId: string,
  scale: number | undefined,
): RtChng | null {
  if (scale === undefined || scale === 1) {
    return change
  }

  const boundedScale = Math.max(0, Math.min(1, scale))
  if (boundedScale <= 0) {
    return null
  }

  if (shldScaleRtFfctPath(change.path)) {
    return change
  }

  if (change.type === 'toggle') {
    return change
  }

  if (change.type === 'add') {
    return {
      ...change,
      value: change.value * boundedScale,
    }
  }

  if (typeof change.value !== 'number') {
    return change
  }

  if (!Number.isFinite(change.value)) {
    return null
  }

  const currentValue = Number(readRtChngVl(state, change, fallbackResId))
  const currentNumber = Number.isFinite(currentValue) ? currentValue : 0

  return {
    ...change,
    value: currentNumber + (change.value - currentNumber) * boundedScale,
  }
}

function getRuntimeEffectScalePath(path: string): string | null {
  const nrmlPath = path.replace(/^runtime\./, '')
  if (
    nrmlPath.startsWith('state.controls.') ||
    nrmlPath.startsWith('state.manualBuffs.') ||
    nrmlPath.startsWith('state.combat.') ||
    nrmlPath.startsWith('base.') ||
    nrmlPath.startsWith('build.weapon.') ||
    nrmlPath.startsWith('build.echoes.')
  ) {
    return nrmlPath
  }

  return null
}

function shldScaleRtFfctPath(path: string): boolean {
  return path.replace(/^runtime\./, '').startsWith('state.controls.')
}

function withRtEffectScale(
  state: RotationExec,
  resonatorId: string,
  path: string,
  scale: number | undefined,
): RotationExec {
  if (scale === undefined || scale >= 1) {
    return state
  }

  const runtimePath = getRuntimeEffectScalePath(path)
  if (!runtimePath) {
    return state
  }

  const boundedScale = Math.max(0, Math.min(1, scale))
  if (boundedScale <= 0) {
    return state
  }
  const currentScale = state.overlay.effectScalesByRuntimePath[resonatorId]?.[runtimePath] ?? 1
  const nextScale = Math.min(currentScale, boundedScale)
  if (Object.is(currentScale, nextScale)) return state
  writeNumericEffectScale(state.numericTeam, resonatorId, runtimePath, nextScale)

  if (state.mutableOverlay) {
    writeMutableNested(
      state.overlay.effectScalesByRuntimePath,
      resonatorId,
      runtimePath,
      nextScale,
    )
    state.overlay.version += 1
    state.overlay.combatVersion += 1
    state.mtrlGrphVrsn = -1
    return state
  }

  return {
    ...state,
    overlay: {
      ...state.overlay,
      version: state.overlay.version + 1,
      combatVersion: state.overlay.combatVersion + 1,
      effectScalesByRuntimePath: {
        ...state.overlay.effectScalesByRuntimePath,
        [resonatorId]: {
          ...(state.overlay.effectScalesByRuntimePath[resonatorId] ?? {}),
          [runtimePath]: nextScale,
        },
      },
    },
    mtrlGrphVrsn: -1,
  }
}

// read the current value addressed by a runtime change after overlays have been applied
// used mainly by inspection mode so the ui can display what a condition node changed
function readRtChngVl(
  state: RotationExec,
  change: RtChng,
  fallbackResId: string,
): string | number | boolean | undefined {
  const formulaKey = getRotFormulaStatKey(change.path)
  if (formulaKey) {
    return getRotFormula(state, formulaKey)
  }

  if (change.path.replace(/^runtime\./, '') === 'rotation.activeResonatorId') {
    return getActResId(state)
  }

  if (isEnemySttsP(change.path)) {
    return readPathValue(getActEnemy(state), getEnemyPath(change.path)) as string | number | boolean | undefined
  }

  if (isEnemyCmbtP(change.path)) {
    const prmrRt = getPrmrRt(state)
    return prmrRt
      ? readRtPath(prmrRt, `runtime.state.${getEnemyPath(change.path)}`) as string | number | boolean | undefined
      : undefined
  }

  const tgtResId = change.resonatorId ?? fallbackResId
  const numeric = readNumericRuntime(state.numericTeam, tgtResId, change.path)
  if (numeric.found) return numeric.value
  const participant = getPartRt(state, tgtResId)
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
function resolveRotationSkill(
    state: RotationExec,
    participant: RotPartStt,
    skill: SkillDef,
): SkillDef {
  const runtimesById = getRslvRtLkp(state)
  const resolved = resolveSkill(participant.runtime, skill, (condition) => {
    const numeric = evaluateNumericCondition(state.numericTeam, participant.lane, condition)
    if (numeric !== undefined) return numeric
    state.metrics.legacyConditionEvaluations += 1
    return evalCond(condition, buildScope(participant.runtime, {
        type: 'resonator',
        id: participant.seed.id,
      }))
  }, runtimesById)
  return prepareNumericSkill(
    state.numericTeam,
    participant.lane,
    resolved,
  )
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
    const feature = state.environment.catalogByResonator[prfrResId]?.featuresById[featureId]
    if (feature) {
      return { participant: preferred, feature }
    }
  }

  for (const resonatorId of Object.keys(state.environment.catalogByResonator)) {
    const feature = state.environment.catalogByResonator[resonatorId]?.featuresById[featureId]
    const participant = feature ? getPart(state, resonatorId) : null
    if (feature && participant) {
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
    multiplier: featureMultiplier(runtime, node),
  }
}

interface AppliedRotWrite {
  change: RtChng
  /** Runtime that actually received the write after feature-condition fallback. */
  resonatorId: string
}

interface RunFeatOptions {
  /**
   * Multiplies this feature's authored multiplier. Used so a parent's
   * multiplier scales each attached child feature the way a repeat multiplies
   * its body.
   */
  multiplierScale?: number
  /** Child attach runs never carry attachments of their own. */
  asAttachment?: boolean
  /**
   * Writes already applied by the parent's local attachment scope. An attached
   * negative-effect feature must see these when it decides whether its own
   * fixed stack value should apply.
   */
  preAppliedWrites?: AppliedRotWrite[]
  /** Intern-table feature id from the compiled instruction stream. */
  compiledFeatureId?: string
}

/**
 * Execute one feature node.
 *
 * Attachments (or legacy `changes`) open a local overlay scope:
 * 1. attached conditions apply first
 * 2. the parent feature evaluates under that overlay
 * 3. sibling attached features evaluate under the same overlay, with
 *    effective multiplier = parentMultiplier × childMultiplier
 * 4. only damage/inspection rows leave the scope — overlay writes do not
 *    leak to later siblings in the main list
 */
function runFeatNode(
  state: RotationExec,
  node: Extract<RotationNode, { type: 'feature' }>,
  fallbackResId: string,
  options: RunFeatOptions = {},
): RotationExec {
  const multiplierScale = options.multiplierScale ?? 1
  const asAttachment = options.asAttachment === true

  const normalized = asAttachment
    ? stripFeatureAttachments(node)
    : normalizeFeatureAttachments(node)
  const ownResId = resNodeResId(state, normalized, fallbackResId)

  const attachedConditions = asAttachment ? [] : (normalized.attached?.conditions ?? [])
  const attachedFeatures = asAttachment
    ? []
    : (normalized.attached?.features ?? []).filter(
      (feature): feature is RotFeatureNode => feature.type === 'feature',
    )
  const preAppliedWrites: AppliedRotWrite[] = [...(options.preAppliedWrites ?? [])]

  // Any attachment opens one local group. Catalog follow-up writes produced by
  // the parent or a child stay visible to later siblings in the group, but do
  // not leak into the next top-level authored node.
  const hasAttachments = attachedConditions.length > 0 || attachedFeatures.length > 0
  const numericCheckpoint = hasAttachments ? checkpointNumericTeam(state.numericTeam) : null
  const scopedBase = hasAttachments
    ? cloneRotation(state, { shareNumericTeam: true })
    : state
  let local = scopedBase

  const attachedConditionBlock = local.program?.blockByItems.get(attachedConditions)
  for (let attachedIndex = 0; attachedIndex < attachedConditions.length; attachedIndex += 1) {
    const condition = attachedConditions[attachedIndex]!
    const runItem = condition
    if (!shldRunRotNo(runItem)) {
      local = ppndNspcEnt(local, {
        nodeId: runItem.id,
        nodeType: runItem.type,
        executed: false,
      })
      continue
    }
    if (runItem.type === 'condition') {
      // The negative-effect path only needs to know about writes that actually
      // reached this local overlay. A disabled or run-gated condition must not
      // suppress a feature's explicit stack value.
      const conditionResonatorId = resNodeResId(local, runItem, ownResId)
      preAppliedWrites.push(...runItem.changes.map((change) => ({
        change,
        resonatorId: change.resonatorId ?? conditionResonatorId,
      })))
      local = runCondNode(
        local,
        runItem,
        ownResId,
        undefined,
        attachedConditionBlock,
        attachedIndex,
      )
    }
  }

  const parentMultiplier = (normalized.multiplier ?? 1) * multiplierScale

  const bodyNode: RotFeatureNode = {
    ...normalized,
    attached: undefined,
    changes: undefined,
    multiplier: parentMultiplier,
  }

  local = runFeatBody(
    local,
    bodyNode,
    ownResId,
    preAppliedWrites,
    options.compiledFeatureId,
  )

  if (!asAttachment) {
    for (const child of attachedFeatures) {
      const runItem = child
      if (!shldRunRotNo(runItem)) {
        local = ppndNspcEnt(local, {
          nodeId: runItem.id,
          nodeType: runItem.type,
          executed: false,
        })
        continue
      }
      if (runItem.type !== 'feature') {
        continue
      }
      local = runFeatNode(local, runItem, ownResId, {
        multiplierScale: parentMultiplier,
        asAttachment: true,
        preAppliedWrites,
      })
    }
  }

  if (scopedBase !== state) {
    if (numericCheckpoint) rollbackNumericTeam(numericCheckpoint)
    return mergeScopedRotRslt(state, local)
  }
  return local
}

// damage path for a single feature with no attachment handling
function runFeatBody(
  state: RotationExec,
  node: Extract<RotationNode, { type: 'feature' }>,
  fallbackResId: string,
  /** writes already applied into `state` by attached conditions */
  preAppliedWrites: AppliedRotWrite[] = [],
  compiledFeatureId?: string,
): RotationExec {
  const ownResId = resNodeResId(state, node, fallbackResId)
  const lclFeatStt = state
  const runtimesById = getRslvRtLkp(lclFeatStt)

  const featureData = findFeatOwn(lclFeatStt, compiledFeatureId ?? node.featureId, ownResId)
  if (!featureData) {
    return ppndNspcEnt(lclFeatStt, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const { participant, feature } = featureData

  const nodeState = resFeatNodeS(participant.runtime, node)
  if (!nodeState.enabled) {
    return ppndNspcEnt(lclFeatStt, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const skill = lclFeatStt.environment.catalogByResonator[participant.seed.id]?.skillsById[feature.skillId]
  if (!skill) {
    return ppndNspcEnt(lclFeatStt, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const skillResult = resolveRotationSkill(lclFeatStt, participant, skill)

  if (skillResult.visible === false) {
    return ppndNspcEnt(lclFeatStt, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const ftrdSkll = slcSkllForFe(skillResult, feature)
  const hasFormulaStats = hasRotFormulaStats(lclFeatStt)
  const formulaSkill = hasFormulaStats
    ? applyFormulaToSkill(ftrdSkll, materializeFormulaStats(lclFeatStt))
    : ftrdSkll
  const flatScoreOnly = !lclFeatStt.captureEntries && !lclFeatStt.nspcNtrs
    && Boolean(lclFeatStt.scoreValues)
  // The scalar kernel takes the node multiplier as a numeric operand. Avoid
  // cloning the skill and every hit in the score-only path.
  const scaledSkill = flatScoreOnly
    ? formulaSkill
    : scaleSkill(formulaSkill, nodeState.multiplier)
  if (participant.lane < 0) return lclFeatStt
  const formulaFinalPlane = hasFormulaStats && participant.lane >= 0
    ? applyFormulaToFinalPlane(lclFeatStt, participant.lane, scaledSkill)
    : null
  const enemy = getActEnemy(lclFeatStt)
  const effectiveStats = lclFeatStt.captureEntries || lclFeatStt.nspcNtrs
    ? resolveNumericEffectiveStats(
      lclFeatStt.numericTeam,
      participant.lane,
      formulaFinalPlane ?? lclFeatStt.numericTeam.finals,
      scaledSkill,
      enemy,
    )
    : undefined

  // negative-effect skills depend on stack count in combat state
  // this block supports:
  // - explicit node stack override
  // - attached condition writes that already modify stack state
  // - multi-instance repeated evaluation with stack decay
  const negFfctCmbtK = getNegFfctCm(scaledSkill.archetype)
  const stckFxd = scaledSkill.stackMode === 'fixedMax'
  const hasTtchNegFf = negFfctCmbtK
    ? preAppliedWrites.some(({ change, resonatorId }) =>
      chngTrgtNegF(change, negFfctCmbtK, resonatorId, participant.seed.id))
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

  // everything below reads derived stats, directly or through the kernel
  syncNumericTeam(lclFeatStt.numericTeam)
  const numericRevision = lclFeatStt.numericTeam.revision
  const cachedCombat = lclFeatStt.combatBaseByLane[participant.lane]
    ?? (lclFeatStt.combatBaseByLane[participant.lane] = {})
  const baseCmbtStt = lclFeatStt.combatBaseRevisionByLane[participant.lane] === numericRevision
    ? cachedCombat
    : materializeNumericCombat(
      lclFeatStt.numericTeam,
      participant.lane,
      participant.runtime.state.combat,
      cachedCombat,
    ) as DamageCombatState
  lclFeatStt.combatBaseRevisionByLane[participant.lane] = numericRevision
  const invocationGroup = lclFeatStt.invocationGroup.value
  lclFeatStt.invocationGroup.value += 1
  const emitInvocation = (combat: DamageCombatState): void => {
    lclFeatStt.onDamageInvocation?.({
      resonatorId: participant.seed.id,
      lane: participant.lane,
      group: invocationGroup,
      suppressWhenEmpty: Boolean(negFfctCmbtK),
      skill: formulaSkill,
      runtime: participant.runtime,
      enemy,
      level: participant.runtime.base.level,
      combat,
      finalPlane: formulaFinalPlane ?? lclFeatStt.numericTeam.finals,
      finalOffset: formulaFinalPlane ? 0 : participant.lane * NUMERIC_FINAL_CELL_COUNT,
      nodeMultiplier: nodeState.multiplier,
      weight: lclFeatStt.weight,
      loopDivisor: activeLoopDivisor(lclFeatStt),
      immunityAll: lclFeatStt.numericTeam.immunityAll[participant.lane] ?? 0,
      immunityElements: lclFeatStt.numericTeam.immunityElements[participant.lane] ?? 0,
      immunitySkillTypes: lclFeatStt.numericTeam.immunitySkillTypes[participant.lane] ?? 0,
      immunityNegative: lclFeatStt.numericTeam.immunityNegative[participant.lane] ?? 0,
    })
  }

  /*
    Score and captured execution both use the same numeric kernel. Score mode
    writes three caller-owned scalars; capture mode asks that kernel to emit
    per-hit rows and materializes objects only for inspector metadata.
  */
  if (flatScoreOnly && lclFeatStt.scoreValues) {
    lclFeatStt.environment.kernelMetrics.scalarFeatures += 1
    lclFeatStt.metrics.scalarFeatures += 1
    const scratch = lclFeatStt.damageScratch
    scratch[0] = 0
    scratch[1] = 0
    scratch[2] = 0
    const scoreInto = (
      offset: number,
      combat: DamageCombatState,
    ): void => {
      emitInvocation(combat)
      if (formulaFinalPlane) {
        calcNumericPlaneSkillDamageScoreInto(
          { values: scratch, offset },
          lclFeatStt.numericTeam,
          participant.lane,
          formulaFinalPlane,
          scaledSkill,
          enemy,
          participant.runtime.base.level,
          combat,
          nodeState.multiplier,
        )
      } else {
        calcPackedSkillDamageScoreInto(
          { values: scratch, offset },
          lclFeatStt.numericTeam,
          participant.lane,
          scaledSkill,
          enemy,
          participant.runtime.base.level,
          combat,
          nodeState.multiplier,
        )
      }
    }

    if (negFfctCmbtK) {
      const startStacks = stckFxd
        ? scaledSkill.stackMax ?? getNegFfctEn(participant.runtime, negFfctCmbtK, runtimesById)?.max
          ?? Math.max(0, Math.floor(baseCmbtStt[negFfctCmbtK] ?? 0))
        : negFfctStckV ?? Math.max(0, Math.floor(baseCmbtStt[negFfctCmbtK] ?? 0))
      const combatScratch = lclFeatStt.combatScratch
      for (const key of Object.keys(combatScratch)) {
        delete (combatScratch as Record<string, unknown>)[key]
      }
      Object.assign(combatScratch, baseCmbtStt)

      if (stckFxd) {
        combatScratch[negFfctCmbtK] = startStacks
        scoreInto(0, combatScratch)
      } else {
        let evaluated = false
        for (let instance = 0; instance < negFfctNstn; instance += 1) {
          const stackValue = startStacks - Math.floor(instance / negFfctStblW)
          if (stackValue <= 0) break
          combatScratch[negFfctCmbtK] = stackValue
          scoreInto(3, combatScratch)
          scratch[0] += scratch[3]
          scratch[1] += scratch[4]
          scratch[2] += scratch[5]
          evaluated = true
        }

        if (!evaluated) {
          combatScratch[negFfctCmbtK] = 0
          scoreInto(0, combatScratch)
        }
      }
    } else {
      scoreInto(0, baseCmbtStt)
    }

    // Empty negative-effect states are semantically absent, not zero rows.
    if (negFfctCmbtK && scratch[2] <= 0) {
      return lclFeatStt
    }

    const scoreIndex = lclFeatStt.scoreIndexById[participant.seed.id]
    if (
      scoreIndex !== undefined
      && (
        !lclFeatStt.scoreAggregationType
        || scaledSkill.aggregationType === lclFeatStt.scoreAggregationType
      )
    ) {
      const weight = lclFeatStt.weight
      const normal = scratch[0] * weight
      const crit = scratch[1] * weight
      const avg = scratch[2] * weight
      addNumericScore(lclFeatStt, scoreIndex, normal, crit, avg)
    }

    return lclFeatStt
  }

  const damageOptions = dmgOptionsFor(lclFeatStt.detail)
  const calcDetailed = (combat: DamageCombatState) => {
    emitInvocation(combat)
    return formulaFinalPlane
      ? calcNumericPlaneSkillDamage(
        lclFeatStt.numericTeam,
        participant.lane,
        formulaFinalPlane,
        scaledSkill,
        enemy,
        participant.runtime.base.level,
        combat,
        damageOptions,
      )
      : calcNumericSkillDamage(
        lclFeatStt.numericTeam,
        participant.lane,
        scaledSkill,
        enemy,
        participant.runtime.base.level,
        combat,
        damageOptions,
      )
  }

  const wghtRslt = scaleResult(
    negFfctCmbtK
      ? (() => {
        const startStacks = stckFxd
          ? scaledSkill.stackMax ?? getNegFfctEn(participant.runtime, negFfctCmbtK, runtimesById)?.max ?? Math.max(0, Math.floor(baseCmbtStt[negFfctCmbtK] ?? 0))
          : negFfctStckV ?? Math.max(0, Math.floor(baseCmbtStt[negFfctCmbtK] ?? 0))
        const stackSeries = stckFxd
          ? [startStacks]
          : mkNegFfctStc(
            startStacks,
            negFfctNstn,
            negFfctStblW,
          )

        if (stackSeries.length === 0) {
          return calcDetailed({
            ...baseCmbtStt,
            [negFfctCmbtK]: 0,
          })
        }

        return stackSeries.reduce<DamageResult | null>((total, stackValue) => {
          const nextResult = calcDetailed({
            ...baseCmbtStt,
            [negFfctCmbtK]: stackValue,
          })

          return total ? mrgDmgRslts(total, nextResult) : nextResult
        }, null) ?? calcDetailed(baseCmbtStt)
      })()
      : calcDetailed(baseCmbtStt),
    state.weight,
  )

  if (!shldNcldFeat(scaledSkill, wghtRslt)) {
    return ppndNspcEnt(lclFeatStt, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  const scoreIndex = lclFeatStt.scoreIndexById[participant.seed.id]
  if (
    lclFeatStt.scoreValues
    && scoreIndex !== undefined
    && (
      !lclFeatStt.scoreAggregationType
      || scaledSkill.aggregationType === lclFeatStt.scoreAggregationType
    )
  ) {
    addNumericScore(lclFeatStt, scoreIndex, wghtRslt.normal, wghtRslt.crit, wghtRslt.avg)
  }

  if (lclFeatStt.captureEntries) {
    lclFeatStt.metrics.capturedEntries += 1
    lclFeatStt.entries.push({
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
      effectiveStats,
      ...(Object.keys(lclFeatStt.actLoopRuns).length > 0 ? { loopRuns: { ...lclFeatStt.actLoopRuns } } : {}),
      ...(Object.keys(lclFeatStt.actLoopRunqi).length > 0 ? { loopRunCounts: { ...lclFeatStt.actLoopRunqi } } : {}),
    })
  }

  const nspcStt = ppndNspcEnt(lclFeatStt, {
    nodeId: node.id,
    nodeType: node.type,
    executed: true,
    value: {
      kind: 'feature',
      resonatorId: participant.seed.id,
      normal: wghtRslt.normal,
      crit: wghtRslt.crit,
      avg: wghtRslt.avg,
      ggrgType: scaledSkill.aggregationType,
      effectiveStats,
    },
  })

  return nspcStt
}

// execute a condition node by applying all runtime changes
// note: this node's gating is handled by shouldRunRotationNode before calling here
function runCondNode(
  state: RotationExec,
  node: Extract<RotationNode, { type: 'condition' }>,
  fallbackResId: string,
  changeScale?: number,
  compiledBlock?: CompiledRotationBlock,
  nodeIndex = -1,
): RotationExec {
  const scpResId = resNodeResId(state, node, fallbackResId)
  if (state.numericTeam.program.laneById[scpResId] === undefined) {
    return ppndNspcEnt(state, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
    })
  }

  let nextState = state
  let prmrChng: RtChng | undefined
  let prmrBefore: string | number | boolean | undefined
  const compiledStart = compiledBlock && nodeIndex >= 0
    ? compiledBlock.writeStartByIndex[nodeIndex] ?? -1
    : -1
  const compiledCount = compiledBlock && nodeIndex >= 0
    ? compiledBlock.writeCountByIndex[nodeIndex] ?? 0
    : 0
  if (changeScale === undefined && compiledBlock && compiledStart >= 0) {
    for (let offset = 0; offset < compiledCount; offset += 1) {
      const cursor = compiledStart + offset
      const path = state.program?.runtimePaths[compiledBlock.writePathIndexes[cursor] ?? -1]
      if (!path) continue
      const resonatorIndex = compiledBlock.writeResonatorIndexes[cursor] ?? -1
      const resonatorId = resonatorIndex >= 0
        ? state.program?.resonatorIds[resonatorIndex] ?? scpResId
        : scpResId
      const valueKind = compiledBlock.writeValueKinds[cursor] ?? ROT_VALUE_DEFAULT
      const value = valueKind === ROT_VALUE_NUMBER
        ? compiledBlock.writeNumericValues[cursor]
        : valueKind === ROT_VALUE_BOOLEAN
          ? compiledBlock.writeNumericValues[cursor] !== 0
          : valueKind === ROT_VALUE_STRING
            ? state.program?.stringValues[compiledBlock.writeStringIndexes[cursor] ?? -1]
            : undefined
      const writeOpcode = compiledBlock.writeOpcodes[cursor]
      const type = writeOpcode === ROT_WRITE_ADD
        ? 'add'
        : writeOpcode === ROT_WRITE_TOGGLE
          ? 'toggle'
          : 'set'
      if (!prmrChng && state.nspcNtrs) {
        prmrChng = { type, path, resonatorId, value } as RtChng
        prmrBefore = readRtChngVl(nextState, prmrChng, scpResId)
      }
      nextState = applyRtWrite(nextState, type, path, value, resonatorId)
    }
  } else for (const change of node.changes) {
    const scaleByEffect = changeScale !== undefined && shldScaleRtFfctPath(change.path)
    const scaledChange = scaleRtChng(nextState, change, scpResId, changeScale)
    if (!scaledChange) {
      continue
    }

    if (!prmrChng) {
      prmrChng = scaledChange
      prmrBefore = nextState.nspcNtrs
        ? readRtChngVl(nextState, scaledChange, scpResId)
        : undefined
    }
    nextState = applyRtChng(nextState, scaledChange, scpResId)
    if (
      changeScale !== undefined &&
      (
        scaleByEffect ||
        scaledChange.type === 'toggle' ||
        (scaledChange.type === 'set' && typeof scaledChange.value !== 'number')
      )
    ) {
      nextState = withRtEffectScale(
        nextState,
        scaledChange.resonatorId ?? scpResId,
        scaledChange.path,
        changeScale,
      )
    }
  }

  return ppndNspcEnt(nextState, {
    nodeId: node.id,
    nodeType: node.type,
    executed: true,
    ...(prmrChng
      ? {
        value: {
          kind: 'condition',
          path: prmrChng.path,
          ...(prmrBefore !== undefined ? { before: prmrBefore } : {}),
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
  compiledTimes?: number,
): RotationExec {
  const scpResId = resNodeResId(state, node, fallbackResId)
  const participant = getPartRt(state, scpResId)
  const rotRt = getPrmrRt(state)
  const actRt = getActRt(state) ?? rotRt
  if (!participant || !rotRt || !actRt) {
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
        Number.isFinite(compiledTimes) ? compiledTimes : repeatTimes(rotRt, node),
        actRt,
        participant.runtime,
        getActEnemy(state),
      ),
    ),
  )

  const hasSetup = Boolean(node.setup?.length)
  const ratio = !hasSetup || node.ratio === undefined
    ? 1
    : Math.max(
      0,
      Math.min(
        1,
        evalRotVl(
          node.ratio,
          participant.runtime,
          { type: 'resonator', id: participant.seed.id },
          uptimeRatio(rotRt, node),
          rotRt,
          participant.runtime,
          getActEnemy(state),
        ),
      ),
    )

  /* The canonical block keeps repeat, uptime and setup on one body. Retain
     the old direct repeat path when it has neither optional attribute. */
  if (hasSetup) {
    const numericCheckpoint = checkpointNumericTeam(state.numericTeam)
    let branchState = cloneRotation(state, { shareNumericTeam: true })
    branchState = runStpTms(branchState, node.setup, scpResId, ratio)
    const setupState = branchState.mutableOverlay
      ? {
        ...branchState,
        overlay: cloneMutableOverlay(branchState.overlay),
        formulaRegisters: branchState.formulaRegisters.slice(),
      }
      : branchState
    branchState = {
      ...branchState,
      weight: state.weight,
      entries: [],
      scoreValues: branchState.scoreValues ? new Float64Array(branchState.scoreValues.length) : null,
      normalizedScoreValues: branchState.normalizedScoreValues
        ? new Float64Array(branchState.normalizedScoreValues.length)
        : null,
    }
    for (let index = 0; index < times; index += 1) {
      branchState = runRotTimes(branchState, node.items, scpResId)
    }
    appendAll(state.entries, branchState.entries)
    mergeNumericScore(state, branchState)
    if (state.nspcNtrs && branchState.nspcNtrs) appendAll(state.nspcNtrs, branchState.nspcNtrs)
    rollbackNumericTeam(numericCheckpoint)
    const nextState = mergePtmBodyOverlay(state, setupState, branchState)
    return ppndNspcEnt(nextState, {
      nodeId: node.id,
      nodeType: node.type,
      executed: true,
      value: { kind: 'repeat', times },
    })
  }

  let nextState = state
  for (let index = 0; index < times; index += 1) {
    nextState = runRotTimes(nextState, node.items, scpResId)
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
// setup can mutate overlay state before an uptime body is evaluated
// for setup-only usage, branch entries are ignored and only resulting state is carried forward
function runStpTms(
  state: RotationExec,
  items: RotationNode[] | undefined,
  fallbackResId: string,
  changeScale?: number,
): RotationExec {
  if (!items?.length) {
    return state
  }

  let nextState = state
  const compiledBlock = state.program?.blockByItems.get(items)

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    if (item.type === 'note') {
      continue
    }
    const runItem = item
    if (!shldRunRotNo(runItem, compiledBlock?.flagsByIndex[index])) {
      nextState = ppndNspcEnt(nextState, {
        nodeId: runItem.id,
        nodeType: runItem.type,
        executed: false,
      })
      continue
    }

    if (runItem.type === 'loop') {
      nextState = ppndNspcEnt(nextState, {
        nodeId: runItem.id,
        nodeType: runItem.type,
        executed: true,
        ...(runItem.kind === 'start'
          ? {
            value: {
              kind: 'loop',
              markerKind: 'start',
              label: runItem.label ?? 'Loop',
              runs: Math.max(1, Math.floor(runItem.runs ?? 1)),
            } as const,
          }
          : {}),
      })
      continue
    }

    nextState = runExecutableNode(nextState, runItem, fallbackResId, {
      setup: true,
      conditionScale: changeScale,
      numericOperand: compiledBlock?.numericOperandByIndex[index],
      compiledBlock,
      nodeIndex: index,
    })
  }

  return nextState
}

type ExecutableRotationNode = Exclude<
  RotationNode,
  Extract<RotationNode, { type: 'loop' | 'note' }>
>

function runSetupUptimeNode(
  state: RotationExec,
  node: Extract<RotationNode, { type: 'uptime' }>,
  fallbackResId: string,
  changeScale?: number,
  compiledRatio?: number,
): RotationExec {
  const scpResId = resNodeResId(state, node, fallbackResId)
  const participant = getPartRt(state, scpResId)
  const prmrRt = getPrmrRt(state)
  if (!participant || !prmrRt) {
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
        Number.isFinite(compiledRatio) ? compiledRatio : uptimeRatio(prmrRt, node),
        prmrRt,
        participant.runtime,
        getActEnemy(state),
      ),
    ),
  )

  let nextState = state
  if (ratio > 0) {
    let branchState = cloneRotation(state)
    const nestedChangeScale = (changeScale ?? 1) * ratio
    branchState = runStpTms(branchState, node.setup, scpResId, nestedChangeScale)
    branchState = runStpTms(branchState, node.items, scpResId, nestedChangeScale)
    nextState = {
      ...state,
      overlay: branchState.overlay,
      numericTeam: branchState.numericTeam,
      rslvRtCch: branchState.rslvRtCch,
      mtrlGrphVrsn: branchState.mtrlGrphVrsn,
      mtrlGrph: branchState.mtrlGrph,
      dirtyGraphIds: branchState.dirtyGraphIds,
    }
  }

  return ppndNspcEnt(nextState, {
    nodeId: node.id,
    nodeType: node.type,
    executed: true,
    value: {
      kind: 'uptime',
      ratio,
    },
  })
}

// execute an uptime node by scaling numeric setup effects before running its body
// body entries are merged back into the parent, but the parent's own weight remains unchanged
function runPtmNode(
  state: RotationExec,
  node: Extract<RotationNode, { type: 'uptime' }>,
  fallbackResId: string,
  compiledRatio?: number,
): RotationExec {
  const scpResId = resNodeResId(state, node, fallbackResId)
  const participant = getPartRt(state, scpResId)
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
        Number.isFinite(compiledRatio) ? compiledRatio : uptimeRatio(rotRt, node),
        rotRt,
        participant.runtime,
        getActEnemy(state),
      ),
    ),
  )

  const numericCheckpoint = checkpointNumericTeam(state.numericTeam)
  let branchState = cloneRotation(state, { shareNumericTeam: true })
  branchState = runStpTms(branchState, node.setup, scpResId, ratio)
  const setupState = branchState.mutableOverlay
    ? {
      ...branchState,
      overlay: cloneMutableOverlay(branchState.overlay),
      formulaRegisters: branchState.formulaRegisters.slice(),
    }
    : branchState
  branchState = {
    ...branchState,
    weight: state.weight,
    entries: [],
    scoreValues: branchState.scoreValues
      ? new Float64Array(branchState.scoreValues.length)
      : null,
    normalizedScoreValues: branchState.normalizedScoreValues
      ? new Float64Array(branchState.normalizedScoreValues.length)
      : null,
  }

  const result = runRotTimes(branchState, node.items, scpResId)

  appendAll(state.entries, result.entries)
  mergeNumericScore(state, result)
  if (state.nspcNtrs && result.nspcNtrs) {
    appendAll(state.nspcNtrs, result.nspcNtrs)
  }

  rollbackNumericTeam(numericCheckpoint)
  const nextState = mergePtmBodyOverlay(state, setupState, result)

  return ppndNspcEnt(nextState, {
    nodeId: node.id,
    nodeType: node.type,
    executed: true,
    value: {
      kind: 'uptime',
      ratio,
    },
  })
}

/** Execute a non-marker node after its enabled/when gate has passed. */
function runExecutableNode(
  state: RotationExec,
  node: ExecutableRotationNode,
  fallbackResId: string,
  options: {
    setup?: boolean
    conditionScale?: number
    numericOperand?: number
    compiledBlock?: CompiledRotationBlock
    nodeIndex?: number
  } = {},
): RotationExec {
  if (node.type === 'feature') {
    return runFeatNode(state, node, fallbackResId)
  }
  if (node.type === 'condition') {
    return runCondNode(
      state,
      node,
      fallbackResId,
      options.conditionScale,
      options.compiledBlock,
      options.nodeIndex,
    )
  }
  if (node.type === 'repeat') {
    return runRptNode(state, node, fallbackResId, options.numericOperand)
  }
  return options.setup
    ? runSetupUptimeNode(state, node, fallbackResId, options.conditionScale, options.numericOperand)
    : runPtmNode(state, node, fallbackResId, options.numericOperand)
}

// find the matching loop-end node for a given loop-start node within the same items list
function findLoopEndN(
  state: RotationExec,
  items: readonly RotationNode[],
  startNode: Extract<RotationNode, { type: 'loop'; kind: 'start' }>,
  startIndex?: number,
): number | null {
  const block = state.program?.blockByItems.get(items)
  const compiledIndex = startIndex ?? items.indexOf(startNode)
  if (block && compiledIndex >= 0) {
    const endIndex = block.loopEndByIndex[compiledIndex]
    return endIndex >= 0 ? endIndex : null
  }

  const foundIndex = items.findIndex((item) =>
    item.type === 'loop' &&
    item.kind === 'end' &&
    item.loopId === startNode.loopId,
  )

  return foundIndex >= 0 ? foundIndex : null
}

// move one step forward in a circular loop item list
function getNextLoopC(items: readonly RotationNode[], index: number): number {
  return items.length > 0 ? (index + 1) % items.length : 0
}

// helper to check whether a loop boundary belongs to the given loop id
function isLoopBndrFo(
  node: RotationNode,
  loopId: string,
): boolean { return node.type === 'loop' && node.loopId === loopId }

/**
 * A loop reports where it actually finished, not where its own end marker
 * sits. A nested loop can carry the sequence past this loop's end, and the
 * caller has to resume after that rather than replay what already ran.
 */
interface RotLoopRun {
  state: RotationExec
  /** index of the last item this loop and its nested calls consumed */
  resumeIndex: number
}

interface RotLoopFrm {
  items: readonly RotationNode[]
  startIndex: number
  loopId: string
  cursor: number
  run: number
  runs: number
  fallbackResId: string
  /**
   * Loops that already ran to completion inside the current pass of this
   * frame. Reset on every new run, because a nested loop is a fresh call on
   * each pass of its parent.
   */
  finished: Set<string>
}

type RotLoopRunState = Pick<RotLoopFrm, 'loopId' | 'run' | 'runs'>

// create a loop execution frame from a loop-start node
function mkLoopFrm(
  items: readonly RotationNode[],
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
    finished: new Set(),
  }
}

// stamp the current loop-run bookkeeping into state
function setActLoopRu(state: RotationExec, frame: RotLoopRunState): RotationExec {
  const actLoopRunqi = {
    ...state.actLoopRunqi,
    [frame.loopId]: frame.runs,
  }
  return {
    ...state,
    actLoopRuns: {
      ...state.actLoopRuns,
      [frame.loopId]: frame.run,
    },
    actLoopRunqi,
    loopDivisor: mkLoopDivisor(actLoopRunqi),
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
      finished: new Set<string>(),
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
      loopDivisor: mkLoopDivisor(rmnnLoopRunC),
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
function runLoopNodeFrameStack(
  state: RotationExec,
  items: readonly RotationNode[],
  startIndex: number,
  fallbackResId: string,
): RotLoopRun {
  const initialFrame = mkLoopFrm(items, startIndex, fallbackResId)
  if (!initialFrame) {
    return { state, resumeIndex: startIndex }
  }

  let nextState = setActLoopRu(state, initialFrame)
  let stack: RotLoopFrm[] = [initialFrame]
  /*
    Every frame this walker creates is a nested loop inside the same authored
    list, so one compiled block covers them all. The identity check keeps the
    lookup honest if a frame is ever built over another list.
  */
  const compiledBlock = state.program?.blockByItems.get(items)
  const flagsAt = (frame: RotLoopFrm): number | undefined => (
    frame.items === items ? compiledBlock?.flagsByIndex[frame.cursor] : undefined
  )
  /*
    Nested frames share this items array, so the furthest index any of them
    consumed is how far the whole call reached. A nested loop whose end marker
    sits past this loop's own end takes the sequence with it, and the caller
    must resume after that rather than replaying the overshoot.
  */
  let furthest = startIndex
  /*
    A cursor is circular, so a wrap-around layout can walk onto the start
    marker of a loop that already finished. Each loop is one call per pass of
    whatever is walking it, so a finished loop's start is stepped over rather
    than started again. The record lives on the enclosing frame's pass, since
    a nested loop is a fresh call on each pass of its parent.
  */
  const closeTopFrame = () => {
    const closing = stack[stack.length - 1]
    const finished = fnshLoopFrm(nextState, stack)
    nextState = finished.state
    if (closing && finished.stack.length < stack.length) {
      finished.stack[finished.stack.length - 1]?.finished.add(closing.loopId)
    }
    stack = finished.stack
  }

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    if (!frame || frame.items.length === 0 || frame.cursor === frame.startIndex) {
      closeTopFrame()
      continue
    }

    if (frame.items === items && frame.cursor > furthest) {
      furthest = frame.cursor
    }

    const item = frame.items[frame.cursor]
    if (!item) {
      closeTopFrame()
      continue
    }

    // encountering the matching loop boundary means this run finished
    if (isLoopBndrFo(item, frame.loopId)) {
      closeTopFrame()
      continue
    }

    const runItem = item
    if (runItem.type === 'note') {
      stack = dvncTopLoopF(stack)
      continue
    }
    if (runItem.type === 'loop') {
      /*
        A loop that already ran to completion is done. Wrapping onto its start
        again is the sequence walking past it, not a second call, so step over
        it without re-entering or re-tracing.
      */
      if (runItem.kind === 'start' && frame.finished.has(runItem.loopId)) {
        stack = dvncTopLoopF(stack)
        continue
      }

      // Explicit frames retain cursor, run counter, and trace state without
      // making nested authored loops depend on JavaScript call-stack depth.
      if (!shldRunRotNo(runItem, flagsAt(frame))) {
        nextState = ppndNspcEnt(nextState, {
          nodeId: runItem.id,
          nodeType: runItem.type,
          executed: false,
        })
        stack = dvncTopLoopF(stack)
        continue
      }

      nextState = ppndNspcEnt(nextState, {
        nodeId: runItem.id,
        nodeType: runItem.type,
        executed: true,
        ...(runItem.kind === 'start'
          ? {
            value: {
              kind: 'loop',
              markerKind: 'start',
              label: runItem.label ?? 'Loop',
              runs: Math.max(1, Math.floor(runItem.runs ?? 1)),
            } as const,
          }
          : {}),
      })

      if (runItem.kind === 'start') {
        // prevent looping back into the same loop id from inside itself
        if (stckHasLoopI(stack, runItem.loopId)) {
          closeTopFrame()
          continue
        }

        const nstdStartNdx = frame.cursor
        // Nested loops that already carry lazy pass forks must run those
        // bodies, not re-walk the shared marker template.
        if (Object.keys(readPassForks(runItem)).length > 0) {
          const nested = runLoopNode(
            nextState,
            frame.items,
            nstdStartNdx,
            frame.fallbackResId,
          )
          nextState = nested.state
          frame.finished.add(runItem.loopId)
          if (nested.resumeIndex > frame.cursor) {
            stack = rplcTopLoopF(stack, {
              ...frame,
              cursor: nested.resumeIndex,
            })
          }
          stack = dvncTopLoopF(stack)
          continue
        }

        const nestedFrame = mkLoopFrm(frame.items, nstdStartNdx, frame.fallbackResId)
        /*
          A loop is a call: the nested frame owns everything up to its own end
          marker, and this frame resumes after it. Advancing only past the
          nested start would leave this cursor inside the nested body, so the
          body would run once more per enclosing pass outside the nested run
          context. A nested loop with no reachable end marker runs until it
          wraps to its own start, and this frame resumes after that start.
        */
        const nestedEnd = findLoopEndN(nextState, frame.items, runItem, frame.cursor)
        if (nestedEnd != null && nestedEnd > frame.cursor) {
          stack = rplcTopLoopF(stack, {
            ...frame,
            cursor: nestedEnd,
          })
        }
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

    if (!shldRunRotNo(runItem, flagsAt(frame))) {
      nextState = ppndNspcEnt(nextState, {
        nodeId: runItem.id,
        nodeType: runItem.type,
        executed: false,
      })
      stack = dvncTopLoopF(stack)
      continue
    }

    nextState = runExecutableNode(nextState, runItem, frame.fallbackResId)

    stack = dvncTopLoopF(stack)
  }

  return { state: nextState, resumeIndex: furthest }
}

/**
 * Loops with lazy pass forks run each resolved body as its own list. Loops
 * without forks keep the marker frame-stack walker (free/nested markers).
 */
function runLoopNode(
  state: RotationExec,
  items: readonly RotationNode[],
  startIndex: number,
  fallbackResId: string,
): RotLoopRun {
  const startNode = items[startIndex]
  if (!startNode || startNode.type !== 'loop' || startNode.kind !== 'start') {
    return { state, resumeIndex: startIndex }
  }

  const compiled = state.program?.blockByItems.get(items)?.loopsByIndex[startIndex]
  if (compiled) {
    const runs = compiled.passBlocks.length
    let nextState = state
    for (let run = 1; run <= runs; run += 1) {
      nextState = setActLoopRu(nextState, {
        loopId: startNode.loopId,
        run,
        runs,
      })
      nextState = runRotTimes(nextState, compiled.passBlocks[run - 1]!.items, fallbackResId)
    }

    const { [startNode.loopId]: _removedRun, ...rmnnLoopRuns } = nextState.actLoopRuns
    const { [startNode.loopId]: _removedCount, ...rmnnLoopRunC } = nextState.actLoopRunqi
    void _removedRun
    void _removedCount
    return {
      state: {
        ...nextState,
        actLoopRuns: rmnnLoopRuns,
        actLoopRunqi: rmnnLoopRunC,
        loopDivisor: mkLoopDivisor(rmnnLoopRunC),
      },
      resumeIndex: compiled.circular
        ? Math.max(startIndex, items.length - 1)
        : compiled.endIndex ?? startIndex,
    }
  }

  const passForks = readPassForks(startNode)
  if (Object.keys(passForks).length === 0) {
    return runLoopNodeFrameStack(state, items, startIndex, fallbackResId)
  }

  const runs = Math.max(1, Math.floor(startNode.runs ?? 1))
  const { body: template, endIndex, circular } = extractLoopExecutionBody(items, startIndex)
  let nextState = state

  for (let run = 1; run <= runs; run += 1) {
    const frame = {
      items,
      startIndex,
      loopId: startNode.loopId,
      cursor: startIndex,
      run,
      runs,
      fallbackResId,
    }
    nextState = setActLoopRu(nextState, frame)
    const body = resolveLoopPassBody(template, passForks, run)
    nextState = runRotTimes(nextState, body, fallbackResId)
  }

  const { [startNode.loopId]: _removedRun, ...rmnnLoopRuns } = nextState.actLoopRuns
  const { [startNode.loopId]: _rmvd, ...rmnnLoopRunC } = nextState.actLoopRunqi
  void _removedRun
  void _rmvd
  return {
    state: {
      ...nextState,
      actLoopRuns: rmnnLoopRuns,
      actLoopRunqi: rmnnLoopRunC,
      loopDivisor: mkLoopDivisor(rmnnLoopRunC),
    },
    // A circular loop consumes the remainder before wrapping to entries the
    // caller already passed; a forward loop resumes at its end marker.
    resumeIndex: circular ? Math.max(startIndex, items.length - 1) : endIndex ?? startIndex,
  }
}

// main rotation interpreter
// walks nodes in order and updates execution state as each node resolves
export function runRotTimes(
  state: RotationExec,
  items: readonly RotationNode[],
  fallbackResId: string = state.environment.prmrResId,
): RotationExec {
  let nextState = state
  const compiledBlock = state.program?.blockByItems.get(items)
  /*
    Each loop in this list is one call. A wrap-around layout can leave a loop's
    start marker sitting after its end, and resuming there must not start the
    same loop over.
  */
  const finishedLoops = new Set<string>()

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const opcode = compiledBlock?.opcodes[index]
    if (!item || opcode === ROT_OP_NOTE) {
      continue
    }
    if (item.type === 'note') {
      continue
    }

    const runItem = item
    if (!shldRunRotNo(runItem, compiledBlock?.flagsByIndex[index])) {
      nextState = ppndNspcEnt(nextState, {
        nodeId: runItem.id,
        nodeType: runItem.type,
        executed: false,
      })
      continue
    }

    if (runItem.type !== 'loop') {
      if (opcode === ROT_OP_FEATURE) {
        const featureIndex = compiledBlock?.featureIndexByIndex[index] ?? -1
        nextState = runFeatNode(
          nextState,
          runItem as Extract<RotationNode, { type: 'feature' }>,
          fallbackResId,
          {
            compiledFeatureId: featureIndex >= 0
              ? state.program?.featureIds[featureIndex]
              : undefined,
          },
        )
      } else if (opcode === ROT_OP_CONDITION) {
        nextState = runCondNode(
          nextState,
          runItem as Extract<RotationNode, { type: 'condition' }>,
          fallbackResId,
          undefined,
          compiledBlock,
          index,
        )
      } else if (opcode === ROT_OP_REPEAT) {
        nextState = runRptNode(
          nextState,
          runItem as Extract<RotationNode, { type: 'repeat' }>,
          fallbackResId,
          compiledBlock?.numericOperandByIndex[index],
        )
      } else if (opcode === ROT_OP_UPTIME) {
        nextState = runPtmNode(
          nextState,
          runItem as Extract<RotationNode, { type: 'uptime' }>,
          fallbackResId,
          compiledBlock?.numericOperandByIndex[index],
        )
      } else {
        nextState = runExecutableNode(nextState, runItem, fallbackResId)
      }
      continue
    }

    // a loop already run to completion is stepped over, never started again
    if (runItem.kind === 'start' && finishedLoops.has(runItem.loopId)) {
      continue
    }

    nextState = ppndNspcEnt(nextState, {
      nodeId: runItem.id,
      nodeType: runItem.type,
      executed: true,
      ...(runItem.kind === 'start'
        ? {
          value: {
            kind: 'loop',
            markerKind: 'start',
            label: runItem.label ?? 'Loop',
            runs: Math.max(1, Math.floor(runItem.runs ?? 1)),
          } as const,
        }
        : {}),
    })

    // end markers are only meaningful inside runLoopNode
    if (runItem.kind === 'end') {
      continue
    }

    const endIndex = findLoopEndN(nextState, items, runItem, index)
    const loopRun = runLoopNode(nextState, items, index, fallbackResId)
    nextState = loopRun.state
    finishedLoops.add(runItem.loopId)

    /*
      Resume after whichever came last: this loop's own end marker, or the
      furthest item a nested loop took with it. A nested loop whose end sits
      past this one's would otherwise have its tail replayed here, outside
      every loop context.
    */
    if (endIndex !== null && endIndex > index) {
      index = Math.max(endIndex, loopRun.resumeIndex)
      continue
    }

    // if there is no matching end marker, treat the rest of the list as consumed by the loop runner
    return nextState
  }

  return nextState
}

// evaluate all direct features attached to the active runtime itself
// this does not walk rotation nodes. it simply evaluates the direct feature catalog
export function directFeatureRows(
  context: CombatContext,
  seed: ResSeed,
  options: {
    detail?: RunDetail
  } = {},
): DamageFeature[] {
  const actCat = makeRuntimeCat(context.runtime, seed)
  const damageOptions = dmgOptionsFor(options.detail ?? 'full')

  return actCat.features
    .filter((feature) => feature.variant !== 'subHit')
    .map((feature) => {
      const skill = actCat.skillsById[feature.skillId]
      if (!skill) {
        return null
      }

      const skillResult = prprRtSkll(context.runtime, skill, context)
      if (skillResult.visible === false) {
        return null
      }

      const ftrdSkll = slcSkllForFe(skillResult, feature)

      const result = calcNumericSkillDamage(
        context.numericTeam,
        context.numericLane,
        ftrdSkll,
        context.enemy,
        context.runtime.base.level,
        context.runtime.state.combat,
        damageOptions,
      )
      if (!shldNcldFeat(ftrdSkll, result)) {
        return null
      }

      const entry: DamageFeature = {
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
        effectiveStats: resolveNumericEffectiveStats(
          context.numericTeam,
          context.numericLane,
          context.numericTeam.finals,
          ftrdSkll,
          context.enemy,
        ),
      }
      return entry
    })
    .filter((entry): entry is DamageFeature => entry !== null)
}

// run the full feature simulation surface:
// 1. evaluate direct features for the active runtime
// 2. execute the requested rotation program
export function runFeatureSimulation(
  context: CombatContext,
  seed: ResSeed,
  environment?: RunEnvironment,
  drctFeats?: DamageFeature[],
  options: SimulationOpts = {},
): {
  allFeatures: DamageFeature[]
  rotation: {
    sequence: { entries: DamageFeature[] }
    program: { entries: DamageFeature[] }
  }
} {
  const detail = options.detail ?? 'full'
  const allFeatures = drctFeats ?? directFeatureRows(context, seed, { detail })
  const prepNvrn = environment ?? prepareRunEnv(context, seed)
  const sequence = executeRotationProgram(
    prepNvrn,
    prepareRotationProgram(options.sequence ?? context.runtime.rotation.sequence),
    { detail },
  )
  const program = executeRotationProgram(
    prepNvrn,
    prepareRotationProgram(options.program ?? context.runtime.rotation.program),
    { detail },
  )

  return {
    allFeatures,
    rotation: {
      sequence: { entries: sequence.entries },
      program: { entries: program.entries },
    },
  }
}

// Execute one explicit rotation while retaining damage and inspection rows.
export function runDetailedRotation(
  context: CombatContext,
  seed: ResSeed,
  environment?: RunEnvironment,
  options: DetailedRunOpts = {},
): ProgramResult {
  const prepNvrn = environment ?? prepareRunEnv(context, seed)
  return executeRotationProgram(
    prepNvrn,
    prepareRotationProgram(options.items ?? context.runtime.rotation.sequence),
    {
      inspect: true,
      detail: options.detail,
      includeSnapshots: options.includeSnapshots ?? false,
    },
  )
}
