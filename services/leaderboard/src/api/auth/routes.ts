/*
  Author: Runor Ewhro
  description: routes for uid claims (fresh card login), releasing a claimed
               uid, logout, session details (the signed-in account and the uids
               the session acts for), and per-uid settings: hidden, anonymous,
               and opted out of the boards.
*/

import type { AccountSummary, CardLoginRequest, MeResponse, PlayerPatchRequest, UidRequest } from '@lb/contract/api'
import { auditStatement } from '../../lib/audit.ts'
import { HttpError, clientIp, json, readJsonBody } from '../../lib/http.ts'
import { clearedSessionCookie, sessionCookie, SESSION_COOKIE_MAX_AGE_S, type SessionActor } from '../../lib/session.ts'
import { requireTurnstile } from '../../lib/turnstile.ts'
import { getAccount, linkOf, loginsOf, unlinkUidStatement } from '../../db/accounts.ts'
import { unreadCount } from '../../db/notifications.ts'
import { freshInFeed } from '../../db/social.ts'
import { stoppedBy } from '../../db/sanctions.ts'
import { trustOf } from './writers.ts'
import { liveHolder, sessionUids, setAnonymousStatement, setHideUidStatement, setOptedOutStatement } from '../../db/identity.ts'
import { browserReader } from '../read/dispatch.ts'
import { ingestCard } from '../read/ingest.ts'
import { eraseUidCards, playerResonators, syncPlayerBoards } from '../players.ts'
import { boardOf } from '../stubs.ts'
import { rateLimit, takeCard } from '../cards/routes.ts'
import type { RouteContext } from '../router.ts'
import { claimUid, endSessionStatements, releaseStatements } from './claims.ts'
import { optionalSession, requireOwnUid, requireSession } from './sessions.ts'

export async function cardLogin(context: RouteContext): Promise<Response> {
  const { request, env, now } = context
  const ip = clientIp(request)
  await rateLimit(env.SUBMIT_LIMIT, `login:${ip}`)
  const body = await readJsonBody<Partial<CardLoginRequest>>(request)
  await requireTurnstile(body.turnstileToken, env.TURNSTILE_SECRET, ip)
  // only a fresh card claims because only the uid's owner can draw one; stale cards are refused before storage
  const { card } = await takeCard(context, body.input, { mustBeFresh: true })
  if (card.status === 'blocked') throw new HttpError('blocked', "this card has been blocked from the boards. staff can review it if you think there has been a mistake.")
  // the claim reads the card inline because the uid is required before it can be held.
  const reader = context.services.reader ?? browserReader(env.BROWSER, env.READER_URL, env.READ_MODE)
  const outcome = await ingestCard(env, card.id, { reader, freshLogin: true, byPlayer: true, now })
  if (outcome.kind === 'skipped') throw new HttpError('internal', "oopsies... this card could not be read right now. try again in a little while :(")
  if (outcome.kind === 'rejected' && outcome.reason === 'suspended') throw new HttpError('suspended', "this UID is suspended. check your account standing for details and appeals.")
  if (outcome.kind === 'rejected' && outcome.reason !== 'opted_out') {
    throw new HttpError(outcome.reason, outcome.reason === 'uid_unreadable' ? "uh oh... we could not read the UID on this card. generate a new card and send its original link :("
      : "hmm... we could not read enough of this card to save it. generate a new card and send its original link :(")
  }
  // an opted-out uid may still log in, to opt back in; its build was not stored.
  const uid = outcome.read.uid!
  const session = await optionalSession(context)
  const claimed = await claimUid(context, session, { uid, cardId: card.id, name: outcome.read.snapshot?.name ?? null })
  const me = await meFor(env.LB, { tokenHash: claimed.tokenHash, accountId: session?.accountId ?? null, expiresAt: claimed.expiresAt }, now)
  return json(me, claimed.token ? { headers: { 'set-cookie': sessionCookie(claimed.token, SESSION_COOKIE_MAX_AGE_S) } } : {})
}

/** signing out unclaims every uid the session held. */
export async function logout(context: RouteContext): Promise<Response> {
  const session = await optionalSession(context)
  if (session) await context.env.LB.batch(endSessionStatements(context, session.tokenHash))
  return json({ ok: true }, { headers: { 'set-cookie': clearedSessionCookie() } })
}

/** the signed-in account summary shown to its owner. */
export async function accountSummary(db: D1Database, accountId: string, now = Date.now()): Promise<AccountSummary | null> {
  const [account, logins, notifications, trust, stop] = await Promise.all([getAccount(db, accountId), loginsOf(db, accountId),
    unreadCount(db, accountId), trustOf(db, accountId, now), stoppedBy(db, 'account', accountId, now)])
  if (!account) return null
  // until the feed is first read, what came after the account was made is new.
  const feed = await freshInFeed(db, accountId, account.feed_seen_at ?? account.created_at)
  const suspension = stop ? { sanctionId: stop.id, kind: stop.kind as 'suspend' | 'ban', reason: stop.reason, expiresAt: stop.expires_at } : null
  return { id: account.id, role: account.role, unread: { notifications, feed }, trust, suspension,
    logins: logins.map((login) => ({ provider: login.provider, createdAt: login.created_at, lastUsedAt: login.last_used_at })) }
}

