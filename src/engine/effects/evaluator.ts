/*
  Author: Runor Ewhro
  Description: Evaluates formula and condition expressions against scoped
               runtime, stat, pool, and context data, with cached compiled
               path access for the hot runtime evaluation path.
*/

import type {
  CondExpr,
  EvalScpRoot,
  EffectScope,
  EffectOp,
  FormExpr,
  RotationNode,
  SrcPkg,
  SourceState,
} from '@/domain/gameData/contracts'
import type { SkillDef } from '@/domain/entities/stats'
import { readRtPath } from '@/domain/gameData/runtimePath'

interface ScpdPathRef {
  from: EvalScpRoot
  path: string
}

interface CompPathRef {
  from: EvalScpRoot
  parts: string[]
  runtimePath: string
  // tracks whether the path points at a runtime root so callers can preserve
  // runtime-path dependency metadata without reparsing the expression.
  usesRtPath: boolean
}

const scpdPathCch = new Map<string, CompPathRef>()
const bjctPathCch = new Map<string, string[]>()

const FORM_CONST = 1
const FORM_READ = 2
const FORM_TABLE = 3
const FORM_ADD = 4
const FORM_MUL = 5
const FORM_CLAMP = 6

const COND_ALWAYS = 1
const COND_NOT = 2
const COND_TRUTHY = 3
const COND_EQ = 4
const COND_NEQ = 5
const COND_GT = 6
const COND_GTE = 7
const COND_LT = 8
const COND_LTE = 9
const COND_INCLUDES = 10
const COND_AND = 11
const COND_OR = 12

interface CompiledFormProgram {
  readonly opcodes: Uint8Array
  readonly a: Int32Array
  readonly b: Int32Array
  readonly c: Int32Array
  readonly x: Float64Array
  readonly y: Float64Array
  readonly paths: readonly CompPathRef[]
  readonly tables: readonly number[][]
  /** Re-entrant scratch lanes; ordinary execution uses only lane zero. */
  readonly stacks: Float64Array[]
  activeDepth: number
}

const formProgramCache = new WeakMap<FormExpr, CompiledFormProgram>()

interface CompiledConditionProgram {
  readonly opcodes: Uint8Array
  readonly pathIndexes: Int32Array
  readonly valueIndexes: Int32Array
  readonly itemPathIndexes: Int32Array
  readonly childStarts: Int32Array
  readonly childCounts: Int32Array
  readonly children: Int32Array
  readonly paths: readonly CompPathRef[]
  readonly values: ReadonlyArray<string | number | boolean>
  readonly itemPaths: ReadonlyArray<readonly string[]>
}

const conditionProgramCache = new WeakMap<CondExpr, CompiledConditionProgram>()

function mkScpdPathCc(path: string, from?: EvalScpRoot): string {
  return `${from ?? ''}::${path}`
}

// normalize an expression path into an explicit scope root and inner path
function normScpdPath(path: string, from?: EvalScpRoot): ScpdPathRef {
  if (from) {
    return { from, path }
  }

  if (path.startsWith('sourceRuntime.')) {
    return {
      from: 'sourceRuntime',
      path: path.replace(/^sourceRuntime\./, ''),
    }
  }

  if (path.startsWith('sourceFinalStats.')) {
    return {
      from: 'sourceFinalStats',
      path: path.replace(/^sourceFinalStats\./, ''),
    }
  }

  if (path.startsWith('targetRuntime.')) {
    return {
      from: 'targetRuntime',
      path: path.replace(/^targetRuntime\./, ''),
    }
  }

  if (path.startsWith('activeRuntime.')) {
    return {
      from: 'activeRuntime',
      path: path.replace(/^activeRuntime\./, ''),
    }
  }

  if (path.startsWith('baseStats.')) {
    return {
      from: 'baseStats',
      path: path.replace(/^baseStats\./, ''),
    }
  }

  if (path.startsWith('finalStats.')) {
    return {
      from: 'finalStats',
      path: path.replace(/^finalStats\./, ''),
    }
  }

  if (path.startsWith('context.pool.')) {
    return {
      from: 'pool',
      path: path.replace(/^context\.pool\./, ''),
    }
  }

  if (path.startsWith('pool.')) {
    return {
      from: 'pool',
      path: path.replace(/^pool\./, ''),
    }
  }

  if (path.startsWith('context.')) {
    return {
      from: 'context',
      path: path.replace(/^context\./, ''),
    }
  }

  if (path.startsWith('runtime.')) {
    return {
      from: 'sourceRuntime',
      path: path.replace(/^runtime\./, ''),
    }
  }

  return {
    from: 'context',
    path,
  }
}

