/*
  Author: Runor Ewhro
  Description: Provides helpers for reading and writing nested runtime state
               values using dot-path access.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import type { RuntimeValue } from '@/domain/gameData/contracts'

// normalize a runtime path into key segments
function normPath(path: string): string[] {
  return path.replace(/^runtime\./, '').split('.').filter(Boolean)
}

function shldUseRryCn(key: string): boolean {
  return /^\d+$/.test(key)
}

function cloneCntn<T extends Record<string, unknown> | unknown[]>(value: T): T {
  return (Array.isArray(value) ? [...value] : { ...value }) as T
}

function writeNstdPat(
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
          : shldUseRryCn(key)
              ? []
              : {}
  const childBefore = (source as Record<string, unknown>)[key]
  const childAfter = writeNstdPat(childBefore, rest, value)

  if (childAfter === childBefore && source === current) {
    return current
  }

  const next = cloneCntn(source)
  ;(next as Record<string, unknown>)[key] = childAfter
  return next
}

export function writeBjctPat<T extends Record<string, unknown> | unknown[]>(
    value: T,
    keys: string[],
    nextValue: unknown,
): T {
  if (keys.length === 0) {
    return value
  }

  return writeNstdPat(value, keys, nextValue) as T
}

// read a nested value from runtime state
export function readRtPath(runtime: ResRuntime, path: string): unknown {
  let cursor: unknown = runtime

  for (const key of normPath(path)) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined
    }

    cursor = (cursor as Record<string, unknown>)[key]
  }

  return cursor
}

// write a nested value into runtime state immutably
export function writeRtPath(
    runtime: ResRuntime,
    path: string,
    value: RuntimeValue,
): ResRuntime {
  const keys = normPath(path)
  if (keys.length === 0) {
    return runtime
  }

  return writeBjctPat(runtime as unknown as Record<string, unknown>, keys, value) as unknown as ResRuntime
}
