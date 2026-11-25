/*
  Author: Runor Ewhro
  description: append-only audit_log writer and its action names. every
               significant write is logged in the same d1 batch as its change,
               which makes the log the single history of any subject for
               moderation, notifications and feeds.
*/

import { uuidv7 } from './ids.ts'

export type ActorKind = 'uid' | 'account' | 'admin' | 'system'

/** subjects the log is kept against. */
export type SubjectKind = 'build' | 'card' | 'player' | 'account' | 'report' | 'ruleset' | 'sanction' | 'media' | 'document' | 'score' | 'comment'
  | 'seed'

/** every logged action as `subject.verb`; new writes add their action here. */
export type AuditAction =
  | 'build.submit' | 'build.delete' | 'build.hide' | 'build.restore'
  | 'build.hide_own' | 'build.show_own'
  | 'card.admin_submit' | 'card.block' | 'card.reject' | 'card.dead_letter' | 'card.retention_erase'
  | 'player.hide_uid' | 'player.anonymous' | 'player.opt_out' | 'player.opt_in' | 'player.setup' | 'player.setup_end'
  | 'uid.claim' | 'uid.release' | 'uid.link' | 'uid.unlink'
  | 'account.create' | 'account.sign_in' | 'account.login_add' | 'account.login_remove' | 'account.delete' | 'account.role'
  | 'report.create' | 'report.assign' | 'report.note' | 'report.resolved' | 'report.dismissed'
  | 'sanction.issue' | 'sanction.lift' | 'appeal.write' | 'appeal.decide'
  | 'document.write' | 'document.clear' | 'document.reviewed'
  | 'comment.write' | 'comment.edit' | 'comment.remove'
  | 'media.upload' | 'media.delete' | 'media.approved' | 'media.rejected'
  | 'preset.write' | 'preset.delete'
  | 'ruleset.publish' | 'ruleset.rescore' | 'ruleset.activate' | 'ruleset.rollout' | 'ruleset.rollout_cancel' | 'ruleset.check'
  | 'score.dead_letter' | 'score.resume' | 'score.restart' | 'score.abandoned'
  | 'seed.create' | 'seed.purge'

export interface Actor {
  actorKind: ActorKind
  actorId: string | null
}

export interface AuditEntry extends Actor {
  action: AuditAction
  subjectKind: SubjectKind
  subjectId: string
  data?: unknown
}

export function auditStatement(db: D1Database, entry: AuditEntry, now: number = Date.now()): D1PreparedStatement {
  return db.prepare(`INSERT INTO audit_log (id, at, actor_kind, actor_id, action, subject_kind, subject_id, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(uuidv7(now), now, entry.actorKind, entry.actorId, entry.action,
    entry.subjectKind, entry.subjectId, entry.data === undefined ? null : JSON.stringify(entry.data))
}

export interface AuditRow {
  id: string
  at: number
  actor_kind: ActorKind
  actor_id: string | null
  action: AuditAction
  subject_kind: SubjectKind
  subject_id: string
  data: string | null
}

/** a subject's history, newest first. */
export async function historyOf(db: D1Database, subjectKind: SubjectKind, subjectId: string, limit: number): Promise<AuditRow[]> {
  const { results } = await db.prepare(`SELECT * FROM audit_log WHERE subject_kind = ? AND subject_id = ? ORDER BY at DESC, id DESC LIMIT ?`)
    .bind(subjectKind, subjectId, limit).all<AuditRow>()
  return results
}

/** what an actor did, newest first. */
export async function actionsBy(db: D1Database, actor: Actor, limit: number): Promise<AuditRow[]> {
  const { results } = await db.prepare(`SELECT * FROM audit_log WHERE actor_kind = ? AND actor_id IS ? ORDER BY at DESC, id DESC LIMIT ?`)
    .bind(actor.actorKind, actor.actorId, limit).all<AuditRow>()
  return results
}