function compScpdPath(path: string, from?: EvalScpRoot): CompPathRef {
  const cacheKey = mkScpdPathCc(path, from)
  const cached = scpdPathCch.get(cacheKey)
  if (cached) {
    return cached
  }

  const normalized = normScpdPath(path, from)
  const compiled = {
    from: normalized.from,
    parts: normalized.path.split('.').filter(Boolean),
    runtimePath: normalized.path,
    usesRtPath:
        normalized.from === 'sourceRuntime'
        || normalized.from === 'targetRuntime'
        || normalized.from === 'activeRuntime',
  }

  scpdPathCch.set(cacheKey, compiled)
  return compiled
}

function compBjctPath(path: string): string[] {
  const cached = bjctPathCch.get(path)
  if (cached) {
    return cached
  }

  const parts = path.split('.').filter(Boolean)
  bjctPathCch.set(path, parts)
  return parts
}

// resolve the root object for a given evaluation scope
function resolveRoot(scope: EffectScope, from: EvalScpRoot): unknown {
  switch (from) {
    case 'sourceRuntime':
      return scope.sourceRuntime
    case 'sourceFinalStats':
      return scope.sourceFinalStats
    case 'targetRuntime':
      return scope.targetRuntime
    case 'activeRuntime':
      return scope.activeRuntime
    case 'pool':
      return scope.pool
    case 'baseStats':
      return scope.baseStats
    case 'finalStats':
      return scope.finalStats
    case 'context':
      return scope.context
    default:
      return undefined
  }
}

function readBjctPath(root: unknown, parts: readonly string[]): unknown {
  let cursor: unknown = root

  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined
    }

    cursor = (cursor as Record<string, unknown>)[part]
  }

  return cursor
}

// read a value from a compiled scoped path
// runtime-backed roots use the dedicated runtime-path helper so evaluator reads
// Stay aligned with the rest of the Simulation runtime semantics.
function readCompPath(scope: EffectScope, compiled: CompPathRef): unknown {
  const root = resolveRoot(scope, compiled.from)

  if (compiled.usesRtPath) {
    if (!root) {
      return undefined
    }

    return readRtPath(root as typeof scope.sourceRuntime, compiled.runtimePath)
  }

  return readBjctPath(root, compiled.parts)
}

// coerce a value into a number with fallback handling
function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return fallback
}

// clamp a number into optional bounds
function clampValue(value: number, min?: number, max?: number): number {
  let next = value

  if (typeof min === 'number') {
    next = Math.max(min, next)
  }

  if (typeof max === 'number') {
    next = Math.min(max, next)
  }

  return next
}

