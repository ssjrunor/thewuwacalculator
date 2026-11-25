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
import type { CardReadResult } from '@lb/contract/read'
import type { BuildSnapshot } from '@lb/contract/snapshot'
import type { ApiEnv } from '../../env.ts'
import { formatBuildId } from '../../lib/ids.ts'
import { packSnapshot } from '../../lib/snapshotPack.ts'
import { getPlayer, upsertPlayerStatement } from '../../db/identity.ts'
import { insertReportStatement } from '../../db/moderation.ts'
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

/** what identifies a build for "the same build again": the card's stats, not its name or data version. */
export const snapshotHash = (snapshot: BuildSnapshot): Promise<string> =>
  sha256Hex(canonicalJson({ v: snapshot.v, uid: snapshot.uid, resonator: snapshot.resonator, weapon: snapshot.weapon,
    echoes: snapshot.echoes }))

export interface IngestOptions {
  reader: CardReader
  /** uids in the submitter's session. */
  sessionUids?: string[]
  /** the card itself proves control (a fresh card logging in). */
  freshLogin?: boolean
  /** set for a player's submission (staff and re-reads leave it unset); ends a setup uid's setup state. */
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
  // store the evidence before judging the result, which keeps refused reads inspectable
  await env.CARDS.put(cardReadKey(card.id, read.parserVer), JSON.stringify(read), { httpMetadata: { contentType: 'application/json' } })
  const resonatorId = read.snapshot ? canonicalResonatorId(read.snapshot.resonator.id) : read.resonatorId
  await ref.stub.recordRead(ref.shard, card.no, { parserVer: read.parserVer, outcome: read.outcome,
    uid: read.uid && /^\d{9}$/.test(read.uid) ? Number(read.uid) : null, resonator: resonatorId ? Number(resonatorId) : null })
  const reject = async (reason: Extract<IngestOutcome, { kind: 'rejected' }>['reason']): Promise<IngestOutcome> => {
    await ref.stub.setStatus(ref.shard, card.no, 'rejected', reason)
    return { kind: 'rejected', reason, read }
  }
  if (read.outcome !== 'ok' || !read.snapshot || !read.uid || read.uid === '0' || !resonatorId) {
    // empty echo slots are read as part of the build, so a refusal is one of these two reasons
    return reject(read.outcome === 'uid_unreadable' ? 'uid_unreadable' : 'unreadable')
  }

  const uid = read.uid
  const player = await getPlayer(db, uid)
  if (player?.opted_out_at != null) return reject('opted_out')
  // a suspended or banned uid stores nothing new; the card can be read again once the sanction ends.
  if (await stoppedBy(db, 'uid', uid, options.now)) return reject('suspended')
  const claimSetup = player?.setup_at != null && options.byPlayer === true
  await db.batch([upsertPlayerStatement(db, { uid, name: read.snapshot.name }, options.now),
    ...(claimSetup ? endSetupStatements(db, uid, null, options.now) : [])])
  const facts = (await playerFacts(db, uid))!
  const resonator = Number(resonatorId)
  // ownership applies only to the fresh-card login or a session holding the uid read from this image.
  const { placement } = await boardOf(env, resonator).place(resonator, {
    uid: Number(uid), player: facts, card: card.id, snap: packSnapshot(read.snapshot), snapHash: await snapshotHash(read.snapshot),
    seq: read.snapshot.resonator.sequence, drawnAt: card.kuro_last_modified,
    owner: options.freshLogin === true || (options.sessionUids ?? []).includes(uid), claimSetup, now: options.now,
  })
  const buildId = formatBuildId({ resonator, local: placement.local })
  await ref.stub.setPlaced(ref.shard, card.no, Number(uid), resonator, buildId)
  // corrected values do not block the build; they open a report for a moderator to check
  if (!placement.repeated && !placement.claimed && read.confidence.review?.length) {
    await insertReportStatement(db, { buildId, subjectUid: uid, reason: 'misread',
      details: correctedDetails(read.confidence.review) }, options.now).statement.run()
  }
  return { kind: 'placed', uid, buildId, resonatorId: String(resonator), placement, read }
}

/** the report text for values the reader corrected by one character. */
export function correctedDetails(review: NonNullable<CardReadResult['confidence']['review']>): string {
  const values = review.map(({ slot, key }) => `echo ${slot + 1} ${key}`).join(', ')
  return `Automatic: read with ${review.length === 1 ? 'a value' : `${review.length} values`} corrected by one character (${values}). The build was accepted; check the card if a value looks wrong.`
}

export type { CardRecord }
