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
  FeatDef,
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

function readBjctPath(root: unknown, parts: string[]): unknown {
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
// stay aligned with the rest of the calculator's runtime semantics
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

function prmFormExpr(formula: FormExpr): void {
  if (formula.type === 'read' || formula.type === 'table') {
    compScpdPath(formula.path, formula.from)
    return
  }

  if (formula.type === 'add' || formula.type === 'mul') {
    for (const value of formula.values) {
      prmFormExpr(value)
    }
    return
  }

  if (formula.type === 'clamp') {
    prmFormExpr(formula.value)
  }
}

function prmCondExpr(condition: CondExpr | undefined): void {
  if (!condition || condition.type === 'always') {
    return
  }

  if (condition.type === 'not') {
    prmCondExpr(condition.value)
    return
  }

  if (condition.type === 'and' || condition.type === 'or') {
    for (const value of condition.values) {
      prmCondExpr(value)
    }
    return
  }

  compScpdPath(condition.path, condition.from)

  if (condition.type === 'includes' && condition.itemPath) {
    compBjctPath(condition.itemPath)
  }
}

function primeSkill(skill: SkillDef): void {
  prmCondExpr(skill.visibleWhen)

  for (const entry of skill.skillTypeWhen ?? []) {
    prmCondExpr(entry.when)
  }
}

function primeFeature(feature: FeatDef): void {
  prmCondExpr(feature.condition)
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
  if ('condition' in node) {
    prmCondExpr(node.condition)
  }
  prmCondExpr('when' in node ? node.when?.condition : undefined)

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

export function prmCompFeatE(features: FeatDef[]): void {
  for (const feature of features) {
    primeFeature(feature)
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
  prmCompFeatE(source.features ?? [])

  for (const rotation of source.rotations ?? []) {
    for (const item of rotation.items) {
      prmRotNode(item)
    }
  }
}

// evaluate a formula expression against the given scope
export function evalForm(formula: FormExpr, scope: EffectScope): number {
  if (formula.type === 'const') {
    return formula.value
  }

  if (formula.type === 'read') {
    const fallback = formula.default ?? 0
    return toNumber(readCompPath(scope, compScpdPath(formula.path, formula.from)), fallback)
  }

  if (formula.type === 'table') {
    const fllbNdx = formula.defaultIndex ?? 0
    const minIndex = formula.minIndex ?? 0
    const rawIndex = toNumber(
        readCompPath(scope, compScpdPath(formula.path, formula.from)),
        fllbNdx,
    )
    const index = clampValue(
        Math.floor(rawIndex),
        minIndex,
        formula.maxIndex ?? (formula.values.length - 1 + minIndex),
    )

    return formula.values[index - minIndex] ?? 0
  }

  if (formula.type === 'add') {
    return formula.values.reduce((acc, item) => acc + evalForm(item, scope), 0)
  }

  if (formula.type === 'mul') {
    return formula.values.reduce((acc, item) => acc * evalForm(item, scope), 1)
  }

  if (formula.type === 'clamp') {
    const value = evalForm(formula.value, scope)
    return clampValue(value, formula.min, formula.max)
  }

  return 0
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

  if (condition.type === 'not') {
    return !evalCond(condition.value, scope)
  }

  if (condition.type === 'truthy') {
    return Boolean(readCompPath(scope, compScpdPath(condition.path, condition.from)))
  }

  if (condition.type === 'eq') {
    return readCompPath(scope, compScpdPath(condition.path, condition.from)) === condition.value
  }

  if (condition.type === 'neq') {
    return readCompPath(scope, compScpdPath(condition.path, condition.from)) !== condition.value
  }

  if (condition.type === 'gt') {
    return toNumber(readCompPath(scope, compScpdPath(condition.path, condition.from)), 0) > condition.value
  }

  if (condition.type === 'gte') {
    return toNumber(readCompPath(scope, compScpdPath(condition.path, condition.from)), 0) >= condition.value
  }

  if (condition.type === 'lt') {
    return toNumber(readCompPath(scope, compScpdPath(condition.path, condition.from)), 0) < condition.value
  }

  if (condition.type === 'lte') {
    return toNumber(readCompPath(scope, compScpdPath(condition.path, condition.from)), 0) <= condition.value
  }

  if (condition.type === 'includes') {
    const container = readCompPath(scope, compScpdPath(condition.path, condition.from))
    if (!Array.isArray(container)) {
      return false
    }

    const itemParts = condition.itemPath ? compBjctPath(condition.itemPath) : null

    return container.some((item) => {
      const candidate = itemParts ? readBjctPath(item, itemParts) : item
      return candidate === condition.value
    })
  }

  if (condition.type === 'and') {
    return condition.values.every((item) => evalCond(item, scope))
  }

  if (condition.type === 'or') {
    return condition.values.some((item) => evalCond(item, scope))
  }

  return false
}
