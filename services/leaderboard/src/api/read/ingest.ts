/*
  Author: Runor Ewhro
  description: reads a card and places its build. the read evidence (snapshot
               and confidence) goes to CARDS and the outcome to the card's
               registry shard; an accepted build goes to its board, which dedupes
               it, ranks the player's best and queues scoring. a refused read
               stores only the evidence and a reason.
*/

import { canonicalJson, sha256Hex } from '@lb/contract/canonical'
import { canonicalResonatorId } from '@lb/contract/identity'
import type { CardReadFlag, CardReadResult } from '@lb/contract/read'
import type { BuildSnapshot } from '@lb/contract/snapshot'
import type { ApiEnv } from '../../env.ts'
import { formatBuildId, parseBuildId } from '../../lib/ids.ts'
import { packSnapshot } from '../../lib/snapshotPack.ts'
import { getPlayer, upsertPlayerStatement } from '../../db/identity.ts'
import { insertReportStatement, openCardReport } from '../../db/moderation.ts'
import { stoppedBy } from '../../db/sanctions.ts'
import { cardImageKey, cardReadKey, type CardRecord } from '../../cards/registry.ts'
import type { Placement } from '../../board/types.ts'
import { loadCardImage } from '../cards/store.ts'
import { endSetupStatements } from '../builds/lifecycle.ts'
import { playerFacts } from '../players.ts'
import { boardOf, cardRef } from '../stubs.ts'
import type { CardReader } from './dispatch.ts'

export type IngestOutcome =
  | { kind: 'skipped'; reason: 'missing' | 'blocked' | 'image_missing' }
  | { kind: 'rejected'; reason: 'uid_unreadable' | 'unreadable' | 'opted_out' | 'suspended'; read: CardReadResult }
  | { kind: 'placed'; uid: string; buildId: string; resonatorId: string; placement: Placement; read: CardReadResult }

// what identifies a build for "the same build again": the card's stats, without its name or data version
export const snapshotHash = (snapshot: BuildSnapshot): Promise<string> =>
  sha256Hex(canonicalJson({ v: snapshot.v, uid: snapshot.uid, resonator: snapshot.resonator, weapon: snapshot.weapon,
    echoes: snapshot.echoes }))

export interface IngestOptions {
  reader: CardReader
  // uids in the submitter's session
  sessionUids?: string[]
  // the card itself proves control (a fresh card logging in)
  freshLogin?: boolean
  // set for a player's submission (staff and re-reads leave it unset); ends a setup uid's setup state
  byPlayer?: boolean
  now: number
}

type IngestEnv = Pick<ApiEnv, 'LB' | 'CARDS' | 'BOARDS' | 'CARD_REGISTRY'>

export async function ingestCard(env: IngestEnv, cardId: string, options: IngestOptions): Promise<IngestOutcome> {
  const db = env.LB
  const ref = cardRef(env, cardId)
  const card = ref ? await ref.stub.get(ref.shard, ref.no) : null
  if (!ref || !card) return { kind: 'skipped', reason: 'missing' }
  if (card.status === 'blocked') return { kind: 'skipped', reason: 'blocked' }
  const bytes = await loadCardImage(env.CARDS, cardImageKey(card))
  if (!bytes) return { kind: 'skipped', reason: 'image_missing' }

  const read = await options.reader(bytes, card.content_type)
  // store the evidence before judging the result, so refused reads stay inspectable
  await env.CARDS.put(cardReadKey(card.id, read.parserVer), JSON.stringify(read), { httpMetadata: { contentType: 'application/json' } })
  const resonatorId = read.snapshot ? canonicalResonatorId(read.snapshot.resonator.id) : read.resonatorId
  await ref.stub.recordRead(ref.shard, card.no, { parserVer: read.parserVer, outcome: read.outcome,
    uid: read.uid && /^\d{9}$/.test(read.uid) ? Number(read.uid) : null, resonator: resonatorId ? Number(resonatorId) : null })
  const reject = async (reason: Extract<IngestOutcome, { kind: 'rejected' }>['reason']): Promise<IngestOutcome> => {
    await ref.stub.setStatus(ref.shard, card.no, 'rejected', reason)
    return { kind: 'rejected', reason, read }
  }
  if (read.outcome !== 'ok' || !read.snapshot || !read.uid || read.uid === '0' || !resonatorId) {
    // a card kept out by its uid alone goes to staff, who read the uid off the image (POST /admin/cards/:id/uid)
    if (read.awaitingUid && !await openCardReport(db, card.id)) {
      const guess = /^\d{9}$/.test(read.awaitingUid.uid) ? ` (best read ${read.awaitingUid.uid})` : ''
      await insertReportStatement(db, { buildId: null, cardId: card.id, subjectUid: null, reason: 'misread',
        details: `Automatic: the UID could not be read${guess}, so the card was refused. Everything else read; enter the UID from the card to place the build.` },
      options.now).statement.run()
    }
    // empty echo slots are read as part of the build, so a refusal is one of these two reasons
    return reject(read.outcome === 'uid_unreadable' ? 'uid_unreadable' : 'unreadable')
  }
  return placeRead(env, card, { ...read, snapshot: read.snapshot, uid: read.uid }, options)
}

