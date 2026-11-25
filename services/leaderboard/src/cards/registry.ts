/*
  Author: Runor Ewhro
  description: one card registry shard: every card whose link hash starts with
               the shard's hex digit, its outcome and its reads. a card row is
               about 120 bytes; its image is in CARDS (cards/<card id>.<ext>), and
               each read's evidence (snapshot and confidence) is also in CARDS
               (reads/<card id>/<parser ver>.json). cards are deduped here by link
               hash, before the resonator is known.
*/

import { formatCardId } from '../lib/ids.ts'
import type { SqlLike } from '../board/sql.ts'

export type CardStatusCode = 'pending' | 'read' | 'rejected' | 'blocked'

export interface CardRecord {
  /** the card's public id. */
  id: string
  no: number
  link_hash: string
  ext: 'jpg' | 'png'
  content_type: 'image/jpeg' | 'image/png'
  byte_size: number
  image_sha256: string
  kuro_last_modified: number
  fetched_at: number
  status: CardStatusCode
  reject_reason: string | null
  image_erased_at: number | null
  /** what its accepted read said, once read. */
  uid: number | null
  resonator: number | null
  /** the build it made, once placed. */
  build: string | null
  read_ver: string | null
}

export interface NewCard {
  linkHash: string
  contentType: 'image/jpeg' | 'image/png'
  byteSize: number
  imageSha256: string
  lastModified: number
}

