/*
  Author: Runor Ewhro
  description: stores card evidence and parser-versioned reads using keyed link hashes.
*/

import type { CardReadResult } from '@/domain/leaderboard/read'
import { uuidv7 } from '../lib/ids.ts'

export type CardRowStatus = 'pending' | 'read' | 'rejected' | 'blocked'

export interface CardRow {
  id: string
  link_hash: string
  image_sha256: string
  r2_key: string
  content_type: 'image/jpeg' | 'image/png'
  byte_size: number
  kuro_last_modified: number
  fetched_at: number
  status: CardRowStatus
  reject_reason: string | null
  current_read_id: string | null
  /** set once the image is gone from CARDS (opt-out or retention); a resubmission fetches it again. */
  image_erased_at: number | null
}

export interface CardReadRow {
  id: string
  card_id: string
  parser_ver: string
  uid: string | null
  resonator_id: string | null
  snapshot: string | null
  confidence: string | null
  outcome: CardReadResult['outcome']
  created_at: number
}

export const findCardByLinkHash = (db: D1Database, linkHash: string) =>
  db.prepare('SELECT * FROM cards WHERE link_hash = ?').bind(linkHash).first<CardRow>()

export const getCard = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM cards WHERE id = ?').bind(id).first<CardRow>()

export interface NewCard {
  linkHash: string
  imageSha256: string
  r2Key: string
  contentType: CardRow['content_type']
  byteSize: number
  lastModified: number
}

/** inserts a pending card; a racing submit of the same link loses to the unique link_hash. */
export async function insertCard(db: D1Database, card: NewCard, now: number): Promise<{ card: CardRow; inserted: boolean }> {
  const id = uuidv7(now)
  await db.prepare(`INSERT INTO cards (id, link_hash, image_sha256, r2_key, content_type, byte_size, kuro_last_modified,
      fetched_at, status, reject_reason, current_read_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL) ON CONFLICT (link_hash) DO NOTHING`)
    .bind(id, card.linkHash, card.imageSha256, card.r2Key, card.contentType, card.byteSize, card.lastModified, now).run()
  // read back the winning unique-key row; concurrent submissions return the same stored card identity.
  const stored = (await findCardByLinkHash(db, card.linkHash))!
  return { card: stored, inserted: stored.id === id }
}

export const setCardStatusStatement = (db: D1Database, id: string, status: CardRowStatus, reason: string | null) =>
  db.prepare('UPDATE cards SET status = ?, reject_reason = ? WHERE id = ?').bind(status, reason, id)

/** the image of each card is gone from CARDS. */
export const markImageErasedStatement = (db: D1Database, id: string, now: number) =>
  db.prepare('UPDATE cards SET image_erased_at = ? WHERE id = ?').bind(now, id)

/** a card's image is stored again: back to pending for a fresh read. */
export const restoreCardImageStatement = (db: D1Database, id: string) =>
  db.prepare(`UPDATE cards SET status = 'pending', reject_reason = NULL, image_erased_at = NULL WHERE id = ?`).bind(id)

// a blocked card cannot become readable through a late parser result.
export const setCurrentReadStatement = (db: D1Database, cardId: string, readId: string) =>
  db.prepare(`UPDATE cards SET current_read_id = ?, status = 'read', reject_reason = NULL WHERE id = ? AND status <> 'blocked'`)
    .bind(readId, cardId)

export const getReadFor = (db: D1Database, cardId: string, parserVer: string) =>
  db.prepare('SELECT * FROM card_reads WHERE card_id = ? AND parser_ver = ?').bind(cardId, parserVer).first<CardReadRow>()

export const getRead = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM card_reads WHERE id = ?').bind(id).first<CardReadRow>()

/** stores a read once per parser version; a repeat delivery keeps the first one. */
export async function insertRead(db: D1Database, cardId: string, read: CardReadResult, now: number): Promise<CardReadRow> {
  await db.prepare(`INSERT INTO card_reads (id, card_id, parser_ver, uid, resonator_id, snapshot, confidence, outcome, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (card_id, parser_ver) DO NOTHING`)
    .bind(uuidv7(now), cardId, read.parserVer, read.outcome === 'uid_unreadable' ? null : read.uid, read.resonatorId,
      read.snapshot ? JSON.stringify(read.snapshot) : null,
      JSON.stringify({ ...read.confidence, ms: read.ms, wallMs: read.wallMs ?? null, error: read.error ?? null }), read.outcome, now).run()
  return (await getReadFor(db, cardId, read.parserVer))!
}

/** the image keys of every card read as this uid (opt-out erases them). */
export async function cardKeysForUid(db: D1Database, uid: string): Promise<Array<{ id: string; r2_key: string }>> {
  const { results } = await db.prepare(`SELECT DISTINCT c.id, c.r2_key FROM cards c
    JOIN card_reads r ON r.card_id = c.id WHERE r.uid = ?`).bind(uid).all<{ id: string; r2_key: string }>()
  return results
}

/** another card may still use an image (two links to one image). */
// image hashes can be shared by several card rows; erase bytes only after excluding every row being removed.
export async function imageStillUsed(db: D1Database, r2Key: string, exceptIds: ReadonlySet<string>): Promise<boolean> {
  const { results } = await db.prepare('SELECT id FROM cards WHERE r2_key = ?').bind(r2Key).all<{ id: string }>()
  return results.some((row) => !exceptIds.has(row.id))
}
