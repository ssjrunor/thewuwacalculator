/*
  Author: Runor Ewhro
  description: prepares player, ownership-claim and session records. a uid only
               groups builds; a session acts for its account's linked uids, or,
               signed out, for the uids it claimed with fresh cards.
*/

import { uuidv7 } from '../lib/ids.ts'
import { blocking } from './sanctions.ts'

export interface PlayerRow {
  uid: string
  region: string | null
  last_name: string | null
  hide_uid: 0 | 1
  /** the player shows as Anonymous: no name, uid or profile, only their region. */
  anonymous: 0 | 1
  /** a uid added to fill the boards before its player took part (players.setup_at); it reads as anonymous. */
  setup_at: number | null
  opted_out_at: number | null
  first_seen_at: number
  last_seen_at: number
  /** incremented with every change the boards need (BoardDO.syncPlayer). */
  ver: number
}

/** bumps ver for a board-relevant change stored outside the players row (a ban issued or lifted). */
export const bumpPlayerStatement = (db: D1Database, uid: string) => db.prepare('UPDATE players SET ver = ver + 1 WHERE uid = ?').bind(uid)

export interface SessionRow {
  token_hash: string
  /** the signed-in account; null for a claim session, which acts only for its held uids. */
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

/** the condition for showing a player without a name or profile: their own choice, or a setup uid. `p` is a players
    row alias, and every query naming players selects it as `masked`. */
export const maskedSql = (p: string) => `(${p}.anonymous = 1 OR ${p}.setup_at IS NOT NULL)`
export const isMasked = (player: Pick<PlayerRow, 'anonymous' | 'setup_at'>): boolean => player.anonymous === 1 || player.setup_at != null

export const getPlayer = (db: D1Database, uid: string) =>
  db.prepare('SELECT * FROM players WHERE uid = ?').bind(uid).first<PlayerRow>()

/** a player anyone may look up (listed_players: not opted out, not banned). */
export const getListedPlayer = (db: D1Database, uid: string) =>
  db.prepare('SELECT * FROM listed_players WHERE uid = ?').bind(uid).first<PlayerRow>()

// repeat reads update the display name and last-seen time without resetting privacy or opt-out settings.
export function upsertPlayerStatement(db: D1Database, player: { uid: string; name: string | null }, now: number) {
  return db.prepare(`INSERT INTO players (uid, region, last_name, hide_uid, opted_out_at, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, 0, NULL, ?, ?)
    ON CONFLICT (uid) DO UPDATE SET last_name = COALESCE(excluded.last_name, players.last_name), last_seen_at = excluded.last_seen_at,
      ver = players.ver + (COALESCE(excluded.last_name, players.last_name) IS NOT players.last_name)`)
    .bind(player.uid, regionOf(player.uid), player.name, now, now)
}

export const setHideUidStatement = (db: D1Database, uid: string, hide: boolean) =>
  db.prepare('UPDATE players SET hide_uid = ?, ver = ver + 1 WHERE uid = ?').bind(hide ? 1 : 0, uid)

export const setAnonymousStatement = (db: D1Database, uid: string, anonymous: boolean) =>
  db.prepare('UPDATE players SET anonymous = ?, ver = ver + 1 WHERE uid = ?').bind(anonymous ? 1 : 0, uid)

/** ends a uid's setup state when a player acts for it; a no-op for other uids. */
export const endSetupStatement = (db: D1Database, uid: string) =>
  db.prepare('UPDATE players SET setup_at = NULL, ver = ver + 1 WHERE uid = ? AND setup_at IS NOT NULL').bind(uid)

export const setOptedOutStatement = (db: D1Database, uid: string, at: number | null) =>
  db.prepare('UPDATE players SET opted_out_at = ?, ver = ver + 1 WHERE uid = ?').bind(at, uid)

export function insertClaimStatement(db: D1Database, claim: { uid: string; cardId: string }, now: number) {
  const id = uuidv7(now)
  return { id, statement: db.prepare(`INSERT INTO claims (id, uid, card_id, kind, created_at) VALUES (?, ?, ?, 'fresh_card', ?)`)
    .bind(id, claim.uid, claim.cardId, now) }
}

// only unrevoked sessions expiring strictly after the request time authenticate; `stopped` is 1 when a sanction
// blocks the session's account, and such a session acts for no uid
export const findLiveSession = (db: D1Database, tokenHash: string, now: number) =>
  db.prepare(`SELECT s.*,
      EXISTS (SELECT 1 FROM sanctions x WHERE x.subject_kind = 'account' AND x.subject_id = s.account_id AND ${blocking('x', '?2')}) AS stopped
    FROM sessions s WHERE s.token_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2`)
    .bind(tokenHash, now).first<SessionRow & { stopped: 0 | 1 }>()

export interface SessionUidRow {
  uid: string
  /** 1 when the uid is linked to the session's account, 0 when only this claim session holds it. */
  linked: 0 | 1
  last_name: string | null
  hide_uid: 0 | 1
  anonymous: 0 | 1
  opted_out_at: number | null
}

/** every uid a session acts for, oldest first: its account's linked uids, or a claim session's held uids; uids
    blocked by a sanction are excluded. */
export async function sessionUids(db: D1Database, session: { tokenHash: string; accountId: string | null }, now = Date.now()): Promise<SessionUidRow[]> {
  const { results } = await db.prepare(`SELECT m.uid, m.linked, p.last_name, p.hide_uid, p.anonymous, p.opted_out_at FROM (
      SELECT l.uid, 1 AS linked, l.linked_at AS at FROM account_uids l WHERE l.account_id = ?2
      UNION ALL
      SELECT h.uid, 0, h.created_at FROM uid_holds h WHERE h.token_hash = ?1 AND ?2 IS NULL) m
    JOIN players p ON p.uid = m.uid
    WHERE NOT EXISTS (SELECT 1 FROM sanctions x WHERE x.subject_kind = 'uid' AND x.subject_id = m.uid AND ${blocking('x', '?3')})
    ORDER BY m.at, m.uid`).bind(session.tokenHash, session.accountId, now).all<SessionUidRow>()
  return results
}

/** whether a session acts for a uid. */
export const sessionHasUid = async (db: D1Database, session: { tokenHash: string; accountId: string | null }, uid: string, now = Date.now()) =>
  (await sessionUids(db, session, now)).some((row) => row.uid === uid)

export const revokeSessionStatement = (db: D1Database, tokenHash: string, now: number) =>
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').bind(now, tokenHash)

// uid_holds: the claim session holding each uid, proved by a fresh card; one holder per uid, counted only while its
// session is live

export interface HoldRow {
  uid: string
  token_hash: string
  claim_id: string
  created_at: number
}

/** the live holder of a uid, or null; holds of ended sessions do not count. */
export const liveHolder = (db: D1Database, uid: string, now: number) =>
  db.prepare(`SELECT h.* FROM uid_holds h JOIN sessions s ON s.token_hash = h.token_hash
    WHERE h.uid = ? AND s.revoked_at IS NULL AND s.expires_at > ?`).bind(uid, now).first<HoldRow>()

/** a claim session's held uids with the claim that proved each, oldest first. */
export async function holdsOf(db: D1Database, tokenHash: string): Promise<HoldRow[]> {
  const { results } = await db.prepare('SELECT * FROM uid_holds WHERE token_hash = ? ORDER BY created_at').bind(tokenHash).all<HoldRow>()
  return results
}

/** assigns a uid to a claim session, replacing a stale hold from an ended session. */
export const upsertHoldStatement = (db: D1Database, hold: { uid: string; tokenHash: string; claimId: string; now: number }) =>
  db.prepare(`INSERT INTO uid_holds (uid, token_hash, claim_id, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (uid) DO UPDATE SET token_hash = excluded.token_hash, claim_id = excluded.claim_id, created_at = excluded.created_at`)
    .bind(hold.uid, hold.tokenHash, hold.claimId, hold.now)

export const deleteHoldStatement = (db: D1Database, uid: string) =>
  db.prepare('DELETE FROM uid_holds WHERE uid = ?').bind(uid)

export const deleteSessionHoldsStatement = (db: D1Database, tokenHash: string) =>
  db.prepare('DELETE FROM uid_holds WHERE token_hash = ?').bind(tokenHash)

export const extendSessionStatement = (db: D1Database, tokenHash: string, expiresAt: number) =>
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ? AND revoked_at IS NULL').bind(expiresAt, tokenHash)

/** a claim session, started by the fresh card that proved its first uid. */
export const insertClaimSessionStatement = (db: D1Database, session: { tokenHash: string; claimId: string; now: number; expiresAt: number }) =>
  db.prepare(`INSERT INTO sessions (token_hash, account_id, claim_id, created_at, expires_at, revoked_at) VALUES (?, NULL, ?, ?, ?, NULL)`)
    .bind(session.tokenHash, session.claimId, session.now, session.expiresAt)
