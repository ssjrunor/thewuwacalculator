/*
  Author: Runor Ewhro
  Description: Formats formula expressions, condition expressions, runtime
               changes, and rotation node values into readable UI text.
*/

import type {
  ConditionExpression,
  FormulaExpression,
  RuntimeChange,
} from '@/domain/gameData/contracts'

// format a runtime path into readable title-cased text
function formatPath(path: string): string {
  return path
      .replace(/^runtime\./, '')
      .split('.')
      .map((part) =>
          part
              .replace(/([A-Z])/g, ' $1')
              .replace(/^./, (value) => value.toUpperCase()),
      )
      .join(' ')
}

// format numeric constants without unnecessary trailing zeros
function formatConst(value: number): string {
  if (Number.isInteger(value)) {
    return String(value)
  }

  return value.toFixed(2).replace(/\.?0+$/, '')
}

// format a formula expression into readable text
export function formatFormulaExpression(expression: FormulaExpression): string {
  if (expression.type === 'const') {
    return formatConst(expression.value)
  }

  if (expression.type === 'read') {
    return formatPath(expression.path)
  }

  if (expression.type === 'table') {
    return `${formatPath(expression.path)} table`
  }

  if (expression.type === 'add') {
    return expression.values.map((value) => formatFormulaExpression(value)).join(' + ')
  }

  if (expression.type === 'mul') {
    return expression.values.map((value) => formatFormulaExpression(value)).join(' x ')
  }

  if (expression.type === 'clamp') {
    const source = formatFormulaExpression(expression.value)

    if (typeof expression.min === 'number' && typeof expression.max === 'number') {
      return `Clamp(${source}, ${formatConst(expression.min)}, ${formatConst(expression.max)})`
    }

    if (typeof expression.min === 'number') {
      return `ClampMin(${source}, ${formatConst(expression.min)})`
    }

    if (typeof expression.max === 'number') {
      return `ClampMax(${source}, ${formatConst(expression.max)})`
    }

    return source
  }

  return ''
}

// format a condition expression into readable text
export function formatConditionExpression(expression?: ConditionExpression): string {
  if (!expression || expression.type === 'always') {
    return 'Always'
  }

  if (expression.type === 'not') {
    return `Not (${formatConditionExpression(expression.value)})`
  }

  if (expression.type === 'truthy') {
    return formatPath(expression.path)
  }

  if (expression.type === 'eq') {
    return `${formatPath(expression.path)} = ${String(expression.value)}`
  }

  if (expression.type === 'neq') {
    return `${formatPath(expression.path)} != ${String(expression.value)}`
  }

  if (expression.type === 'gt') {
    return `${formatPath(expression.path)} > ${formatConst(expression.value)}`
  }

  if (expression.type === 'gte') {
    return `${formatPath(expression.path)} >= ${formatConst(expression.value)}`
  }

  if (expression.type === 'lt') {
    return `${formatPath(expression.path)} < ${formatConst(expression.value)}`
  }

  if (expression.type === 'lte') {
    return `${formatPath(expression.path)} <= ${formatConst(expression.value)}`
  }

  if (expression.type === 'and') {
    return expression.values.map((value) => formatConditionExpression(value)).join(' and ')
  }

  if (expression.type === 'or') {
    return expression.values.map((value) => formatConditionExpression(value)).join(' or ')
  }

  return 'Always'
}

// format a runtime mutation into readable text
export function formatRuntimeChange(change: RuntimeChange): string {
  if (change.type === 'set') {
    return `${formatPath(change.path)} = ${String(change.value)}`
  }

  if (change.type === 'add') {
    return `${formatPath(change.path)} + ${formatConst(change.value)}`
  }

  return `${formatPath(change.path)} = ${String(change.value ?? true)}`
}