function compileFormProgram(formula: FormExpr): CompiledFormProgram {
  const cached = formProgramCache.get(formula)
  if (cached) return cached

  const opcodes: number[] = []
  const a: number[] = []
  const b: number[] = []
  const c: number[] = []
  const x: number[] = []
  const y: number[] = []
  const paths: CompPathRef[] = []
  const tables: number[][] = []

  const emit = (
      opcode: number,
      aValue = 0,
      bValue = 0,
      cValue = 0,
      xValue = 0,
      yValue = 0,
  ): void => {
    opcodes.push(opcode)
    a.push(aValue)
    b.push(bValue)
    c.push(cValue)
    x.push(xValue)
    y.push(yValue)
  }

  const visit = (expression: FormExpr): void => {
    if (expression.type === 'const') {
      emit(FORM_CONST, 0, 0, 0, expression.value)
      return
    }

    if (expression.type === 'read') {
      const pathIndex = paths.length
      paths.push(compScpdPath(expression.path, expression.from))
      emit(FORM_READ, pathIndex, 0, 0, expression.default ?? 0)
      return
    }

    if (expression.type === 'table') {
      const pathIndex = paths.length
      const tableIndex = tables.length
      const minIndex = expression.minIndex ?? 0
      paths.push(compScpdPath(expression.path, expression.from))
      tables.push(expression.values)
      emit(
        FORM_TABLE,
        pathIndex,
        tableIndex,
        expression.defaultIndex ?? 0,
        minIndex,
        expression.maxIndex ?? (expression.values.length - 1 + minIndex),
      )
      return
    }

    if (expression.type === 'add' || expression.type === 'mul') {
      for (const value of expression.values) visit(value)
      emit(expression.type === 'add' ? FORM_ADD : FORM_MUL, expression.values.length)
      return
    }

    visit(expression.value)
    emit(
      FORM_CLAMP,
      0,
      0,
      0,
      expression.min ?? Number.NaN,
      expression.max ?? Number.NaN,
    )
  }

  visit(formula)
  const program: CompiledFormProgram = {
    opcodes: Uint8Array.from(opcodes),
    a: Int32Array.from(a),
    b: Int32Array.from(b),
    c: Int32Array.from(c),
    x: Float64Array.from(x),
    y: Float64Array.from(y),
    paths,
    tables,
    stacks: [new Float64Array(opcodes.length)],
    activeDepth: 0,
  }
  formProgramCache.set(formula, program)
  return program
}

function executeFormProgram(program: CompiledFormProgram, scope: EffectScope): number {
  const { opcodes, a, b, c, x, y, paths, tables } = program
  const depth = program.activeDepth
  const stack = program.stacks[depth]
    ?? new Float64Array(opcodes.length)
  if (!program.stacks[depth]) program.stacks[depth] = stack
  program.activeDepth += 1
  let stackSize = 0
  try {
    for (let instruction = 0; instruction < opcodes.length; instruction += 1) {
      const opcode = opcodes[instruction]
      if (opcode === FORM_CONST) {
        stack[stackSize] = x[instruction] ?? 0
        stackSize += 1
        continue
      }

      if (opcode === FORM_READ) {
        const path = paths[a[instruction] ?? 0]
        stack[stackSize] = path
          ? toNumber(readCompPath(scope, path), x[instruction] ?? 0)
          : (x[instruction] ?? 0)
        stackSize += 1
        continue
      }

      if (opcode === FORM_TABLE) {
        const path = paths[a[instruction] ?? 0]
        const minIndex = x[instruction] ?? 0
        const maxIndex = y[instruction] ?? minIndex
        const rawIndex = path
          ? toNumber(readCompPath(scope, path), c[instruction] ?? 0)
          : (c[instruction] ?? 0)
        const index = clampValue(Math.floor(rawIndex), minIndex, maxIndex)
        stack[stackSize] = tables[b[instruction] ?? 0]?.[index - minIndex] ?? 0
        stackSize += 1
        continue
      }

      if (opcode === FORM_ADD || opcode === FORM_MUL) {
        const count = a[instruction] ?? 0
        const start = stackSize - count
        let value = opcode === FORM_ADD ? 0 : 1
        for (let index = start; index < stackSize; index += 1) {
          value = opcode === FORM_ADD ? value + (stack[index] ?? 0) : value * (stack[index] ?? 0)
        }
        stackSize = start
        stack[stackSize] = value
        stackSize += 1
        continue
      }

      if (opcode === FORM_CLAMP) {
        const index = stackSize - 1
        const min = x[instruction]
        const max = y[instruction]
        stack[index] = clampValue(
          stack[index] ?? 0,
          Number.isNaN(min) ? undefined : min,
          Number.isNaN(max) ? undefined : max,
        )
      }
    }
    return stackSize > 0 ? (stack[stackSize - 1] ?? 0) : 0
  } finally {
    program.activeDepth -= 1
  }
}

