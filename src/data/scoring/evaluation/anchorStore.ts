/*
  Author: Runor Ewhro
  Description: Owns anchor store behavior and state transitions for the evaluation module.
*/
import type { EvaluationAnchors } from './search.ts'

const DB_NAME = 'wuwa-evaluation'
const STORE_NAME = 'anchors'
const DB_VERSION = 1
// Persisted anchors encode scoring-engine and generated-data assumptions that
// are not fully represented by a user's runtime. Bump this whenever those
// assumptions change so an older bundle cannot grade a current build.
export const EVALUATION_ANCHOR_CACHE_REVISION = 14
// Anchor bundles contain generated build details. Keep persistence bounded too;
// the in-memory LRU remains the hot path and a miss is preferable to retaining
// an unbounded catalog of stale reports on disk.
const MAX_STORED_ANCHORS = 16
const MAX_HYDRATED_ANCHORS = 8

export interface StoredAnchor {
  key: string
  anchors: EvaluationAnchors
  ts: number
  revision?: number
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

export function selectCurrentAnchorEntries(
  rows: readonly StoredAnchor[],
): Array<[string, EvaluationAnchors]> {
  const current = rows
    .filter((row) => row.revision === EVALUATION_ANCHOR_CACHE_REVISION)
    .sort((left, right) => left.ts - right.ts)
  return current
    .slice(Math.max(0, current.length - MAX_HYDRATED_ANCHORS))
    .map((row) => [row.key, row.anchors])
}

// Read every persisted anchor, oldest first, so the caller can rebuild an LRU
// map by re-inserting in order (the most-recently-used ends up newest).
export async function loadPersistedAnchors(): Promise<Array<[string, EvaluationAnchors]>> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    try {
      const request = storeFor(db, 'readonly').getAll()
      request.onsuccess = () => {
        const rows = (request.result as StoredAnchor[]) ?? []
        resolve(selectCurrentAnchorEntries(rows))
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
export function persistAnchor(key: string, anchors: EvaluationAnchors): void {
  void openDb().then((db) => {
    if (!db) return
    try {
      const store = storeFor(db, 'readwrite')
      store.put({
        key,
        anchors,
        ts: Date.now(),
        revision: EVALUATION_ANCHOR_CACHE_REVISION,
      } satisfies StoredAnchor)
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