export interface ReadSummary {
  parserVer: string
  outcome: 'ok' | 'uid_unreadable' | 'unreadable' | 'unsupported'
  uid: number | null
  resonator: number | null
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS cards (no INTEGER PRIMARY KEY, link_hash TEXT NOT NULL UNIQUE, ext TEXT NOT NULL,
    content_type TEXT NOT NULL, byte_size INTEGER NOT NULL, image_sha256 TEXT NOT NULL, kuro_last_modified INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL, status TEXT NOT NULL, reject_reason TEXT, image_erased_at INTEGER, uid INTEGER, resonator INTEGER,
    build TEXT, read_ver TEXT)`,
  `CREATE INDEX IF NOT EXISTS cards_uid ON cards (uid) WHERE uid IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS cards_status ON cards (status, fetched_at)`,
  `CREATE TABLE IF NOT EXISTS reads (card INTEGER NOT NULL, parser_ver TEXT NOT NULL, outcome TEXT NOT NULL, uid INTEGER,
    resonator INTEGER, at INTEGER NOT NULL, PRIMARY KEY (card, parser_ver)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS events (card INTEGER NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, actor TEXT, data TEXT)`,
  `CREATE INDEX IF NOT EXISTS events_card ON events (card, at)`,
]

type Row = Omit<CardRecord, 'id'>

export const cardImageKey = (card: Pick<CardRecord, 'id' | 'ext'>) => `cards/${card.id}.${card.ext}`
export const cardReadKey = (cardId: string, parserVer: string) => `reads/${cardId}/${parserVer}.json`

export class RegistryStore {
  readonly sql: SqlLike
  readonly shard: number

  constructor(sql: SqlLike, shard: number) {
    this.sql = sql
    this.shard = shard
    sql.transaction(() => {
      for (const statement of SCHEMA) sql.run(statement)
      const stored = sql.first<{ v: number }>(`SELECT v FROM meta WHERE k = 'shard'`)
      if (!stored) sql.run(`INSERT INTO meta (k, v) VALUES ('shard', ?)`, shard)
      else if (stored.v !== shard) throw new Error(`registry: this storage is shard ${stored.v}'s, not ${shard}'s`)
    })
  }

  private withId(row: Row | null): CardRecord | null {
    return row ? { ...row, id: formatCardId({ shard: this.shard, no: row.no }) } : null
  }

  private event(no: number, kind: string, actor: string | null, data: unknown, now: number): void {
    this.sql.run(`INSERT INTO events (card, at, kind, actor, data) VALUES (?, ?, ?, ?, ?)`, no, now, kind, actor,
      data == null ? null : JSON.stringify(data))
  }

  get(no: number): CardRecord | null {
    return this.withId(this.sql.first<Row>(`SELECT * FROM cards WHERE no = ?`, no))
  }

  byLink(linkHash: string): CardRecord | null {
    return this.withId(this.sql.first<Row>(`SELECT * FROM cards WHERE link_hash = ?`, linkHash))
  }

  /** records a new card pending its read; a known link returns its existing card. */
  record(card: NewCard, now: number): { card: CardRecord; inserted: boolean } {
    return this.sql.transaction(() => {
      const known = this.byLink(card.linkHash)
      if (known) return { card: known, inserted: false }
      this.sql.run(`INSERT INTO cards (link_hash, ext, content_type, byte_size, image_sha256, kuro_last_modified, fetched_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`, card.linkHash, card.contentType === 'image/png' ? 'png' : 'jpg', card.contentType,
      card.byteSize, card.imageSha256, card.lastModified, now)
      const stored = this.byLink(card.linkHash)!
      this.event(stored.no, 'card.fetch', null, null, now)
      return { card: stored, inserted: true }
    })
  }

  setStatus(no: number, status: CardStatusCode, reason: string | null, now: number, actor: string | null = null): void {
    this.sql.transaction(() => {
      // a blocked card stays blocked: only block() and nothing after it sets that.
      this.sql.run(`UPDATE cards SET status = ?, reject_reason = ? WHERE no = ? AND (status <> 'blocked' OR ? = 'blocked')`,
        status, reason, no, status)
      this.event(no, status === 'rejected' ? 'card.reject' : `card.${status}`, actor, reason == null ? null : { reason }, now)
    })
  }

  /** a card's image is stored again (it was erased): back to pending for a fresh read. */
  restoreImage(no: number, now: number): void {
    this.sql.transaction(() => {
      this.sql.run(`UPDATE cards SET status = 'pending', reject_reason = NULL, image_erased_at = NULL WHERE no = ? AND status <> 'blocked'`, no)
      this.event(no, 'card.refetch', null, null, now)
    })
  }

  markErased(nos: number[], now: number): void {
    if (!nos.length) return
    this.sql.transaction(() => {
      for (const no of nos) this.sql.run(`UPDATE cards SET image_erased_at = ? WHERE no = ?`, now, no)
    })
  }

  /** records a read once per parser version (evidence is in R2); an accepted read marks the card read. */
  recordRead(no: number, read: ReadSummary, now: number): void {
    this.sql.transaction(() => {
      this.sql.run(`INSERT INTO reads (card, parser_ver, outcome, uid, resonator, at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (card, parser_ver) DO NOTHING`, no, read.parserVer, read.outcome, read.uid, read.resonator, now)
      this.sql.run(`UPDATE cards SET read_ver = ? WHERE no = ?`, read.parserVer, no)
    })
  }

  /** the card is read as this player's build: it is `read`, and names the build it made. */
  setPlaced(no: number, uid: number, resonator: number, build: string, now: number): void {
    this.sql.transaction(() => {
      this.sql.run(`UPDATE cards SET status = 'read', reject_reason = NULL, uid = ?, resonator = ?, build = ? WHERE no = ? AND status <> 'blocked'`,
        uid, resonator, build, no)
      this.event(no, 'card.placed', null, { build }, now)
    })
  }

  block(no: number, actor: string, now: number): CardRecord | null {
    this.setStatus(no, 'blocked', 'blocked', now, actor)
    return this.get(no)
  }

  /** the uid a card's newest read named, for a card refused before it was placed. */
  readUid(no: number): number | null {
    return this.sql.first<{ uid: number | null }>(`SELECT uid FROM reads WHERE card = ? AND uid IS NOT NULL ORDER BY at DESC LIMIT 1`, no)?.uid ?? null
  }

  /** every card read as this uid (an opt-out erases them). */
  cardsOfUid(uid: number): CardRecord[] {
    const nos = new Set([
      ...this.sql.all<{ no: number }>(`SELECT no FROM cards WHERE uid = ?`, uid).map((row) => row.no),
      ...this.sql.all<{ card: number }>(`SELECT card FROM reads WHERE uid = ?`, uid).map((row) => row.card),
    ])
    return [...nos].flatMap((no) => this.get(no) ?? [])
  }

  /** cards refused for one of `reasons` whose images are kept past `before`: retention erases them. */
  refusedImages(before: number, limit: number, reasons: readonly string[]): CardRecord[] {
    return this.sql.all<Row>(`SELECT * FROM cards WHERE status = 'rejected' AND fetched_at < ? AND image_erased_at IS NULL
      AND reject_reason IN (SELECT value FROM json_each(?)) LIMIT ?`, before, JSON.stringify(reasons), limit).map((row) => this.withId(row)!)
  }

  /** cards still pending a read since `before`: their read message was lost. */
  stuckPending(before: number, limit: number): CardRecord[] {
    return this.sql.all<Row>(`SELECT * FROM cards WHERE status = 'pending' AND fetched_at < ? LIMIT ?`, before, limit)
      .map((row) => this.withId(row)!)
  }

  events(no: number): Array<{ at: number; kind: string; actor: string | null; data: string | null }> {
    return this.sql.all(`SELECT at, kind, actor, data FROM events WHERE card = ? ORDER BY at`, no)
  }

  reads(no: number): Array<{ parser_ver: string; outcome: string; uid: number | null; resonator: number | null; at: number }> {
    return this.sql.all(`SELECT parser_ver, outcome, uid, resonator, at FROM reads WHERE card = ? ORDER BY at`, no)
  }
}
