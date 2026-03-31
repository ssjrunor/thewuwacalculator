/*
  Author: Runor Ewhro
  Description: Evaluates formula and condition expressions against scoped
               runtime, stat, pool, and context data.
*/

import type {
  ConditionExpression,
  EvalScopeRoot,
  EffectEvalScope,
  FormulaExpression,
} from '@/domain/gameData/contracts'
import { readRuntimePath } from '@/domain/gameData/runtimePath'

interface ScopedPathRef {
  from: EvalScopeRoot
  path: string
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

// read a value from a scoped path
function readPath(scope: EffectEvalScope, path: string, from?: EvalScopeRoot): unknown {
  const ref = normalizeScopedPath(path, from)
  const root = resolveRoot(scope, ref.from)

  if (ref.from === 'sourceRuntime' || ref.from === 'targetRuntime' || ref.from === 'activeRuntime') {
    if (!root) {
      return undefined
    }

    return readRuntimePath(root as typeof scope.sourceRuntime, ref.path)
  }

  const parts = ref.path.split('.').filter(Boolean)
  let cursor: unknown = root

  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined
    }

    cursor = (cursor as Record<string, unknown>)[part]
  }

  return cursor
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

// evaluate a formula expression against the given scope
export function evaluateFormula(formula: FormulaExpression, scope: EffectEvalScope): number {
  if (formula.type === 'const') {
    return formula.value
  }

  if (formula.type === 'read') {
    const fallback = formula.default ?? 0
    return toNumber(readPath(scope, formula.path, formula.from), fallback)
  }

  if (formula.type === 'table') {
    const fallbackIndex = formula.defaultIndex ?? 0
    const minIndex = formula.minIndex ?? 0
    const rawIndex = toNumber(readPath(scope, formula.path, formula.from), fallbackIndex)
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
    return Boolean(readPath(scope, condition.path, condition.from))
  }

  if (condition.type === 'eq') {
    return readPath(scope, condition.path, condition.from) === condition.value
  }

  if (condition.type === 'neq') {
    return readPath(scope, condition.path, condition.from) !== condition.value
  }

  if (condition.type === 'gt') {
    return toNumber(readPath(scope, condition.path, condition.from), 0) > condition.value
  }

  if (condition.type === 'gte') {
    return toNumber(readPath(scope, condition.path, condition.from), 0) >= condition.value
  }

  if (condition.type === 'lt') {
    return toNumber(readPath(scope, condition.path, condition.from), 0) < condition.value
  }

  if (condition.type === 'lte') {
    return toNumber(readPath(scope, condition.path, condition.from), 0) <= condition.value
  }

  if (condition.type === 'and') {
    return condition.values.every((item) => evaluateCondition(item, scope))
  }

  if (condition.type === 'or') {
    return condition.values.some((item) => evaluateCondition(item, scope))
  }

  return false
}