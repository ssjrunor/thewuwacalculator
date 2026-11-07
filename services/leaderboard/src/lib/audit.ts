/*
  Author: Runor Ewhro
  description: append-only audit_log writer. returns a statement so the entry
               lands in the same d1 batch as the change it records.
*/

import { uuidv7 } from './ids.ts'

export type ActorKind = 'uid' | 'account' | 'admin' | 'system'

export interface AuditEntry {
  actorKind: ActorKind
  actorId: string | null
  /** e.g. 'build.delete', 'player.opt_out', 'ruleset.activate'. */
  action: string
  subjectKind: string
  subjectId: string
  data?: unknown
}

export function auditStatement(db: D1Database, entry: AuditEntry, now: number = Date.now()): D1PreparedStatement {
  return db.prepare(`INSERT INTO audit_log (id, at, actor_kind, actor_id, action, subject_kind, subject_id, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(uuidv7(now), now, entry.actorKind, entry.actorId, entry.action,
    entry.subjectKind, entry.subjectId, entry.data === undefined ? null : JSON.stringify(entry.data))
}
