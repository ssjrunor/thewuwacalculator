/*
  Author: Runor Ewhro
  description: stores build history and prepares changes to the single active build per UID and resonator.
*/

import { uuidv7 } from '../lib/ids.ts'

export type BuildState = 'active' | 'replaced' | 'deleted' | 'hidden'

export interface BuildRow {
  id: string
  uid: string
  resonator_id: string
  card_id: string
  read_id: string
  sequence: number
  drawn_at: number
  activated_by: 'submission' | 'owner' | null
  snapshot_hash: string
  state: BuildState
  replaced_by: string | null
  created_at: number
  last_seen_at: number
  ended_at: number | null
}

export const getBuild = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM builds WHERE id = ?').bind(id).first<BuildRow>()

export const activeBuild = (db: D1Database, uid: string, resonatorId: string) =>
  db.prepare(`SELECT * FROM builds WHERE uid = ? AND resonator_id = ? AND state = 'active'`).bind(uid, resonatorId).first<BuildRow>()

/** a build this uid already stored with the same snapshot (any state but deleted). */
export const buildBySnapshot = (db: D1Database, uid: string, resonatorId: string, snapshotHash: string) =>
  db.prepare(`SELECT * FROM builds WHERE uid = ? AND resonator_id = ? AND snapshot_hash = ? AND state <> 'deleted'
    ORDER BY created_at DESC LIMIT 1`).bind(uid, resonatorId, snapshotHash).first<BuildRow>()

export const buildsForCard = async (db: D1Database, cardId: string): Promise<BuildRow[]> =>
  (await db.prepare('SELECT * FROM builds WHERE card_id = ? ORDER BY created_at DESC').bind(cardId).all<BuildRow>()).results

export interface NewBuild {
  uid: string
  resonatorId: string
  cardId: string
  readId: string
  sequence: number
  drawnAt: number
  snapshotHash: string
  state: 'active' | 'replaced'
  activatedBy: 'submission' | 'owner' | null
}

// return the new id with its unexecuted statement so activation, replacement links, and audit writes can share one batch.
export function insertBuildStatement(db: D1Database, build: NewBuild, now: number) {
  const id = uuidv7(now)
  return { id, statement: db.prepare(`INSERT INTO builds (id, uid, resonator_id, card_id, read_id, sequence, drawn_at,
      activated_by, snapshot_hash, state, replaced_by, created_at, last_seen_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`)
    .bind(id, build.uid, build.resonatorId, build.cardId, build.readId, build.sequence, build.drawnAt,
      build.activatedBy, build.snapshotHash, build.state, now, now) }
}

/** retire the active build so another can take its place (the unique index allows one active). */
export const retireActiveStatement = (db: D1Database, uid: string, resonatorId: string, except: string, now: number) =>
  db.prepare(`UPDATE builds SET state = 'replaced', ended_at = ?
    WHERE uid = ? AND resonator_id = ? AND state = 'active' AND id <> ?`).bind(now, uid, resonatorId, except)

/** after the replacement exists, point the retired build at it. */
export const linkReplacementStatement = (db: D1Database, retiredId: string, replacedBy: string) =>
  db.prepare('UPDATE builds SET replaced_by = ? WHERE id = ?').bind(replacedBy, retiredId)

export const activateStatement = (db: D1Database, id: string, activatedBy: 'submission' | 'owner', now: number) =>
  db.prepare(`UPDATE builds SET state = 'active', activated_by = ?, replaced_by = NULL, ended_at = NULL, last_seen_at = ?
    WHERE id = ? AND state = 'replaced'`).bind(activatedBy, now, id)

export const touchBuildStatement = (db: D1Database, id: string, now: number) =>
  db.prepare('UPDATE builds SET last_seen_at = ? WHERE id = ?').bind(now, id)

export const endBuildStatement = (db: D1Database, id: string, state: 'deleted' | 'hidden', now: number) =>
  db.prepare(`UPDATE builds SET state = ?, ended_at = ? WHERE id = ? AND state <> 'deleted'`).bind(state, now, id)

/** an admin restores a hidden build as history; the owner can activate it again. */
export const restoreHiddenStatement = (db: D1Database, id: string) =>
  db.prepare(`UPDATE builds SET state = 'replaced' WHERE id = ? AND state = 'hidden'`).bind(id)

export const deleteUidBuildsStatement = (db: D1Database, uid: string, now: number) =>
  db.prepare(`UPDATE builds SET state = 'deleted', ended_at = ? WHERE uid = ? AND state <> 'deleted'`).bind(now, uid)

export interface OwnerBuildRow extends BuildRow {
  snapshot: string | null
}

// the owner list includes active and replaced builds; deleted and administratively hidden records are excluded.
export async function ownerBuilds(db: D1Database, uid: string): Promise<OwnerBuildRow[]> {
  const { results } = await db.prepare(`SELECT b.*, r.snapshot FROM builds b JOIN card_reads r ON r.id = b.read_id
    WHERE b.uid = ? AND b.state IN ('active', 'replaced') ORDER BY b.resonator_id, b.drawn_at DESC`).bind(uid).all<OwnerBuildRow>()
  return results
}
