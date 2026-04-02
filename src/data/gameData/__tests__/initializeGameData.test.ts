import { describe, expect, it, vi } from 'vitest'

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

describe('initializeGameData', () => {
  it('dedupes concurrent initialization work', async () => {
    vi.resetModules()
    const previousFetch = globalThis.fetch

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = resolveRequestUrl(input)

      switch (url) {
        case '/data/resonator-sources.json':
        case '/data/echo-sources.json':
        case '/data/weapon-data.json':
        case '/data/resonator-catalog.json':
        case '/data/echo-catalog.json':
        case '/data/sonata-sets.json':
        case '/data/sonata-set-defs.json':
          return createJsonResponse([])
        case '/data/resonator-details.json':
          return createJsonResponse({})
        case '/data/echo-stats.json':
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
      const { getGameData, initializeGameData } = await import('@/data/gameData')

      await Promise.all([
        initializeGameData(),
        initializeGameData(),
        initializeGameData(),
      ])

      expect(fetchMock).toHaveBeenCalledTimes(9)
      expect(() => getGameData()).not.toThrow()
    } finally {
      globalThis.fetch = previousFetch
      vi.resetModules()
    }
  })
})
