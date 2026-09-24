/*
  Author: Runor Ewhro
  Description: Caches and invalidates evaluation anchors by catalog, scenario, and scoring identity.
*/
import type { EvaluationAnchors } from './search.ts'

const DB_NAME = 'wuwa-evaluation'
const STORE_NAME = 'anchors'
const DB_VERSION = 1
// Persisted anchors encode scoring-engine and generated-data assumptions that
// are not fully represented by a user's runtime. Bump this whenever those
// assumptions change so an older bundle cannot grade a current build.
export const EVALUATION_ANCHOR_CACHE_REVISION = 1
// Anchor bundles contain compact scoring inputs. Keep persistence bounded too;
// the in-memory LRU remains the hot path and a miss is preferable to retaining
// an unbounded catalog of stale reports on disk.
const MAX_STORED_ANCHORS = 16
const MAX_HYDRATED_ANCHORS = 2

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

// Cursor through persisted entries one at a time. getAll() materialized every
// large anchor bundle together, even though the worker retains only two.
export async function loadPersistedAnchors(): Promise<Array<[string, EvaluationAnchors]>> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    try {
      const recent: StoredAnchor[] = []
      const request = storeFor(db, 'readonly').openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(selectCurrentAnchorEntries(recent))
          return
        }
        const row = cursor.value as StoredAnchor
        if (row.revision === EVALUATION_ANCHOR_CACHE_REVISION) {
          recent.push(row)
          recent.sort((left, right) => right.ts - left.ts)
          recent.length = Math.min(recent.length, MAX_HYDRATED_ANCHORS)
        }
        cursor.continue()
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
      const entries: Array<{ key: string; ts: number }> = []
      const cursorRequest = store.openCursor()
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (cursor) {
          const row = cursor.value as StoredAnchor
          entries.push({ key: row.key, ts: row.ts })
          cursor.continue()
          return
        }
        if (entries.length <= MAX_STORED_ANCHORS) return
        entries.sort((left, right) => left.ts - right.ts)
        for (const row of entries.slice(0, entries.length - MAX_STORED_ANCHORS)) {
          store.delete(row.key)
        }
      }
    } catch {
      // ignore persistence failures; the in-memory cache still works
    }
  })
}