function conditionOpcode(condition: CondExpr): number {
  if (condition.type === 'always') return COND_ALWAYS
  if (condition.type === 'not') return COND_NOT
  if (condition.type === 'truthy') return COND_TRUTHY
  if (condition.type === 'eq') return COND_EQ
  if (condition.type === 'neq') return COND_NEQ
  if (condition.type === 'gt') return COND_GT
  if (condition.type === 'gte') return COND_GTE
  if (condition.type === 'lt') return COND_LT
  if (condition.type === 'includes') return COND_INCLUDES
  return condition.type === 'and' ? COND_AND : COND_OR
}

function compileConditionProgram(condition: CondExpr): CompiledConditionProgram {
  const cached = conditionProgramCache.get(condition)
  if (cached) return cached

  const opcodes: number[] = []
  const pathIndexes: number[] = []
  const valueIndexes: number[] = []
  const itemPathIndexes: number[] = []
  const childStarts: number[] = []
  const childCounts: number[] = []
  const children: number[] = []
  const paths: CompPathRef[] = []
  const values: Array<string | number | boolean> = []
  const itemPaths: string[][] = []

  const visit = (entry: CondExpr): number => {
    const nodeIndex = opcodes.length
    opcodes.push(conditionOpcode(entry))
    pathIndexes.push(-1)
    valueIndexes.push(-1)
    itemPathIndexes.push(-1)
    childStarts.push(-1)
    childCounts.push(0)

    if (entry.type === 'not') {
      const child = visit(entry.value)
      childStarts[nodeIndex] = children.length
      children.push(child)
      childCounts[nodeIndex] = 1
      return nodeIndex
    }

    if (entry.type === 'and' || entry.type === 'or') {
      const indexes = entry.values.map(visit)
      // Compile children before recording this range: nested child lists must
      // not become interleaved with this parent's contiguous references.
      childStarts[nodeIndex] = children.length
      children.push(...indexes)
      childCounts[nodeIndex] = indexes.length
      return nodeIndex
    }

    if (entry.type === 'always') return nodeIndex

    pathIndexes[nodeIndex] = paths.length
    paths.push(compScpdPath(entry.path, entry.from))
    if (entry.type !== 'truthy') {
      valueIndexes[nodeIndex] = values.length
      values.push(entry.value)
    }
    if (entry.type === 'includes' && entry.itemPath) {
      itemPathIndexes[nodeIndex] = itemPaths.length
      itemPaths.push(compBjctPath(entry.itemPath))
    }
    return nodeIndex
  }

  visit(condition)
  const program: CompiledConditionProgram = {
    opcodes: Uint8Array.from(opcodes),
    pathIndexes: Int32Array.from(pathIndexes),
    valueIndexes: Int32Array.from(valueIndexes),
    itemPathIndexes: Int32Array.from(itemPathIndexes),
    childStarts: Int32Array.from(childStarts),
    childCounts: Int32Array.from(childCounts),
    children: Int32Array.from(children),
    paths,
    values,
    itemPaths,
  }
  conditionProgramCache.set(condition, program)
  return program
}

function executeConditionNode(
    program: CompiledConditionProgram,
    nodeIndex: number,
    scope: EffectScope,
): boolean {
  const opcode = program.opcodes[nodeIndex]
  if (opcode === COND_ALWAYS) return true

  const childStart = program.childStarts[nodeIndex] ?? -1
  const childCount = program.childCounts[nodeIndex] ?? 0
  if (opcode === COND_NOT) {
    return !executeConditionNode(program, program.children[childStart] ?? 0, scope)
  }
  if (opcode === COND_AND) {
    for (let index = 0; index < childCount; index += 1) {
      if (!executeConditionNode(program, program.children[childStart + index] ?? 0, scope)) {
        return false
      }
    }
    return true
  }
  if (opcode === COND_OR) {
    for (let index = 0; index < childCount; index += 1) {
      if (executeConditionNode(program, program.children[childStart + index] ?? 0, scope)) {
        return true
      }
    }
    return false
  }

  const path = program.paths[program.pathIndexes[nodeIndex] ?? -1]
  const actual = path ? readCompPath(scope, path) : undefined
  if (opcode === COND_TRUTHY) return Boolean(actual)
  const expected = program.values[program.valueIndexes[nodeIndex] ?? -1]
  if (opcode === COND_EQ) return actual === expected
  if (opcode === COND_NEQ) return actual !== expected
  if (opcode === COND_GT) return toNumber(actual, 0) > Number(expected)
  if (opcode === COND_GTE) return toNumber(actual, 0) >= Number(expected)
  if (opcode === COND_LT) return toNumber(actual, 0) < Number(expected)
  if (opcode === COND_LTE) return toNumber(actual, 0) <= Number(expected)

  if (opcode === COND_INCLUDES && Array.isArray(actual)) {
    const itemPathIndex = program.itemPathIndexes[nodeIndex] ?? -1
    const itemPath = itemPathIndex >= 0 ? program.itemPaths[itemPathIndex] : undefined
    for (const item of actual) {
      if ((itemPath ? readBjctPath(item, itemPath) : item) === expected) return true
    }
  }
  return false
}

