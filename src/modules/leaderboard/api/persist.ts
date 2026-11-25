/*
  Author: Runor Ewhro
  description: persists the leaderboard's last responses across reloads. a
               reload paints this browser's last data (the signed-in viewer, the
               boards, the activity list, the first page of each opened board) at
               once while every query refetches, as for any response past its
               fresh time. stored in localStorage for a day, and only small
               public reads and the viewer's own /me are stored.
*/

import type { Query } from '@tanstack/react-query'
import { queryClient } from '@/shared/lib/queryClient'

const STORE_KEY = 'lb.answers.v1'
/** maximum age of a stored response; older ones are dropped and the page waits for a new one. */
const KEEP_MS = 24 * 3600_000
/** board pages kept: the boards opened most recently. */
const KEEP_BOARDS = 8
/** delay between a response and the store write, which writes a burst of responses once. */
const WRITE_AFTER_MS = 1_000

interface Kept { key: readonly unknown[]; data: unknown; at: number }

/** the stored response kinds: chrome and main page reads, and a board's first page with its stats. */
function keptKind(key: readonly unknown[]): string | null {
  if (key[0] !== 'lb') return null
  const kind = key[1]
  if (kind === 'me' || kind === 'boards' || kind === 'live' || kind === 'activity') return 'page'
  if (kind === 'board-stats' || kind === 'board-counts') return 'board'
  if (kind === 'board') {
    const query = key[3] as { offset?: number } | undefined
    return query && !query.offset ? 'board' : null
  }
  return null
}

function read(): Kept[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const kept = raw ? JSON.parse(raw) as Kept[] : []
    return Array.isArray(kept) ? kept : []
  } catch {
    return []
  }
}

function write(): void {
  const now = Date.now()
  const queries = queryClient.getQueryCache().getAll()
    .filter((query: Query) => query.state.status === 'success' && query.state.data !== undefined && keptKind(query.queryKey) != null)
  const pages = queries.filter((query) => keptKind(query.queryKey) === 'page')
  // a board's reads count as one board, kept by when it was last answered.
  const boards = new Map<string, number>()
  for (const query of queries) {
    if (keptKind(query.queryKey) !== 'board') continue
    const id = String(query.queryKey[2])
    boards.set(id, Math.max(boards.get(id) ?? 0, query.state.dataUpdatedAt))
  }
  const recent = new Set([...boards].sort((a, b) => b[1] - a[1]).slice(0, KEEP_BOARDS).map(([id]) => id))
  const kept: Kept[] = [...pages, ...queries.filter((query) => keptKind(query.queryKey) === 'board' && recent.has(String(query.queryKey[2])))]
    .filter((query) => now - query.state.dataUpdatedAt < KEEP_MS)
    .map((query) => ({ key: query.queryKey, data: query.state.data, at: query.state.dataUpdatedAt }))
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(kept))
  } catch {
    // full or blocked storage: the next reload asks for everything, as it would without this.
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
const schedule = () => {
  if (timer == null) timer = setTimeout(() => { timer = null; write() }, WRITE_AFTER_MS)
}

let restored = false

/** restores stored responses into the cache (once, before the leaderboard first renders) and starts persisting. */
export function restoreLb(): void {
  if (restored || typeof window === 'undefined') return
  restored = true
  const now = Date.now()
  for (const kept of read()) {
    if (!Array.isArray(kept.key) || keptKind(kept.key) == null || now - kept.at >= KEEP_MS) continue
    // a response already in the cache is newer than any stored one
    if (queryClient.getQueryData(kept.key) !== undefined) continue
    // restore with the stored time, which puts it past its fresh time so every query refetches on mount
    queryClient.setQueryData(kept.key, kept.data, { updatedAt: kept.at })
  }
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success' && keptKind(event.query.queryKey) != null) schedule()
    if (event.type === 'removed' && keptKind(event.query.queryKey) != null) schedule()
  })
  window.addEventListener('pagehide', () => { if (timer != null) { clearTimeout(timer); timer = null; write() } })
}
