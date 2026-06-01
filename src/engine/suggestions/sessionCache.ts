/*
  Author: Runor Ewhro
  Description: Provides a small in-memory LRU cache for Suggestions results
               so reopening the pane with identical inputs can reuse the last
               successful computation without re-dispatching worker jobs.
*/

const SUGG_CACHE_MAX = 24
const suggestCache = new Map<string, unknown>()

export function readSuggsSss<T>(key: string): T | null {
  if (!suggestCache.has(key)) {
    return null
  }

  const value = suggestCache.get(key) as T
  suggestCache.delete(key)
  suggestCache.set(key, value)
  return value
}

export function writeSuggsSs<T>(key: string, value: T): void {
  if (suggestCache.has(key)) {
    suggestCache.delete(key)
  }

  suggestCache.set(key, value)

  while (suggestCache.size > SUGG_CACHE_MAX) {
    const oldestKey = suggestCache.keys().next().value
    if (oldestKey == null) {
      break
    }

    suggestCache.delete(oldestKey)
  }
}
