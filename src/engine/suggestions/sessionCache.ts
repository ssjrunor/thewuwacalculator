/*
  Author: Runor Ewhro
  Description: Provides a small in-memory LRU cache for Suggestions results
               so reopening the pane with identical inputs can reuse the last
               successful computation without re-dispatching worker jobs.
*/

const MAX_SUGGESTIONS_CACHE_ENTRIES = 24
const suggestionsSessionCache = new Map<string, unknown>()

export function readSuggestionsSessionCache<T>(key: string): T | null {
  if (!suggestionsSessionCache.has(key)) {
    return null
  }

  const value = suggestionsSessionCache.get(key) as T
  suggestionsSessionCache.delete(key)
  suggestionsSessionCache.set(key, value)
  return value
}

export function writeSuggestionsSessionCache<T>(key: string, value: T): void {
  if (suggestionsSessionCache.has(key)) {
    suggestionsSessionCache.delete(key)
  }

  suggestionsSessionCache.set(key, value)

  while (suggestionsSessionCache.size > MAX_SUGGESTIONS_CACHE_ENTRIES) {
    const oldestKey = suggestionsSessionCache.keys().next().value
    if (oldestKey == null) {
      break
    }

    suggestionsSessionCache.delete(oldestKey)
  }
}
