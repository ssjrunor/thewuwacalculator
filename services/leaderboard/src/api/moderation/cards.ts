/*
  Author: Runor Ewhro
  description: staff inspect and fix a card and its build. GET /admin/cards/:id
               (its record, every read and event, and the newest read in full),
               GET /admin/cards/:id/image (the Kuro card as it was fetched), GET
               /admin/builds/:id/card (the card behind a build, hidden builds
               included, with the build as stored). fixes: POST
               /admin/cards/:id/reread queues the card's read again; POST
               /admin/cards/:id/uid places a card refused for its uid alone
               under the uid staff read off it; POST
               /admin/builds/:id/rescore scores the build again on the live
               ruleset; POST /admin/builds/:id/details fills in what scoring
               maxes (the player name, resonator, weapon and skill levels), so it
               changes neither scores nor ownership. the image is served to a
               staff session cookie, so the app shows it in a plain img.
*/

import type { StaffBuildDetails, StaffCardResponse } from '@lb/contract/api'
import type { CardReadResult } from '@lb/contract/read'
import type { BuildSnapshot } from '@lb/contract/snapshot'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import { cardImageKey, cardReadKey } from '../../cards/registry.ts'
import { formatBuildId } from '../../lib/ids.ts'
import { packSnapshot, unpackSnapshot } from '../../lib/snapshotPack.ts'
import { renamePlayerStatement } from '../../db/identity.ts'
import { attachCardReportsStatement } from '../../db/moderation.ts'
import { getRuleset, liveRulesetId } from '../../db/rulesets.ts'
import { authorize, staffAudit as audit, type Staff } from '../auth/staff.ts'
import { buildRef, type BuildRef } from '../builds/lifecycle.ts'
import { placeRead, snapshotHash } from '../read/ingest.ts'
import { syncPlayerBoards } from '../players.ts'
import { cardRef } from '../stubs.ts'
import type { RouteContext } from '../router.ts'

const GONE = "hmm... we couldn't find that card. check its id; it may never have been stored."
const NO_BUILD = "hmm... we couldn't find that build on its board."
const NAME_MAX = 32
const MAX_LEVEL = 90
const MAX_SKILL = 10

const staffActor = (who: Staff) => `${who.actorKind}:${who.actorId}`

async function cardOr404(context: RouteContext, cardId: string) {
  const ref = cardRef(context.env, cardId)
  const card = ref ? await ref.stub.get(ref.shard, ref.no) : null
  if (!ref || !card) throw new HttpError('not_found', GONE)
  return { ref, card }
}

async function buildOr404(ref: BuildRef) {
  const build = await ref.board.buildRecord(ref.resonator, ref.local)
  if (!build || build.state === 2) throw new HttpError('not_found', NO_BUILD)
  return build
}

