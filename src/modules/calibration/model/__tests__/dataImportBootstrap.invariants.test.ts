/*
  Author: Runor Ewhro
  description: verifies data-import workers start with empty caches and load
               their own catalogs before resolving imported snapshots.
*/

import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { makeAppState } from '@/engine/runtime/defaults'
import type { DataImportWorkerRequest, DataImportWorkerResponse } from '../dataImport.worker'

describe('data import worker bootstrap', () => {
  it.each(['live', 'beta'] as const)('imports files and legacy text from a fresh %s worker', async (mode) => {
    const snapshot = makeAppState()
    const globals = globalThis as typeof globalThis & { __wuwaGameDataState__?: unknown }
    const previousData = globals.__wuwaGameDataState__
    const previousFetch = globalThis.fetch
    const scope = {
      onmessage: null as ((event: MessageEvent<DataImportWorkerRequest>) => Promise<void>) | null,
      postMessage: vi.fn<(message: DataImportWorkerResponse) => void>(),
    }

    vi.resetModules()
    delete globals.__wuwaGameDataState__
    vi.stubGlobal('self', scope)
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url.endsWith('.wasm')) {
        return new Response(new Uint8Array(await readFile(url)), {
          headers: { 'Content-Type': 'application/wasm' },
        })
      }
      return new Response(await readFile(`public${url}`, 'utf8'))
    }) as typeof fetch

    try {
      // Importing the entry must not initialize the browser's application store.
      await import('../dataImport.worker')
      expect(globalThis.fetch).not.toHaveBeenCalled()
      const data = await import('@/data/gameData')
      expect(() => data.getGameData()).toThrow('Game data not initialized')

      const { encAppFileBy } = await import('@/application/persistence/fileCodec')
      const bytes = await encAppFileBy(JSON.stringify(snapshot))
      await scope.onmessage!({ data: {
        id: 1,
        gameDataMode: mode,
        job: {
          kind: 'snapshot',
          source: { kind: 'bytes', bytes: bytes.buffer as ArrayBuffer },
          currentState: snapshot,
        },
      } } as MessageEvent<DataImportWorkerRequest>)

      expect(data.getGameDataMode()).toBe(mode)
      expect(scope.postMessage).toHaveBeenLastCalledWith({
        id: 1,
        ok: true,
        result: { kind: 'snapshot', result: { label: 'full snapshot', snapshot } },
      })

      await scope.onmessage!({ data: {
        id: 2,
        gameDataMode: mode,
        job: { kind: 'legacy', source: { kind: 'text', raw: '{}' } },
      } } as MessageEvent<DataImportWorkerRequest>)
      expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
        id: 2, ok: true, result: expect.objectContaining({ kind: 'legacy' }),
      }))
    } finally {
      vi.unstubAllGlobals()
      globalThis.fetch = previousFetch
      globals.__wuwaGameDataState__ = previousData
      vi.resetModules()
    }
  })
})
