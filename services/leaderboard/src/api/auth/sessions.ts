/*
  Author: Runor Ewhro
  description: resolves request cookies to live sessions, extends a session on
               use (account sessions for longer), and requires either a
               signed-in account (profile and social routes) or a session with a
               given uid (its builds and settings), linked to the account or
               claimed by this browser with a fresh card.
*/

import { limits } from '../../env.ts'
import { HttpError } from '../../lib/http.ts'
import { readCookie, SESSION_COOKIE, sessionTokenHash, type SessionActor } from '../../lib/session.ts'
import { extendSessionStatement, findLiveSession, sessionUids } from '../../db/identity.ts'
import type { RouteContext } from '../router.ts'

/** a session in use is pushed out to a full lifetime again, at most once a day. */
const EXTEND_EVERY_MS = 86_400_000

type SessionContext = Pick<RouteContext, 'request' | 'env' | 'now'>

/** returns the live session or null; a sanctioned account's session acts for no uid unless `stopped` is set,
    which only the sanctions and appeal routes use. */
export async function optionalSession(context: SessionContext, { stopped = false }: { stopped?: boolean } = {}): Promise<SessionActor | null> {
  const token = readCookie(context.request, SESSION_COOKIE)
  if (!token || token.length > 128) return null
  // query by the keyed token hash; the raw bearer token is read only from the request cookie.
  const tokenHash = await sessionTokenHash(context.env.SESSION_KEY, token)
  const row = await findLiveSession(context.env.LB, tokenHash, context.now)
  if (!row || (row.stopped && !stopped)) return null
  let expiresAt = row.expires_at
  const ttl = limits(context.env)
  const full = context.now + (row.account_id ? ttl.accountSessionTtlMs : ttl.sessionTtlMs)
  if (full - expiresAt >= EXTEND_EVERY_MS) {
    await extendSessionStatement(context.env.LB, tokenHash, full).run()
    expiresAt = full
  }
  return { tokenHash, accountId: row.account_id, expiresAt, stopped: row.stopped === 1 }
}

/** the session itself, signed in or a claim session, or a 401. */
export async function requireSession(context: SessionContext): Promise<SessionActor> {
  const session = await optionalSession(context)
  if (!session) throw new HttpError('unauthorized', "hold on... sign in, or claim your UID with a fresh card first :P")
  return session
}

/** a session that has this uid, or a 401 (no session) or 404 (one that does not have it). */
export async function requireOwnUid(context: SessionContext, uid: string): Promise<SessionActor> {
  const session = await requireSession(context)
  if (!(await sessionUids(context.env.LB, session, context.now)).some((row) => row.uid === uid)) {
    throw new HttpError('not_found', "hmm... that UID isn't yours here. add it to your account, or claim it with a fresh card :P")
  }
  return session
}

/** the session's signed-in account, or a 401. */
export async function requireAccount(context: SessionContext, { stopped = false }: { stopped?: boolean } = {}): Promise<SessionActor & { accountId: string }> {
  const session = await optionalSession(context, { stopped })
  if (!session?.accountId) throw new HttpError('unauthorized', "hold on... sign in with Discord or Google first :P")
  return session as SessionActor & { accountId: string }
}

/** a signed-in account that has this uid linked: what writes the uid's builds' words and looks. */
export async function requireLinkedUid(context: SessionContext, uid: string): Promise<SessionActor & { accountId: string }> {
  const session = await requireAccount(context)
  if (!(await sessionUids(context.env.LB, session, context.now)).some((row) => row.uid === uid)) {
    throw new HttpError('not_found', "hmm... that UID isn't on your account. add it with a fresh card first :P")
  }
  return session
}
