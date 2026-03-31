/*
  Author: Runor Ewhro
  Description: Provides helpers for reading and writing nested runtime state
               values using dot-path access.
*/

import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { RuntimeValue } from '@/domain/gameData/contracts'

// normalize a runtime path into key segments
function normalizePath(path: string): string[] {
  return path.replace(/^runtime\./, '').split('.').filter(Boolean)
}

function shouldUseArrayContainer(key: string): boolean {
  return /^\d+$/.test(key)
}

function cloneContainer<T extends Record<string, unknown> | unknown[]>(value: T): T {
  return (Array.isArray(value) ? [...value] : { ...value }) as T
}

function writeNestedPathValue(
    current: unknown,
    keys: string[],
    value: unknown,
): unknown {
  if (keys.length === 0) {
    return Object.is(current, value) ? current : value
  }

  const [key, ...rest] = keys
  const source =
      current && typeof current === 'object'
          ? current as Record<string, unknown> | unknown[]
          : shouldUseArrayContainer(key)
              ? []
              : {}
  const childBefore = (source as Record<string, unknown>)[key]
  const childAfter = writeNestedPathValue(childBefore, rest, value)

  if (childAfter === childBefore && source === current) {
    return current
  }

  const next = cloneContainer(source)
  ;(next as Record<string, unknown>)[key] = childAfter
  return next
}

export function writeObjectPath<T extends Record<string, unknown> | unknown[]>(
    value: T,
    keys: string[],
    nextValue: unknown,
): T {
  if (keys.length === 0) {
    return value
  }

  return writeNestedPathValue(value, keys, nextValue) as T
}

// read a nested value from runtime state
export function readRuntimePath(runtime: ResonatorRuntimeState, path: string): unknown {
  let cursor: unknown = runtime

  for (const key of normalizePath(path)) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined
    }

    cursor = (cursor as Record<string, unknown>)[key]
  }

  return cursor
}

// write a nested value into runtime state immutably
export function writeRuntimePath(
    runtime: ResonatorRuntimeState,
    path: string,
    value: RuntimeValue,
): ResonatorRuntimeState {
  const keys = normalizePath(path)
  if (keys.length === 0) {
    return runtime
  }

  return writeObjectPath(runtime as unknown as Record<string, unknown>, keys, value) as unknown as ResonatorRuntimeState
}
