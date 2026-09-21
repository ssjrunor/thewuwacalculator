/*
  Author: Runor Ewhro
  Description: Compiles participant effects into packed numeric team state for repeated combat evaluation.
*/

/*
  Shader-like Simulation effect kernel.

  Rich runtimes and authored effect objects are consumed once by compilation.
  Evaluation thereafter uses dense participant lanes, numeric registers and
  typed instruction streams. The object-shaped Simulation context is only a
  cold materialization boundary for UI and compatibility callers.
*/

import { getGameData } from '@/data/gameData/index.ts'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { CombatGraph, SlotId } from '@/domain/entities/combatGraph.ts'
import type {
  CondExpr,
  DataSrcRef,
  EffectContext,
  EffectDef,
  EffectOp,
  EvalScpRoot,
  FormExpr,
  RotationNode,
} from '@/domain/gameData/contracts.ts'
import { getScopedTargetSelection } from '@/domain/gameData/targetRouting.ts'
import { listSrcRtFfc } from '@/data/gameData/registry.ts'
import { readRtPath } from '@/domain/gameData/runtimePath.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type {
  AttributeKey,
  ImmunitySet,
  ModBuff,
  NegEffectKey,
  ResBaseStats,
  SkillDef,
  SkillTypeKey,
  UnifiedBuffPool,
} from '@/domain/entities/stats.ts'
import { wpnAtkAt } from '@/engine/runtime/weaponState.ts'
import { makeRuntimeCat } from '@/engine/services/runtimeSourceService.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { listGraphEffectRows } from '@/engine/effects/dataEffects.ts'
import {
  NUMERIC_FINAL_CELL_COUNT,
  NUMERIC_POOL_CELL_COUNT,
  deriveFinalPlane,
  finalCoreCell,
  finalTopCell,
  packBuffPool,
  poolAttributeCell,
  poolBaseCell,
  poolFixedCell,
  poolNegativeCell,
  poolSkillTypeCell,
  poolTopCell,
  unpackBuffPool,
  unpackFinalStats,
} from '@/engine/rotation/numericLayout.ts'

const MAX_LANES = 3

const DIRECT_RUNTIME_POOL_CELL: Readonly<Record<string, number>> = {
  'state.manualBuffs.quick.atk.percent': poolBaseCell('atk', 'percent'),
  'state.manualBuffs.quick.atk.flat': poolBaseCell('atk', 'flat'),
  'state.manualBuffs.quick.hp.percent': poolBaseCell('hp', 'percent'),
  'state.manualBuffs.quick.hp.flat': poolBaseCell('hp', 'flat'),
  'state.manualBuffs.quick.def.percent': poolBaseCell('def', 'percent'),
  'state.manualBuffs.quick.def.flat': poolBaseCell('def', 'flat'),
  'state.manualBuffs.quick.critRate': poolTopCell('critRate'),
  'state.manualBuffs.quick.critDmg': poolTopCell('critDmg'),
  'state.manualBuffs.quick.energyRegen': poolTopCell('energyRegen'),
  'state.manualBuffs.quick.healingBonus': poolTopCell('healingBonus'),
}

const REF_CONST = 0
const REF_SOURCE_RUNTIME = 1
const REF_TARGET_RUNTIME = 2
const REF_ACTIVE_RUNTIME = 3
const REF_POOL = 4
const REF_FINAL = 5
const REF_SOURCE_FINAL = 6
const REF_BASE = 7
const REF_ENEMY = 8
const REF_ACTIVE_ID = 9

const FORM_CONST = 1
const FORM_READ = 2
const FORM_TABLE = 3
const FORM_ADD = 4
const FORM_MUL = 5
const FORM_CLAMP = 6

const COND_CONST = 1
const COND_NOT = 2
const COND_TRUTHY = 3
const COND_EQ = 4
const COND_NEQ = 5
const COND_GT = 6
const COND_GTE = 7
const COND_LT = 8
const COND_LTE = 9
const COND_AND = 10
const COND_OR = 11

const TARGET_SELF = 1
const TARGET_ACTIVE = 2
const TARGET_ACTIVE_OTHER = 3
const TARGET_TEAM = 4
const TARGET_OTHER = 5

const OP_ADD = 1
const OP_SET = 2
const OP_IMMUNITY = 3

const SKILL_MOD = 1
const SKILL_ADD_MULTIPLIER = 2
const SKILL_ADD_HIT = 3
const SKILL_SCALAR = 4
const SKILL_SCALE_MULTIPLIER = 5

const VALUE_UNDEFINED = 0
const VALUE_NUMBER = 1
const VALUE_BOOLEAN = 2
const VALUE_STRING = 3

interface NumericRef {
  kind: number
  index: number
  lane: number
  constant: number
}

interface NumericFormulaProgram {
  opcodes: Uint8Array
  a: Int32Array
  x: Float64Array
  y: Float64Array
  defaults: Int32Array
  refs: readonly NumericRef[]
  tables: readonly number[][]
  scaleRefs: readonly NumericRef[]
}

interface NumericConditionProgram {
  opcodes: Uint8Array
  refs: readonly NumericRef[]
  refIndexes: Int32Array
  expectedKinds: Uint8Array
  expectedValues: Float64Array
  childStarts: Int32Array
  childCounts: Int32Array
  children: Int32Array
}

interface NumericRuntimeProgram {
  sourceLane: number
  targetLane: number
  targetScope: number
  routedLane: number
  routeIndex: number
  ownerKey: string
  stage: 0 | 1 | 2
  condition: NumericConditionProgram
  opcodes: Uint8Array
  destinations: Int32Array
  formulas: readonly (NumericFormulaProgram | null)[]
  immunityMasks: Float64Array
  runtimeDependencies: readonly NumericRef[]
  readsSourceFinal: boolean
}

interface NumericSkillOperation {
  opcode: number
  destination: number
  formula: NumericFormulaProgram
  skillIds: readonly string[]
  tabs: readonly string[]
  skillTypes: readonly SkillTypeKey[]
  elements: readonly AttributeKey[]
  labelIncludes: readonly string[]
}

interface NumericSkillProgram {
  sourceLane: number
  targetLane: number
  targetScope: number
  routedLane: number
  routeIndex: number
  ownerKey: string
  condition: NumericConditionProgram
  operations: readonly NumericSkillOperation[]
}

interface CompileState {
  graph: CombatGraph
  enemy: EnemyProfile
  laneIds: string[]
  laneById: Record<string, number>
  pathIndexes: Map<string, number>
  paths: string[]
  enemyPathIndexes: Map<string, number>
  enemyPaths: string[]
  symbols: Map<string, number>
  symbolValues: string[]
}

export interface NumericTeamProgram {
  readonly laneIds: readonly string[]
  readonly slotIds: readonly SlotId[]
  readonly laneById: Readonly<Record<string, number>>
  readonly paths: readonly string[]
  readonly pathIndexByName: ReadonlyMap<string, number>
  readonly enemyPaths: readonly string[]
  readonly enemyPathIndexByName: ReadonlyMap<string, number>
  readonly combatPathIndexes: Int32Array
  readonly symbols: Map<string, number>
  readonly symbolValues: readonly string[]
  readonly programsByTarget: readonly (readonly NumericRuntimeProgram[])[]
  readonly skillProgramsByTarget: readonly (readonly NumericSkillProgram[])[]
  readonly conditionsByTarget: readonly ReadonlyMap<CondExpr, NumericConditionProgram>[]
  readonly sourceFinalTargetMasks: Uint8Array
  readonly runtimeDependencyMasks: Uint8Array
  readonly activeDependencyMask: number
  readonly enemyDependencyMask: number
  readonly routeProgramsByKey: Readonly<Record<string, readonly number[]>>
  readonly routeTargetLanes: Int8Array
  readonly routeDefaults: Int8Array
  readonly maxFormulaStack: number
}

export interface NumericTeamState {
  readonly program: NumericTeamProgram
  activeLane: number
  /*
    A write does not rebuild the buff graph; it records which lanes went stale.
    A rotation writes several states in a row before it reads anything, and
    rebuilding after each one repeats the same work for every write in the run.
  */
  dirtySources: number
  dirtyTargets: number
  /** Monotonic register revision for small compatibility projections. */
  revision: number
  readonly baseStats: Float64Array
  readonly weaponAttack: Float64Array
  readonly basePools: Float64Array
  readonly sourceFinals: Float64Array
  readonly pools: Float64Array
  readonly preFinals: Float64Array
  readonly finals: Float64Array
  readonly runtimeNumbers: Float64Array
  readonly runtimeKinds: Uint8Array
  readonly runtimeValues: Float64Array
  readonly enemyNumbers: Float64Array
  readonly enemyKinds: Uint8Array
  readonly enemyValues: Float64Array
  readonly immunityAll: Uint8Array
  readonly immunityElements: Uint32Array
  readonly immunitySkillTypes: Uint32Array
  readonly immunityNegative: Uint32Array
  readonly effectScales: Float64Array
  readonly routes: Int8Array
  readonly formulaStack: Float64Array
  readonly skillBuffScratch: Float64Array
  readonly skillScalarScratch: Float64Array
  /*
    Who moved a figure, not just by how much. The sum alone cannot say which
    buff put the Off-Tune there, and a register readout that names no source is
    a number the reader has to take on faith. Off by default: the search paths
    run the same kernel and have nothing to read it with.
  */
  traceContributions: boolean
  skillScalarTrace: SkillScalarWrite[]
  /* one list per lane, since a lane is recomputed on its own */
  buildupRateTrace: ContributionWrite[][]
  /** Delta log used only while a scoped rotation branch is open. */
  readonly transactionLog: NumericUndoEntry[]
  transactionDepth: number
}

/** One effect's contribution to a figure, as the kernel applied it. */
export interface ContributionWrite {
  ownerKey: string
  /** the lane the effect came from, which is not always the lane it landed on */
  sourceLane: number
  value: number
}

