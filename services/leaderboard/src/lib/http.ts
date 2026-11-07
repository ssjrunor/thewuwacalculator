/*
  Author: Runor Ewhro
  description: json responses, the ApiError envelope, cache headers and cors
               for the app origin. handlers throw HttpError; the router turns
               it into the envelope, so no handler builds error bodies itself.
*/

import type { ApiError } from '@/domain/leaderboard/api'

export type ErrorCode = ApiError['error']['code']

const STATUS: Record<ErrorCode, number> = {
  bad_link: 400, not_kuro: 400, fetch_failed: 502, too_large: 413, bad_image: 422,
  not_fresh: 403, uid_unreadable: 422, unreadable: 422, incomplete_build: 422, read_failed: 503, opted_out: 403, blocked: 403,
  duplicate: 409, rate_limited: 429, unauthorized: 401, forbidden: 403, not_found: 404,
  bad_request: 400, turnstile_failed: 403, internal: 500,
}

export class HttpError extends Error {
  readonly code: ErrorCode
  readonly status: number

  constructor(code: ErrorCode, message: string, status: number = STATUS[code]) {
    super(message)
    this.name = 'HttpError'
    this.code = code
    this.status = status
  }
}

export interface ResponseOptions {
  status?: number
  /** public edge cache seconds (s-maxage); omitted means private, no-store. */
  cacheSeconds?: number
  headers?: HeadersInit
}

export function json(body: unknown, options: ResponseOptions = {}): Response {
  // responses are private and uncached by default; public edge caching requires an explicit duration.
  const headers = new Headers(options.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', options.cacheSeconds != null
    ? `public, max-age=0, s-maxage=${options.cacheSeconds}`
    : 'private, no-store')
  return new Response(JSON.stringify(body), { status: options.status ?? 200, headers })
}

export function errorResponse(error: HttpError): Response {
  const body: ApiError = { error: { code: error.code, message: error.message } }
  return json(body, { status: error.status })
}

/** cors for the app's own origin only; credentials are allowed for the session cookie. */
export function withCors(response: Response, request: Request, appOrigin: string): Response {
  const origin = request.headers.get('origin')
  if (origin !== appOrigin) return response
  const next = new Response(response.body, response)
  next.headers.set('access-control-allow-origin', appOrigin)
  next.headers.set('access-control-allow-credentials', 'true')
  next.headers.append('vary', 'Origin')
  return next
}

export function preflight(request: Request, appOrigin: string): Response {
  const headers = new Headers({ 'access-control-max-age': '600' })
  if (request.headers.get('origin') === appOrigin) {
    headers.set('access-control-allow-origin', appOrigin)
    headers.set('access-control-allow-credentials', 'true')
    headers.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    headers.set('access-control-allow-headers', 'content-type')
  }
  return new Response(null, { status: 204, headers })
}

/** the request body as json, refusing anything that is not a json object. */
export async function readJsonBody<T>(request: Request, maxBytes = 16_384): Promise<T> {
  // the existing limit counts decoded string characters; accepted JSON must be a non-null object, excluding arrays.
  const text = await request.text()
  if (text.length > maxBytes) throw new HttpError('bad_request', 'request body too large', 413)
  try {
    const value = JSON.parse(text)
    if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
    return value as T
  } catch {
    throw new HttpError('bad_request', 'request body is not a json object')
  }
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown'
}
