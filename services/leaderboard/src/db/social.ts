/*
  Author: Runor Ewhro
  description: account social rows: follows (players and boards), likes and
               blocks, and player refs in social responses. players are
               referenced by uid, or by one of their listed builds when the uid
               is hidden, and hidden uids are never returned.
*/

import type { PlayerRef } from '@lb/contract/api'
import { uuidv7 } from '../lib/ids.ts'
import { maskedSql, type PlayerRow } from './identity.ts'

export type FollowKind = 'player' | 'board'

/** a uid, or a build id. */
export const isUid = (ref: string) => /^\d{9}$/.test(ref)

/** the listed player for a ref: by uid only when the uid is shown, otherwise through one of their listed builds;
    anonymous players match neither, so they cannot be followed, blocked or opened by ref. */
export function playerByRef(db: D1Database, ref: string) {
  return isUid(ref)
    ? db.prepare(`SELECT * FROM listed_players p WHERE uid = ? AND hide_uid = 0 AND NOT ${maskedSql('p')}`).bind(ref).first<PlayerRow>()
    : db.prepare(`SELECT p.* FROM listed_players p WHERE p.uid = (${UID_OF_BUILD}) AND NOT ${maskedSql('p')}`).bind(ref).first<PlayerRow>()
}

/** the uid of build `?1`, from the projections: a player's best build on a board (every ref handed out is one), or a
    recent upload. */
const UID_OF_BUILD = `SELECT uid FROM player_boards WHERE active = ?1 UNION ALL SELECT uid FROM recent_uploads WHERE build_id = ?1 LIMIT 1`

/** sql columns naming the player at `uid` (a column expression) as a PlayerRef: alias `p` is their players row. */
export const refColumns = (uid: string) => `p.hide_uid AS ref_hidden, ${maskedSql('p')} AS ref_masked, p.last_name AS ref_name,
  ${uid} AS ref_uid, (SELECT pb.listed FROM player_boards pb WHERE pb.uid = ${uid} AND pb.listed IS NOT NULL
    ORDER BY pb.listed_at DESC LIMIT 1) AS ref_build`

export interface RefColumns {
  ref_hidden: number | null
  ref_masked: number | null
  ref_name: string | null
  ref_uid: string | null
  ref_build: string | null
}

/** a player ref for social responses; anonymous players get no uid, name or build. */
export const toRef = (row: RefColumns): PlayerRef => row.ref_masked
  ? { uid: null, buildId: null, name: null, anonymous: true }
  : { uid: row.ref_hidden ? null : row.ref_uid, buildId: row.ref_build, name: row.ref_name }

// follows

/** the most an account follows of each kind. */
export const FOLLOW_CAP = 500

export const followStatement = (db: D1Database, accountId: string, kind: FollowKind, target: string, now: number) =>
  db.prepare('INSERT OR IGNORE INTO follows (account_id, kind, target, created_at) VALUES (?, ?, ?, ?)').bind(accountId, kind, target, now)

export const unfollowStatement = (db: D1Database, accountId: string, kind: FollowKind, target: string) =>
  db.prepare('DELETE FROM follows WHERE account_id = ? AND kind = ? AND target = ?').bind(accountId, kind, target)

export async function followCount(db: D1Database, accountId: string, kind: FollowKind): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM follows WHERE account_id = ? AND kind = ?').bind(accountId, kind).first<{ n: number }>())!.n
}

export const isFollowing = async (db: D1Database, accountId: string, kind: FollowKind, target: string): Promise<boolean> =>
  (await db.prepare('SELECT 1 AS n FROM follows WHERE account_id = ? AND kind = ? AND target = ?').bind(accountId, kind, target).first()) != null

