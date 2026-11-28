/*
  Author: Runor Ewhro
  description: POST /cards (submit a link or card file name) and GET /cards/:id
               (read and scoring status). a submit fetches the card from kuro,
               stores the image privately, records the card in its registry
               shard (cards/registry.ts) and queues the read. a known link
               returns its existing card without a fetch, since kuro does not
               rewrite card files.
*/

import { MAX_CARDS_PER_SUBMIT, splitCardInputs, type CardStatusResponse, type SubmitCardRequest, type SubmitCardResponse,
  type SubmitCardResult, type SubmitCardsRequest, type SubmitCardsResponse } from '@lb/contract/api'
import { limits } from '../../env.ts'
import { HttpError, clientIp, json, readJsonBody, type ErrorCode } from '../../lib/http.ts'
import { isFreshCard } from './freshness.ts'
import { requireTurnstile } from '../../lib/turnstile.ts'
import { requireFresh } from '../auth/claims.ts'
import { CARD_PARSER_VER } from '@lb/parser-version'
import { getPlayer, sessionUids } from '../../db/identity.ts'
import type { RouteContext } from '../router.ts'
import { optionalSession } from '../auth/sessions.ts'
import { staffWith } from '../auth/staff.ts'
import { buildRef, endSetupStatements } from '../builds/lifecycle.ts'
import { syncPlayerBoards } from '../players.ts'
import { boardOf, cardRef, shardOfLink } from '../stubs.ts'
import { parseBuildId, uidToText } from '../../lib/ids.ts'
import { cardImageKey, type CardRecord } from '../../cards/registry.ts'
import type { ApiEnv, ReadMessage } from '../../env.ts'
import { fetchIdentified, identifyCard, type CollectedCard } from './collect.ts'
import { storeCardImage } from './store.ts'

export async function rateLimit(limiter: RateLimit, key: string): Promise<void> {
  const { success } = await limiter.limit({ key })
  if (!success) throw new HttpError('rate_limited', "woah... a few too many requests at once! give it a minute, then try again :P")
}

export interface TakenCard {
  card: CardRecord
  // the link was already a card, so nothing new was stored or queued
  duplicate: boolean
  // first drawn within the freshness window (proves control for a login)
  fresh: boolean
}

// the card the user's link names. a known link is answered from the database without fetching (kuro never rewrites a
// card file); only a new card, or a refused one whose image was erased (opt-out or retention), is fetched from kuro
export async function takeCard(context: RouteContext, input: unknown, { mustBeFresh = false } = {}): Promise<TakenCard> {
  if (typeof input !== 'string') throw new HttpError('bad_link', "hmm... paste a Kuro card link or the card's file name first :P")
  const { env, now } = context
  const { cardMaxBytes, freshMaxAgeSeconds } = limits(env)
  const options = {
    linkHashKey: env.LINK_HASH_KEY, maxBytes: cardMaxBytes, freshMaxAgeSeconds, now,
    rules: { host: env.KURO_CARD_HOST, pathPrefix: env.KURO_CARD_PATH_PREFIX },
  }
  const identified = await identifyCard(input, options)
  if (!identified.ok) throw new HttpError(identified.code as ErrorCode, identified.message)
  const shard = shardOfLink(env, identified.linkHash)
  const known = await shard.stub.byLink(shard.shard, identified.linkHash)
  // only refused cards with erased images are refetched; known readable evidence retains its original card timestamp
  const erased = known?.status === 'rejected' && (known.reject_reason === 'opted_out' || known.image_erased_at != null)
  if (known && !erased) {
    const fresh = isFreshCard(known.kuro_last_modified, now, freshMaxAgeSeconds)
    if (mustBeFresh) requireFresh(fresh)
    // re-read from the stored image a card whose reads all failed (reader down), that was refused while its uid was
    // suspended, or that an earlier reader version refused; a uid that is still suspended is refused again
    if (known.status === 'rejected' && (known.reject_reason === 'read_failed' || known.reject_reason === 'suspended'
      || rereadable(known))) {
      await shard.stub.setStatus(shard.shard, known.no, 'pending', null)
      return { card: { ...known, status: 'pending', reject_reason: null }, duplicate: false, fresh }
    }
    return { card: known, duplicate: true, fresh }
  }
  const fetched = await fetchIdentified(identified, options)
  if (!fetched.ok) throw new HttpError(fetched.code as ErrorCode, fetched.message)
  // a login refuses a stale card before anything is stored
  if (mustBeFresh) requireFresh(fetched.card.fresh)
  const { card, duplicate } = await recordCard(context, shard, fetched.card, known)
  return { card, duplicate, fresh: fetched.card.fresh }
}

