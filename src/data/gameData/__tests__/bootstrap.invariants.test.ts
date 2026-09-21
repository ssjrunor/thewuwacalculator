/*
  Author: Runor Ewhro
  Description: Verifies game-data initialization ordering, shared concurrent loads, retry cleanup, and prehydration.
*/

import { describe, expect, it, vi } from 'vitest'
import type { GameDataReg } from '@/domain/gameData/contracts'

// response fixtures only need json() because the bootstrap loader never reads
// status metadata for these generated data requests
function createJsonResponse<T>(data: T): Response {
  return {
    json: async () => data,
  } as Response
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return input.url
}

// tests import the data module repeatedly, so the singleton has to be removed
// from global state as well as from the module cache
function clearGameDataState() {
  delete (globalThis as typeof globalThis & {
    __wuwaGameDataState__?: unknown
  }).__wuwaGameDataState__
}

describe('game data bootstrap invariants', () => {
  it('throws when the registry is read before initialization', async () => {
    vi.resetModules()
    clearGameDataState()

    try {
      const { getGameData } = await import('@/data/gameData')
      expect(() => getGameData()).toThrow('Game data not initialized, call initializeGameData() first')
    } finally {
      clearGameDataState()
      vi.resetModules()
    }
  })

  it('dedupes concurrent initialization work', async () => {
    vi.resetModules()
    clearGameDataState()
    const previousFetch = globalThis.fetch

    // the exact request list matters because a second in-flight initializer
    // should await the first one instead of duplicating every data fetch
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = resolveRequestUrl(input)

      switch (url) {
        case '/data/beta/resonators/sources.json':
        case '/data/beta/resonators/damage-entries.json':
        case '/data/beta/echoes/sources.json':
        case '/data/beta/enemies/sources.json':
        case '/data/beta/weapons/sources.json':
        case '/data/beta/weapons/catalog.json':
        case '/data/beta/resonators/catalog.json':
        case '/data/beta/echoes/catalog.json':
        case '/data/beta/sonata/sets.json':
        case '/data/beta/sonata/effects.json':
          return createJsonResponse([])
        case '/data/beta/resonators/details.json':
          return createJsonResponse({})
        case '/data/beta/echoes/stats.json':
          return createJsonResponse({
            primaryStats: {},
            secondaryStats: {},
            substatKeys: [],
            substatRanges: {},
          })
        default:
          throw new Error(`Unexpected fetch request: ${url}`)
      }
    })

    globalThis.fetch = fetchMock as typeof fetch

    try {
      const { getGameData, initGameData: initializeGameData } = await import('@/data/gameData')

      await Promise.all([
        initializeGameData(),
        initializeGameData(),
        initializeGameData(),
      ])

      expect(fetchMock).toHaveBeenCalledTimes(12)
      expect(() => getGameData()).not.toThrow()
    } finally {
      globalThis.fetch = previousFetch
      clearGameDataState()
      vi.resetModules()
    }
  })

  it('clears the in-flight promise after a failed attempt so the next call can retry', async () => {
    vi.resetModules()
    clearGameDataState()
    const previousFetch = globalThis.fetch

    // fail only the first echo-stats request so the retry proves the rejected
    // promise was cleared rather than cached as the permanent bootstrap result
    let failEchoStats = true
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = resolveRequestUrl(input)

      switch (url) {
        case '/data/beta/resonators/sources.json':
        case '/data/beta/resonators/damage-entries.json':
        case '/data/beta/echoes/sources.json':
        case '/data/beta/enemies/sources.json':
        case '/data/beta/weapons/sources.json':
        case '/data/beta/weapons/catalog.json':
        case '/data/beta/resonators/catalog.json':
        case '/data/beta/echoes/catalog.json':
        case '/data/beta/sonata/sets.json':
        case '/data/beta/sonata/effects.json':
          return createJsonResponse([])
        case '/data/beta/resonators/details.json':
          return createJsonResponse({})
        case '/data/beta/echoes/stats.json':
          if (failEchoStats) {
            failEchoStats = false
            throw new Error('echo stats unavailable')
          }

          return createJsonResponse({
            primaryStats: {},
            secondaryStats: {},
            substatKeys: [],
            substatRanges: {},
          })
        default:
          throw new Error(`Unexpected fetch request: ${url}`)
      }
    })

    globalThis.fetch = fetchMock as typeof fetch

    try {
      const { getGameData, initGameData } = await import('@/data/gameData')

      await expect(initGameData()).rejects.toThrow('echo stats unavailable')
      expect(() => getGameData()).toThrow('Game data not initialized')

      await expect(initGameData()).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledTimes(24)
      expect(() => getGameData()).not.toThrow()
    } finally {
      globalThis.fetch = previousFetch
      clearGameDataState()
      vi.resetModules()
    }
  })

  it('accepts a prehydrated registry and skips network initialization', async () => {
    vi.resetModules()
    clearGameDataState()
    const previousFetch = globalThis.fetch
    const fetchMock = vi.fn()

    globalThis.fetch = fetchMock as typeof fetch

    try {
      const { getGameData, hydrGameData, initGameData } = await import('@/data/gameData')
      // hydration is used by tests and non-browser entry points that already
      // own the generated registry, so init must become a no-op afterwards
      const registry = { marker: 'preloaded-registry' } as unknown as GameDataReg

      hydrGameData(registry)
      await expect(initGameData()).resolves.toBeUndefined()

      expect(getGameData()).toBe(registry)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = previousFetch
      clearGameDataState()
      vi.resetModules()
    }
  })

  it('fetches the live snapshot when requested explicitly', async () => {
    vi.resetModules()
    clearGameDataState()
    const previousFetch = globalThis.fetch

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = resolveRequestUrl(input)

      switch (url) {
        case '/data/live/resonators/sources.json':
        case '/data/live/resonators/damage-entries.json':
        case '/data/live/echoes/sources.json':
        case '/data/live/enemies/sources.json':
        case '/data/live/weapons/sources.json':
        case '/data/live/weapons/catalog.json':
        case '/data/live/resonators/catalog.json':
        case '/data/live/echoes/catalog.json':
        case '/data/live/sonata/sets.json':
        case '/data/live/sonata/effects.json':
          return createJsonResponse([])
        case '/data/live/resonators/details.json':
          return createJsonResponse({})
        case '/data/live/echoes/stats.json':
          return createJsonResponse({
            primaryStats: {},
            secondaryStats: {},
            substatKeys: [],
            substatRanges: {},
          })
        default:
          throw new Error(`Unexpected fetch request: ${url}`)
      }
    })

    globalThis.fetch = fetchMock as typeof fetch

    try {
      const { initGameData, getGameDataMode } = await import('@/data/gameData')

      await expect(initGameData({ mode: 'live' })).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledTimes(12)
      expect(getGameDataMode()).toBe('live')
    } finally {
      globalThis.fetch = previousFetch
      clearGameDataState()
      vi.resetModules()
    }
  })
})
