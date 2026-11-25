/*
  Author: Runor Ewhro
  description: edge-cached public reads (the workers cache api), keyed by the
               request url and a version of the response's inputs: a board's
               counter for its pages, players.ver for a profile, the clock for
               the activity strip. changes produce a new key, so stale responses
               are never served and nothing is purged. clock reads (clockJson)
               are the exception: a new window returns the previous window's
               copy at once and builds its own in the background, which keeps
               readers from waiting on the fan-out.
*/

import { json } from './http.ts'

/** the cache key: the url with its query sorted (so equal reads share a key) and the version added. */
function keyFor(url: URL, version: string): Request {
  const params = [...url.searchParams].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const key = new URL(url.origin + url.pathname)
  for (const [name, value] of params) key.searchParams.append(name, value)
  key.searchParams.set('__v', version)
  return new Request(key.toString())
}

/** tags a cached response for the app's timing logs (Server-Timing cache;desc): hit, stale or miss. */
function tagged(response: Response, desc: 'hit' | 'miss'): Response {
  const out = new Response(response.body, response)
  out.headers.append('server-timing', `cache;desc=${desc}`)
  return out
}

const edgeCache = (): Cache | null => (typeof caches !== 'undefined' && 'default' in caches ? (caches as unknown as { default: Cache }).default : null)

export interface CachedRead {
  url: URL
  ctx: ExecutionContext
  /** a string version of the response's inputs that changes with them. */
  version: () => Promise<string | number>
}

/** maximum age of a clock read's previous copy served for an unrequested window. */
const LAST_CLOCK_S = 120
/** delay between returning the previous copy and starting its refresh, which sends the response first. */
const REFRESH_AFTER_MS = 50
/** clock windows being made in this isolate: one refresh each, however many readers find it missing. */
const making = new Set<string>()

/**
 * a public read versioned by the clock (every `ms`): served from this window's copy, else the previous window's (up to
 * LAST_CLOCK_S old) while this one builds in the background, else produced. the previous copy is cached under its own
 * key with a longer edge lifetime, and browsers cache neither (max-age 0).
 */
export async function clockJson(read: Pick<CachedRead, 'url' | 'ctx'>, ms: number, seconds: number, produce: () => Promise<unknown>): Promise<Response> {
  const cache = edgeCache()
  if (!cache) return json(await produce(), { cacheSeconds: seconds })
  const key = keyFor(read.url, `t${Math.floor(Date.now() / ms)}`)
  const lastKey = keyFor(read.url, 'last')
  const hit = await cache.match(key)
  if (hit) return tagged(hit, 'hit')
  const make = async () => {
    const body = await produce()
    const response = json(body, { cacheSeconds: seconds })
    await Promise.all([cache.put(key, response.clone()), cache.put(lastKey, json(body, { cacheSeconds: LAST_CLOCK_S }))])
    return response
  }
  const last = await cache.match(lastKey)
  if (!last) return tagged(await make(), 'miss')
  // read the whole body before the refresh starts; boards on this thread (local dev) would stall a streamed body
  const body = await last.text()
  if (!making.has(key.url)) {
    making.add(key.url)
    read.ctx.waitUntil(new Promise((resolve) => setTimeout(resolve, REFRESH_AFTER_MS)).then(make)
      .then(() => undefined, (error: unknown) => console.error('clock read refresh failed', error))
      .finally(() => making.delete(key.url)))
  }
  // browser and proxy cache lifetime matches the window's own response
  const headers = new Headers(last.headers)
  headers.set('cache-control', `public, max-age=0, s-maxage=${seconds}`)
  headers.append('server-timing', 'cache;desc=stale')
  return new Response(body, { status: last.status, headers })
}

/** a public read: served from the edge cache for this version, or produced, answered and stored. */
export async function publicJson(read: CachedRead, seconds: number, produce: () => Promise<unknown>): Promise<Response> {
  const cache = edgeCache()
  if (!cache) return json(await produce(), { cacheSeconds: seconds })
  const key = keyFor(read.url, String(await read.version()))
  const hit = await cache.match(key)
  if (hit) return tagged(hit, 'hit')
  const response = json(await produce(), { cacheSeconds: seconds })
  read.ctx.waitUntil(cache.put(key, response.clone()))
  return tagged(response, 'miss')
}

/** owner-specific responses are not cached; other viewers get a public read. */
export const ownedOrPublicJson = (read: CachedRead, own: boolean, seconds: number, produce: () => Promise<unknown>): Promise<Response> =>
  own ? produce().then((body) => json(body)) : publicJson(read, seconds, produce)