// a card an earlier reader version refused is read once more by a newer reader version
const REREAD_REASONS = new Set(['unreadable', 'uid_unreadable', 'incomplete_build'])
function rereadable(card: CardRecord): boolean {
  if (!REREAD_REASONS.has(card.reject_reason ?? '')) return false
  return card.read_ver !== null && card.read_ver !== CARD_PARSER_VER
}

// a fetched card stored and recorded; `known` is its earlier row when its image was erased
async function recordCard(context: RouteContext, shard: ReturnType<typeof shardOfLink>, collected: CollectedCard,
  known: CardRecord | null): Promise<{ card: CardRecord; duplicate: boolean }> {
  const { env } = context
  if (known) {
    // a card set aside (opted out, or erased by retention) is read again from its new copy
    await storeCardImage(env.CARDS, cardImageKey(known), collected.bytes, collected.contentType)
    await shard.stub.restoreImage(shard.shard, known.no)
    return { card: { ...known, status: 'pending', reject_reason: null, image_erased_at: null }, duplicate: false }
  }
  // the registry numbers the card before the image is stored under that number; a card whose image was never stored
  // stays pending without one, and its read is skipped until the link is sent again
  const { card, inserted } = await shard.stub.record(shard.shard, {
    linkHash: collected.linkHash, imageSha256: collected.imageSha256, contentType: collected.contentType,
    byteSize: collected.byteSize, lastModified: collected.lastModified,
  })
  if (inserted) await storeCardImage(env.CARDS, cardImageKey(card), collected.bytes, collected.contentType)
  return { card, duplicate: !inserted }
}

// the current board row of the build a read card created
async function placedBuild(env: Pick<ApiEnv, 'BOARDS'>, card: CardRecord) {
  const key = card.build ? parseBuildId(card.build) : null
  if (!key) return null
  const [row] = await boardOf(env, key.resonator).standings(key.resonator, [key.local])
  return row ? { id: card.build!, resonatorId: String(key.resonator), row } : null
}

export async function cardStatus(env: Pick<ApiEnv, 'BOARDS'>, card: CardRecord): Promise<CardStatusResponse> {
  if (card.status === 'blocked') return { cardId: card.id, status: 'rejected', rejectReason: 'blocked' }
  if (card.status === 'rejected') {
    return { cardId: card.id, status: 'rejected', rejectReason: (card.reject_reason ?? 'unreadable') as ErrorCode }
  }
  if (card.status === 'pending') return { cardId: card.id, status: 'pending' }
  const build = await placedBuild(env, card)
  if (!build) return { cardId: card.id, status: 'reading' }
  const read = { buildId: build.id, resonatorId: build.resonatorId }
  if (build.row.state !== 'active') return { cardId: card.id, status: 'scored', ...read, active: false }
  // every kept build is scored and ranked as itself once its score is in
  const status = build.row.scoring ? 'scoring' : build.row.cellKey != null ? 'scored' : 'insufficient_data'
  return { cardId: card.id, status, ...read, active: true }
}

// the read owner for a submitted card, resolved once per request and only for new cards (or setup uids' cards);
// staff submissions do not end a uid's setup state
function readOwner(context: RouteContext) {
  let owner: Promise<{ ownerUids?: string[]; byPlayer: boolean }> | null = null
  return () => owner ??= (async () => {
    const session = await optionalSession(context)
    const [held, staff] = await Promise.all([
      session ? sessionUids(context.env.LB, session, context.now).then((rows) => rows.map((row) => row.uid)) : [],
      staffWith(context, 'cards.moderate')])
    return { ...(held.length ? { ownerUids: held } : {}), byPlayer: staff == null }
  })()
}

// a player resubmitting a card already read for a setup uid: the uid leaves setup, and the build counts as uploaded
// at this time and retains its scores, with no new read or scoring
async function claimSetupCard(context: RouteContext, card: CardRecord, owner: ReturnType<typeof readOwner>): Promise<boolean> {
  if (card.status !== 'read' || card.uid == null) return false
  const build = await placedBuild(context.env, card)
  if (!build || build.row.state !== 'active') return false
  const uid = uidToText(card.uid)
  if ((await getPlayer(context.env.LB, uid))?.setup_at == null || !(await owner()).byPlayer) return false
  await context.env.LB.batch(endSetupStatements(context.env.LB, uid, build.id, context.now))
  // sync the player to every board; this build's board also records the build as their upload
  await syncPlayerBoards(context.env, uid)
  const ref = buildRef(context.env, build.id)
  return ref.board.claimSetup(ref.resonator, ref.local, card.uid, card.id)
}

