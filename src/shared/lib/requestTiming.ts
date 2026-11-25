/*
  Author: Runor Ewhro
  description: timing logs from request to paint. each query the cache runs logs
               one line once the first frame showing its data has painted: the
               request time, the wait split (server time from the Server-Timing
               header, network, body read), the draw time, and the time since page
               load. on in dev; elsewhere set localStorage 'lb.timing' to '1'
               (timingLog.ts). window.lbTiming() prints all lines as a table.
*/

import { replaceEqualDeep, type Query, type QueryCache } from '@tanstack/react-query'
import { timingLine, timingMs as ms, timingOn } from './timingLog'

/** a response's own request timings, as measured by send(). */
export interface NetTiming {
  path: string
  status: number
  /** from the request leaving to its headers arriving: the server's time, plus the network and any wait in a queue
      (the browser's six connections, a proxy, a busy dev thread). */
  headersMs: number
  /** reading and parsing the body. */
  bodyMs: number
  /** the server's own time (Server-Timing app;dur), null when unreported. */
  serverMs: number | null
  /** the edge cache result (Server-Timing cache;desc), null when not cached. */
  cache: string | null
  chars: number
}

interface Entry {
  key: string
  kind: 'asked' | 'refresh' | 'kept' | 'failed'
  /** page time (ms since navigation) when the fetch started or the stored response was restored. */
  askedAt: number
  answeredAt: number
  /** page time the first frame showing it painted; null when no view showed it. */
  drawnAt: number | null
  net: NetTiming | null
  note: string
}

const enabled = timingOn

// a body (or error) to its request's timing: the query's data is the very object send() parsed.
const nets = new WeakMap<object, NetTiming>()

/** send() reports each response it read; only bodies that are objects can be matched to their query. */
export function noteResponse(body: unknown, timing: NetTiming): void {
  if (enabled && body != null && typeof body === 'object') nets.set(body, timing)
}

/**
 * the cache's structural sharing (a response equal to the last reuses the last's objects), copying the new response's
 * timing onto the object the query keeps, which lets a refetch still log its split.
 */
export function shareKeepingTiming(old: unknown, next: unknown): unknown {
  const shared = replaceEqualDeep(old, next)
  if (enabled && shared !== next && shared != null && typeof shared === 'object' && next != null && typeof next === 'object') {
    const timing = nets.get(next)
    if (timing) nets.set(shared, timing)
  }
  return shared
}

