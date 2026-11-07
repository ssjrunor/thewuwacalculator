/*
  Author: Runor Ewhro
  description: POST /cards (submit a link or card file name) and GET /cards/:id
               (read and scoring status). submitting fetches the card from kuro,
               keeps the image privately, records the card and queues its read.
               a link seen before answers with the card it already is, without
               fetching it again: kuro never rewrites a card file.
*/

import type { CardStatus, CardStatusResponse, SubmitCardRequest, SubmitCardResponse } from '@/domain/leaderboard/api'
import { limits } from '../../env.ts'
import { HttpError, clientIp, json, readJsonBody, type ErrorCode } from '../../lib/http.ts'
import { isFreshCard } from './freshness.ts'
import { requireTurnstile } from '../../lib/turnstile.ts'
import { requireFresh } from '../auth/claims.ts'
import { findCardByLinkHash, getCard, insertCard, restoreCardImageStatement, setCardStatusStatement, type CardRow } from '../../db/cards.ts'
import { buildsForCard } from '../../db/builds.ts'
import { getPlayer } from '../../db/identity.ts'
import { getJob } from '../../db/scores.ts'
import { liveRulesetId } from '../../db/rulesets.ts'
import type { RouteContext } from '../router.ts'
import { optionalSession } from '../auth/sessions.ts'
import { fetchIdentified, identifyCard, type CollectedCard } from './collect.ts'
import { storeCardImage } from './store.ts'

export async function rateLimit(limiter: RateLimit, key: string): Promise<void> {
  const { success } = await limiter.limit({ key })
  if (!success) throw new HttpError('rate_limited', 'too many requests, try again in a minute')
}

export interface TakenCard {
  card: CardRow
  /** the link was already a card, so nothing new was stored or queued. */
  duplicate: boolean
  /** first drawn within the freshness window (proves control for a login). */
  fresh: boolean
}

/**
 * the card the user's link names. a known link is answered from the database
 * without fetching (kuro never rewrites a card file); only a new card, or a
 * refused one whose image was erased (opt-out or retention), is fetched from kuro.
 */
export async function takeCard(context: RouteContext, input: unknown, { mustBeFresh = false } = {}): Promise<TakenCard> {
  if (typeof input !== 'string') throw new HttpError('bad_link', 'send a card link or card file name as `input`')
  const { env, now } = context
  const { cardMaxBytes, freshMaxAgeSeconds } = limits(env)
  const options = {
    linkHashKey: env.LINK_HASH_KEY, maxBytes: cardMaxBytes, freshMaxAgeSeconds, now,
    rules: { host: env.KURO_CARD_HOST, pathPrefix: env.KURO_CARD_PATH_PREFIX },
  }
  const identified = await identifyCard(input, options)
  if (!identified.ok) throw new HttpError(identified.code as ErrorCode, identified.message)
  const known = await findCardByLinkHash(env.LB, identified.linkHash)
  // only refused cards with erased images are refetched; known readable evidence retains its original card timestamp.
  const erased = known?.status === 'rejected' && (known.reject_reason === 'opted_out' || known.image_erased_at != null)
  if (known && !erased) {
    const fresh = isFreshCard(known.kuro_last_modified, now, freshMaxAgeSeconds)
    if (mustBeFresh) requireFresh(fresh)
    // a card whose reads all failed (the reader was down) is read again from the image already kept.
    if (known.status === 'rejected' && known.reject_reason === 'read_failed') {
      await setCardStatusStatement(env.LB, known.id, 'pending', null).run()
      return { card: { ...known, status: 'pending', reject_reason: null }, duplicate: false, fresh }
    }
    return { card: known, duplicate: true, fresh }
  }
  const fetched = await fetchIdentified(identified, options)
  if (!fetched.ok) throw new HttpError(fetched.code as ErrorCode, fetched.message)
  // a login refuses a stale card before anything is stored.
  if (mustBeFresh) requireFresh(fetched.card.fresh)
  const { card, duplicate } = await recordCard(context, fetched.card, known)
  return { card, duplicate, fresh: fetched.card.fresh }
}

/** a fetched card stored and recorded; `known` is its earlier row when its image was erased. */
async function recordCard(context: RouteContext, collected: CollectedCard, known: CardRow | null): Promise<{ card: CardRow; duplicate: boolean }> {
  const { env, now } = context
  if (known) {
    // a card set aside (opted out, or erased by retention) is read again from its new copy.
    await storeCardImage(env.CARDS, known.r2_key, collected.bytes, collected.contentType)
    await restoreCardImageStatement(env.LB, known.id).run()
    return { card: { ...known, status: 'pending', reject_reason: null, image_erased_at: null }, duplicate: false }
  }
  await storeCardImage(env.CARDS, collected.r2Key, collected.bytes, collected.contentType)
  const { card, inserted } = await insertCard(env.LB, {
    linkHash: collected.linkHash, imageSha256: collected.imageSha256, r2Key: collected.r2Key,
    contentType: collected.contentType, byteSize: collected.byteSize, lastModified: collected.lastModified,
  }, now)
  return { card, duplicate: !inserted }
}

export async function cardStatus(db: D1Database, card: CardRow): Promise<CardStatusResponse> {
  if (card.status === 'blocked') return { cardId: card.id, status: 'rejected', rejectReason: 'blocked' }
  if (card.status === 'rejected') {
    return { cardId: card.id, status: 'rejected', rejectReason: (card.reject_reason ?? 'unreadable') as ErrorCode }
  }
  if (card.status === 'pending') return { cardId: card.id, status: 'pending' }
  const [build] = await buildsForCard(db, card.id)
  if (!build) return { cardId: card.id, status: 'reading' }
  if (build.state !== 'active') {
    return { cardId: card.id, status: 'scored', buildId: build.id, active: false,
      ...(build.state === 'replaced' ? { inactiveReason: 'older_than_active' as const } : {}) }
  }
  const live = await liveRulesetId(db)
  const job = live ? await getJob(db, build.id, live) : null
  const status: CardStatus = job && job.status !== 'scoring' ? 'scored' : 'scoring'
  return { cardId: card.id, status, buildId: build.id, active: true }
}

export async function submitCard(context: RouteContext): Promise<Response> {
  const { request, env } = context
  const ip = clientIp(request)
  await rateLimit(env.SUBMIT_LIMIT, `submit:${ip}`)
  const body = await readJsonBody<Partial<SubmitCardRequest>>(request)
  await requireTurnstile(body.turnstileToken, env.TURNSTILE_SECRET, ip)
  const { card, duplicate } = await takeCard(context, body.input)
  // only newly accepted work enters the read queue; duplicate requests return the existing card status.
  if (!duplicate) {
    const session = await optionalSession(context)
    await env.READ_QUEUE.send({ cardId: card.id, ownerUid: session?.uid ?? null })
  }
  const response: SubmitCardResponse = { cardId: card.id, duplicate, status: (await cardStatus(env.LB, card)).status }
  return json(response, { status: duplicate ? 200 : 202 })
}

export async function getCardStatus(context: RouteContext): Promise<Response> {
  const card = await getCard(context.env.LB, context.params.id)
  if (!card) throw new HttpError('not_found', 'no such card')
  const status = await cardStatus(context.env.LB, card)
  // an opted-out uid's cards say nothing more than that they were refused.
  if (status.buildId) {
    const [build] = await buildsForCard(context.env.LB, card.id)
    const player = build ? await getPlayer(context.env.LB, build.uid) : null
    if (player?.opted_out_at != null) return json({ cardId: card.id, status: 'rejected', rejectReason: 'opted_out' })
  }
  return json(status)
}