// an accepted read placed on its board: the player stored, the build placed, and doubts reported. staff placing a
// refused card under the uid they read off it (`checks: false`) also come here, with no doubt report
export async function placeRead(env: IngestEnv, card: CardRecord, read: CardReadResult & { snapshot: BuildSnapshot; uid: string },
  options: Omit<IngestOptions, 'reader'> & { checks?: boolean }): Promise<IngestOutcome> {
  const db = env.LB
  const ref = cardRef(env, card.id)!
  const resonatorId = canonicalResonatorId(read.snapshot.resonator.id)
  const reject = async (reason: Extract<IngestOutcome, { kind: 'rejected' }>['reason']): Promise<IngestOutcome> => {
    await ref.stub.setStatus(ref.shard, card.no, 'rejected', reason)
    return { kind: 'rejected', reason, read }
  }
  const uid = read.uid
  const player = await getPlayer(db, uid)
  if (player?.opted_out_at != null) return reject('opted_out')
  // a suspended or banned uid stores nothing new; the card can be read again once the sanction ends
  if (await stoppedBy(db, 'uid', uid, options.now)) return reject('suspended')
  const claimSetup = player?.setup_at != null && options.byPlayer === true
  await db.batch([upsertPlayerStatement(db, { uid, name: read.snapshot.name, nameAt: card.kuro_last_modified }, options.now),
    ...(claimSetup ? endSetupStatements(db, uid, null, options.now) : [])])
  const facts = (await playerFacts(db, uid))!
  const resonator = Number(resonatorId)
  // ownership applies only to the fresh-card login or a session holding the uid read from this image
  const { placement } = await boardOf(env, resonator).place(resonator, {
    uid: Number(uid), player: facts, card: card.id, snap: packSnapshot(read.snapshot), snapHash: await snapshotHash(read.snapshot),
    seq: read.snapshot.resonator.sequence, drawnAt: card.kuro_last_modified,
    owner: options.freshLogin === true || (options.sessionUids ?? []).includes(uid), claimSetup, now: options.now,
  })
  const buildId = formatBuildId({ resonator, local: placement.local })
  await ref.stub.setPlaced(ref.shard, card.no, Number(uid), resonator, buildId)
  // a re-read that reads the card as another build replaces the build its earlier read made
  const before = card.build && card.build !== buildId ? parseBuildId(card.build) : null
  if (before) await boardOf(env, before.resonator).retireCardBuild(before.resonator, before.local, card.id)
  // doubts do not block the build; they open one report for a moderator to check against the card
  const details = options.checks === false ? null : readCheckDetails(read, { name: player?.last_name ?? null, nameAt: player?.name_at ?? null },
    card.kuro_last_modified, !placement.repeated && !placement.claimed)
  if (details) {
    await insertReportStatement(db, { buildId, subjectUid: uid, reason: 'misread', details }, options.now).statement.run()
  }
  return { kind: 'placed', uid, buildId, resonatorId: String(resonator), placement, read }
}

const MISSING_NAME: Partial<Record<CardReadFlag, string>> = {
  name_blank: 'the card prints no player name',
  name_obscured: 'art behind the player name kept it from being read',
  name_unread: 'the player name could not be read',
}

// what the reader could not fill in, for staff to fill in (scoring maxes all of it). doubts the reader resolved
// itself (the portrait picking the resonator, the icon picking the weapon) are not reported
const BUILD_FLAGS: Partial<Record<CardReadFlag, string>> = {
  level_unread: 'the resonator level was not read',
  weapon_level_unread: 'the weapon level was not read',
  weapon_unread: 'the weapon was not read (scored with each scenario\'s weapon)',
  skill_unread: 'a skill level was not read',
}

// the report text for a read worth checking, or null. `stored` is the player's name before this read and the
// first-drawn date of its card, and `drawnAt` this card's: a name is reported only when it would change what the
// boards show (an older card renames no one), and the build's own doubts only for a new build
export function readCheckDetails(read: CardReadResult, stored: { name: string | null; nameAt: number | null }, drawnAt: number,
  newBuild: boolean): string | null {
  const flags = read.confidence.flags ?? []
  const name = read.snapshot?.name ?? null
  const storedName = stored.name
  const renames = stored.nameAt == null || drawnAt >= stored.nameAt
  const notes: string[] = []

  if (name === null && storedName === null && newBuild) {
    const why = flags.map((flag) => MISSING_NAME[flag]).find(Boolean) ?? 'no player name was read'
    notes.push(`${why}, so the player shows as Unnamed`)
  } else if (name !== null && name !== storedName && renames) {
    const edge = flags.includes('name_edge') ? ', and its edge punctuation may be a misread decoration such as "~"' : ''
    // a chinese card's non-latin name ("Λæα" read as "Λξεα") is one model's guess, so staff check it either way
    const unsure = flags.includes('name_unconfirmed') ? ', but no second read confirmed it, so it may be wrong' : ''
    if (storedName !== null) notes.push(`the player name changed from "${storedName}" to "${name}"${edge}${unsure}`)
    else if (edge || unsure) notes.push(`the player name was read as "${name}"${edge}${unsure}`)
  }

  if (newBuild) {
    const review = read.confidence.review ?? []
    if (review.length) {
      const values = review.map(({ slot, key }) => `echo ${slot + 1} ${key}`).join(', ')
      notes.push(`${review.length === 1 ? 'a value was' : `${review.length} values were`} corrected by one character (${values})`)
    }
    for (const flag of flags) if (BUILD_FLAGS[flag]) notes.push(BUILD_FLAGS[flag])
  }

  if (!notes.length) return null
  return `Automatic: ${notes.join('; ')}. The build was accepted; check the card if something looks wrong.`
}

export type { CardRecord }