/** One effect's contribution to one skill scalar, as the kernel applied it. */
export interface SkillScalarWrite extends ContributionWrite {
  field: SkillScalarField
}

type NumericUndoEntry =
  | { kind: 'runtime'; index: number; valueKind: number; value: number; numeric: number; poolIndex: number; poolValue: number }
  | { kind: 'enemy'; index: number; valueKind: number; value: number; numeric: number }
  | { kind: 'active'; lane: number }
  | { kind: 'route'; index: number; lane: number }
  | { kind: 'scale'; index: number; value: number }

export interface NumericTeamCheckpoint {
  readonly state: NumericTeamState
  readonly logIndex: number
}

export interface NumericTeamInput {
  graph: CombatGraph
  enemy: EnemyProfile
  basePools: Partial<Record<SlotId, UnifiedBuffPool>>
  baseStats?: Partial<Record<SlotId, ResBaseStats>>
  /** Optional cold-build source filter; omitted by live Simulation execution. */
  includeEffectSource?: (source: DataSrcRef) => boolean
}

function readObjectPath(root: unknown, path: string): unknown {
  let cursor = root
  for (const part of path.split('.').filter(Boolean)) {
    if (!cursor || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}

function numericValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function internSymbol(state: CompileState, value: string): number {
  const existing = state.symbols.get(value)
  if (existing !== undefined) return existing
  const index = state.symbolValues.length
  state.symbols.set(value, index)
  state.symbolValues.push(value)
  return index
}

function encodeExact(state: CompileState, value: unknown): [number, number] {
  if (typeof value === 'number') return [VALUE_NUMBER, value]
  if (typeof value === 'boolean') return [VALUE_BOOLEAN, value ? 1 : 0]
  if (typeof value === 'string') return [VALUE_STRING, internSymbol(state, value)]
  return [VALUE_UNDEFINED, 0]
}

function encodeStateExact(program: NumericTeamProgram, value: unknown): [number, number] {
  if (typeof value === 'number') return [VALUE_NUMBER, value]
  if (typeof value === 'boolean') return [VALUE_BOOLEAN, value ? 1 : 0]
  if (typeof value === 'string') return [VALUE_STRING, program.symbols.get(value) ?? -1]
  return [VALUE_UNDEFINED, 0]
}

function normalizePath(path: string, from?: EvalScpRoot): { from: EvalScpRoot; path: string } {
  if (from) return { from, path: path.replace(/^runtime\./, '') }
  for (const root of [
    'sourceRuntime', 'sourceFinalStats', 'targetRuntime', 'activeRuntime',
    'baseStats', 'finalStats', 'pool',
  ] as const) {
    if (path.startsWith(`${root}.`)) {
      return { from: root === 'pool' ? 'pool' : root, path: path.slice(root.length + 1) }
    }
  }
  if (path.startsWith('context.pool.')) return { from: 'pool', path: path.slice(13) }
  if (path.startsWith('context.')) return { from: 'context', path: path.slice(8) }
  if (path.startsWith('runtime.')) return { from: 'sourceRuntime', path: path.slice(8) }
  return { from: 'context', path }
}

function runtimePathIndex(state: CompileState, path: string): number {
  const normalized = path.replace(/^runtime\./, '')
  const cached = state.pathIndexes.get(normalized)
  if (cached !== undefined) return cached
  const index = state.paths.length
  state.pathIndexes.set(normalized, index)
  state.paths.push(normalized)
  return index
}

function enemyPathIndex(state: CompileState, path: string): number {
  const cached = state.enemyPathIndexes.get(path)
  if (cached !== undefined) return cached
  const index = state.enemyPaths.length
  state.enemyPathIndexes.set(path, index)
  state.enemyPaths.push(path)
  return index
}

function finalCell(path: string): number {
  if (path === 'atk.base' || path === 'atk.final') return finalCoreCell('atk', path.endsWith('final') ? 'final' : 'base')
  if (path === 'hp.base' || path === 'hp.final') return finalCoreCell('hp', path.endsWith('final') ? 'final' : 'base')
  if (path === 'def.base' || path === 'def.final') return finalCoreCell('def', path.endsWith('final') ? 'final' : 'base')
  if (path === 'tbb') return finalTopCell('tuneBreakBoost')
  const top = path === 'tuneBreakBoost' ? 'tuneBreakBoost' : path
  const allowed = new Set([
    'flatDmg', 'amplify', 'critRate', 'critDmg', 'energyRegen', 'healingBonus',
    'shieldBonus', 'dmgBonus', 'defIgnore', 'defShred', 'dmgVuln',
    'offTuneBuildupRate', 'finalDmg',
  ])
  if (allowed.has(top)) return finalTopCell(top as Parameters<typeof finalTopCell>[0])
  throw new Error(`Unsupported numeric final-stat path: ${path}`)
}

function poolCell(path: string): number {
  const parts = path.split('.')
  if ((parts[0] === 'atk' || parts[0] === 'hp' || parts[0] === 'def') && (parts[1] === 'percent' || parts[1] === 'flat')) {
    return poolBaseCell(parts[0], parts[1])
  }
  if (parts[0] === 'fixedStats' && (parts[1] === 'atk' || parts[1] === 'hp' || parts[1] === 'def')) return poolFixedCell(parts[1])
  if (parts[0] === 'attribute' && parts[1] && parts[2]) return poolAttributeCell(parts[1] as 'all' | AttributeKey, parts[2] as keyof ModBuff)
  if (parts[0] === 'skillType' && parts[1] && parts[2]) return poolSkillTypeCell(parts[1] as SkillTypeKey, parts[2] as keyof ModBuff)
  if (parts[0] === 'negativeEffect' && parts[1] && parts[2]) return poolNegativeCell(parts[1] as NegEffectKey, parts[2] as 'critRate' | 'critDmg' | 'multiplier')
  return poolTopCell(path as Parameters<typeof poolTopCell>[0])
}

function baseCell(path: string): number {
  const cells: Record<string, number> = {
    atk: 0, hp: 1, def: 2, critRate: 3, critDmg: 4, energyRegen: 5,
    healingBonus: 6, tuneBreakBoost: 7,
  }
  const cell = cells[path]
  if (cell === undefined) throw new Error(`Unsupported numeric base-stat path: ${path}`)
  return cell
}

function staticContextValue(context: EffectContext, path: string): unknown {
  return readObjectPath(context, path)
}

function compileRef(
    state: CompileState,
    context: EffectContext,
    sourceLane: number,
    targetLane: number,
    path: string,
    from?: EvalScpRoot,
): NumericRef {
  const normalized = normalizePath(path, from)
  if (normalized.from === 'sourceRuntime') return { kind: REF_SOURCE_RUNTIME, index: runtimePathIndex(state, normalized.path), lane: sourceLane, constant: 0 }
  if (normalized.from === 'targetRuntime') return { kind: REF_TARGET_RUNTIME, index: runtimePathIndex(state, normalized.path), lane: targetLane, constant: 0 }
  if (normalized.from === 'activeRuntime') return { kind: REF_ACTIVE_RUNTIME, index: runtimePathIndex(state, normalized.path), lane: -1, constant: 0 }
  if (normalized.from === 'pool') return { kind: REF_POOL, index: poolCell(normalized.path), lane: targetLane, constant: 0 }
  if (normalized.from === 'finalStats') return { kind: REF_FINAL, index: finalCell(normalized.path), lane: targetLane, constant: 0 }
  if (normalized.from === 'sourceFinalStats') return { kind: REF_SOURCE_FINAL, index: finalCell(normalized.path), lane: sourceLane, constant: 0 }
  if (normalized.from === 'baseStats') return { kind: REF_BASE, index: baseCell(normalized.path), lane: targetLane, constant: 0 }
  if (normalized.from === 'context') {
    if (normalized.path === 'activeResonatorId') return { kind: REF_ACTIVE_ID, index: 0, lane: -1, constant: 0 }
    if (normalized.path.startsWith('enemy.')) return { kind: REF_ENEMY, index: enemyPathIndex(state, normalized.path.slice(6)), lane: -1, constant: 0 }
    return { kind: REF_CONST, index: 0, lane: -1, constant: numericValue(staticContextValue(context, normalized.path)) }
  }
  return { kind: REF_CONST, index: 0, lane: -1, constant: 0 }
}

function compileFormula(
    state: CompileState,
    context: EffectContext,
    sourceLane: number,
    targetLane: number,
    formula: FormExpr,
): NumericFormulaProgram {
  const opcodes: number[] = []
  const a: number[] = []
  const x: number[] = []
  const y: number[] = []
  const defaults: number[] = []
  const refs: NumericRef[] = []
  const tables: number[][] = []
  const emit = (opcode: number, av = 0, xv = 0, yv = 0): void => {
    opcodes.push(opcode); a.push(av); x.push(xv); y.push(yv); defaults.push(0)
  }
  const visit = (entry: FormExpr): void => {
    if (entry.type === 'const') { emit(FORM_CONST, 0, entry.value); return }
    if (entry.type === 'read') {
      refs.push(compileRef(state, context, sourceLane, targetLane, entry.path, entry.from))
      emit(FORM_READ, refs.length - 1, entry.default ?? 0)
      return
    }
    if (entry.type === 'table') {
      refs.push(compileRef(state, context, sourceLane, targetLane, entry.path, entry.from))
      tables.push(entry.values)
      emit(FORM_TABLE, refs.length - 1, entry.minIndex ?? 0, entry.maxIndex ?? (entry.values.length - 1 + (entry.minIndex ?? 0)))
      a[a.length - 1] = (refs.length - 1) | (tables.length - 1) << 16
      defaults[defaults.length - 1] = entry.defaultIndex ?? 0
      return
    }
    if (entry.type === 'add' || entry.type === 'mul') {
      for (const child of entry.values) visit(child)
      emit(entry.type === 'add' ? FORM_ADD : FORM_MUL, entry.values.length)
      return
    }
    visit(entry.value)
    emit(FORM_CLAMP, 0, entry.min ?? Number.NaN, entry.max ?? Number.NaN)
  }
  visit(formula)
  return {
    opcodes: Uint8Array.from(opcodes), a: Int32Array.from(a), x: Float64Array.from(x),
    y: Float64Array.from(y), defaults: Int32Array.from(defaults), refs, tables,
    scaleRefs: refs.filter((ref) => ref.kind >= REF_SOURCE_RUNTIME && ref.kind <= REF_ACTIVE_RUNTIME),
  }
}

function conditionOpcode(type: CondExpr['type']): number {
  if (type === 'always') return COND_CONST
  if (type === 'not') return COND_NOT
  if (type === 'truthy') return COND_TRUTHY
  if (type === 'eq') return COND_EQ
  if (type === 'neq') return COND_NEQ
  if (type === 'gt') return COND_GT
  if (type === 'gte') return COND_GTE
  if (type === 'lt') return COND_LT
  if (type === 'lte') return COND_LTE
  if (type === 'and') return COND_AND
  return COND_OR
}

function compileCondition(
    state: CompileState,
    context: EffectContext,
    sourceLane: number,
    targetLane: number,
    condition: CondExpr | undefined,
): NumericConditionProgram {
  const opcodes: number[] = []
  const refs: NumericRef[] = []
  const refIndexes: number[] = []
  const expectedKinds: number[] = []
  const expectedValues: number[] = []
  const childStarts: number[] = []
  const childCounts: number[] = []
  const children: number[] = []
  const visit = (entry: CondExpr): number => {
    const node = opcodes.length
    opcodes.push(conditionOpcode(entry.type)); refIndexes.push(-1); expectedKinds.push(0)
    expectedValues.push(entry.type === 'always' ? 1 : 0); childStarts.push(-1); childCounts.push(0)
    if (entry.type === 'not') {
      const child = visit(entry.value); childStarts[node] = children.length; children.push(child); childCounts[node] = 1
      return node
    }
    if (entry.type === 'and' || entry.type === 'or') {
      const indexes = entry.values.map(visit); childStarts[node] = children.length; children.push(...indexes); childCounts[node] = indexes.length
      return node
    }
    if (entry.type === 'always') return node
    const normalized = normalizePath(entry.path, entry.from)
    if (entry.type === 'includes' || (normalized.from === 'context' && normalized.path !== 'activeResonatorId' && !normalized.path.startsWith('enemy.'))) {
      const actual = staticContextValue(context, normalized.path)
      let result = false
      if (entry.type === 'includes' && Array.isArray(actual)) {
        result = actual.some((item) => (entry.itemPath ? readObjectPath(item, entry.itemPath) : item) === entry.value)
      } else if (entry.type === 'truthy') result = Boolean(actual)
      else if (entry.type === 'eq') result = actual === entry.value
      else if (entry.type === 'neq') result = actual !== entry.value
      else if (entry.type === 'gt') result = numericValue(actual) > entry.value
      else if (entry.type === 'gte') result = numericValue(actual) >= entry.value
      else if (entry.type === 'lt') result = numericValue(actual) < entry.value
      else if (entry.type === 'lte') result = numericValue(actual) <= entry.value
      opcodes[node] = COND_CONST; expectedValues[node] = result ? 1 : 0
      return node
    }
    refs.push(compileRef(state, context, sourceLane, targetLane, entry.path, entry.from))
    refIndexes[node] = refs.length - 1
    if (entry.type !== 'truthy') {
      const [kind, value] = encodeExact(state, entry.value)
      expectedKinds[node] = kind; expectedValues[node] = value
    }
    return node
  }
  visit(condition ?? { type: 'always' })
  return {
    opcodes: Uint8Array.from(opcodes), refs, refIndexes: Int32Array.from(refIndexes),
    expectedKinds: Uint8Array.from(expectedKinds), expectedValues: Float64Array.from(expectedValues),
    childStarts: Int32Array.from(childStarts), childCounts: Int32Array.from(childCounts),
    children: Int32Array.from(children),
  }
}

function targetScopeCode(effect: EffectDef): number {
  if (effect.targetScope === 'active') return TARGET_ACTIVE
  if (effect.targetScope === 'activeOther') return TARGET_ACTIVE_OTHER
  if (effect.targetScope === 'teamWide') return TARGET_TEAM
  if (effect.targetScope === 'otherTeammates') return TARGET_OTHER
  return TARGET_SELF
}

function routedLane(state: CompileState, effect: EffectDef, context: EffectContext, sourceLane: number): number {
  if (!effect.ownerKey) return -1
  const selection = getScopedTargetSelection(
    context.selectedTargetsByOwnerKey,
    context.sourceRuntime.id,
    effect.ownerKey,
  )
  if (!selection || typeof selection.value !== 'string') return -1
  const lane = state.laneById[selection.value]
  if (lane === undefined || (effect.targetScope === 'activeOther' && lane === sourceLane)) return -2
  return lane
}

function operationDestination(operation: EffectOp): number {
  if (operation.type === 'add_base_stat') return poolBaseCell(operation.stat, operation.field)
  if (operation.type === 'set_final_stat') return poolFixedCell(operation.stat)
  if (operation.type === 'add_top_stat') return poolTopCell(operation.stat)
  throw new Error(`Operation ${operation.type} does not have a scalar destination`)
}

function expandOperation(operation: EffectOp): Array<{ destination: number; value: FormExpr } | { immunity: number[] }> {
  if (operation.type === 'add_immunity') {
    const scope = operation.scope
    if (scope.target === 'all') return [{ immunity: [1, 0, 0, 0] }]
    const attrs: readonly string[] = ['aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc', 'physical']
    const skills: readonly string[] = ['all', 'basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation', 'introSkill', 'outroSkill', 'echoSkill', 'coord', 'spectroFrazzle', 'aeroErosion', 'fusionBurst', 'havocBane', 'glacioChafe', 'electroFlare', 'healing', 'shield', 'tuneRupture', 'hack']
    const negatives: readonly string[] = ['spectroFrazzle', 'aeroErosion', 'fusionBurst', 'havocBane', 'glacioChafe', 'electroFlare']
    const keys = scope.keys
    const mask = (list: readonly string[]) => keys.reduce((bits, key) => bits | (1 << Math.max(0, list.indexOf(key))), 0)
    return [{ immunity: [0, scope.target === 'element' ? mask(attrs) : 0, scope.target === 'skillType' ? mask(skills) : 0, scope.target === 'negativeEffect' ? mask(negatives) : 0] }]
  }
  if (operation.type === 'add_attribute_mod') {
    const keys = Array.isArray(operation.attribute) ? operation.attribute : [operation.attribute]
    return keys.map((key) => ({ destination: poolAttributeCell(key, operation.mod), value: operation.value }))
  }
  if (operation.type === 'add_skilltype_mod') {
    const keys = Array.isArray(operation.skillType) ? operation.skillType : [operation.skillType]
    return keys.map((key) => ({ destination: poolSkillTypeCell(key, operation.mod), value: operation.value }))
  }
  if (operation.type === 'add_negative_effect_mod') {
    const keys = Array.isArray(operation.negativeEffect) ? operation.negativeEffect : [operation.negativeEffect]
    return keys.map((key) => ({ destination: poolNegativeCell(key, operation.mod), value: operation.value }))
  }
  if (operation.type === 'add_base_stat' || operation.type === 'set_final_stat' || operation.type === 'add_top_stat') {
    return [{ destination: operationDestination(operation), value: operation.value }]
  }
  return []
}

function compileRuntimeProgram(
    state: CompileState,
    effect: EffectDef,
    context: EffectContext,
    sourceLane: number,
    targetLane: number,
    stage: 0 | 1 | 2,
    routeIndex: number,
): NumericRuntimeProgram {
  const condition = compileCondition(state, context, sourceLane, targetLane, effect.condition)
  const opcodes: number[] = []
  const destinations: number[] = []
  const formulas: Array<NumericFormulaProgram | null> = []
  const immunityMasks: number[] = []
  for (const operation of effect.operations) {
    for (const expanded of expandOperation(operation)) {
      if ('immunity' in expanded) {
        opcodes.push(OP_IMMUNITY); destinations.push(-1); formulas.push(null); immunityMasks.push(...expanded.immunity)
      } else {
        opcodes.push(operation.type === 'set_final_stat' ? OP_SET : OP_ADD)
        destinations.push(expanded.destination)
        formulas.push(compileFormula(state, context, sourceLane, targetLane, expanded.value))
        immunityMasks.push(0, 0, 0, 0)
      }
    }
  }
  const refs = [
    ...condition.refs,
    ...formulas.flatMap((formula) => formula?.refs ?? []),
  ]
  return {
    sourceLane, targetLane, targetScope: targetScopeCode(effect),
    routedLane: routedLane(state, effect, context, sourceLane), routeIndex,
    ownerKey: effect.ownerKey ?? '', stage, condition,
    opcodes: Uint8Array.from(opcodes), destinations: Int32Array.from(destinations), formulas,
    immunityMasks: Float64Array.from(immunityMasks),
    runtimeDependencies: refs.filter((ref) => ref.kind >= REF_SOURCE_RUNTIME && ref.kind <= REF_ACTIVE_RUNTIME),
    readsSourceFinal: refs.some((ref) => ref.kind === REF_SOURCE_FINAL),
  }
}

const skillModFields: readonly (keyof ModBuff)[] = [
  'resShred', 'dmgBonus', 'amplify', 'defIgnore', 'defShred', 'dmgVuln', 'critRate', 'critDmg',
]
const skillScalarFields = [
  'fixedDmg', 'offTune', 'directOffTune', 'skillHealingBonus', 'skillShieldBonus', 'tuneRuptureCritRate',
  'tuneRuptureCritDmg', 'negativeEffectCritRate', 'negativeEffectCritDmg',
] as const

export type SkillScalarField = (typeof skillScalarFields)[number]

function compileSkillProgram(
    state: CompileState,
    effect: EffectDef,
    context: EffectContext,
    sourceLane: number,
    targetLane: number,
    routeIndex: number,
): NumericSkillProgram {
  const operations: NumericSkillOperation[] = []
  for (const operation of effect.operations) {
    let opcode = 0
    let destination = 0
    if (operation.type === 'add_skill_mod') {
      opcode = SKILL_MOD; destination = skillModFields.indexOf(operation.mod)
    } else if (operation.type === 'add_skill_multiplier') opcode = SKILL_ADD_MULTIPLIER
    else if (operation.type === 'add_skill_hit_multiplier') {
      opcode = SKILL_ADD_HIT; destination = operation.hitIndex
    } else if (operation.type === 'add_skill_scalar') {
      opcode = SKILL_SCALAR; destination = skillScalarFields.indexOf(operation.field)
    } else if (operation.type === 'scale_skill_multiplier') opcode = SKILL_SCALE_MULTIPLIER
    if (!opcode || !('value' in operation)) continue
    const match = 'match' in operation ? operation.match : undefined
    operations.push({
      opcode,
      destination,
      formula: compileFormula(state, context, sourceLane, targetLane, operation.value),
      skillIds: match?.skillIds ?? [],
      tabs: match?.tabs ?? [],
      skillTypes: match?.skillTypes ?? [],
      elements: match?.elements ?? [],
      labelIncludes: match?.labelIncludes ?? [],
    })
  }
  return {
    sourceLane, targetLane, targetScope: targetScopeCode(effect),
    routedLane: routedLane(state, effect, context, sourceLane), routeIndex,
    ownerKey: effect.ownerKey ?? '',
    condition: compileCondition(state, context, sourceLane, targetLane, effect.condition),
    operations,
  }
}

function refLane(state: NumericTeamState, ref: NumericRef): number {
  return ref.kind === REF_ACTIVE_RUNTIME || ref.kind === REF_ACTIVE_ID ? state.activeLane : ref.lane
}

function readRefNumber(
    state: NumericTeamState,
    ref: NumericRef,
    sourceFinalReady: boolean,
    finalReady = true,
): number {
  const lane = refLane(state, ref)
  if (ref.kind === REF_CONST) return ref.constant
  if (ref.kind >= REF_SOURCE_RUNTIME && ref.kind <= REF_ACTIVE_RUNTIME) return state.runtimeNumbers[lane * state.program.paths.length + ref.index] ?? 0
  if (ref.kind === REF_POOL) return state.pools[lane * NUMERIC_POOL_CELL_COUNT + ref.index] ?? 0
  if (ref.kind === REF_FINAL) return finalReady ? (state.preFinals[lane * NUMERIC_FINAL_CELL_COUNT + ref.index] ?? 0) : 0
  if (ref.kind === REF_SOURCE_FINAL) return sourceFinalReady ? (state.sourceFinals[lane * NUMERIC_FINAL_CELL_COUNT + ref.index] ?? 0) : 0
  if (ref.kind === REF_BASE) return state.baseStats[lane * 8 + ref.index] ?? 0
  if (ref.kind === REF_ENEMY) return state.enemyNumbers[ref.index] ?? 0
  if (ref.kind === REF_ACTIVE_ID) return state.activeLane
  return 0
}

function refIsDefined(
    state: NumericTeamState,
    ref: NumericRef,
    sourceFinalReady: boolean,
    finalReady: boolean,
): boolean {
  const lane = refLane(state, ref)
  if (ref.kind >= REF_SOURCE_RUNTIME && ref.kind <= REF_ACTIVE_RUNTIME) {
    return (state.runtimeKinds[lane * state.program.paths.length + ref.index] ?? VALUE_UNDEFINED) !== VALUE_UNDEFINED
  }
  if (ref.kind === REF_ENEMY) return (state.enemyKinds[ref.index] ?? VALUE_UNDEFINED) !== VALUE_UNDEFINED
  if (ref.kind === REF_SOURCE_FINAL) return sourceFinalReady
  if (ref.kind === REF_FINAL) return finalReady
  return true
}

function readRefExact(state: NumericTeamState, ref: NumericRef): [number, number] {
  const lane = refLane(state, ref)
  if (ref.kind >= REF_SOURCE_RUNTIME && ref.kind <= REF_ACTIVE_RUNTIME) {
    const index = lane * state.program.paths.length + ref.index
    return [state.runtimeKinds[index] ?? 0, state.runtimeValues[index] ?? 0]
  }
  if (ref.kind === REF_ENEMY) return [state.enemyKinds[ref.index] ?? 0, state.enemyValues[ref.index] ?? 0]
  if (ref.kind === REF_ACTIVE_ID) return [VALUE_STRING, state.activeLane]
  return [VALUE_NUMBER, readRefNumber(state, ref, true)]
}

function executeFormula(
    state: NumericTeamState,
    program: NumericFormulaProgram,
    sourceFinalReady: boolean,
    finalReady = true,
): number {
  const stack = state.formulaStack
  let size = 0
  for (let pc = 0; pc < program.opcodes.length; pc += 1) {
    const opcode = program.opcodes[pc]
    if (opcode === FORM_CONST) stack[size++] = program.x[pc] ?? 0
    else if (opcode === FORM_READ) {
      const ref = program.refs[program.a[pc] ?? 0]!
      stack[size++] = refIsDefined(state, ref, sourceFinalReady, finalReady)
        ? readRefNumber(state, ref, sourceFinalReady, finalReady)
        : (program.x[pc] ?? 0)
    }
    else if (opcode === FORM_TABLE) {
      const packed = program.a[pc] ?? 0
      const ref = program.refs[packed & 0xffff]!
      const table = program.tables[(packed >>> 16) & 0xffff] ?? []
      const min = program.x[pc] ?? 0
      const raw = refIsDefined(state, ref, sourceFinalReady, finalReady)
        ? readRefNumber(state, ref, sourceFinalReady, finalReady)
        : (program.defaults[pc] ?? 0)
      const index = Math.max(min, Math.min(program.y[pc] ?? min, Math.floor(raw)))
      stack[size++] = table[index - min] ?? 0
    } else if (opcode === FORM_ADD || opcode === FORM_MUL) {
      const count = program.a[pc] ?? 0; const start = size - count
      let value = opcode === FORM_ADD ? 0 : 1
      for (let index = start; index < size; index += 1) value = opcode === FORM_ADD ? value + (stack[index] ?? 0) : value * (stack[index] ?? 0)
      size = start; stack[size++] = value
    } else if (opcode === FORM_CLAMP) {
      const index = size - 1
      if (!Number.isNaN(program.x[pc])) stack[index] = Math.max(program.x[pc]!, stack[index] ?? 0)
      if (!Number.isNaN(program.y[pc])) stack[index] = Math.min(program.y[pc]!, stack[index] ?? 0)
    }
  }
  return stack[size - 1] ?? 0
}

function executeConditionNode(state: NumericTeamState, program: NumericConditionProgram, node: number): boolean {
  const opcode = program.opcodes[node]
  if (opcode === COND_CONST) return Boolean(program.expectedValues[node])
  const start = program.childStarts[node] ?? -1
  const count = program.childCounts[node] ?? 0
  if (opcode === COND_NOT) return !executeConditionNode(state, program, program.children[start] ?? 0)
  if (opcode === COND_AND || opcode === COND_OR) {
    for (let index = 0; index < count; index += 1) {
      const value = executeConditionNode(state, program, program.children[start + index] ?? 0)
      if (opcode === COND_AND && !value) return false
      if (opcode === COND_OR && value) return true
    }
    return opcode === COND_AND
  }
  const ref = program.refs[program.refIndexes[node] ?? 0]!
  const number = readRefNumber(state, ref, true)
  if (opcode === COND_TRUTHY) return Boolean(number)
  if (opcode === COND_GT) return number > (program.expectedValues[node] ?? 0)
  if (opcode === COND_GTE) return number >= (program.expectedValues[node] ?? 0)
  if (opcode === COND_LT) return number < (program.expectedValues[node] ?? 0)
  if (opcode === COND_LTE) return number <= (program.expectedValues[node] ?? 0)
  const [kind, value] = readRefExact(state, ref)
  const equal = kind === program.expectedKinds[node] && Object.is(value, program.expectedValues[node])
  return opcode === COND_EQ ? equal : !equal
}

function refScale(state: NumericTeamState, ref: NumericRef): number {
  if (ref.kind < REF_SOURCE_RUNTIME || ref.kind > REF_ACTIVE_RUNTIME) return 1
  const lane = refLane(state, ref)
  return state.effectScales[lane * state.program.paths.length + ref.index] ?? 1
}

function conditionScale(state: NumericTeamState, program: NumericConditionProgram, node: number): number {
  const opcode = program.opcodes[node]
  if (opcode === COND_CONST || opcode === COND_NOT) return 1
  const start = program.childStarts[node] ?? -1
  const count = program.childCounts[node] ?? 0
  if (opcode === COND_AND) {
    let scale = 1
    for (let index = 0; index < count; index += 1) {
      scale = Math.min(scale, conditionScale(state, program, program.children[start + index] ?? 0))
    }
    return scale
  }
  if (opcode === COND_OR) {
    let scale = 1
    let found = false
    for (let index = 0; index < count; index += 1) {
      const child = program.children[start + index] ?? 0
      if (!executeConditionNode(state, program, child)) continue
      const childScale = conditionScale(state, program, child)
      scale = found ? Math.max(scale, childScale) : childScale
      found = true
    }
    return found ? scale : 1
  }
  return refScale(state, program.refs[program.refIndexes[node] ?? 0]!)
}

function programTargetsActive(
    state: NumericTeamState,
    program: Pick<NumericRuntimeProgram, 'targetScope' | 'sourceLane' | 'targetLane' | 'routedLane' | 'routeIndex'>,
): boolean {
  if (program.targetScope === TARGET_SELF) return program.sourceLane === program.targetLane
  if (program.targetScope === TARGET_TEAM) return true
  if (program.targetScope === TARGET_OTHER) return program.sourceLane !== program.targetLane
  const routed = state.routes[program.routeIndex] ?? program.routedLane
  if (routed === -2) return false
  const target = routed >= 0
    ? routed
    : program.targetScope === TARGET_ACTIVE_OTHER && state.activeLane === program.sourceLane
      ? (program.sourceLane === 0 && state.program.laneIds.length > 1 ? 1 : 0)
      : state.activeLane
  return target === program.targetLane && (program.targetScope !== TARGET_ACTIVE_OTHER || target !== program.sourceLane)
}

function clearImmunities(state: NumericTeamState, lane: number): void {
  state.immunityAll[lane] = 0; state.immunityElements[lane] = 0
  state.immunitySkillTypes[lane] = 0; state.immunityNegative[lane] = 0
}

/*
  The one pool cell a readout names sources for. Watching a single destination
  keeps the cost of tracing to one integer compare per write, which is what
  makes it affordable in the recompute loop at all.
*/
const RATE_POOL_CELL = poolTopCell('offTuneBuildupRate')

function executePrograms(
  state: NumericTeamState,
  lane: number,
  stage: 0 | 1 | 2,
  sourceFinalReady: boolean,
): void {
  const poolOffset = lane * NUMERIC_POOL_CELL_COUNT
  const rateTrace = state.traceContributions ? state.buildupRateTrace[lane] : undefined
  const rateCell = poolOffset + RATE_POOL_CELL
  for (const program of state.program.programsByTarget[lane] ?? []) {
    if (program.stage !== stage || !programTargetsActive(state, program)) continue
    if (!executeConditionNode(state, program.condition, 0)) continue
    const effectScale = conditionScale(state, program.condition, 0)
    for (let op = 0; op < program.opcodes.length; op += 1) {
      if (program.opcodes[op] === OP_IMMUNITY) {
        const offset = op * 4
        state.immunityAll[lane] |= program.immunityMasks[offset] ? 1 : 0
        state.immunityElements[lane] |= program.immunityMasks[offset + 1] ?? 0
        state.immunitySkillTypes[lane] |= program.immunityMasks[offset + 2] ?? 0
        state.immunityNegative[lane] |= program.immunityMasks[offset + 3] ?? 0
        continue
      }
      const formula = program.formulas[op]
      if (!formula) continue
      const destination = poolOffset + (program.destinations[op] ?? 0)
      let formulaScale = 1
      for (const ref of formula.scaleRefs) formulaScale = Math.min(formulaScale, refScale(state, ref))
      const value = executeFormula(state, formula, sourceFinalReady, stage !== 0) * Math.min(effectScale, formulaScale)
      if (rateTrace && destination === rateCell && value !== 0) {
        rateTrace.push({ ownerKey: program.ownerKey, sourceLane: program.sourceLane, value })
      }
      if (program.opcodes[op] === OP_SET) state.pools[destination] = value
      else state.pools[destination] = (state.pools[destination] ?? 0) + value
    }
  }
}

function recomputeSourceLane(state: NumericTeamState, lane: number): void {
  const poolOffset = lane * NUMERIC_POOL_CELL_COUNT
  state.pools.set(state.basePools.subarray(poolOffset, poolOffset + NUMERIC_POOL_CELL_COUNT), poolOffset)
  if (state.traceContributions) state.buildupRateTrace[lane]!.length = 0
  clearImmunities(state, lane)
  executePrograms(state, lane, 0, false)
  deriveFinalPlane(
    {
      atk: state.baseStats[lane * 8] ?? 0, hp: state.baseStats[lane * 8 + 1] ?? 0,
      def: state.baseStats[lane * 8 + 2] ?? 0, critRate: state.baseStats[lane * 8 + 3] ?? 0,
      critDmg: state.baseStats[lane * 8 + 4] ?? 0, energyRegen: state.baseStats[lane * 8 + 5] ?? 0,
      healingBonus: state.baseStats[lane * 8 + 6] ?? 0, tuneBreakBoost: state.baseStats[lane * 8 + 7] ?? 0,
    },
    state.weaponAttack[lane] ?? 0,
    state.pools.subarray(poolOffset, poolOffset + NUMERIC_POOL_CELL_COUNT),
    state.sourceFinals.subarray(lane * NUMERIC_FINAL_CELL_COUNT, (lane + 1) * NUMERIC_FINAL_CELL_COUNT),
  )
}

function recomputeTargetLane(state: NumericTeamState, lane: number): void {
  const poolOffset = lane * NUMERIC_POOL_CELL_COUNT
  state.pools.set(state.basePools.subarray(poolOffset, poolOffset + NUMERIC_POOL_CELL_COUNT), poolOffset)
  /*
    target lanes are recomputed after source lanes, so what a readout finds
    here is the pass that produced the final plane it is reading.
  */
  if (state.traceContributions) state.buildupRateTrace[lane]!.length = 0
  clearImmunities(state, lane)
  executePrograms(state, lane, 0, true)
  const base = {
    atk: state.baseStats[lane * 8] ?? 0, hp: state.baseStats[lane * 8 + 1] ?? 0,
    def: state.baseStats[lane * 8 + 2] ?? 0, critRate: state.baseStats[lane * 8 + 3] ?? 0,
    critDmg: state.baseStats[lane * 8 + 4] ?? 0, energyRegen: state.baseStats[lane * 8 + 5] ?? 0,
    healingBonus: state.baseStats[lane * 8 + 6] ?? 0, tuneBreakBoost: state.baseStats[lane * 8 + 7] ?? 0,
  }
  deriveFinalPlane(base, state.weaponAttack[lane] ?? 0,
    state.pools.subarray(poolOffset, poolOffset + NUMERIC_POOL_CELL_COUNT),
    state.preFinals.subarray(lane * NUMERIC_FINAL_CELL_COUNT, (lane + 1) * NUMERIC_FINAL_CELL_COUNT))
  executePrograms(state, lane, 1, true)
  deriveFinalPlane(base, state.weaponAttack[lane] ?? 0,
    state.pools.subarray(poolOffset, poolOffset + NUMERIC_POOL_CELL_COUNT),
    state.preFinals.subarray(lane * NUMERIC_FINAL_CELL_COUNT, (lane + 1) * NUMERIC_FINAL_CELL_COUNT))
  executePrograms(state, lane, 2, true)
  deriveFinalPlane(base, state.weaponAttack[lane] ?? 0,
    state.pools.subarray(poolOffset, poolOffset + NUMERIC_POOL_CELL_COUNT),
    state.finals.subarray(lane * NUMERIC_FINAL_CELL_COUNT, (lane + 1) * NUMERIC_FINAL_CELL_COUNT))
}

function markNumericDirty(state: NumericTeamState, sourceMask: number, targetMask: number): void {
  state.dirtySources |= sourceMask
  state.dirtyTargets |= targetMask
}

/**
 * Rebuild whatever went stale since the last read. Every path that reads a
 * derived value calls this first, so a caller never sees a half-written graph.
 */
export function syncNumericTeam(state: NumericTeamState): void {
  const sourceMask = state.dirtySources
  const targetMask = state.dirtyTargets
  if (sourceMask === 0 && targetMask === 0) return
  state.dirtySources = 0
  state.dirtyTargets = 0
  recomputeMask(state, sourceMask, targetMask)
}

function recomputeMask(state: NumericTeamState, sourceMask: number, targetMask: number): void {
  const laneCount = state.program.laneIds.length
  let expanded = targetMask
  for (let lane = 0; lane < laneCount; lane += 1) {
    if (!(sourceMask & (1 << lane))) continue
    /*
      A source plane is what a lane offers to the lanes that read it. When no
      program reads this one, deriving it is work nothing can observe, and a
      team where only the active member buffs others has more such lanes than
      not.
    */
    const consumers = state.program.sourceFinalTargetMasks[lane] ?? 0
    if (consumers === 0) continue
    recomputeSourceLane(state, lane)
    expanded |= consumers
  }
  for (let lane = 0; lane < laneCount; lane += 1) if (expanded & (1 << lane)) recomputeTargetLane(state, lane)
}

function initializeRegisters(state: NumericTeamState, graph: CombatGraph, enemy: EnemyProfile): void {
  const stride = state.program.paths.length
  for (let lane = 0; lane < state.program.laneIds.length; lane += 1) {
    const runtime = Object.values(graph.participants).find((part) => part.resonatorId === state.program.laneIds[lane])?.runtime
    if (!runtime) continue
    for (let pathIndex = 0; pathIndex < stride; pathIndex += 1) {
      writeRegister(state, lane, pathIndex, readRtPath(runtime, state.program.paths[pathIndex] ?? ''))
    }
  }
  for (let index = 0; index < state.program.enemyPaths.length; index += 1) writeEnemyRegister(state, index, readObjectPath(enemy, state.program.enemyPaths[index] ?? ''))
}

function writeRegister(state: NumericTeamState, lane: number, pathIndex: number, value: unknown): void {
  const index = lane * state.program.paths.length + pathIndex
  const [kind, encoded] = encodeStateExact(state.program, value)
  state.runtimeKinds[index] = kind; state.runtimeValues[index] = encoded; state.runtimeNumbers[index] = numericValue(value)
}

function writeEnemyRegister(state: NumericTeamState, pathIndex: number, value: unknown): void {
  const [kind, encoded] = encodeStateExact(state.program, value)
  state.enemyKinds[pathIndex] = kind; state.enemyValues[pathIndex] = encoded; state.enemyNumbers[pathIndex] = numericValue(value)
}

function compileProgram(input: NumericTeamInput): NumericTeamProgram {
  const participants = Object.values(input.graph.participants).slice(0, MAX_LANES)
  const state: CompileState = {
    graph: input.graph, enemy: input.enemy,
    laneIds: participants.map((part) => part.resonatorId),
    laneById: Object.fromEntries(participants.map((part, index) => [part.resonatorId, index])),
    pathIndexes: new Map(), paths: [], enemyPathIndexes: new Map(), enemyPaths: [],
    symbols: new Map(), symbolValues: [],
  }
  for (const id of state.laneIds) internSymbol(state, id)
  const programsByTarget: NumericRuntimeProgram[][] = participants.map(() => [])
  const skillProgramsByTarget: NumericSkillProgram[][] = participants.map(() => [])
  const conditionsByTarget: Map<CondExpr, NumericConditionProgram>[] = participants.map(() => new Map())
  const flatPrograms: NumericRuntimeProgram[] = []
  const flatSkillPrograms: NumericSkillProgram[] = []
  let routeCount = 0
  const sourceFinalTargetMasks = new Uint8Array(participants.length)
  for (let targetLane = 0; targetLane < participants.length; targetLane += 1) {
    const target = participants[targetLane]!
    const rows = listGraphEffectRows(input.graph, target.slotId)
    for (const row of rows) {
      if (input.includeEffectSource && !input.includeEffectSource(row.baseContext.source)) continue
      const sourceLane = state.laneById[row.baseContext.sourceRuntime.id]
      if (sourceLane === undefined) continue
      for (const effect of row.rtPreSttsExe) {
        const program = compileRuntimeProgram(state, effect, row.baseContext, sourceLane, targetLane, 0, routeCount++)
        programsByTarget[targetLane]!.push(program); flatPrograms.push(program)
      }
      for (const effect of row.postStatEffects) {
        const program = compileRuntimeProgram(state, effect, row.baseContext, sourceLane, targetLane, 1, routeCount++)
        programsByTarget[targetLane]!.push(program); flatPrograms.push(program)
      }
      for (const effect of row.finalStatEffects) {
        const program = compileRuntimeProgram(state, effect, row.baseContext, sourceLane, targetLane, 2, routeCount++)
        programsByTarget[targetLane]!.push(program); flatPrograms.push(program)
      }
      for (const effect of row.skillEffects) {
        const program = compileSkillProgram(state, effect, row.baseContext, sourceLane, targetLane, routeCount++)
        skillProgramsByTarget[targetLane]!.push(program); flatSkillPrograms.push(program)
      }
    }
    const scaffold = rows.find((row) =>
      row.baseContext.source.type === 'resonator' &&
      row.baseContext.sourceRuntime.id === target.resonatorId)?.baseContext ?? rows[0]?.baseContext
    if (scaffold) {
      const conditions = conditionsByTarget[targetLane]!
      const addCondition = (condition: CondExpr | undefined) => {
        if (condition && !conditions.has(condition)) {
          conditions.set(condition, compileCondition(state, scaffold, targetLane, targetLane, condition))
        }
      }
      const addSkillConditions = (skill: Partial<SkillDef>) => {
        const entries = [
          skill.visibleWhen,
          ...(skill.skillTypeWhen?.map((entry) => entry.when) ?? []),
          ...(skill.skillVariantWhen?.map((entry) => entry.when) ?? []),
        ].filter((entry): entry is CondExpr => Boolean(entry))
        for (const condition of entries) addCondition(condition)
        for (const variant of skill.skillVariantWhen ?? []) addSkillConditions(variant.patch)
      }
      const catalog = makeRuntimeCat(target.runtime, getResSeedBy(target.resonatorId))
      for (const skill of catalog.skills) addSkillConditions(skill)
      const visitRotation = (nodes: readonly RotationNode[]): void => {
        for (const node of nodes) {
          if (node.type === 'condition') {
            for (const change of node.changes) {
              const path = change.path.replace(/^runtime\./, '')
              if (
                path.startsWith('state.')
                || path.startsWith('base.')
                || path.startsWith('build.')
              ) runtimePathIndex(state, path)
            }
          } else if (node.type === 'feature') {
            visitRotation(node.attached?.conditions ?? [])
            visitRotation(node.attached?.features ?? [])
          } else if (node.type === 'repeat') {
            visitRotation(node.items)
          } else if (node.type === 'uptime') {
            visitRotation(node.setup ?? [])
            visitRotation(node.items)
          }
        }
      }
      visitRotation(target.runtime.rotation.sequence)
      visitRotation(target.runtime.rotation.program ?? [])
    }
    if (scaffold && (!input.includeEffectSource || input.includeEffectSource({ type: 'enemy', id: input.enemy.id }))) {
      const effects = listSrcRtFfc(getGameData(), { type: 'enemy', id: input.enemy.id }, 'preStats')
      const context = { ...scaffold, source: { type: 'enemy' as const, id: input.enemy.id } }
      for (const effect of effects) {
        const program = compileRuntimeProgram(state, effect, context, targetLane, targetLane, 0, routeCount++)
        programsByTarget[targetLane]!.push(program); flatPrograms.push(program)
      }
    }
  }
  for (const path of [
    'state.manualBuffs.quick.atk.percent', 'state.manualBuffs.quick.atk.flat',
    'state.manualBuffs.quick.hp.percent', 'state.manualBuffs.quick.hp.flat',
    'state.manualBuffs.quick.def.percent', 'state.manualBuffs.quick.def.flat',
    'state.manualBuffs.quick.critRate', 'state.manualBuffs.quick.critDmg',
    'state.manualBuffs.quick.energyRegen', 'state.manualBuffs.quick.healingBonus',
    'state.combat.havocBane',
  ]) runtimePathIndex(state, path)
  const stride = state.paths.length
  const combatPathIndexes = Int32Array.from(state.paths.flatMap((path, index) =>
    path.startsWith('state.combat.') ? [index] : []))
  const runtimeDependencyMasks = new Uint8Array(participants.length * stride)
  let activeDependencyMask = 0
  let enemyDependencyMask = 0
  for (const programs of programsByTarget) for (const program of programs) {
    if (program.readsSourceFinal) sourceFinalTargetMasks[program.sourceLane] |= 1 << program.targetLane
    for (const ref of [...program.condition.refs, ...program.formulas.flatMap((formula) => formula?.refs ?? [])]) {
      if (ref.kind === REF_SOURCE_RUNTIME || ref.kind === REF_TARGET_RUNTIME) runtimeDependencyMasks[ref.lane * stride + ref.index] |= 1 << program.targetLane
      else if (ref.kind === REF_ACTIVE_RUNTIME) activeDependencyMask |= 1 << program.targetLane
      else if (ref.kind === REF_ENEMY) enemyDependencyMask |= 1 << program.targetLane
    }
    if (program.targetScope === TARGET_ACTIVE || program.targetScope === TARGET_ACTIVE_OTHER) activeDependencyMask |= 1 << program.targetLane
  }
  const routeProgramsByKey: Record<string, number[]> = {}
  const allTargetPrograms = [...flatPrograms, ...flatSkillPrograms].sort((left, right) => left.routeIndex - right.routeIndex)
  for (const program of allTargetPrograms) {
    if (!program.ownerKey) continue
    const key = `${program.sourceLane}:${program.ownerKey}`
    ;(routeProgramsByKey[key] ??= []).push(program.routeIndex)
  }
  let maxFormulaStack = 1
  for (const program of flatPrograms) {
    for (const formula of program.formulas) {
      if (formula) maxFormulaStack = Math.max(maxFormulaStack, formula.opcodes.length)
    }
  }
  for (const program of flatSkillPrograms) {
    for (const operation of program.operations) {
      maxFormulaStack = Math.max(maxFormulaStack, operation.formula.opcodes.length)
    }
  }
  return {
    laneIds: state.laneIds, slotIds: participants.map((part) => part.slotId), laneById: state.laneById,
    paths: state.paths, pathIndexByName: state.pathIndexes,
    enemyPaths: state.enemyPaths, enemyPathIndexByName: state.enemyPathIndexes, symbols: state.symbols,
    combatPathIndexes,
    symbolValues: state.symbolValues, programsByTarget, skillProgramsByTarget, conditionsByTarget, sourceFinalTargetMasks,
    runtimeDependencyMasks, activeDependencyMask, enemyDependencyMask,
    routeProgramsByKey,
    routeTargetLanes: Int8Array.from(allTargetPrograms.map((entry) => entry.targetLane)),
    routeDefaults: Int8Array.from(allTargetPrograms.map((entry) => entry.routedLane)),
    maxFormulaStack,
  }
}

export function createNumericTeam(input: NumericTeamInput): NumericTeamState {
  const program = compileProgram(input)
  const laneCount = program.laneIds.length
  const poolCells = laneCount * NUMERIC_POOL_CELL_COUNT
  const finalCells = laneCount * NUMERIC_FINAL_CELL_COUNT
  const state: NumericTeamState = {
    program,
    activeLane: Math.max(0, program.slotIds.indexOf(input.graph.activeSlotId)),
    baseStats: new Float64Array(laneCount * 8), weaponAttack: new Float64Array(laneCount),
    basePools: new Float64Array(poolCells), sourceFinals: new Float64Array(finalCells),
    pools: new Float64Array(poolCells), preFinals: new Float64Array(finalCells), finals: new Float64Array(finalCells),
    runtimeNumbers: new Float64Array(laneCount * program.paths.length),
    runtimeKinds: new Uint8Array(laneCount * program.paths.length),
    runtimeValues: new Float64Array(laneCount * program.paths.length),
    enemyNumbers: new Float64Array(program.enemyPaths.length), enemyKinds: new Uint8Array(program.enemyPaths.length),
    enemyValues: new Float64Array(program.enemyPaths.length),
    immunityAll: new Uint8Array(laneCount), immunityElements: new Uint32Array(laneCount),
    immunitySkillTypes: new Uint32Array(laneCount), immunityNegative: new Uint32Array(laneCount),
    effectScales: new Float64Array(laneCount * program.paths.length).fill(1),
    routes: program.routeDefaults.slice(),
    formulaStack: new Float64Array(program.maxFormulaStack),
    skillBuffScratch: new Float64Array(skillModFields.length),
    skillScalarScratch: new Float64Array(skillScalarFields.length),
    traceContributions: false,
    skillScalarTrace: [],
    buildupRateTrace: program.laneIds.map(() => []),
    transactionLog: [],
    transactionDepth: 0,
    dirtySources: 0,
    dirtyTargets: 0,
    revision: 0,
  }
  for (let lane = 0; lane < laneCount; lane += 1) {
    const participant = input.graph.participants[program.slotIds[lane]!]
    if (!participant) continue
    const offset = lane * 8
    const base = input.baseStats?.[participant.slotId] ?? participant.baseStats
    state.baseStats.set([base.atk, base.hp, base.def, base.critRate, base.critDmg, base.energyRegen, base.healingBonus, base.tuneBreakBoost], offset)
    state.weaponAttack[lane] = wpnAtkAt(participant.runtime.build.weapon.id, participant.runtime.build.weapon.level)
    const pool = input.basePools[participant.slotId]
    if (pool) packBuffPool(pool, state.basePools.subarray(lane * NUMERIC_POOL_CELL_COUNT, (lane + 1) * NUMERIC_POOL_CELL_COUNT))
  }
  initializeRegisters(state, input.graph, input.enemy)
  for (let lane = 0; lane < laneCount; lane += 1) {
    const scales = input.graph.effectScalesByRuntimePath?.[program.laneIds[lane] ?? '']
    if (!scales) continue
    for (const [path, scale] of Object.entries(scales)) {
      const pathIndex = program.pathIndexByName.get(path.replace(/^runtime\./, '')) ?? -1
      if (pathIndex >= 0) state.effectScales[lane * program.paths.length + pathIndex] = scale
    }
  }
  const all = (1 << laneCount) - 1
  recomputeMask(state, all, all)
  return state
}

/*
  Recompute every lane so the contribution traces describe the state as it
  stands. A trace is only written while a lane is being recomputed, so a lane
  that never goes dirty during a run would otherwise have nothing to show and
  its whole figure would fall to the unattributed remainder.
*/
export function primeNumericTraces(state: NumericTeamState): void {
  const all = (1 << state.program.laneIds.length) - 1
  markNumericDirty(state, all, all)
  syncNumericTeam(state)
}

export function forkNumericTeam(source: NumericTeamState): NumericTeamState {
  syncNumericTeam(source)
  return {
    ...source,
    baseStats: source.baseStats.slice(), weaponAttack: source.weaponAttack.slice(), basePools: source.basePools.slice(),
    sourceFinals: source.sourceFinals.slice(), pools: source.pools.slice(), preFinals: source.preFinals.slice(), finals: source.finals.slice(),
    runtimeNumbers: source.runtimeNumbers.slice(), runtimeKinds: source.runtimeKinds.slice(), runtimeValues: source.runtimeValues.slice(),
    enemyNumbers: source.enemyNumbers.slice(), enemyKinds: source.enemyKinds.slice(), enemyValues: source.enemyValues.slice(),
    immunityAll: source.immunityAll.slice(), immunityElements: source.immunityElements.slice(),
    immunitySkillTypes: source.immunitySkillTypes.slice(), immunityNegative: source.immunityNegative.slice(),
    effectScales: source.effectScales.slice(),
    routes: source.routes.slice(),
    formulaStack: new Float64Array(source.program.maxFormulaStack),
    skillBuffScratch: new Float64Array(skillModFields.length),
    skillScalarScratch: new Float64Array(skillScalarFields.length),
    skillScalarTrace: [],
    buildupRateTrace: source.program.laneIds.map(() => []),
    transactionLog: [],
    transactionDepth: 0,
  }
}

/** Begin a scoped branch without copying the team's register banks. */
export function checkpointNumericTeam(state: NumericTeamState): NumericTeamCheckpoint {
  state.transactionDepth += 1
  return { state, logIndex: state.transactionLog.length }
}

/** Restore only registers written since the checkpoint and invalidate derived lanes. */
export function rollbackNumericTeam(checkpoint: NumericTeamCheckpoint): void {
  const state = checkpoint.state
  for (let index = state.transactionLog.length - 1; index >= checkpoint.logIndex; index -= 1) {
    const entry = state.transactionLog[index]!
    if (entry.kind === 'runtime') {
      state.runtimeKinds[entry.index] = entry.valueKind
      state.runtimeValues[entry.index] = entry.value
      state.runtimeNumbers[entry.index] = entry.numeric
      if (entry.poolIndex >= 0) state.basePools[entry.poolIndex] = entry.poolValue
    } else if (entry.kind === 'enemy') {
      state.enemyKinds[entry.index] = entry.valueKind
      state.enemyValues[entry.index] = entry.value
      state.enemyNumbers[entry.index] = entry.numeric
    } else if (entry.kind === 'active') {
      state.activeLane = entry.lane
    } else if (entry.kind === 'route') {
      state.routes[entry.index] = entry.lane
    } else {
      state.effectScales[entry.index] = entry.value
    }
  }
  state.transactionLog.length = checkpoint.logIndex
  state.transactionDepth = Math.max(0, state.transactionDepth - 1)
  state.revision += 1
  const all = (1 << state.program.laneIds.length) - 1
  // A temporary branch may have synchronized derived planes. Re-deriving once
  // from restored registers is cheaper than snapshotting every derived array.
  markNumericDirty(state, all, all)
}

export function writeNumericRuntime(state: NumericTeamState, resonatorId: string, path: string, value: unknown): number {
  const lane = state.program.laneById[resonatorId]
  const normalized = path.replace(/^runtime\./, '')
  const pathIndex = state.program.pathIndexByName.get(normalized) ?? -1
  if (lane === undefined || pathIndex < 0) return 0
  const register = lane * state.program.paths.length + pathIndex
  const previous = state.runtimeNumbers[register] ?? 0
  const next = numericValue(value)
  const [nextKind, nextEncoded] = encodeStateExact(state.program, value)
  if (
    state.runtimeKinds[register] === nextKind
    && Object.is(state.runtimeValues[register], nextEncoded)
  ) return 0
  const directCell = DIRECT_RUNTIME_POOL_CELL[normalized]
  let poolIndex = -1
  let poolValue = 0
  if (directCell !== undefined) {
    const cell = lane * NUMERIC_POOL_CELL_COUNT + directCell
    poolIndex = cell
    poolValue = state.basePools[cell] ?? 0
    state.basePools[cell] = (state.basePools[cell] ?? 0) + next - previous
  } else if (normalized === 'state.combat.havocBane') {
    const cell = lane * NUMERIC_POOL_CELL_COUNT + poolTopCell('defShred')
    poolIndex = cell
    poolValue = state.basePools[cell] ?? 0
    state.basePools[cell] = (state.basePools[cell] ?? 0) + (next - previous) * 2
  }
  if (state.transactionDepth > 0) {
    state.transactionLog.push({
      kind: 'runtime',
      index: register,
      valueKind: state.runtimeKinds[register] ?? VALUE_UNDEFINED,
      value: state.runtimeValues[register] ?? 0,
      numeric: previous,
      poolIndex,
      poolValue,
    })
  }
  writeRegister(state, lane, pathIndex, value)
  state.revision += 1
  const targetMask = state.program.runtimeDependencyMasks[lane * state.program.paths.length + pathIndex] ?? 0
  markNumericDirty(state, (1 << lane), targetMask | (1 << lane))
  return targetMask | (1 << lane)
}

export interface NumericRegisterRead {
  found: boolean
  value: string | number | boolean | undefined
}

/** Read one tagged runtime register without projecting a ResRuntime object. */
export function readNumericRuntime(
    state: NumericTeamState,
    resonatorId: string,
    path: string,
): NumericRegisterRead {
  const lane = state.program.laneById[resonatorId]
  const pathIndex = state.program.pathIndexByName.get(path.replace(/^runtime\./, ''))
  if (lane === undefined || pathIndex === undefined) return { found: false, value: undefined }
  const index = lane * state.program.paths.length + pathIndex
  const kind = state.runtimeKinds[index] ?? VALUE_UNDEFINED
  const encoded = state.runtimeValues[index] ?? 0
  if (kind === VALUE_NUMBER) return { found: true, value: encoded }
  if (kind === VALUE_BOOLEAN) return { found: true, value: encoded !== 0 }
  if (kind === VALUE_STRING) return { found: true, value: state.program.symbolValues[encoded] }
  return { found: true, value: undefined }
}

/** Project only the small combat register group needed by damage formulas. */
export function materializeNumericCombat(
    state: NumericTeamState,
    lane: number,
    base: object,
    output: object,
): Record<string, number | boolean | undefined> {
  const target = output as Record<string, number | boolean | undefined>
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, base)
  const stride = state.program.paths.length
  for (const pathIndex of state.program.combatPathIndexes) {
    const path = state.program.paths[pathIndex]
    if (!path) continue
    const index = lane * stride + pathIndex
    const kind = state.runtimeKinds[index] ?? VALUE_UNDEFINED
    if (kind === VALUE_NUMBER) target[path.slice('state.combat.'.length)] = state.runtimeValues[index]
    else if (kind === VALUE_BOOLEAN) target[path.slice('state.combat.'.length)] = state.runtimeValues[index] !== 0
  }
  return target
}

export function writeNumericEnemy(state: NumericTeamState, path: string, value: unknown): number {
  const index = state.program.enemyPathIndexByName.get(path.replace(/^enemy\./, '')) ?? -1
  if (index < 0) return 0
  const [nextKind, nextEncoded] = encodeStateExact(state.program, value)
  if (state.enemyKinds[index] === nextKind && Object.is(state.enemyValues[index], nextEncoded)) return 0
  if (state.transactionDepth > 0) {
    state.transactionLog.push({
      kind: 'enemy',
      index,
      valueKind: state.enemyKinds[index] ?? VALUE_UNDEFINED,
      value: state.enemyValues[index] ?? 0,
      numeric: state.enemyNumbers[index] ?? 0,
    })
  }
  writeEnemyRegister(state, index, value)
  state.revision += 1
  markNumericDirty(state, 0, state.program.enemyDependencyMask)
  return state.program.enemyDependencyMask
}

export function setNumericActiveLane(state: NumericTeamState, resonatorId: string): number {
  const lane = state.program.laneById[resonatorId]
  if (lane === undefined || lane === state.activeLane) return 0
  if (state.transactionDepth > 0) state.transactionLog.push({ kind: 'active', lane: state.activeLane })
  state.activeLane = lane
  state.revision += 1
  markNumericDirty(state, 0, state.program.activeDependencyMask)
  return state.program.activeDependencyMask
}

/** Read a runtime skill condition from its compiled numeric program. */
export function evaluateNumericCondition(
    state: NumericTeamState,
    lane: number,
    condition: CondExpr,
): boolean | undefined {
  const program = state.program.conditionsByTarget[lane]?.get(condition)
  if (program) syncNumericTeam(state)
  return program ? executeConditionNode(state, program, 0) : undefined
}

/** Compatibility name for callers preparing an individual skill. */
export const evaluateNumericSkillCondition = evaluateNumericCondition

export function writeNumericRoute(
    state: NumericTeamState,
    sourceId: string,
    ownerKey: string,
    targetId: string | null,
): number {
  const sourceLane = state.program.laneById[sourceId]
  if (sourceLane === undefined) return 0
  const route = targetId === null ? -1 : (state.program.laneById[targetId] ?? -2)
  let mask = 0
  for (const index of state.program.routeProgramsByKey[`${sourceLane}:${ownerKey}`] ?? []) {
    if (state.routes[index] === route) continue
    if (state.transactionDepth > 0) {
      state.transactionLog.push({ kind: 'route', index, lane: state.routes[index] ?? -1 })
    }
    state.routes[index] = route
    state.revision += 1
    mask |= 1 << (state.program.routeTargetLanes[index] ?? 0)
  }
  markNumericDirty(state, 0, mask)
  return mask
}

function skillOperationMatches(skill: SkillDef, operation: NumericSkillOperation): boolean {
  if (operation.skillIds.length > 0 && !operation.skillIds.includes(skill.id)) return false
  if (operation.tabs.length > 0 && !operation.tabs.includes(skill.tab)) return false
  if (operation.skillTypes.length > 0 && !skill.skillType.some((type) => operation.skillTypes.includes(type))) return false
  if (operation.elements.length > 0 && !operation.elements.includes(skill.element)) return false
  if (operation.labelIncludes.length > 0 && !operation.labelIncludes.some((label) => skill.label.includes(label))) return false
  return true
}

/** Apply compiled skill effects without rebuilding an effect context or graph. */
export function prepareNumericSkill(state: NumericTeamState, lane: number, skill: SkillDef): SkillDef {
  syncNumericTeam(state)
  let multiplier = skill.multiplier
  let hits = skill.hits
  const buffs = state.skillBuffScratch
  for (let index = 0; index < skillModFields.length; index += 1) buffs[index] = skill.skillBuffs?.[skillModFields[index]!] ?? 0
  const scalars = state.skillScalarScratch
  for (let index = 0; index < skillScalarFields.length; index += 1) scalars[index] = skill[skillScalarFields[index]!] ?? 0
  const trace = state.traceContributions ? state.skillScalarTrace : null
  if (trace) trace.length = 0
  let changed = false
  for (const program of state.program.skillProgramsByTarget[lane] ?? []) {
    if (!programTargetsActive(state, program) || !executeConditionNode(state, program.condition, 0)) continue
    const effectScale = conditionScale(state, program.condition, 0)
    for (const operation of program.operations) {
      if (!skillOperationMatches(skill, operation)) continue
      let formulaScale = 1
      for (const ref of operation.formula.scaleRefs) formulaScale = Math.min(formulaScale, refScale(state, ref))
      const raw = executeFormula(state, operation.formula, true)
      const scale = Math.min(effectScale, formulaScale)
      changed = true
      if (operation.opcode === SKILL_MOD) {
        buffs[operation.destination] = (buffs[operation.destination] ?? 0) + raw * scale
      } else if (operation.opcode === SKILL_SCALAR) {
        scalars[operation.destination] = (scalars[operation.destination] ?? 0) + raw * scale
        if (trace && raw * scale !== 0) {
          trace.push({
            field: skillScalarFields[operation.destination]!,
            ownerKey: program.ownerKey,
            sourceLane: program.sourceLane,
            value: raw * scale,
          })
        }
      } else if (operation.opcode === SKILL_ADD_MULTIPLIER) {
        const delta = raw * scale
        if (multiplier > 0 && delta !== 0) {
          if (hits.length === 0) multiplier += delta
          else {
            const ratio = (multiplier + delta) / multiplier
            hits = hits.map((hit) => ({ ...hit, multiplier: hit.multiplier * ratio }))
            multiplier = hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0)
          }
        }
      } else if (operation.opcode === SKILL_ADD_HIT) {
        const delta = raw * scale
        if (delta !== 0 && operation.destination >= 0 && operation.destination < hits.length) {
          hits = hits.map((hit, index) => index === operation.destination ? { ...hit, multiplier: hit.multiplier + delta } : hit)
          multiplier = hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0)
        }
      } else if (operation.opcode === SKILL_SCALE_MULTIPLIER) {
        const ratio = 1 + (raw - 1) * scale
        if (hits.length === 0) multiplier *= ratio
        else {
          hits = hits.map((hit) => ({ ...hit, multiplier: hit.multiplier * ratio }))
          multiplier = hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0)
        }
      }
    }
  }
  if (!changed) return skill
  const skillBuffs = Object.fromEntries(skillModFields.map((field, index) => [field, buffs[index] ?? 0])) as unknown as ModBuff
  const scalarPatch = Object.fromEntries(skillScalarFields.map((field, index) => [field, scalars[index] ?? 0]))
  return { ...skill, ...scalarPatch, multiplier, hits, skillBuffs }
}