export async function meFor(db: D1Database, session: Pick<SessionActor, 'tokenHash' | 'accountId' | 'expiresAt'>, now = Date.now()): Promise<MeResponse> {
  const [uids, account] = await Promise.all([sessionUids(db, session, now), session.accountId ? accountSummary(db, session.accountId, now) : null])
  return { expiresAt: session.expiresAt, account,
    uids: uids.map((row) => ({ uid: row.uid, name: row.last_name, linked: row.linked === 1, hideUid: row.hide_uid === 1,
      anonymous: row.anonymous === 1, optedOut: row.opted_out_at != null })) }
}

/** GET /me: a suspended account's session returns the account with its suspension and no actionable uids. */
export async function me(context: RouteContext): Promise<Response> {
  const session = await optionalSession(context, { stopped: true })
  if (!session) throw new HttpError('unauthorized', "hold on... sign in, or claim your UID with a fresh card first :P")
  if (session.stopped && session.accountId) {
    const body: MeResponse = { expiresAt: session.expiresAt, uids: [], account: await accountSummary(context.env.LB, session.accountId, context.now) }
    return json(body)
  }
  return json(await meFor(context.env.LB, session, context.now))
}

function uidFrom(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{9}$/.test(value)) throw new HttpError('bad_request', "hmm... a UID needs all 9 digits. check it and try again :P")
  return value
}

/** POST /auth/release { uid }: unclaims a uid this browser claimed and ends the claim session after the last one;
    linked uids are removed with DELETE /account/uids/:uid. */
export async function releaseUid(context: RouteContext): Promise<Response> {
  const session = await requireSession(context)
  const uid = uidFrom((await readJsonBody<Partial<UidRequest>>(context.request)).uid)
  const holder = await liveHolder(context.env.LB, uid, context.now)
  if (holder?.token_hash !== session.tokenHash) throw new HttpError('not_found', "hmm... this browser no longer has that UID. refresh your account details.")
  await context.env.LB.batch(await releaseStatements(context, holder, uid))
  const after = await optionalSession(context)
  if (!after) return json({ ok: true }, { headers: { 'set-cookie': clearedSessionCookie() } })
  return json(await meFor(context.env.LB, after, context.now))
}

/** PATCH /players/me/uids/:uid { hideUid?, anonymous? }. */
export async function patchPlayer(context: RouteContext): Promise<Response> {
  const uid = uidFrom(context.params.uid)
  const session = await requireOwnUid(context, uid)
  const body = await readJsonBody<Partial<PlayerPatchRequest>>(context.request)
  const { hideUid, anonymous } = body
  if ((hideUid !== undefined && typeof hideUid !== 'boolean') || (anonymous !== undefined && typeof anonymous !== 'boolean')
    || (hideUid === undefined && anonymous === undefined)) {
    throw new HttpError('bad_request', "oopsies... we couldn't read those privacy settings. refresh your profile and try again.")
  }
  const db = context.env.LB
  const actor = { actorKind: 'uid' as const, actorId: uid, subjectKind: 'player' as const, subjectId: uid }
  await db.batch([
    ...(hideUid === undefined ? [] : [setHideUidStatement(db, uid, hideUid),
      auditStatement(db, { ...actor, action: 'player.hide_uid', data: { hideUid } }, context.now)]),
    ...(anonymous === undefined ? [] : [setAnonymousStatement(db, uid, anonymous),
      auditStatement(db, { ...actor, action: 'player.anonymous', data: { anonymous } }, context.now)]),
  ])
  await syncPlayerBoards(context.env, uid)
  return json(await meFor(db, session, context.now))
}

/** POST /players/me/uids/:uid/opt-out: refuses later submissions of the uid, erases its card images and removes
    its builds from every board; the uid leaves the session and account, and rejoining needs a fresh card. */
export async function optOut(context: RouteContext): Promise<Response> {
  const { env, now } = context
  const uid = uidFrom(context.params.uid)
  const session = await requireOwnUid(context, uid)
  const [resonators, holder, link] = await Promise.all([playerResonators(env.LB, uid), liveHolder(env.LB, uid, now), linkOf(env.LB, uid)])
  await env.LB.batch([
    setOptedOutStatement(env.LB, uid, now),
    ...(holder ? await releaseStatements(context, holder, uid) : []),
    ...(link ? [unlinkUidStatement(env.LB, uid)] : []),
    auditStatement(env.LB, { actorKind: 'uid', actorId: uid, action: 'player.opt_out', subjectKind: 'player',
      subjectId: uid, data: { boards: resonators.length } }, now),
  ])
  // the refusal is on record first; then each board deletes the uid's builds (their likes, comments and documents
  // follow through its outbox), and every card read as the uid is refused and its image and evidence erased.
  await Promise.all(resonators.map((resonator) => boardOf(env, resonator).deletePlayer(Number(resonator), Number(uid))))
  await eraseUidCards(env, uid, 'opted_out')
  const after = await optionalSession(context)
  if (!after) return json({ ok: true }, { headers: { 'set-cookie': clearedSessionCookie() } })
  return json(await meFor(env.LB, { ...session, expiresAt: after.expiresAt }, now))
}

/** DELETE /players/me/uids/:uid/opt-out: rejoining, for a uid claimed with a fresh card after the opt-out. */
export async function optIn(context: RouteContext): Promise<Response> {
  const uid = uidFrom(context.params.uid)
  const session = await requireOwnUid(context, uid)
  await context.env.LB.batch([
    setOptedOutStatement(context.env.LB, uid, null),
    auditStatement(context.env.LB, { actorKind: 'uid', actorId: uid, action: 'player.opt_in', subjectKind: 'player', subjectId: uid }, context.now),
  ])
  return json(await meFor(context.env.LB, session, context.now))
}
