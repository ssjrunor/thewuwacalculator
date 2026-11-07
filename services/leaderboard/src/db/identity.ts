/*
  Author: Runor Ewhro
  description: prepares player, ownership-claim, and session records.
*/

import { uuidv7 } from '../lib/ids.ts'

export interface PlayerRow {
  uid: string
  region: string | null
  last_name: string | null
  hide_uid: 0 | 1
  opted_out_at: number | null
  first_seen_at: number
  last_seen_at: number
}

export interface SessionRow {
  token_hash: string
  uid: string | null
  account_id: string | null
  claim_id: string | null
  created_at: number
  expires_at: number
  revoked_at: number | null
}

/* the server a uid belongs to is its first digit, stored as is. naming the
   servers is the app's job, so a wrong or new name never touches stored rows. */
export function regionOf(uid: string): string | null {
  return /^\d{9}$/.test(uid) ? uid[0] : null
}

export const getPlayer = (db: D1Database, uid: string) =>
  db.prepare('SELECT * FROM players WHERE uid = ?').bind(uid).first<PlayerRow>()

// repeat reads update the display name and last-seen time without resetting privacy or opt-out settings.
export function upsertPlayerStatement(db: D1Database, player: { uid: string; name: string | null }, now: number) {
  return db.prepare(`INSERT INTO players (uid, region, last_name, hide_uid, opted_out_at, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, 0, NULL, ?, ?)
    ON CONFLICT (uid) DO UPDATE SET last_name = COALESCE(excluded.last_name, players.last_name), last_seen_at = excluded.last_seen_at`)
    .bind(player.uid, regionOf(player.uid), player.name, now, now)
}

export const setHideUidStatement = (db: D1Database, uid: string, hide: boolean) =>
  db.prepare('UPDATE players SET hide_uid = ? WHERE uid = ?').bind(hide ? 1 : 0, uid)

export const setOptedOutStatement = (db: D1Database, uid: string, at: number | null) =>
  db.prepare('UPDATE players SET opted_out_at = ? WHERE uid = ?').bind(at, uid)

export function insertClaimStatement(db: D1Database, claim: { uid: string; cardId: string }, now: number) {
  const id = uuidv7(now)
  return { id, statement: db.prepare(`INSERT INTO claims (id, uid, card_id, kind, created_at) VALUES (?, ?, ?, 'fresh_card', ?)`)
    .bind(id, claim.uid, claim.cardId, now) }
}

export const insertSessionStatement = (db: D1Database, session: { tokenHash: string; uid: string; claimId: string;
  now: number; expiresAt: number }) =>
  db.prepare(`INSERT INTO sessions (token_hash, uid, account_id, claim_id, created_at, expires_at, revoked_at)
    VALUES (?, ?, NULL, ?, ?, ?, NULL)`).bind(session.tokenHash, session.uid, session.claimId, session.now, session.expiresAt)

// only unrevoked sessions whose expiry is strictly after the request time authenticate a request.
export const findLiveSession = (db: D1Database, tokenHash: string, now: number) =>
  db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?')
    .bind(tokenHash, now).first<SessionRow>()

export const revokeSessionStatement = (db: D1Database, tokenHash: string, now: number) =>
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').bind(now, tokenHash)

/** every session of a uid ends when the uid opts out. */
export const revokeUidSessionsStatement = (db: D1Database, uid: string, now: number) =>
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE uid = ? AND revoked_at IS NULL').bind(now, uid)
