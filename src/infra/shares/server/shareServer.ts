/*
  Author: Runor Ewhro
  Description: Worker-side anonymous share storage for compact app share links.
*/

export interface ShareKvNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export interface ShareEnv {
  SHARES?: ShareKvNamespace
}

export interface ShareServerResult {
  body: unknown
  status: number
  headers?: Record<string, string>
}

interface ShareRequest {
  body?: string
  clientId?: string
  env: ShareEnv
  method: string
  requestUrl: string
}

const SHARE_KEY_PREFIX = 'share:v1:'
const RATE_KEY_PREFIX = 'share-rate:v1:'
const SHARE_TTL_SECONDS = 60 * 60 * 24 * 90
const RATE_TTL_SECONDS = 60 * 60
const MAX_SHARES_PER_RATE_WINDOW = 60
const MAX_SHARE_BYTES = 512 * 1024
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,96}$/

function jsonError(error: string, status: number): ShareServerResult {
  return { body: { error }, status }
}

function bodySize(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function normalizePayload(body = ''): string | null {
  if (!body.trim() || bodySize(body) > MAX_SHARE_BYTES) {
    return null
  }

  try {
    const parsed = JSON.parse(body) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const record = parsed as Record<string, unknown>
    if (
      record.source !== 'wuwa-calculator' ||
      typeof record.kind !== 'string' ||
      record.kind.length > 80 ||
      typeof record.version !== 'number' ||
      !Number.isFinite(record.version)
    ) {
      return null
    }

    return JSON.stringify(parsed)
  } catch {
    return null
  }
}

function makeShareToken(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

async function createUnusedToken(store: ShareKvNamespace): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = makeShareToken()
    const existing = await store.get(SHARE_KEY_PREFIX + token)
    if (!existing) {
      return token
    }
  }

  return null
}

async function checkRateLimit(store: ShareKvNamespace, clientId = 'anonymous'): Promise<boolean> {
  const safeClient = clientId.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120) || 'anonymous'
  const key = `${RATE_KEY_PREFIX}${safeClient}`
  const current = Number(await store.get(key) ?? '0')
  if (Number.isFinite(current) && current >= MAX_SHARES_PER_RATE_WINDOW) {
    return false
  }

  await store.put(key, String((Number.isFinite(current) ? current : 0) + 1), {
    expirationTtl: RATE_TTL_SECONDS,
  })
  return true
}

async function onCreateShare({ body, clientId, env, requestUrl }: ShareRequest): Promise<ShareServerResult> {
  if (!env.SHARES) {
    return jsonError('Share storage is not configured', 500)
  }

  if (!await checkRateLimit(env.SHARES, clientId)) {
    return jsonError('Too many share requests', 429)
  }

  const payload = normalizePayload(body)
  if (!payload) {
    return jsonError('Invalid or oversized share payload', 400)
  }

  const token = await createUnusedToken(env.SHARES)
  if (!token) {
    return jsonError('Could not allocate share token', 503)
  }

  await env.SHARES.put(SHARE_KEY_PREFIX + token, payload, {
    expirationTtl: SHARE_TTL_SECONDS,
  })

  const url = new URL(requestUrl)
  url.pathname = '/modulation'
  url.search = `?s=${encodeURIComponent(token)}`
  url.hash = ''

  return {
    body: { token, url: url.toString() },
    status: 200,
  }
}

async function onGetShare({ env, requestUrl }: ShareRequest): Promise<ShareServerResult> {
  if (!env.SHARES) {
    return jsonError('Share storage is not configured', 500)
  }

  const url = new URL(requestUrl)
  const token = decodeURIComponent(url.pathname.slice('/api/shares/'.length))
  if (!TOKEN_PATTERN.test(token)) {
    return jsonError('Invalid share token', 400)
  }

  const payload = await env.SHARES.get(SHARE_KEY_PREFIX + token)
  if (!payload) {
    return jsonError('Share not found', 404)
  }

  return {
    body: payload,
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }
}

export async function onShareRequest(request: ShareRequest): Promise<ShareServerResult> {
  const url = new URL(request.requestUrl)

  if (url.pathname === '/api/shares') {
    if (request.method !== 'POST') {
      return jsonError('Method not allowed', 405)
    }
    return onCreateShare(request)
  }

  if (url.pathname.startsWith('/api/shares/')) {
    if (request.method !== 'GET') {
      return jsonError('Method not allowed', 405)
    }
    return onGetShare(request)
  }

  return jsonError('Share route not found', 404)
}
