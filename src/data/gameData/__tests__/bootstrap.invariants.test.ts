/*
  Author: Runor Ewhro
  Description: Verifies game-data initialization ordering, shared concurrent loads, retry cleanup, and prehydration.
*/

import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
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

  it('loads only requested resonator bundles for a scoped worker registry', async () => {
    vi.resetModules()
    clearGameDataState()
    const previousFetch = globalThis.fetch
    const requested: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = resolveRequestUrl(input)
      requested.push(url)
      if (url.endsWith('/resonators/picker-catalog.json')) return createJsonResponse([{ id: '1234' }])
      if (url.endsWith('/worker-bundles/1234.json')) {
        return {
          ok: true,
          json: async () => ({
            source: { source: { type: 'resonator', id: '1234' }, damageEntries: [] },
            details: null,
          }),
        } as Response
      }
      if (url.endsWith('/echoes/stats.json')) {
        return createJsonResponse({
          primaryStats: {}, secondaryStats: {}, substatKeys: [], substatRanges: {},
        })
      }
      return createJsonResponse([])
    }) as typeof fetch
    try {
      const { getGameData, initGameData } = await import('@/data/gameData')
      await initGameData({ resonatorIds: ['1234', '1234'] })
      expect(getGameData().sourcesByKey['resonator:1234']).toBeDefined()
      expect(requested.filter((url) => url.includes('worker-bundles'))).toEqual([
        '/data/beta/resonators/worker-bundles/1234.json',
      ])
      expect(requested.some((url) => url.endsWith('/resonators/sources.json'))).toBe(false)
      expect(requested.some((url) => url.endsWith('/resonators/details.json'))).toBe(false)
      expect(requested.some((url) => url.endsWith('/resonators/damage-entries.json'))).toBe(false)
    } finally {
      globalThis.fetch = previousFetch
      clearGameDataState()
      vi.resetModules()
    }
  })

  it('builds a valid scoped registry from generated beta bundles', async () => {
    vi.resetModules()
    clearGameDataState()
    const previousFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = resolveRequestUrl(input)
      return {
        ok: true,
        json: async () => JSON.parse(await readFile(`public${url}`, 'utf8')),
      } as Response
    }) as typeof fetch
    try {
      const { getGameData, initGameData } = await import('@/data/gameData')
      await initGameData({ mode: 'beta', resonatorIds: ['1311'] })
      const registry = getGameData()
      expect(registry.sourcesByKey['resonator:1311']).toBeDefined()
      expect(registry.resonatorDamageEntriesById['1311']?.length).toBeGreaterThan(0)
      expect(registry.sourcesByKey['resonator:1205']).toBeUndefined()
    } finally {
      globalThis.fetch = previousFetch
      clearGameDataState()
      vi.resetModules()
    }
  })

  it('dedupes kit loads, releases unpinned kits, and reloads them without refetching common catalogs', async () => {
    vi.resetModules()
    clearGameDataState()
    const previousFetch = globalThis.fetch
    const requested: string[] = []
    let failNext = false
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = resolveRequestUrl(input)
      requested.push(url)
      if (failNext && url.includes('/worker-bundles/')) {
        failNext = false
        throw new Error('temporary kit failure')
      }
      return { ok: true, json: async () => JSON.parse(await readFile(`public${url}`, 'utf8')) } as Response
    }) as typeof fetch
    try {
      const data = await import('@/data/gameData')
      await data.initGameData({ resonatorIds: ['1202'] })
      const { getResCat, getResCatByI } = await import('@/data/gameData/resonators/resonatorDataStore')
      expect(getResCat().find((seed) => seed.id === '1202')?.baseStatsByLevel).toBeUndefined()
      expect(getResCatByI()['1202'].baseStatsByLevel).toBeDefined()
      const others = getResCat().map((seed) => seed.id).filter((id) => id !== '1202').slice(0, 6)
      const release = data.holdResonatorData([others[0]])
      await Promise.all([data.ensureResonatorData([others[0]]), data.ensureResonatorData([others[0]])])
      expect(requested.filter((url) => url.endsWith(`/worker-bundles/${others[0]}.json`))).toHaveLength(1)
      const knownFeatures = data.getKnownFeatureIds()
      for (const id of others.slice(1)) await data.ensureResonatorData([id])
      await new Promise((resolve) => setTimeout(resolve, 15))
      expect(data.hasResonatorData(['1202', others[0]])).toBe(true)
      expect(data.hasResonatorData([others[1]])).toBe(false)
      release()
      await new Promise((resolve) => setTimeout(resolve, 15))
      expect(data.hasResonatorData([others[0]])).toBe(false)
      expect(getResCatByI()[others[0]].baseStatsByLevel).toBeUndefined()
      expect(data.getKnownFeatureIds()).toBe(knownFeatures)
      const kits = Object.keys(data.getGameData().sourcesByKey).filter((key) => key.startsWith('resonator:'))
      expect(kits).toHaveLength(4)
      failNext = true
      await expect(data.ensureResonatorData([others[0]])).rejects.toThrow('temporary kit failure')
      await data.ensureResonatorData([others[0]])
      expect(data.hasResonatorData([others[0]])).toBe(true)
      expect(requested.filter((url) => url.endsWith('/weapons/catalog.json'))).toHaveLength(1)
      expect(requested.some((url) => url.endsWith('/resonators/details.json'))).toBe(false)
    } finally {
      globalThis.fetch = previousFetch
      clearGameDataState()
      vi.resetModules()
    }
  })
})