const parsed = (data: string | null): unknown => {
  if (data == null) return null
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

async function staffCard(context: RouteContext, cardId: string, build: StaffCardResponse['build'] = null): Promise<StaffCardResponse> {
  const { ref, card } = await cardOr404(context, cardId)
  const [history, evidence] = await Promise.all([ref.stub.history(ref.shard, ref.no),
    card.read_ver ? context.env.CARDS.get(cardReadKey(card.id, card.read_ver)) : Promise.resolve(null)])
  return {
    cardId: card.id, status: card.status, rejectReason: card.reject_reason, drawnAt: card.kuro_last_modified, fetchedAt: card.fetched_at,
    imageKept: card.image_erased_at == null, buildId: card.build,
    reads: history.reads.map((read) => ({ parserVer: read.parser_ver, outcome: read.outcome, uid: read.uid == null ? null : String(read.uid).padStart(9, '0'),
      resonatorId: read.resonator == null ? null : String(read.resonator), at: read.at })),
    events: history.events.map((event) => ({ at: event.at, kind: event.kind, actor: event.actor, data: parsed(event.data) })),
    read: evidence ? await evidence.json<CardReadResult>() : null,
    build,
  }
}

// GET /admin/cards/:id
export async function inspectCard(context: RouteContext): Promise<Response> {
  await authorize(context, 'reports.review')
  return json(await staffCard(context, context.params.id))
}

// GET /admin/builds/:id/card: the card behind a build, and the build as stored
export async function inspectBuildCard(context: RouteContext): Promise<Response> {
  await authorize(context, 'reports.review')
  const ref = buildRef(context.env, context.params.id)
  const build = await ref.board.buildRecord(ref.resonator, ref.local)
  if (!build) throw new HttpError('not_found', `hmm... we couldn't find build ${formatBuildId(ref)} on its board.`)
  return json(await staffCard(context, build.card, { id: ref.id, uid: String(build.uid).padStart(9, '0'),
    snapshot: unpackSnapshot(build.snap), removed: build.state === 2 }))
}

// GET /admin/cards/:id/image: the stored image, never cached
export async function cardImage(context: RouteContext): Promise<Response> {
  await authorize(context, 'reports.review')
  const { card } = await cardOr404(context, context.params.id)
  const object = card.image_erased_at == null ? await context.env.CARDS.get(cardImageKey(card)) : null
  if (!object) throw new HttpError('not_found', "hmm... this card's image is gone. retention erases refused cards' images after a while.")
  return new Response(object.body, { headers: { 'content-type': card.content_type, 'x-content-type-options': 'nosniff',
    'cache-control': 'private, no-store' } })
}

// POST /admin/cards/:id/reread: the card is read again with the current reader; a read that comes out as another
// build replaces the build the card made (ingest.ts)
export async function rereadCard(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'cards.moderate')
  const { card } = await cardOr404(context, context.params.id)
  if (card.status === 'blocked') throw new HttpError('bad_request', 'this card is blocked, so it is never read again.')
  if (card.image_erased_at != null) throw new HttpError('bad_request', "this card's image was erased, so it can't be read again. ask for a new card.")
  await context.env.READ_QUEUE.send({ cardId: card.id })
  await audit(context, who, { action: 'card.reread', subjectKind: 'card', subjectId: card.id }).run()
  return json({ ok: true }, { status: 202 })
}

// POST /admin/cards/:id/uid { uid }: a card the reader refused for its uid alone is placed under the uid staff read
// off the image, as the player's build, with what else the reader took off it. the card's reports follow the build
export async function setCardUid(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'cards.moderate')
  const body = await readJsonBody<{ uid?: unknown }>(context.request)
  const uid = typeof body.uid === 'string' ? body.uid.replace(/\s+/g, '') : ''
  if (!/^[1-9]\d{8}$/.test(uid)) throw new HttpError('bad_request', 'a UID is the 9 digits printed on the card')
  const { card } = await cardOr404(context, context.params.id)
  if (card.status !== 'rejected' || card.reject_reason !== 'uid_unreadable') {
    throw new HttpError('bad_request', 'only a card refused for its UID takes one from staff.')
  }
  const evidence = card.read_ver ? await context.env.CARDS.get(cardReadKey(card.id, card.read_ver)) : null
  const read = evidence ? await evidence.json<CardReadResult>() : null
  if (!read?.awaitingUid) throw new HttpError('bad_request', 'the reader missed more than the UID on this card. read it again first.')
  const snapshot = { ...read.awaitingUid, uid }
  const placed = await placeRead(context.env, card, { ...read, outcome: 'ok', uid, snapshot }, { now: context.now, checks: false })
  if (placed.kind !== 'placed') {
    throw new HttpError('bad_request', placed.kind === 'rejected' && placed.reason === 'suspended'
      ? 'that UID is suspended or banned, so the card was refused again.' : 'that UID opted out, so the card was refused again.')
  }
  await context.env.LB.batch([attachCardReportsStatement(context.env.LB, card.id, placed.buildId, uid),
    audit(context, who, { action: 'card.uid_set', subjectKind: 'card', subjectId: card.id,
      data: { uid, read: read.awaitingUid.uid || null, buildId: placed.buildId } })])
  return json({ ok: true, buildId: placed.buildId })
}