function prmFormExpr(formula: FormExpr): void {
  compileFormProgram(formula)
}

function prmCondExpr(condition: CondExpr | undefined): void {
  if (condition) compileConditionProgram(condition)
}

function primeSkill(skill: SkillDef): void {
  prmCondExpr(skill.visibleWhen)

  for (const entry of skill.skillTypeWhen ?? []) {
    prmCondExpr(entry.when)
  }
}

function primeState(state: SourceState): void {
  prmCondExpr(state.visibleWhen)
  prmCondExpr(state.enabledWhen)

  for (const optionSet of state.optionsWhen ?? []) {
    prmCondExpr(optionSet.when)
  }
}

function prmOp(operation: EffectOp): void {
  if (operation.type === 'add_immunity') {
    return
  }

  prmFormExpr(operation.value)
}

function prmRotNode(node: RotationNode): void {
  if (node.type === 'feature') {
    for (const child of node.attached?.conditions ?? []) {
      prmRotNode(child)
    }
    for (const child of node.attached?.features ?? []) {
      prmRotNode(child)
    }
    return
  }

  if (node.type === 'repeat') {
    if (typeof node.times !== 'number') {
      prmFormExpr(node.times)
    }

    for (const child of node.items) {
      prmRotNode(child)
    }
    return
  }

  if (node.type === 'uptime') {
    if (typeof node.ratio !== 'number') {
      prmFormExpr(node.ratio)
    }

    for (const child of node.setup ?? []) {
      prmRotNode(child)
    }

    for (const child of node.items) {
      prmRotNode(child)
    }
  }
}

export function prmCompSkllE(skills: SkillDef[]): void {
  for (const skill of skills) {
    primeSkill(skill)
  }
}

export function prmCompSttEx(states: SourceState[]): void {
  for (const state of states) {
    primeState(state)
  }
}

export function prmCompSrcPk(source: SrcPkg): void {
  for (const owner of source.owners ?? []) {
    prmCondExpr(owner.unlockWhen)
    prmCondExpr(owner.visibleWhen)
  }

  for (const state of source.states ?? []) {
    primeState(state)
  }

  for (const condition of source.conditions ?? []) {
    prmCondExpr(condition.visibleWhen)
  }

  for (const effect of source.effects ?? []) {
    prmCondExpr(effect.condition)
    for (const operation of effect.operations) {
      prmOp(operation)
    }
  }

  prmCompSkllE(source.skills ?? [])
  for (const rotation of source.rotations ?? []) {
    for (const item of rotation.items) {
      prmRotNode(item)
    }
  }
}

// evaluate a formula expression against the given scope
export function evalForm(formula: FormExpr, scope: EffectScope): number {
  return executeFormProgram(compileFormProgram(formula), scope)
}

// evaluate a condition expression against the given scope
// evaluate one authored condition tree against the current scope
// these semantics are reused by effect visibility, skill gating, and rotation when rules
export function evalCond(
    condition: CondExpr | undefined,
    scope: EffectScope,
): boolean {
  if (!condition || condition.type === 'always') {
    return true
  }
  return executeConditionNode(compileConditionProgram(condition), 0, scope)
}
