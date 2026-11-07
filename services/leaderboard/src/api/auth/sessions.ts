/*
  Author: Runor Ewhro
  description: resolves request cookies to live sessions and requires an authenticated UID.
*/

import { HttpError } from '../../lib/http.ts'
import { readCookie, SESSION_COOKIE, sessionTokenHash, type SessionActor } from '../../lib/session.ts'
import { findLiveSession } from '../../db/identity.ts'
import type { RouteContext } from '../router.ts'

export async function optionalSession(context: Pick<RouteContext, 'request' | 'env' | 'now'>): Promise<SessionActor | null> {
  const token = readCookie(context.request, SESSION_COOKIE)
  if (!token || token.length > 128) return null
  // query by the keyed token hash; the raw bearer token is read only from the request cookie.
  const tokenHash = await sessionTokenHash(context.env.SESSION_KEY, token)
  const row = await findLiveSession(context.env.LB, tokenHash, context.now)
  return row ? { tokenHash, uid: row.uid, accountId: row.account_id, expiresAt: row.expires_at } : null
}

/** the session's uid, or a 401. */
export async function requireUid(context: Pick<RouteContext, 'request' | 'env' | 'now'>): Promise<SessionActor & { uid: string }> {
  const session = await optionalSession(context)
  if (!session?.uid) throw new HttpError('unauthorized', 'log in with a fresh card first')
  return session as SessionActor & { uid: string }
}
