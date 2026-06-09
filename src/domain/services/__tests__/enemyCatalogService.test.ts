import { afterEach, describe, expect, it, vi } from 'vitest'

function createJsonResponse<T>(data: T): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response
}

describe('enemyCatalogService', () => {
  const previousFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = previousFetch
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('normalizes enemy elements from catalog object and lowercase raw fields', async () => {
    vi.resetModules()
    const fetchMock = vi.fn(async () => createJsonResponse([
      {
        Id: 1,
        Name: 'Object Element Enemy',
        Class: 1,
        Element: {
          Id: 0,
          Name: 'Physical',
        },
        ElementArray: [0],
      },
      {
        id: 2,
        name: 'Lowercase Element Enemy',
        class: 2,
        element: 3,
        elementArray: [2, 3],
      },
      {
        Id: 3,
        Name: 'Array Only Enemy',
        Class: 3,
        ElementArray: [6],
      },
    ]))
    globalThis.fetch = fetchMock as typeof fetch

    const { fltrEnemyCat, loadEnemyCat } = await import('@/domain/services/enemyCatalogService')

    const catalog = await loadEnemyCat()

    expect(catalog.find((entry) => entry.id === '1')).toMatchObject({
      element: 0,
      elementArray: [0],
    })
    expect(catalog.find((entry) => entry.id === '2')).toMatchObject({
      element: 3,
      elementArray: [2, 3],
    })
    expect(catalog.find((entry) => entry.id === '3')).toMatchObject({
      element: null,
      elementArray: [6],
    })
    expect(fltrEnemyCat(catalog, { element: 2 }).map((entry) => entry.id)).toEqual(['2'])
    expect(fltrEnemyCat(catalog, { element: 6 }).map((entry) => entry.id)).toEqual(['3'])
  })
})
