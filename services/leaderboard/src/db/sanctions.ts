/*
  Author: Runor Ewhro
  description: sanctions on a uid or an account. a warning is only recorded; a
               mute blocks writing (documents, uploads, presets) for a
               time or until lifted; a suspension blocks every action until it
               expires; a ban blocks every action until lifted, and banned uids
               are excluded from every list (the banned_uids view). stop and mute
               checks are only done here.
*/

import { uuidv7 } from '../lib/ids.ts'

export type SanctionSubject = 'uid' | 'account'
export type SanctionKind = 'warn' | 'mute' | 'suspend' | 'ban'

export interface SanctionRow {
  id: string
  subject_kind: SanctionSubject
  subject_id: string
  kind: SanctionKind
  reason: string
  report_id: string | null
  issued_by: string
  created_at: number
  expires_at: number | null
  lifted_at: number | null
  lifted_by: string | null
}

// the sql condition that a sanction row `x` stops its subject at time `now` (a bind placeholder)
export const blocking = (x: string, now: string) =>
  `${x}.lifted_at IS NULL AND (${x}.kind = 'ban' OR (${x}.kind = 'suspend' AND ${x}.expires_at > ${now}))`

export function insertSanctionStatement(db: D1Database, sanction: { subjectKind: SanctionSubject; subjectId: string; kind: SanctionKind;
  reason: string; reportId: string | null; issuedBy: string; expiresAt: number | null }, now: number) {
  const id = uuidv7(now)
  return { id, statement: db.prepare(`INSERT INTO sanctions (id, subject_kind, subject_id, kind, reason, report_id, issued_by,
      created_at, expires_at, lifted_at, lifted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`)
    .bind(id, sanction.subjectKind, sanction.subjectId, sanction.kind, sanction.reason, sanction.reportId, sanction.issuedBy,
      now, sanction.expiresAt) }
}

export const getSanction = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM sanctions WHERE id = ?').bind(id).first<SanctionRow>()

export const liftSanctionStatement = (db: D1Database, id: string, by: string, now: number) =>
  db.prepare('UPDATE sanctions SET lifted_at = ?, lifted_by = ? WHERE id = ? AND lifted_at IS NULL').bind(now, by, id)

// every sanction a subject has had, newest first
export async function sanctionsOf(db: D1Database, kind: SanctionSubject, id: string): Promise<SanctionRow[]> {
  const { results } = await db.prepare(`SELECT * FROM sanctions WHERE subject_kind = ? AND subject_id = ? ORDER BY created_at DESC`)
    .bind(kind, id).all<SanctionRow>()
  return results
}

// the sanction stopping a uid or an account now (a ban before a suspension), or null
export const stoppedBy = (db: D1Database, kind: SanctionSubject, id: string, now: number) =>
  db.prepare(`SELECT * FROM sanctions x WHERE x.subject_kind = ?1 AND x.subject_id = ?2 AND ${blocking('x', '?3')}
    ORDER BY x.kind = 'ban' DESC, x.expires_at DESC LIMIT 1`).bind(kind, id, now).first<SanctionRow>()

// sql condition for sanction row `x` muting its subject at `now`: a live mute or any blocking sanction
const muting = (x: string, now: string) =>
  `${x}.lifted_at IS NULL AND (${x}.kind = 'ban' OR (${x}.kind IN ('mute', 'suspend') AND (${x}.expires_at IS NULL OR ${x}.expires_at > ${now})))`

// the sanction muting a writer now: on the uid written for, on the account, or on any uid linked to the account (a
// muted uid mutes its person); null when none applies
export const mutedBy = (db: D1Database, writer: { uid?: string | null; accountId: string | null }, now: number) =>
  db.prepare(`SELECT * FROM sanctions x WHERE ((x.subject_kind = 'uid' AND (x.subject_id = ?1
      OR x.subject_id IN (SELECT uid FROM account_uids WHERE account_id = ?2))) OR (x.subject_kind = 'account' AND x.subject_id = ?2))
    AND ${muting('x', '?3')} ORDER BY x.created_at DESC LIMIT 1`).bind(writer.uid ?? null, writer.accountId, now).first<SanctionRow>()

// time of the newest non-warning sanction on an account or its linked uids, for its trust level
export const lastSanctionAt = async (db: D1Database, accountId: string): Promise<number | null> =>
  (await db.prepare(`SELECT MAX(created_at) AS at FROM sanctions WHERE kind <> 'warn' AND ((subject_kind = 'account' AND subject_id = ?1)
    OR (subject_kind = 'uid' AND subject_id IN (SELECT uid FROM account_uids WHERE account_id = ?1)))`).bind(accountId).first<{ at: number | null }>())?.at ?? null

// every sanction on an account and on the uids linked to it, newest first: what its owner may appeal
export async function sanctionsOfAccount(db: D1Database, accountId: string): Promise<SanctionRow[]> {
  const { results } = await db.prepare(`SELECT * FROM sanctions WHERE (subject_kind = 'account' AND subject_id = ?1)
    OR (subject_kind = 'uid' AND subject_id IN (SELECT uid FROM account_uids WHERE account_id = ?1)) ORDER BY created_at DESC`)
    .bind(accountId).all<SanctionRow>()
  return results
}

// whether a uid is banned and so excluded from every list (ending the ban restores it)
export const isBanned = async (db: D1Database, uid: string): Promise<boolean> =>
  (await db.prepare('SELECT 1 AS n FROM banned_uids WHERE uid = ?').bind(uid).first()) != null
