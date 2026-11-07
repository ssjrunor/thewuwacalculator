/*
  Author: Runor Ewhro
  description: creates session tokens and serializes scoped authentication cookies.
*/

import { hmacSha256Hex } from './hash.ts'
import { randomToken } from './ids.ts'

export const SESSION_COOKIE = 'lb_session'

export interface SessionActor {
  tokenHash: string
  uid: string | null
  accountId: string | null
  expiresAt: number
}

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
