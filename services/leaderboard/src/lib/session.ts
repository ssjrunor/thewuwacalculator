/*
  Author: Runor Ewhro
  description: creates session tokens and serializes scoped authentication cookies.
*/

import { hmacSha256Hex } from './hash.ts'
import { randomToken } from './ids.ts'

export const SESSION_COOKIE = 'lb_session'

/** a live session: a signed-in account's, or a claim session's (no account, only uids claimed with fresh cards);
    both act for every uid they have (db/identity.ts sessionUids). */
export interface SessionActor {
  tokenHash: string
  accountId: string | null
  expiresAt: number
  /** a sanction stops the account: the session may only read its sanctions and appeal them. */
  stopped?: boolean
}

/** cookie max age, longer than any session, with expiry checked on the server; browsers cap cookies at 400 days. */
export const SESSION_COOKIE_MAX_AGE_S = 400 * 86_400

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=') || null
  }
  return null
}

export const sessionTokenHash = (sessionKey: string, token: string): Promise<string> =>
  hmacSha256Hex(sessionKey, `session:${token}`)

// only the random token reaches the cookie; persistence receives its session-keyed HMAC.
export async function newSessionToken(sessionKey: string): Promise<{ token: string; tokenHash: string }> {
  const token = randomToken(32)
  return { token, tokenHash: await sessionTokenHash(sessionKey, token) }
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api/lb; Max-Age=${maxAgeSeconds}`
}

export const clearedSessionCookie = (): string =>
  `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/lb; Max-Age=0`
