/*
  Author: Runor Ewhro
  Description: IndexedDB-backed persistence for benchmark anchor bundles. The
               0/100/200 anchor search is the multi-second part of a benchmark
               and depends on the build only through the ER target + utility
               plan, so its result is highly reusable. Persisting the bundles
               lets a cold worker (after idle teardown) or a freshly reloaded
               page re-score instantly from disk instead of repeating the search.
               Anchors are plain data, so they round-trip through IndexedDB
               cleanly. Every entry point degrades to a no-op when IndexedDB is
               unavailable (e.g. the Node test environment), so callers never
               need to special-case it.
*/
import type { BenchmarkAnchors } from './search.ts'

const DB_NAME = 'wuwa-benchmark'
const STORE_NAME = 'anchors'
const DB_VERSION = 1
// Anchor bundles are KB-scale plain objects, so a generous on-disk set is cheap
// while still capping unbounded growth across many resonators/enemies.
const MAX_STORED_ANCHORS = 48

interface StoredAnchor {
  key: string
  anchors: BenchmarkAnchors
  ts: number
}

function getIndexedDb(): IDBFactory | null {
  const scope = globalThis as { indexedDB?: IDBFactory }
  return scope.indexedDB ?? null
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  const idb = getIndexedDb()
  if (!idb) {
    dbPromise = Promise.resolve(null)
    return dbPromise
  }
  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = idb.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return dbPromise
}

function storeFor(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)
}

// Read every persisted anchor, oldest first, so the caller can rebuild an LRU
// map by re-inserting in order (the most-recently-used ends up newest).
export async function loadPersistedAnchors(): Promise<Array<[string, BenchmarkAnchors]>> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    try {
      const request = storeFor(db, 'readonly').getAll()
      request.onsuccess = () => {
        const rows = (request.result as StoredAnchor[]) ?? []
        rows.sort((left, right) => left.ts - right.ts)
        resolve(rows.map((row) => [row.key, row.anchors] as [string, BenchmarkAnchors]))
      }
      request.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

// Fire-and-forget write-through. Stores the bundle and prunes the oldest entries
// beyond the cap, all in one transaction. Failures are swallowed because the in-memory
// cache is the source of truth; persistence is a best-effort accelerator.
export function persistAnchor(key: string, anchors: BenchmarkAnchors): void {
  void openDb().then((db) => {
    if (!db) return
    try {
      const store = storeFor(db, 'readwrite')
      store.put({ key, anchors, ts: Date.now() } satisfies StoredAnchor)
      const allRequest = store.getAll()
      allRequest.onsuccess = () => {
        const rows = (allRequest.result as StoredAnchor[]) ?? []
        if (rows.length <= MAX_STORED_ANCHORS) return
        rows.sort((left, right) => left.ts - right.ts)
        for (const row of rows.slice(0, rows.length - MAX_STORED_ANCHORS)) {
          store.delete(row.key)
        }
      }
    } catch {
      // ignore persistence failures; the in-memory cache still works
    }
  })
}
