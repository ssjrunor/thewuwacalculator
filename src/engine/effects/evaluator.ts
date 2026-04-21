/*
  Author: Runor Ewhro
  Description: Evaluates formula and condition expressions against scoped
               runtime, stat, pool, and context data, with cached compiled
               path access for the hot runtime evaluation path.
*/

import type {
  ConditionExpression,
  EvalScopeRoot,
  EffectEvalScope,
  EffectOperation,
  FeatureDefinition,
  FormulaExpression,
  RotationNode,
  SourcePackage,
  SourceStateDefinition,
} from '@/domain/gameData/contracts'
import type { SkillDefinition } from '@/domain/entities/stats'
import { readRuntimePath } from '@/domain/gameData/runtimePath'

interface ScopedPathRef {
  from: EvalScopeRoot
  path: string
}

interface CompiledPathRef {
  from: EvalScopeRoot
  parts: string[]
  runtimePath: string
  usesRuntimePath: boolean
}

const scopedPathCache = new Map<string, CompiledPathRef>()
const objectPathCache = new Map<string, string[]>()

function makeScopedPathCacheKey(path: string, from?: EvalScopeRoot): string {
  return `${from ?? ''}::${path}`
}

// normalize an expression path into an explicit scope root and inner path
function normalizeScopedPath(path: string, from?: EvalScopeRoot): ScopedPathRef {
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

function compileScopedPath(path: string, from?: EvalScopeRoot): CompiledPathRef {
  const cacheKey = makeScopedPathCacheKey(path, from)
  const cached = scopedPathCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const normalized = normalizeScopedPath(path, from)
  const compiled = {
    from: normalized.from,
    parts: normalized.path.split('.').filter(Boolean),
    runtimePath: normalized.path,
    usesRuntimePath:
        normalized.from === 'sourceRuntime'
        || normalized.from === 'targetRuntime'
        || normalized.from === 'activeRuntime',
  }

  scopedPathCache.set(cacheKey, compiled)
  return compiled
}

function compileObjectPath(path: string): string[] {
  const cached = objectPathCache.get(path)
  if (cached) {
    return cached
  }

  const parts = path.split('.').filter(Boolean)
  objectPathCache.set(path, parts)
  return parts
}

// resolve the root object for a given evaluation scope
function resolveRoot(scope: EffectEvalScope, from: EvalScopeRoot): unknown {
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

function readObjectPathParts(root: unknown, parts: string[]): unknown {
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
function readCompiledPath(scope: EffectEvalScope, compiled: CompiledPathRef): unknown {
  const root = resolveRoot(scope, compiled.from)

  if (compiled.usesRuntimePath) {
    if (!root) {
      return undefined
    }

    return readRuntimePath(root as typeof scope.sourceRuntime, compiled.runtimePath)
  }

  return readObjectPathParts(root, compiled.parts)
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

function primeFormulaExpression(formula: FormulaExpression): void {
  if (formula.type === 'read' || formula.type === 'table') {
    compileScopedPath(formula.path, formula.from)
    return
  }

  if (formula.type === 'add' || formula.type === 'mul') {
    for (const value of formula.values) {
      primeFormulaExpression(value)
    }
    return
  }

  if (formula.type === 'clamp') {
    primeFormulaExpression(formula.value)
  }
}

function primeConditionExpression(condition: ConditionExpression | undefined): void {
  if (!condition || condition.type === 'always') {
    return
  }

  if (condition.type === 'not') {
    primeConditionExpression(condition.value)
    return
  }

  if (condition.type === 'and' || condition.type === 'or') {
    for (const value of condition.values) {
      primeConditionExpression(value)
    }
    return
  }

  compileScopedPath(condition.path, condition.from)

  if (condition.type === 'includes' && condition.itemPath) {
    compileObjectPath(condition.itemPath)
  }
}

function primeSkill(skill: SkillDefinition): void {
  primeConditionExpression(skill.visibleWhen)

  for (const entry of skill.skillTypeWhen ?? []) {
    primeConditionExpression(entry.when)
  }
}

function primeFeature(feature: FeatureDefinition): void {
  primeConditionExpression(feature.condition)
}

function primeState(state: SourceStateDefinition): void {
  primeConditionExpression(state.visibleWhen)
  primeConditionExpression(state.enabledWhen)

  for (const optionSet of state.optionsWhen ?? []) {
    primeConditionExpression(optionSet.when)
  }
}

function primeOperation(operation: EffectOperation): void {
  primeFormulaExpression(operation.value)
}

function primeRotationNode(node: RotationNode): void {
  primeConditionExpression(node.condition)

  if (node.type === 'repeat') {
    if (typeof node.times !== 'number') {
      primeFormulaExpression(node.times)
    }

    for (const child of node.items) {
      primeRotationNode(child)
    }
    return
  }

  if (node.type === 'uptime') {
    if (typeof node.ratio !== 'number') {
      primeFormulaExpression(node.ratio)
    }

    for (const child of node.setup ?? []) {
      primeRotationNode(child)
    }

    for (const child of node.items) {
      primeRotationNode(child)
    }
  }
}

export function primeCompiledSkillExpressions(skills: SkillDefinition[]): void {
  for (const skill of skills) {
    primeSkill(skill)
  }
}

export function primeCompiledFeatureExpressions(features: FeatureDefinition[]): void {
  for (const feature of features) {
    primeFeature(feature)
  }
}

export function primeCompiledStateExpressions(states: SourceStateDefinition[]): void {
  for (const state of states) {
    primeState(state)
  }
}

export function primeCompiledSourcePackageExpressions(source: SourcePackage): void {
  for (const owner of source.owners ?? []) {
    primeConditionExpression(owner.unlockWhen)
    primeConditionExpression(owner.visibleWhen)
  }

  for (const state of source.states ?? []) {
    primeState(state)
  }

  for (const condition of source.conditions ?? []) {
    primeConditionExpression(condition.visibleWhen)
  }

  for (const effect of source.effects ?? []) {
    primeConditionExpression(effect.condition)
    for (const operation of effect.operations) {
      primeOperation(operation)
    }
  }

  primeCompiledSkillExpressions(source.skills ?? [])
  primeCompiledFeatureExpressions(source.features ?? [])

  for (const rotation of source.rotations ?? []) {
    for (const item of rotation.items) {
      primeRotationNode(item)
    }
  }
}

// evaluate a formula expression against the given scope
export function evaluateFormula(formula: FormulaExpression, scope: EffectEvalScope): number {
  if (formula.type === 'const') {
    return formula.value
  }

  if (formula.type === 'read') {
    const fallback = formula.default ?? 0
    return toNumber(readCompiledPath(scope, compileScopedPath(formula.path, formula.from)), fallback)
  }

  if (formula.type === 'table') {
    const fallbackIndex = formula.defaultIndex ?? 0
    const minIndex = formula.minIndex ?? 0
    const rawIndex = toNumber(
        readCompiledPath(scope, compileScopedPath(formula.path, formula.from)),
        fallbackIndex,
    )
    const index = clampValue(
        Math.floor(rawIndex),
        minIndex,
        formula.maxIndex ?? (formula.values.length - 1 + minIndex),
    )

    return formula.values[index - minIndex] ?? 0
  }

  if (formula.type === 'add') {
    return formula.values.reduce((acc, item) => acc + evaluateFormula(item, scope), 0)
  }

  if (formula.type === 'mul') {
    return formula.values.reduce((acc, item) => acc * evaluateFormula(item, scope), 1)
  }

  if (formula.type === 'clamp') {
    const value = evaluateFormula(formula.value, scope)
    return clampValue(value, formula.min, formula.max)
  }

  return 0
}

// evaluate a condition expression against the given scope
export function evaluateCondition(
    condition: ConditionExpression | undefined,
    scope: EffectEvalScope,
): boolean {
  if (!condition || condition.type === 'always') {
    return true
  }

  if (condition.type === 'not') {
    return !evaluateCondition(condition.value, scope)
  }

  if (condition.type === 'truthy') {
    return Boolean(readCompiledPath(scope, compileScopedPath(condition.path, condition.from)))
  }

  if (condition.type === 'eq') {
    return readCompiledPath(scope, compileScopedPath(condition.path, condition.from)) === condition.value
  }

  if (condition.type === 'neq') {
    return readCompiledPath(scope, compileScopedPath(condition.path, condition.from)) !== condition.value
  }

  if (condition.type === 'gt') {
    return toNumber(readCompiledPath(scope, compileScopedPath(condition.path, condition.from)), 0) > condition.value
  }

  if (condition.type === 'gte') {
    return toNumber(readCompiledPath(scope, compileScopedPath(condition.path, condition.from)), 0) >= condition.value
  }

  if (condition.type === 'lt') {
    return toNumber(readCompiledPath(scope, compileScopedPath(condition.path, condition.from)), 0) < condition.value
  }

  if (condition.type === 'lte') {
    return toNumber(readCompiledPath(scope, compileScopedPath(condition.path, condition.from)), 0) <= condition.value
  }

  if (condition.type === 'includes') {
    const container = readCompiledPath(scope, compileScopedPath(condition.path, condition.from))
    if (!Array.isArray(container)) {
      return false
    }

    const itemParts = condition.itemPath ? compileObjectPath(condition.itemPath) : null

    return container.some((item) => {
      const candidate = itemParts ? readObjectPathParts(item, itemParts) : item
      return candidate === condition.value
    })
  }

  if (condition.type === 'and') {
    return condition.values.every((item) => evaluateCondition(item, scope))
  }

  if (condition.type === 'or') {
    return condition.values.some((item) => evaluateCondition(item, scope))
  }

  return false
}
