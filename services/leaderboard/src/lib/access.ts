/*
  Author: Runor Ewhro
  description: verifies the cloudflare access jwt on admin routes: RS256 against
               the team's published keys, the application audience, the
               issuer and the expiry. keys are cached per isolate for an hour.
*/

import { HttpError } from './http.ts'

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }

let keyCache: { team: string; at: number; keys: Map<string, CryptoKey> } | null = null
const KEY_TTL_MS = 3_600_000

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const base64UrlJson = (value: string): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(base64UrlBytes(value)))

async function teamKeys(team: string, fetchImpl: typeof fetch): Promise<Map<string, CryptoKey>> {
  if (keyCache && keyCache.team === team && Date.now() - keyCache.at < KEY_TTL_MS) return keyCache.keys
  const response = await fetchImpl(`https://${team}/cdn-cgi/access/certs`)
  if (!response.ok) throw new HttpError('internal', 'access keys unavailable')
  const { keys } = await response.json() as { keys: Jwk[] }
  const imported = new Map<string, CryptoKey>()
  for (const jwk of keys) {
    if (jwk.kty !== 'RSA') continue
    imported.set(jwk.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']))
  }
  keyCache = { team, at: Date.now(), keys: imported }
  return imported
}

export interface AccessIdentity {
  email: string | null
  subject: string
}

/** the admin behind a request, or a 403. */
export async function verifyAccess(request: Request, options: { team: string; audience: string; fetchImpl?: typeof fetch;
  now?: number }): Promise<AccessIdentity> {
  // until an access application exists, admin routes stay shut without asking any host for keys.
  if (!options.team || !options.audience || /[<>\s]/.test(options.team + options.audience)) {
    throw new HttpError('forbidden', 'admin routes are not configured')
  }
  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token) throw new HttpError('forbidden', 'admin routes need cloudflare access')
  const parts = token.split('.')
  if (parts.length !== 3) throw new HttpError('forbidden', 'malformed access token')
  let header: Record<string, unknown>
  let claims: Record<string, unknown>
  let signature: Uint8Array<ArrayBuffer>
  try {
    header = base64UrlJson(parts[0])
    claims = base64UrlJson(parts[1])
    signature = base64UrlBytes(parts[2])
  } catch {
    throw new HttpError('forbidden', 'malformed access token')
  }
  if (!header || !claims || typeof header !== 'object' || typeof claims !== 'object') {
    throw new HttpError('forbidden', 'malformed access token')
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new HttpError('forbidden', 'unexpected access token')
  // the JWT header selects a cached RSA key; signature, audience, issuer, and expiry checks all precede identity creation.
  const key = (await teamKeys(options.team, options.fetchImpl ?? fetch)).get(header.kid)
  if (!key) throw new HttpError('forbidden', 'unknown access key')
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed)
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  const now = Math.floor((options.now ?? Date.now()) / 1000)
  if (!valid || !audience.includes(options.audience) || claims.iss !== `https://${options.team}` ||
    typeof claims.exp !== 'number' || claims.exp < now) {
    throw new HttpError('forbidden', 'access token refused')
  }
  return { email: typeof claims.email === 'string' ? claims.email : null, subject: String(claims.sub ?? '') }
}
