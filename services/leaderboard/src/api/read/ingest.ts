/*
  Author: Runor Ewhro
  description: stores card reads, rejects invalid builds, and queues scoring for accepted active builds.
*/

import { canonicalJson, sha256Hex } from '@/domain/leaderboard/canonical'
import { canonicalResonatorId } from '@/domain/leaderboard/identity'
import type { CardReadResult } from '@/domain/leaderboard/read'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import type { ApiEnv } from '../../env.ts'
import { auditStatement } from '../../lib/audit.ts'
import { getCard, insertRead, setCardStatusStatement, setCurrentReadStatement, type CardRow } from '../../db/cards.ts'
import { getPlayer, upsertPlayerStatement } from '../../db/identity.ts'
import { loadCardImage } from '../cards/store.ts'
import { placeBuild, startScoring, type Placement } from '../builds/lifecycle.ts'
import type { CardReader } from './dispatch.ts'

export type IngestOutcome =
  | { kind: 'skipped'; reason: 'missing' | 'blocked' | 'image_missing' }
  | { kind: 'rejected'; reason: 'uid_unreadable' | 'unreadable' | 'incomplete_build' | 'opted_out'; read: CardReadResult }
  | { kind: 'placed'; uid: string; placement: Placement; read: CardReadResult }

/** what identifies a build for "the same build again": the card's stats, not its name or data version. */
export const snapshotHash = (snapshot: BuildSnapshot): Promise<string> =>
  sha256Hex(canonicalJson({ v: snapshot.v, uid: snapshot.uid, resonator: snapshot.resonator, weapon: snapshot.weapon,
    echoes: snapshot.echoes }))

export interface IngestOptions {
  reader: CardReader
  /** the uid the submitter proved control of (a session), if any. */
  sessionUid?: string | null
  /** the card itself proves control (a fresh card logging in). */
  freshLogin?: boolean
  now: number
}

/** identifies an exact UID read whose only issues are missing Echo slots. */
export const isIncompleteBuild = (read: CardReadResult): boolean =>
  read.outcome === 'unreadable' && !!read.uid && read.uid !== '0' && read.confidence.issues.length > 0 &&
  read.confidence.issues.every((issue) => issue === 'echo_missing')

export async function ingestCard(env: Pick<ApiEnv, 'LB' | 'CARDS' | 'SCORE_QUEUE'>, cardId: string,
  options: IngestOptions): Promise<IngestOutcome> {
  const db = env.LB
  const card = await getCard(db, cardId)
  if (!card) return { kind: 'skipped', reason: 'missing' }
  if (card.status === 'blocked') return { kind: 'skipped', reason: 'blocked' }
  const bytes = await loadCardImage(env.CARDS, card.r2_key)
  if (!bytes) return { kind: 'skipped', reason: 'image_missing' }

  const read = await options.reader(bytes, card.content_type)
  // store parser evidence before validating the result; rejected reads remain available for diagnostics.
  const row = await insertRead(db, card.id, read, options.now)
  if (read.outcome !== 'ok' || !read.snapshot || !read.uid || read.uid === '0') {
    const reason = read.outcome === 'uid_unreadable' ? 'uid_unreadable' : isIncompleteBuild(read) ? 'incomplete_build' : 'unreadable'
    await reject(db, card, reason, options.now)
    return { kind: 'rejected', reason, read }
  }

  const uid = read.uid
  const player = await getPlayer(db, uid)
  if (player?.opted_out_at != null) {
    await reject(db, card, 'opted_out', options.now)
    return { kind: 'rejected', reason: 'opted_out', read }
  }
  await db.batch([upsertPlayerStatement(db, { uid, name: read.snapshot.name }, options.now), setCurrentReadStatement(db, card.id, row.id)])
  // ownership applies only to the fresh-card login or a session matching the UID read from this image.
  const placement = await placeBuild(db, {
    uid,
    resonatorId: canonicalResonatorId(read.snapshot.resonator.id),
    cardId: card.id,
    readId: row.id,
    sequence: read.snapshot.resonator.sequence,
    drawnAt: card.kuro_last_modified,
    snapshotHash: await snapshotHash(read.snapshot),
    owner: options.freshLogin === true || options.sessionUid === uid,
  }, options.now)
  if (placement.active && !placement.repeated) await startScoring(env, placement.buildId)
  return { kind: 'placed', uid, placement, read }
}

async function reject(db: D1Database, card: CardRow, reason: string, now: number): Promise<void> {
  await db.batch([
    setCardStatusStatement(db, card.id, 'rejected', reason),
    auditStatement(db, { actorKind: 'system', actorId: null, action: 'card.reject', subjectKind: 'card', subjectId: card.id,
      data: { reason } }, now),
  ])
}