/** the server time and cache result from a Server-Timing header ("cache;desc=hit, app;dur=12"). */
export function serverTiming(header: string | null): Pick<NetTiming, 'serverMs' | 'cache'> {
  let serverMs: number | null = null
  let cache: string | null = null
  for (const part of (header ?? '').split(',')) {
    const [name, ...params] = part.trim().split(';')
    const param = (key: string) => params.map((p) => p.trim().split('=')).find(([k]) => k === key)?.[1]
    if (name === 'app') serverMs = Number(param('dur') ?? NaN)
    if (name === 'cache') cache = (param('desc') ?? '').replace(/"/g, '') || null
  }
  return { serverMs: Number.isFinite(serverMs) ? serverMs : null, cache }
}

const entries: Entry[] = []
const now = () => performance.now()

/** after the next frame has painted (a frame, then a task after it). */
const afterPaint = (then: () => void) => requestAnimationFrame(() => setTimeout(then, 0))

function print(entry: Entry): void {
  entries.push(entry)
  const { net } = entry
  const wait = entry.answeredAt - entry.askedAt
  const parts: string[] = []
  if (entry.kind === 'kept') parts.push(`kept from the last visit (${entry.note})`)
  else {
    parts.push(`${entry.kind === 'refresh' ? 'refresh' : 'asked'} → answered in ${ms(wait)}`)
    if (net) {
      const server = net.serverMs
      const network = server != null ? Math.max(0, net.headersMs - server) : null
      parts.push(`(server ${server != null ? ms(server) : '?'}, network+queue ${network != null ? ms(network) : ms(net.headersMs)}, ` +
        `body ${ms(net.bodyMs)}, ${(net.chars / 1024).toFixed(0)} KB${net.cache ? `, edge ${net.cache}` : ''}, ${net.status})`)
    }
    if (entry.kind === 'failed') parts.push(`failed: ${entry.note}`)
  }
  if (entry.drawnAt != null) {
    parts.push(`→ drawn ${ms(entry.drawnAt - entry.answeredAt)} later`)
    if (entry.kind !== 'kept') parts.push(`(${ms(entry.drawnAt - entry.askedAt)} from asking)`)
    parts.push(`at page +${ms(entry.drawnAt)}`)
  } else if (entry.kind !== 'failed') parts.push('→ not shown (no view on screen)')
  if (entry.note && entry.kind !== 'kept' && entry.kind !== 'failed') parts.push(`[${entry.note}]`)
  timingLine(`${entry.key}  ${parts.join(' ')}`)
}

/** maximum wait for a view to mount for a response that arrived first (a prefetch) before it is logged as unshown. */
const MOUNT_WAIT_MS = 15_000

/** log every query of the cache from asking to drawing. */
export function watchQueryTiming(cache: QueryCache): void {
  if (!enabled || typeof window === 'undefined') return
  const asked = new Map<string, { at: number; refresh: boolean }>()
  // responses that arrived before any view of them, logged once a view mounts
  const waiting = new Map<string, { entry: Entry; timer: ReturnType<typeof setTimeout> }>()

  const settle = (query: Query, entry: Entry) => {
    if (query.getObserversCount() > 0) {
      afterPaint(() => print({ ...entry, drawnAt: now() }))
      return
    }
    const timer = setTimeout(() => { waiting.delete(query.queryHash); print(entry) }, MOUNT_WAIT_MS)
    waiting.set(query.queryHash, { entry: { ...entry, note: [entry.note, 'answered before its view mounted'].filter(Boolean).join('; ') }, timer })
  }

  cache.subscribe((event) => {
    const query = event.query
    const key = (query.queryKey as unknown[]).map((part) => typeof part === 'object' ? JSON.stringify(part) : String(part)).join(' ')
    if (event.type === 'observerAdded') {
      const held = waiting.get(query.queryHash)
      if (held) {
        waiting.delete(query.queryHash)
        clearTimeout(held.timer)
        afterPaint(() => print({ ...held.entry, drawnAt: now() }))
      }
      return
    }
    if (event.type === 'removed') { asked.delete(query.queryHash); return }
    if (event.type !== 'updated') return
    const action = event.action
    if (action.type === 'fetch') {
      if (!asked.has(query.queryHash)) asked.set(query.queryHash, { at: now(), refresh: query.state.data !== undefined })
      return
    }
    if (action.type === 'success') {
      const start = asked.get(query.queryHash)
      if (action.manual) {
        // a stored response restored on load (with its old time); optimistic edits are not reads
        if (!start && query.state.dataUpdatedAt < Date.now() - 1_000) {
          const age = Math.round((Date.now() - query.state.dataUpdatedAt) / 1000)
          settle(query, { key, kind: 'kept', askedAt: now(), answeredAt: now(), drawnAt: null, net: null, note: `${age}s old` })
        }
        return
      }
      asked.delete(query.queryHash)
      const data = query.state.data
      const net = data != null && typeof data === 'object' ? nets.get(data) ?? null : null
      settle(query, { key, kind: start?.refresh ? 'refresh' : 'asked', askedAt: start?.at ?? now(), answeredAt: now(), drawnAt: null, net,
        note: start?.refresh ? 'the old answer stayed up meanwhile' : '' })
      return
    }
    if (action.type === 'error') {
      const start = asked.get(query.queryHash)
      asked.delete(query.queryHash)
      const error = action.error
      const net = error != null && typeof error === 'object' ? nets.get(error) ?? null : null
      print({ key, kind: 'failed', askedAt: start?.at ?? now(), answeredAt: now(), drawnAt: null, net, note: String((error as Error)?.message ?? error) })
    }
  })

  ;(window as unknown as { lbTiming: () => void }).lbTiming = () => console.table(entries.map((entry) => ({
    key: entry.key, kind: entry.kind, askedAt: Math.round(entry.askedAt), waitMs: Math.round(entry.answeredAt - entry.askedAt),
    serverMs: entry.net?.serverMs ?? null, headersMs: entry.net ? Math.round(entry.net.headersMs) : null,
    bodyMs: entry.net ? Math.round(entry.net.bodyMs) : null, edge: entry.net?.cache ?? null,
    drawMs: entry.drawnAt != null ? Math.round(entry.drawnAt - entry.answeredAt) : null,
    drawnAt: entry.drawnAt != null ? Math.round(entry.drawnAt) : null,
  })))
}