export function writeNumericEffectScale(
    state: NumericTeamState,
    resonatorId: string,
    path: string,
    scale: number,
): number {
  const lane = state.program.laneById[resonatorId]
  const pathIndex = state.program.pathIndexByName.get(path.replace(/^runtime\./, '')) ?? -1
  if (lane === undefined || pathIndex < 0) return 0
  const register = lane * state.program.paths.length + pathIndex
  const nextScale = Math.max(0, Math.min(1, scale))
  if (Object.is(state.effectScales[register], nextScale)) return 0
  if (state.transactionDepth > 0) {
    state.transactionLog.push({ kind: 'scale', index: register, value: state.effectScales[register] ?? 1 })
  }
  state.effectScales[register] = nextScale
  state.revision += 1
  const targetMask = state.program.runtimeDependencyMasks[lane * state.program.paths.length + pathIndex] ?? 0
  markNumericDirty(state, (1 << lane), targetMask | (1 << lane))
  return targetMask | (1 << lane)
}

function bitKeys<T extends string>(mask: number, keys: readonly T[]): T[] {
  return keys.filter((_, index) => Boolean(mask & (1 << index)))
}

export function materializeNumericLane(state: NumericTeamState, lane: number): { buffs: UnifiedBuffPool; finalStats: ReturnType<typeof unpackFinalStats> } {
  syncNumericTeam(state)
  const immunities: ImmunitySet = {
    all: Boolean(state.immunityAll[lane]),
    elements: bitKeys(state.immunityElements[lane] ?? 0, ['aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc', 'physical'] as const),
    skillTypes: bitKeys(state.immunitySkillTypes[lane] ?? 0, ['all', 'basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation', 'introSkill', 'outroSkill', 'echoSkill', 'coord', 'spectroFrazzle', 'aeroErosion', 'fusionBurst', 'havocBane', 'glacioChafe', 'electroFlare', 'healing', 'shield', 'tuneRupture', 'hack'] as const),
    negativeEffects: bitKeys(state.immunityNegative[lane] ?? 0, ['spectroFrazzle', 'aeroErosion', 'fusionBurst', 'havocBane', 'glacioChafe', 'electroFlare'] as const),
  }
  const poolOffset = lane * NUMERIC_POOL_CELL_COUNT
  const finalOffset = lane * NUMERIC_FINAL_CELL_COUNT
  const buffs = unpackBuffPool(state.pools.subarray(poolOffset, poolOffset + NUMERIC_POOL_CELL_COUNT), immunities)
  return { buffs, finalStats: unpackFinalStats(state.finals.subarray(finalOffset, finalOffset + NUMERIC_FINAL_CELL_COUNT), buffs) }
}

export function materializeNumericContext(
    state: NumericTeamState,
    graph: CombatGraph,
    targetSlotId: SlotId,
    enemy: EnemyProfile,
    runtime?: ResRuntime,
) {
  const lane = state.program.slotIds.indexOf(targetSlotId)
  const participant = graph.participants[targetSlotId]
  if (lane < 0 || !participant) throw new Error(`Missing numeric participant for slot ${targetSlotId}`)
  const materialized = materializeNumericLane(state, lane)
  return {
    runtime: runtime ?? participant.runtime,
    baseStats: participant.baseStats,
    enemy,
    buffs: materialized.buffs,
    finalStats: materialized.finalStats,
    graph,
    targetSlotId,
    numericTeam: state,
    numericLane: lane,
  }
}