// read messages for several cards sent as one queue batch, so their reads share one warm reader page; a batch's
// cards go in order of arrival, at most the queue's 100 per call
export async function sendReads(env: Pick<ApiEnv, 'READ_QUEUE'>, messages: ReadMessage[]): Promise<void> {
  for (let start = 0; start < messages.length; start += 100) {
    // a multi-card send marks its messages bulk, which leaves the reader browser up between batches; a single card's
    // read closes it
    await env.READ_QUEUE.sendBatch(messages.slice(start, start + 100).map((body) => ({ body: messages.length > 1 ? { ...body, bulk: true } : body })))
  }
}

// take one card and queue its read when it is new; with `reads`, the read is collected for one sendReads
async function acceptCard(context: RouteContext, input: unknown, owner: ReturnType<typeof readOwner>,
  reads?: ReadMessage[]): Promise<SubmitCardResponse> {
  const taken = await takeCard(context, input)
  const { card } = taken
  // only newly accepted cards enter the read queue, and duplicates return the existing status; a setup uid's card was
  // never sent by a player, so the first player to send it gets a new card's response
  const duplicate = taken.duplicate && !await claimSetupCard(context, card, owner)
  if (!taken.duplicate) {
    const message = { cardId: card.id, ...await owner() }
    if (reads) reads.push(message)
    else await context.env.READ_QUEUE.send(message)
  }
  // a known card returns its full status route response, including any refusal reason
  return { ...(await publicCardStatus(context.env, card)), duplicate }
}

export async function submitCard(context: RouteContext): Promise<Response> {
  const { request, env } = context
  const ip = clientIp(request)
  await rateLimit(env.SUBMIT_LIMIT, `submit:${ip}`)
  const body = await readJsonBody<Partial<SubmitCardRequest>>(request)
  await requireTurnstile(body.turnstileToken, env.TURNSTILE_SECRET, ip)
  const response = await acceptCard(context, body.input, readOwner(context))
  return json(response, { status: response.duplicate ? 200 : 202 })
}

// submits several cards under one bot check. each card counts against the submit limit like a single submission,
// cards past the limit return rate_limited, refused cards do not affect the rest, and results follow the request
// order
export async function submitCards(context: RouteContext): Promise<Response> {
  const { request, env } = context
  const ip = clientIp(request)
  const body = await readJsonBody<Partial<SubmitCardsRequest>>(request)
  const inputs = Array.isArray(body.inputs) ? splitCardInputs(body.inputs.filter((x): x is string => typeof x === 'string').join(' ')) : []
  if (!inputs.length) throw new HttpError('bad_link', "hmm... paste at least one Kuro card link or file name first :P")
  if (inputs.length > MAX_CARDS_PER_SUBMIT) throw new HttpError('bad_request', `woah... send up to ${MAX_CARDS_PER_SUBMIT} cards at once. split these into smaller batches :P`)
  await rateLimit(env.SUBMIT_LIMIT, `submit:${ip}`)
  await requireTurnstile(body.turnstileToken, env.TURNSTILE_SECRET, ip)
  const owner = readOwner(context)
  const results: SubmitCardResult[] = []
  const reads: ReadMessage[] = []
  let limited: HttpError | null = null
  for (const [index, input] of inputs.entries()) {
    try {
      if (limited) throw limited
      if (index > 0) await rateLimit(env.SUBMIT_LIMIT, `submit:${ip}`)
      results.push({ input, ok: true, card: await acceptCard(context, input, owner, reads) })
    } catch (error) {
      if (!(error instanceof HttpError)) {
        console.error('batch submit failed', error)
        results.push({ input, ok: false, error: { code: 'internal', message: "oopsies... we couldn't submit this card. try again in a little while :(" } })
        continue
      }
      if (error.code === 'rate_limited') limited = error
      results.push({ input, ok: false, error: { code: error.code, message: error.message } })
    }
  }
  // a card recorded but never queued (the send failed) is sent again by upkeep once it has waited pending
  await sendReads(env, reads)
  const response: SubmitCardsResponse = { results }
  return json(response)
}

// a card's status as anyone may see it: an opted-out uid's cards show only that they were refused
async function publicCardStatus(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, card: CardRecord): Promise<CardStatusResponse> {
  const status = await cardStatus(env, card)
  if (status.buildId && card.uid != null) {
    const player = await getPlayer(env.LB, uidToText(card.uid))
    if (player?.opted_out_at != null) return { cardId: card.id, status: 'rejected', rejectReason: 'opted_out' }
  }
  return status
}

export async function getCardStatus(context: RouteContext): Promise<Response> {
  const ref = cardRef(context.env, context.params.id)
  const card = ref ? await ref.stub.get(ref.shard, ref.no) : null
  if (!card) throw new HttpError('not_found', "hmm... we couldn't find this card. check the link or submit it again :P")
  return json(await publicCardStatus(context.env, card))
}
