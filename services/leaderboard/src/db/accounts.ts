/*
  Author: Runor Ewhro
  description: accounts, their durable logins, their linked uids and pending
               oauth sign-ins. an account is the person: it is reached only
               through one of its logins, shows every build of its uids, and
               links a uid only with a fresh-card proof.
*/

import type { Role } from '@lb/contract/permissions'
import { uuidv7 } from '../lib/ids.ts'

export type LoginProvider = 'discord' | 'google'

export interface AccountRow {
  id: string
  role: Role
  created_at: number
  last_seen_at: number
  /** when the follow feed was last read; null until it first is. */
  feed_seen_at: number | null
}

/** the provider's profile of the person at sign-in; image addresses are built by the provider code from the
    provider's own ids, and response urls are discarded. */
export interface ProviderProfile {
  name: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  /** `#rrggbb`. */
  accent: string | null
}

export interface LoginRow {
  provider: LoginProvider
  subject: string
  account_id: string
  created_at: number
  last_used_at: number
  /** a ProviderProfile as json, or null. */
  profile: string | null
}

export interface LinkRow {
  uid: string
  account_id: string
  claim_id: string
  linked_at: number
}

export const getAccount = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>()

export function insertAccountStatement(db: D1Database, now: number) {
  const id = uuidv7(now)
  return { id, statement: db.prepare(`INSERT INTO accounts (id, role, created_at, last_seen_at) VALUES (?, 'user', ?, ?)`).bind(id, now, now) }
}

export const touchAccountStatement = (db: D1Database, id: string, now: number) =>
  db.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').bind(now, id)

export const setRoleStatement = (db: D1Database, id: string, role: Role) =>
  db.prepare('UPDATE accounts SET role = ? WHERE id = ?').bind(role, id)

// logins

export const loginFor = (db: D1Database, provider: LoginProvider, subject: string) =>
  db.prepare('SELECT * FROM account_logins WHERE provider = ? AND subject = ?').bind(provider, subject).first<LoginRow>()

export async function loginsOf(db: D1Database, accountId: string): Promise<LoginRow[]> {
  const { results } = await db.prepare('SELECT * FROM account_logins WHERE account_id = ? ORDER BY created_at')
    .bind(accountId).all<LoginRow>()
  return results
}

export const insertLoginStatement = (db: D1Database, login: { provider: LoginProvider; subject: string; accountId: string;
  profile: ProviderProfile | null }, now: number) =>
  db.prepare(`INSERT INTO account_logins (provider, subject, account_id, created_at, last_used_at, profile) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(login.provider, login.subject, login.accountId, now, now, login.profile ? JSON.stringify(login.profile) : null)

export const touchLoginStatement = (db: D1Database, login: { provider: LoginProvider; subject: string; profile: ProviderProfile | null },
  now: number) =>
  db.prepare('UPDATE account_logins SET last_used_at = ?, profile = ? WHERE provider = ? AND subject = ?')
    .bind(now, login.profile ? JSON.stringify(login.profile) : null, login.provider, login.subject)

/** the newest provider profile among an account's logins, or null when none says anything. */
export async function providerProfileOf(db: D1Database, accountId: string): Promise<ProviderProfile | null> {
  const row = await db.prepare(`SELECT profile FROM account_logins WHERE account_id = ? AND profile IS NOT NULL
    ORDER BY last_used_at DESC LIMIT 1`).bind(accountId).first<{ profile: string }>()
  return row ? JSON.parse(row.profile) as ProviderProfile : null
}

export const deleteLoginStatement = (db: D1Database, accountId: string, provider: LoginProvider) =>
  db.prepare('DELETE FROM account_logins WHERE account_id = ? AND provider = ?').bind(accountId, provider)

// linked uids

export const linkOf = (db: D1Database, uid: string) =>
  db.prepare('SELECT * FROM account_uids WHERE uid = ?').bind(uid).first<LinkRow>()

/** an account's linked uids with each player's latest name, oldest link first. */
export async function linksOf(db: D1Database, accountId: string): Promise<Array<LinkRow & { last_name: string | null }>> {
  const { results } = await db.prepare(`SELECT l.*, p.last_name FROM account_uids l LEFT JOIN players p ON p.uid = l.uid
    WHERE l.account_id = ? ORDER BY l.linked_at`).bind(accountId).all<LinkRow & { last_name: string | null }>()
  return results
}

/** a fresh-card proof links a uid to an account, moving it from any other. */
export const linkUidStatement = (db: D1Database, link: { uid: string; accountId: string; claimId: string }, now: number) =>
  db.prepare(`INSERT INTO account_uids (uid, account_id, claim_id, linked_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (uid) DO UPDATE SET account_id = excluded.account_id, claim_id = excluded.claim_id, linked_at = excluded.linked_at`)
    .bind(link.uid, link.accountId, link.claimId, now)

export const unlinkUidStatement = (db: D1Database, uid: string) =>
  db.prepare('DELETE FROM account_uids WHERE uid = ?').bind(uid)

/** the account each of these uids is linked to, for every uid that has one. */
export async function accountsOf(db: D1Database, uids: string[]): Promise<Map<string, string>> {
  if (!uids.length) return new Map()
  const { results } = await db.prepare('SELECT uid, account_id FROM account_uids WHERE uid IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...new Set(uids)])).all<{ uid: string; account_id: string }>()
  return new Map(results.map((row) => [row.uid, row.account_id]))
}

/** statements deleting an account and every row referencing it: logins, links, sessions and media rows (the caller
    erases the media bytes); its audit log entries remain. */
export const deleteAccountStatements = (db: D1Database, id: string, now: number) => [
  db.prepare('DELETE FROM account_uids WHERE account_id = ?').bind(id),
  db.prepare('DELETE FROM account_logins WHERE account_id = ?').bind(id),
  db.prepare(`UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL`).bind(now, id),
  db.prepare('DELETE FROM media WHERE account_id = ?').bind(id),
  db.prepare('DELETE FROM accounts WHERE id = ?').bind(id),
]

// sign-in states

export interface OAuthStateRow {
  state_hash: string
  provider: LoginProvider
  verifier: string
  return_to: string
  token_hash: string | null
  created_at: number
  expires_at: number
}

export const insertOAuthStateStatement = (db: D1Database, state: Omit<OAuthStateRow, 'created_at'>, now: number) =>
  db.prepare(`INSERT INTO oauth_states (state_hash, provider, verifier, return_to, token_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(state.state_hash, state.provider, state.verifier, state.return_to, state.token_hash, now, state.expires_at)

/** takes a sign-in state once, deleting it; expired states return nothing. */
export const takeOAuthState = (db: D1Database, stateHash: string, now: number) =>
  db.prepare('DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING *').bind(stateHash, now).first<OAuthStateRow>()

export const setSessionAccountStatement = (db: D1Database, tokenHash: string, accountId: string, expiresAt: number) =>
  db.prepare('UPDATE sessions SET account_id = ?, expires_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(accountId, expiresAt, tokenHash)

export const insertAccountSessionStatement = (db: D1Database, session: { tokenHash: string; accountId: string; now: number; expiresAt: number }) =>
  db.prepare(`INSERT INTO sessions (token_hash, account_id, claim_id, created_at, expires_at, revoked_at) VALUES (?, ?, NULL, ?, ?, NULL)`)
    .bind(session.tokenHash, session.accountId, session.now, session.expiresAt)
