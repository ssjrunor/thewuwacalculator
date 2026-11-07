/*
  Author: Runor Ewhro
  description: expires sessions, erases retained rejected images, and recovers stalled card reads.
*/

import type { ApiEnv, ReadMessage } from '../env.ts'
import { auditStatement } from '../lib/audit.ts'
import { getCard, imageStillUsed, markImageErasedStatement, setCardStatusStatement } from '../db/cards.ts'
import { deleteCardImages } from './cards/store.ts'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** an expired session row is kept this long (for the audit trail of recent logins), then deleted. */
const SESSION_GRACE_MS = DAY_MS
/** pending cards older than 30 minutes are eligible for read-queue recovery. */
const STUCK_PENDING_MS = HOUR_MS / 2
const BATCH = 100

/** refusals whose image is kept only for the keep window (a re-read after a parser fix). */
export const REFUSED_FOR_RETENTION = ['unreadable', 'uid_unreadable', 'incomplete_build', 'read_failed'] as const

export interface MaintenanceReport {
  sessionsDeleted: number
  imagesErased: number
  requeued: number
}

type MaintenanceEnv = Pick<ApiEnv, 'LB' | 'CARDS' | 'READ_QUEUE' | 'REFUSED_IMAGE_KEEP_DAYS'>

// expire sessions, select bounded retention work, and requeue stalled pending cards using the same maintenance timestamp.
export async function maintain(env: MaintenanceEnv, now: number): Promise<MaintenanceReport> {
  const db = env.LB
  const sessions = await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now - SESSION_GRACE_MS).run()

  const keepMs = Math.max(1, Number(env.REFUSED_IMAGE_KEEP_DAYS) || 30) * DAY_MS
  const reasons = REFUSED_FOR_RETENTION.map(() => '?').join(', ')
  const { results: expired } = await db.prepare(`SELECT id, r2_key FROM cards WHERE status = 'rejected'
      AND reject_reason IN (${reasons}) AND image_erased_at IS NULL AND fetched_at < ? ORDER BY fetched_at LIMIT ?`)
    .bind(...REFUSED_FOR_RETENTION, now - keepMs, BATCH).all<{ id: string; r2_key: string }>()
  if (expired.length) {
    const ids = new Set(expired.map((card) => card.id))
    const erasable: string[] = []
    for (const card of expired) if (!await imageStillUsed(db, card.r2_key, ids)) erasable.push(card.r2_key)
    await db.batch([
      ...expired.map((card) => markImageErasedStatement(db, card.id, now)),
      auditStatement(db, { actorKind: 'system', actorId: null, action: 'card.retention_erase', subjectKind: 'card',
        subjectId: 'batch', data: { cards: expired.length } }, now),
    ])
    await deleteCardImages(env.CARDS, [...new Set(erasable)])
  }

  const { results: stuck } = await db.prepare(`SELECT id FROM cards WHERE status = 'pending' AND image_erased_at IS NULL
      AND fetched_at < ? ORDER BY fetched_at LIMIT ?`).bind(now - STUCK_PENDING_MS, BATCH).all<{ id: string }>()
  if (stuck.length) await env.READ_QUEUE.sendBatch(stuck.map((card) => ({ body: { cardId: card.id, ownerUid: null } })))

  return { sessionsDeleted: sessions.meta.changes ?? 0, imagesErased: expired.length, requeued: stuck.length }
}

/** record exhausted reads as `read_failed`; a later submission can queue the retained image for another attempt. */
export async function settleDeadReads(batch: MessageBatch<ReadMessage>, env: Pick<ApiEnv, 'LB'>, now: number): Promise<void> {
  for (const message of batch.messages) {
    const card = await getCard(env.LB, message.body.cardId)
    if (card?.status === 'pending') {
      await env.LB.batch([
        setCardStatusStatement(env.LB, card.id, 'rejected', 'read_failed'),
        auditStatement(env.LB, { actorKind: 'system', actorId: null, action: 'card.dead_letter', subjectKind: 'card',
          subjectId: card.id, data: { attempts: message.attempts } }, now),
      ])
    }
    message.ack()
  }
}