/** how many accounts follow any of a person's uids. */
export async function followerCount(db: D1Database, uids: string[]): Promise<number> {
  return (await db.prepare(`SELECT COUNT(DISTINCT account_id) AS n FROM follows WHERE kind = 'player' AND target IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(uids)).first<{ n: number }>())!.n
}

/** whether an account follows (pins) any of a person's uids. */
export const followsAny = async (db: D1Database, accountId: string, uids: string[]): Promise<boolean> =>
  (await db.prepare(`SELECT 1 AS n FROM follows WHERE account_id = ? AND kind = 'player' AND target IN (SELECT value FROM json_each(?)) LIMIT 1`)
    .bind(accountId, JSON.stringify(uids)).first()) != null

export interface FollowedPlayerRow extends RefColumns {
  faces: string
}

/** currently listed players an account follows, oldest follow first; follows of players who left the boards or were
    banned remain stored and return when that changes. */
export async function followedPlayers(db: D1Database, accountId: string): Promise<FollowedPlayerRow[]> {
  const { results } = await db.prepare(`SELECT ${refColumns('f.target')},
      (SELECT json_group_array(resonator_id) FROM (SELECT resonator_id FROM player_boards WHERE uid = f.target AND listed IS NOT NULL
        ORDER BY listed_at DESC LIMIT 3)) AS faces
    FROM follows f JOIN listed_players p ON p.uid = f.target
    WHERE f.account_id = ? AND f.kind = 'player' AND NOT ${maskedSql('p')} ORDER BY f.created_at, f.target`).bind(accountId).all<FollowedPlayerRow>()
  return results
}

export async function followedBoards(db: D1Database, accountId: string): Promise<string[]> {
  const { results } = await db.prepare(`SELECT target FROM follows WHERE account_id = ? AND kind = 'board' ORDER BY created_at, target`)
    .bind(accountId).all<{ target: string }>()
  return results.map((row) => row.target)
}

/**
 * an account's followed uploads after `since`: the latest `perTarget` of each followed board and player, searched on
 * recent_uploads_board and recent_uploads_uid, with a followed uid on an account including the person's other uids.
 * filtering all uploads by follows walks the whole table newest first when followed targets posted little recently
 * (12 s over 3.9M local uploads).
 */
export const followedUploads = (account: string, since: string, perTarget: string) => `
  SELECT u.build_id, u.uid, u.resonator_id, u.at FROM follows f JOIN recent_uploads u ON u.build_id IN (
    SELECT r.build_id FROM recent_uploads r WHERE r.resonator_id = f.target AND r.shown = 1 AND r.at > ${since}
    ORDER BY r.at DESC LIMIT ${perTarget})
  WHERE f.account_id = ${account} AND f.kind = 'board'
  UNION
  SELECT u.build_id, u.uid, u.resonator_id, u.at FROM (
      SELECT f.target AS uid FROM follows f WHERE f.account_id = ${account} AND f.kind = 'player'
      UNION
      SELECT s.uid FROM follows f JOIN account_uids l ON l.uid = f.target JOIN account_uids s ON s.account_id = l.account_id
      WHERE f.account_id = ${account} AND f.kind = 'player') t
    JOIN players p ON p.uid = t.uid JOIN recent_uploads u ON u.build_id IN (
      SELECT r.build_id FROM recent_uploads r WHERE r.uid = t.uid AND r.shown = 1 AND r.at > ${since} ORDER BY r.at DESC LIMIT ${perTarget})
  WHERE NOT ${maskedSql('p')}`

/** the most uploads counted as new in a feed: the badge reads "N new", and past this many the count stops. */
export const FRESH_CAP = 999

/** uploads in an account's follow feed after a time, up to FRESH_CAP. */
export async function freshInFeed(db: D1Database, accountId: string, since: number): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM (${followedUploads('?1', '?2', String(FRESH_CAP))})`)
    .bind(accountId, since).first<{ n: number }>()
  return Math.min(row?.n ?? 0, FRESH_CAP)
}

export const setFeedSeenStatement = (db: D1Database, accountId: string, now: number) =>
  db.prepare('UPDATE accounts SET feed_seen_at = ? WHERE id = ?').bind(now, accountId)

// likes

export const likeStatement = (db: D1Database, buildId: string, accountId: string, now: number) =>
  db.prepare('INSERT OR IGNORE INTO likes (build_id, account_id, created_at) VALUES (?, ?, ?)').bind(buildId, accountId, now)

export const unlikeStatement = (db: D1Database, buildId: string, accountId: string) =>
  db.prepare('DELETE FROM likes WHERE build_id = ? AND account_id = ?').bind(buildId, accountId)

export async function likesOn(db: D1Database, buildId: string, accountId: string | null): Promise<{ likes: number; liked: boolean }> {
  const row = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(account_id = ?2), 0) AS mine FROM likes WHERE build_id = ?1`)
    .bind(buildId, accountId).first<{ n: number; mine: number }>()
  return { likes: row!.n, liked: row!.mine > 0 }
}

// blocks are per person, so by account; uids on no account cannot comment and have nothing to block

/** the most people an account blocks. */
export const BLOCK_CAP = 1000

export const blockStatement = (db: D1Database, accountId: string, blocked: string, now: number) =>
  db.prepare('INSERT OR IGNORE INTO blocks (id, account_id, blocked_account, created_at) VALUES (?, ?, ?, ?)')
    .bind(uuidv7(now), accountId, blocked, now)

/** removes a block by its id or by the blocked account. */
export const unblockStatement = (db: D1Database, accountId: string, ref: string, blocked: string | null) =>
  db.prepare('DELETE FROM blocks WHERE account_id = ?1 AND (id = ?2 OR blocked_account = ?3)').bind(accountId, ref, blocked)

export async function blockCount(db: D1Database, accountId: string): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM blocks WHERE account_id = ?').bind(accountId).first<{ n: number }>())!.n
}

/** whether account `by` blocks account `who`. */
export async function blocks(db: D1Database, by: string, who: string | null): Promise<boolean> {
  return who != null && (await db.prepare('SELECT 1 AS n FROM blocks WHERE account_id = ? AND blocked_account = ?').bind(by, who).first()) != null
}

export interface BlockRow {
  id: string
  blocked_account: string
  created_at: number
}

/** the people an account blocks, newest first. */
export async function blockRows(db: D1Database, accountId: string): Promise<BlockRow[]> {
  const { results } = await db.prepare('SELECT id, blocked_account, created_at FROM blocks WHERE account_id = ? ORDER BY created_at DESC')
    .bind(accountId).all<BlockRow>()
  return results
}

/** the account a comment was written by, while it has one. */
export const commentAccount = async (db: D1Database, commentId: string): Promise<string | null> =>
  (await db.prepare('SELECT account_id FROM comments WHERE id = ?').bind(commentId).first<{ account_id: string | null }>())?.account_id ?? null

/** the uid behind a ref for undoing a relation: any uid as given, or the player of any build. */
export async function uidForRemoval(db: D1Database, ref: string): Promise<string | null> {
  if (isUid(ref)) return ref
  return (await db.prepare(UID_OF_BUILD).bind(ref).first<{ uid: string }>())?.uid ?? null
}

/** statements deleting an account's social rows; its comments are emptied in place (preserving threads and reports)
    and lose their owner. */
export const deleteAccountSocialStatements = (db: D1Database, accountId: string, now: number) => [
  db.prepare('DELETE FROM follows WHERE account_id = ?').bind(accountId),
  db.prepare('DELETE FROM likes WHERE account_id = ?').bind(accountId),
  db.prepare('DELETE FROM blocks WHERE account_id = ?1 OR blocked_account = ?1').bind(accountId),
  db.prepare('DELETE FROM notifications WHERE account_id = ?').bind(accountId),
  db.prepare('DELETE FROM bookmarks WHERE account_id = ?').bind(accountId),
  db.prepare('DELETE FROM card_presets WHERE account_id = ?').bind(accountId),
  // the account's documents: profile, card looks (`account:resonator`) and saved views
  db.prepare(`DELETE FROM documents WHERE (kind IN ('profile', 'views') AND owner_id = ?1) OR (kind = 'card' AND owner_id LIKE ?1 || ':%')`)
    .bind(accountId),
  // sanctions remain recorded by subject id; the account's appeals of them are deleted
  db.prepare('DELETE FROM appeals WHERE account_id = ?').bind(accountId),
  db.prepare(`UPDATE comments SET body = NULL, removed_at = ?, removed_by = 'author' WHERE account_id = ? AND removed_at IS NULL`).bind(now, accountId),
  db.prepare('UPDATE comments SET account_id = NULL WHERE account_id = ?').bind(accountId),
]

/** a uid named as a PlayerRef, from its players row. */
export async function refOf(db: D1Database, uid: string): Promise<RefColumns> {
  return (await db.prepare(`SELECT ${refColumns('?1')} FROM players p WHERE p.uid = ?1`).bind(uid).first<RefColumns>())
    ?? { ref_hidden: null, ref_masked: null, ref_name: null, ref_uid: uid, ref_build: null }
}

// bookmarks: private saves of builds, kept while the build stands (replaced ones too).

export const BOOKMARK_CAP = 500

export const bookmarkStatement = (db: D1Database, accountId: string, buildId: string, now: number) =>
  db.prepare('INSERT INTO bookmarks (account_id, build_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(accountId, buildId, now)

export const unbookmarkStatement = (db: D1Database, accountId: string, buildId: string) =>
  db.prepare('DELETE FROM bookmarks WHERE account_id = ? AND build_id = ?').bind(accountId, buildId)

export const bookmarkCount = async (db: D1Database, accountId: string): Promise<number> =>
  (await db.prepare('SELECT COUNT(*) AS n FROM bookmarks WHERE account_id = ?').bind(accountId).first<{ n: number }>())?.n ?? 0

export const isBookmarked = async (db: D1Database, accountId: string, buildId: string): Promise<boolean> =>
  (await db.prepare('SELECT 1 AS n FROM bookmarks WHERE account_id = ? AND build_id = ?').bind(accountId, buildId).first()) != null

/** an account's bookmarks, newest first; the boards resolve which still open (api/crossBoard.ts). */
export async function bookmarksOf(db: D1Database, accountId: string): Promise<Array<{ build_id: string; created_at: number }>> {
  const { results } = await db.prepare('SELECT build_id, created_at FROM bookmarks WHERE account_id = ? ORDER BY created_at DESC')
    .bind(accountId).all<{ build_id: string; created_at: number }>()
  return results
}

/** listed players named as PlayerRefs, by uid; one not listed (opted out, banned) is left out. */
export async function listedRefs(db: D1Database, uids: string[]): Promise<Map<string, RefColumns>> {
  if (!uids.length) return new Map()
  const { results } = await db.prepare(`SELECT ${refColumns('p.uid')} FROM listed_players p WHERE p.uid IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify([...new Set(uids)])).all<RefColumns>()
  return new Map(results.map((row) => [row.ref_uid!, row]))
}
