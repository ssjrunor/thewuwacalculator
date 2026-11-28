/*
  Author: Runor Ewhro
  description: an account's inbox. notifications are written in the same batch
               as their subject, and repeats on one subject merge into one unread
               row. reads filter out notifications whose actor is now blocked; deleted builds remove their
               notifications (projections.ts). follow updates are not stored here
               (see feed).
*/

import type { NotificationKind } from '@lb/contract/api'
import { uuidv7 } from '../lib/ids.ts'
import { refColumns, type RefColumns } from './social.ts'

export interface NewNotification {
  accountId: string
  kind: NotificationKind
  // what it is about: the build, sanction or media item
  subjectId: string
  buildId?: string | null
  // the uid whose build did it (a dethroning)
  actorUid?: string | null
  data?: unknown
}

export const notifyStatement = (db: D1Database, n: NewNotification, now: number) =>
  db.prepare(`INSERT INTO notifications (id, account_id, kind, subject_id, build_id, actor_uid, count, data, created_at, read_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)
    ON CONFLICT (account_id, kind, subject_id) WHERE read_at IS NULL
      DO UPDATE SET count = count + 1, created_at = excluded.created_at, actor_uid = excluded.actor_uid, data = excluded.data`)
    .bind(uuidv7(now), n.accountId, n.kind, n.subjectId, n.buildId ?? null, n.actorUid ?? null,
      n.data === undefined ? null : JSON.stringify(n.data), now)

// the sql condition that notification `n` of account `?1` is still valid
const STANDS = `(n.actor_uid IS NULL OR NOT EXISTS (SELECT 1 FROM blocks k JOIN account_uids l ON l.account_id = k.blocked_account
    WHERE k.account_id = ?1 AND l.uid = n.actor_uid))`

export interface NotificationRow extends RefColumns {
  id: string
  kind: NotificationKind
  subject_id: string
  build_id: string | null
  resonator_id: string | null
  count: number
  data: string | null
  created_at: number
  read_at: number | null
}

// newest first, before a (created_at, id) cursor
export async function notificationsOf(db: D1Database, accountId: string, before: { at: number; id: string } | null,
  limit: number): Promise<NotificationRow[]> {
  const { results } = await db.prepare(`SELECT n.id, n.kind, n.subject_id, n.build_id, n.count, n.data, n.created_at, n.read_at,
      substr(n.build_id, 1, instr(n.build_id, '-') - 1) AS resonator_id, ${refColumns('n.actor_uid')}
    FROM notifications n
      LEFT JOIN players p ON p.uid = n.actor_uid
    WHERE n.account_id = ?1 AND ${STANDS}
      AND (?2 IS NULL OR n.created_at < ?2 OR (n.created_at = ?2 AND n.id < ?3))
    ORDER BY n.created_at DESC, n.id DESC LIMIT ?4`).bind(accountId, before?.at ?? null, before?.id ?? null, limit).all<NotificationRow>()
  return results
}

export async function unreadCount(db: D1Database, accountId: string): Promise<number> {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM notifications n WHERE n.account_id = ?1 AND n.read_at IS NULL AND ${STANDS}`)
    .bind(accountId).first<{ n: number }>())!.n
}

// marks the given notifications read, or all of them
export const markReadStatement = (db: D1Database, accountId: string, ids: string[] | null, now: number) => ids
  ? db.prepare(`UPDATE notifications SET read_at = ? WHERE account_id = ? AND read_at IS NULL AND id IN (SELECT value FROM json_each(?))`)
    .bind(now, accountId, JSON.stringify(ids))
  : db.prepare('UPDATE notifications SET read_at = ? WHERE account_id = ? AND read_at IS NULL').bind(now, accountId)

// read notifications are kept for a while, unread ones longer
export const purgeNotificationsStatement = (db: D1Database, readBefore: number, anyBefore: number, limit: number) =>
  db.prepare(`DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE read_at < ? LIMIT ?)
    OR id IN (SELECT id FROM notifications WHERE created_at < ? LIMIT ?)`).bind(readBefore, limit, anyBefore, limit)
