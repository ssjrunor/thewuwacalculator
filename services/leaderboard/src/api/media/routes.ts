/*
  Author: Runor Ewhro
  description: image uploads for a signed-in account's documents. uploads are
               pending until a moderator approves them (an admin's are approved
               on upload), and only the owner and staff can fetch a pending one.
               byte storage and checks are in store.ts.
*/

import type { MediaItem, MediaListResponse, MediaPurpose } from '@lb/contract/api'
import { MEDIA_LIMITS } from '@lb/contract/media'
import { auditStatement } from '../../lib/audit.ts'
import { HttpError, json } from '../../lib/http.ts'
import { getMedia, mediaOf, pendingCount, setMediaStatusStatement, type MediaRow } from '../../db/media.ts'
import { rateLimit } from '../cards/routes.ts'
import type { RouteContext } from '../router.ts'
import { optionalSession, requireAccount } from '../auth/sessions.ts'
import { staffName, staffWith } from '../auth/staff.ts'
import { assertNotMuted, limitsOf } from '../auth/writers.ts'
import { storeMedia, tooLarge } from './store.ts'

export const mediaItem = (row: MediaRow): MediaItem => ({ id: row.id, purpose: row.purpose, contentType: row.content_type,
  byteSize: row.byte_size, status: row.status === 'deleted' ? 'rejected' : row.status, createdAt: row.created_at })

const isPurpose = (value: string | null): value is MediaPurpose => value === 'avatar' || value === 'banner' || value === 'card'

/** POST /media?purpose=avatar|banner|card with the image as the body. */
export async function uploadMedia(context: RouteContext): Promise<Response> {
  const { env, now } = context
  const session = await requireAccount(context)
  await rateLimit(env.SUBMIT_LIMIT, `media:${session.accountId}`)
  const purpose = context.url.searchParams.get('purpose')
  if (!isPurpose(purpose)) throw new HttpError('bad_request', "hmm... choose an avatar, banner or card image to upload :P")
  const declared = Number(context.request.headers.get('content-length') ?? 0)
  if (declared > MEDIA_LIMITS[purpose].bytes) throw tooLarge(purpose)
  const bytes = new Uint8Array(await context.request.arrayBuffer())
  await assertNotMuted(env.LB, session, now)
  // review-exempt writers are approved on upload; others wait, with a pending limit that grows with account trust
  const exempt = await staffWith(context, 'review.exempt')
  if (!exempt) {
    const { pendingMedia } = await limitsOf(env.LB, session.accountId, now)
    if (await pendingCount(env.LB, session.accountId) >= pendingMedia) {
      throw new HttpError('rate_limited', "hold on... you've reached the limit for images awaiting review. wait for staff to review your earlier uploads before adding more :P")
    }
  }
  const id = await storeMedia(env, { accountId: session.accountId, purpose, bytes, approvedBy: exempt ? staffName(exempt) : null }, now)
  return json(mediaItem((await getMedia(env.LB, id))!), { status: 201 })
}

/** GET /media: the signed-in account's uploads. */
export async function listOwnMedia(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const body: MediaListResponse = { media: (await mediaOf(context.env.LB, session.accountId)).map(mediaItem) }
  return json(body)
}

/** GET /media/:id: approved images for anyone, cached long because an id's bytes are immutable; pending images for
    the owner and staff only. */
export async function getMediaFile(context: RouteContext): Promise<Response> {
  const { env } = context
  const media = await getMedia(env.LB, context.params.id)
  if (!media || media.status === 'deleted' || media.status === 'rejected') throw new HttpError('not_found', "hmm... that image isn't available. it may have been removed or may still be awaiting review.")
  if (media.status !== 'approved' && (await optionalSession(context))?.accountId !== media.account_id
    && !await staffWith(context, 'media.review')) throw new HttpError('not_found', "hmm... that image isn't available. it may have been removed or may still be awaiting review.")
  const object = await env.CARDS.get(media.r2_key)
  if (!object) throw new HttpError('not_found', "hmm... that image isn't available. it may have been removed or may still be awaiting review.")
  return new Response(object.body, { headers: { 'content-type': media.content_type, 'x-content-type-options': 'nosniff',
    'cache-control': media.status === 'approved' ? 'public, max-age=86400, immutable' : 'private, no-store' } })
}

/** DELETE /media/:id: the owner takes an upload down; documents naming it stop showing it. */
export async function deleteOwnMedia(context: RouteContext): Promise<Response> {
  const { env, now } = context
  const session = await requireAccount(context)
  const media = await getMedia(env.LB, context.params.id)
  if (!media || media.account_id !== session.accountId || media.status === 'deleted') throw new HttpError('not_found', "hmm... that image isn't available. it may have been removed or may still be awaiting review.")
  await env.LB.batch([setMediaStatusStatement(env.LB, media.id, 'deleted', null, now),
    auditStatement(env.LB, { actorKind: 'account', actorId: session.accountId, action: 'media.delete', subjectKind: 'media', subjectId: media.id }, now)])
  await env.CARDS.delete(media.r2_key)
  return json({ ok: true })
}