// POST /admin/builds/:id/rescore: the build's live job starts over
export async function rescoreBuild(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'builds.moderate')
  const ref = buildRef(context.env, context.params.id)
  const liveId = await liveRulesetId(context.env.LB)
  const live = liveId ? await getRuleset(context.env.LB, liveId) : null
  if (!live) throw new HttpError('bad_request', 'no ruleset is live, so nothing is scored.')
  if (!await ref.board.rescore(ref.resonator, live.no, [ref.local], 'interactive')) throw new HttpError('not_found', NO_BUILD)
  await audit(context, who, { action: 'build.rescore', subjectKind: 'build', subjectId: ref.id, data: { rulesetId: live.id } }).run()
  return json({ ok: true }, { status: 202 })
}

const level = (value: unknown, max: number, what: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) throw new HttpError('bad_request', `${what} is a whole number from 1 to ${max}`)
  return value
}

// the fields a request fills in, applied to a copy of the snapshot
function fillIn(snapshot: BuildSnapshot, body: StaffBuildDetails): { next: BuildSnapshot; fields: string[]; name: string | null } {
  const next = structuredClone(snapshot)
  const fields: string[] = []
  let name: string | null = null
  if (body.name !== undefined) {
    name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > NAME_MAX) throw new HttpError('bad_request', `a name is 1 to ${NAME_MAX} characters`)
    next.name = name
    fields.push('name')
  }
  if (body.level !== undefined) {
    next.resonator.level = level(body.level, MAX_LEVEL, 'the resonator level')
    fields.push('level')
  }
  if (body.weaponId !== undefined) {
    if (typeof body.weaponId !== 'string' || !/^\d{8}$/.test(body.weaponId)) throw new HttpError('bad_request', 'a weapon is an 8 digit id')
    next.weapon.id = body.weaponId
    fields.push('weapon')
  }
  if (body.weaponLevel !== undefined) {
    next.weapon.level = level(body.weaponLevel, MAX_LEVEL, 'the weapon level')
    fields.push('weaponLevel')
  }
  for (const [key, value] of Object.entries(body.skillLevels ?? {})) {
    if (!(key in next.resonator.skillLevels)) throw new HttpError('bad_request', `${key} is not one of this build's skills`)
    next.resonator.skillLevels[key] = level(value, MAX_SKILL, `${key}'s level`)
    fields.push(`skill:${key}`)
  }
  if (!fields.length) throw new HttpError('bad_request', 'send a name, level, weaponId, weaponLevel or skillLevels')
  return { next, fields, name }
}

// POST /admin/builds/:id/details: fills in what scoring maxes; a name also renames the player, dated by this build's
// card, on every board
export async function editBuildDetails(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'builds.moderate')
  const ref = buildRef(context.env, context.params.id)
  const build = await buildOr404(ref)
  const body = await readJsonBody<StaffBuildDetails>(context.request)
  const { next, fields, name } = fillIn(unpackSnapshot(build.snap), body)
  const done = await ref.board.editSnapshot(ref.resonator, ref.local, packSnapshot(next), await snapshotHash(next), build.snapHash,
    staffActor(who), fields)
  if (!done) throw new HttpError('bad_request', 'hmm... this build changed while you were editing it. reload it and try again.')
  const uid = String(build.uid).padStart(9, '0')
  if (name) {
    const { card } = await cardOr404(context, build.card)
    await renamePlayerStatement(context.env.LB, uid, name, card.kuro_last_modified).run()
    await syncPlayerBoards(context.env, uid)
  }
  await audit(context, who, { action: 'build.edit', subjectKind: 'build', subjectId: ref.id, data: { fields } }).run()
  return json({ ok: true, fields })
}
