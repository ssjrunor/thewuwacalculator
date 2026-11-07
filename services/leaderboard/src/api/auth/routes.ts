/*
  Author: Runor Ewhro
  description: handles card login, logout, session details, and player privacy settings.
*/

import type { CardLoginRequest, MeResponse, PlayerPatchRequest } from '@/domain/leaderboard/api'
import { auditStatement } from '../../lib/audit.ts'
import { HttpError, clientIp, json, readJsonBody } from '../../lib/http.ts'
import { clearedSessionCookie, sessionCookie } from '../../lib/session.ts'
import { requireTurnstile } from '../../lib/turnstile.ts'
import { cardKeysForUid, imageStillUsed, markImageErasedStatement, setCardStatusStatement } from '../../db/cards.ts'
import { deleteUidBuildsStatement } from '../../db/builds.ts'
import { removeUidBoardEntriesStatement } from '../../db/scores.ts'
import {
  getPlayer, revokeSessionStatement, revokeUidSessionsStatement, setHideUidStatement, setOptedOutStatement,
} from '../../db/identity.ts'
import { browserReader } from '../read/dispatch.ts'
import { ingestCard } from '../read/ingest.ts'
import { deleteCardImages } from '../cards/store.ts'
import { rateLimit, takeCard } from '../cards/routes.ts'
import type { RouteContext } from '../router.ts'
import { issueSession } from './claims.ts'
import { optionalSession, requireUid } from './sessions.ts'

export async function cardLogin(context: RouteContext): Promise<Response> {
  const { request, env, now } = context
  const ip = clientIp(request)
  await rateLimit(env.SUBMIT_LIMIT, `login:${ip}`)
  const body = await readJsonBody<Partial<CardLoginRequest>>(request)
  await requireTurnstile(body.turnstileToken, env.TURNSTILE_SECRET, ip)
  const { card } = await takeCard(context, body.input, { mustBeFresh: true })
  if (card.status === 'blocked') throw new HttpError('blocked', 'this card is blocked')
  // login reads the card inline because the UID is required before issuing a session.
  const reader = context.services.reader ?? browserReader(env.BROWSER, env.READER_URL, env.READ_MODE)
  const outcome = await ingestCard(env, card.id, { reader,
    freshLogin: true, now })
  if (outcome.kind === 'skipped') throw new HttpError('internal', `card could not be read (${outcome.reason})`)
  if (outcome.kind === 'rejected' && outcome.reason !== 'opted_out' && outcome.reason !== 'incomplete_build') {
    throw new HttpError(outcome.reason, outcome.reason === 'uid_unreadable' ? 'the uid on this card could not be read exactly'
      : 'this card could not be read')
  }
  // an opted-out uid may still log in, to opt back in, and a card with empty echo slots still proves the
  // account (its uid read exactly); neither build was stored.
  const uid = outcome.read.uid!
  const session = await issueSession(context, { uid, cardId: card.id, name: outcome.read.snapshot?.name ?? null })
  const me = await meFor(env.LB, uid, session.expiresAt)
  return json(me, { headers: { 'set-cookie': sessionCookie(session.token, session.ttlSeconds) } })
}

export async function logout(context: RouteContext): Promise<Response> {
  const session = await optionalSession(context)
  if (session) await revokeSessionStatement(context.env.LB, session.tokenHash, context.now).run()
  return json({ ok: true }, { headers: { 'set-cookie': clearedSessionCookie() } })
}

async function meFor(db: D1Database, uid: string, expiresAt: number): Promise<MeResponse> {
  const player = await getPlayer(db, uid)
  return { uid, accountId: null, expiresAt,
    player: player ? { hideUid: player.hide_uid === 1, optedOut: player.opted_out_at != null } : null }
}

export async function me(context: RouteContext): Promise<Response> {
  const session = await requireUid(context)
  return json(await meFor(context.env.LB, session.uid, session.expiresAt))
}

export async function patchPlayer(context: RouteContext): Promise<Response> {
  const session = await requireUid(context)
  const body = await readJsonBody<Partial<PlayerPatchRequest>>(context.request)
  if (typeof body.hideUid !== 'boolean') throw new HttpError('bad_request', 'send { hideUid: boolean }')
  await context.env.LB.batch([
    setHideUidStatement(context.env.LB, session.uid, body.hideUid),
    auditStatement(context.env.LB, { actorKind: 'uid', actorId: session.uid, action: 'player.hide_uid', subjectKind: 'player',
      subjectId: session.uid, data: { hideUid: body.hideUid } }, context.now),
  ])
  return json(await meFor(context.env.LB, session.uid, session.expiresAt))
}

/** opting out refuses every later submission, erases the uid's card images and takes its builds off every board. */
export async function optOut(context: RouteContext): Promise<Response> {
  const { env, now } = context
  const session = await requireUid(context)
  const cards = await cardKeysForUid(env.LB, session.uid)
  const ids = new Set(cards.map((card) => card.id))
  // retain content-addressed images still referenced by card rows outside this UID's deletion set.
  const erasable: string[] = []
  for (const card of cards) if (!await imageStillUsed(env.LB, card.r2_key, ids)) erasable.push(card.r2_key)
  await env.LB.batch([
    setOptedOutStatement(env.LB, session.uid, now),
    deleteUidBuildsStatement(env.LB, session.uid, now),
    removeUidBoardEntriesStatement(env.LB, session.uid),
    ...cards.map((card) => setCardStatusStatement(env.LB, card.id, 'rejected', 'opted_out')),
    ...cards.map((card) => markImageErasedStatement(env.LB, card.id, now)),
    revokeUidSessionsStatement(env.LB, session.uid, now),
    auditStatement(env.LB, { actorKind: 'uid', actorId: session.uid, action: 'player.opt_out', subjectKind: 'player',
      subjectId: session.uid, data: { cards: cards.length } }, now),
  ])
  // database privacy changes and session revocation are completed before the private image bytes are erased.
  await deleteCardImages(env.CARDS, [...new Set(erasable)])
  return json({ ok: true }, { headers: { 'set-cookie': clearedSessionCookie() } })
}

/** opting back in needs a session made from a fresh card after the opt-out (opting out ends every session). */
export async function optIn(context: RouteContext): Promise<Response> {
  const session = await requireUid(context)
  await context.env.LB.batch([
    setOptedOutStatement(context.env.LB, session.uid, null),
    auditStatement(context.env.LB, { actorKind: 'uid', actorId: session.uid, action: 'player.opt_in', subjectKind: 'player',
      subjectId: session.uid }, context.now),
  ])
  return json(await meFor(context.env.LB, session.uid, session.expiresAt))
}
