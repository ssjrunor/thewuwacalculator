/*
  Author: Runor Ewhro
  description: images an account uploads for its documents (avatar, banner,
               card art). bytes are in CARDS under media/<id>, and each row
               records the owner and moderator approval.
*/

import { uuidv7 } from '../lib/ids.ts'

export type MediaPurpose = 'avatar' | 'banner' | 'card'
export type MediaStatus = 'pending' | 'approved' | 'rejected' | 'deleted'

export interface MediaRow {
  id: string
  account_id: string
  purpose: MediaPurpose
  r2_key: string
  content_type: string
  byte_size: number
  sha256: string
  status: MediaStatus
  created_at: number
  reviewed_at: number | null
  reviewed_by: string | null
}

export const mediaKey = (id: string) => `media/${id}`

/** a new upload waits for review, unless `approvedBy` names the staff member whose upload needs none. */
export function insertMediaStatement(db: D1Database, media: { accountId: string; purpose: MediaPurpose; contentType: string;
  byteSize: number; sha256: string; approvedBy: string | null }, now: number) {
  const id = uuidv7(now)
  const approved = media.approvedBy != null
  return { id, r2Key: mediaKey(id), statement: db.prepare(`INSERT INTO media (id, account_id, purpose, r2_key, content_type, byte_size, sha256,
      status, created_at, reviewed_at, reviewed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, media.accountId, media.purpose, mediaKey(id), media.contentType, media.byteSize, media.sha256,
      approved ? 'approved' : 'pending', now, approved ? now : null, media.approvedBy) }
}

export const getMedia = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM media WHERE id = ?').bind(id).first<MediaRow>()

/** an account's media, newest first; deleted ones are left out. */
export async function mediaOf(db: D1Database, accountId: string): Promise<MediaRow[]> {
  const { results } = await db.prepare(`SELECT * FROM media WHERE account_id = ? AND status <> 'deleted' ORDER BY created_at DESC`)
    .bind(accountId).all<MediaRow>()
  return results
}

export const pendingCount = async (db: D1Database, accountId: string): Promise<number> =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM media WHERE account_id = ? AND status = 'pending'`).bind(accountId).first<{ n: number }>())?.n ?? 0

/** media awaiting a decision, oldest first. */
export async function mediaByStatus(db: D1Database, status: MediaStatus, limit: number): Promise<MediaRow[]> {
  const { results } = await db.prepare('SELECT * FROM media WHERE status = ? ORDER BY created_at LIMIT ?').bind(status, limit).all<MediaRow>()
  return results
}

/** sets a moderator decision or owner deletion on media; decided and deleted items are final. */
export const setMediaStatusStatement = (db: D1Database, id: string, status: Exclude<MediaStatus, 'pending'>, by: string | null, now: number) =>
  db.prepare(`UPDATE media SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ? AND status IN ('pending', 'approved')`)
    .bind(status, now, by, id)

/** which of these ids are approved, so may show to anyone. */
export async function approvedOf(db: D1Database, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const { results } = await db.prepare(`SELECT id FROM media WHERE status = 'approved' AND id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids)).all<{ id: string }>()
  return new Set(results.map((row) => row.id))
}
