/*
  Author: Runor Ewhro
  description: records reports (claimed by a staff member, with notes) and the
               player each report is about, which lets a player's reports be read
               without their boards.
*/

import { uuidv7 } from '../lib/ids.ts'

export interface ReportRow {
  id: string
  build_id: string
  subject_uid: string | null
  reason: 'misread' | 'not_owner' | 'abuse' | 'other'
  details: string | null
  reporter_account: string | null
  status: 'open' | 'resolved' | 'dismissed'
  resolution: string | null
  created_at: number
  resolved_at: number | null
  assigned_to: string | null
  assigned_at: number | null
  comment_id: string | null
}

export interface ReportNoteRow {
  id: string
  report_id: string
  author: string
  body: string
  created_at: number
}

export function insertReportStatement(db: D1Database, report: { buildId: string; subjectUid: string | null; commentId?: string | null
  reason: ReportRow['reason']; details: string | null; reporterAccount?: string | null }, now: number) {
  const id = uuidv7(now)
  return { id, statement: db.prepare(`INSERT INTO reports (id, build_id, subject_uid, comment_id, reason, details, reporter_account,
      status, resolution, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, NULL)`)
    .bind(id, report.buildId, report.subjectUid, report.commentId ?? null, report.reason, report.details, report.reporterAccount ?? null, now) }
}

export async function openReports(db: D1Database, limit: number): Promise<ReportRow[]> {
  const { results } = await db.prepare(`SELECT * FROM reports WHERE status = 'open' ORDER BY created_at LIMIT ?`)
    .bind(limit).all<ReportRow>()
  return results
}

export const getReport = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first<ReportRow>()

// the open-state predicate prevents a completed report from being resolved a second time.
export const resolveReportStatement = (db: D1Database, id: string, status: 'resolved' | 'dismissed',
  resolution: string | null, now: number) =>
  db.prepare(`UPDATE reports SET status = ?, resolution = ?, resolved_at = ? WHERE id = ? AND status = 'open'`)
    .bind(status, resolution, now, id)

/** a staff member takes a report, or lets it go (null). */
export const assignReportStatement = (db: D1Database, id: string, to: string | null, now: number) =>
  db.prepare('UPDATE reports SET assigned_to = ?, assigned_at = ? WHERE id = ?').bind(to, to ? now : null, id)

export function insertReportNoteStatement(db: D1Database, note: { reportId: string; author: string; body: string }, now: number) {
  const id = uuidv7(now)
  return { id, statement: db.prepare('INSERT INTO report_notes (id, report_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, note.reportId, note.author, note.body, now) }
}

export async function reportNotes(db: D1Database, reportId: string): Promise<ReportNoteRow[]> {
  const { results } = await db.prepare('SELECT * FROM report_notes WHERE report_id = ? ORDER BY created_at, id').bind(reportId).all<ReportNoteRow>()
  return results
}

/** the reports on a build, or on every build of a uid, newest first. */
export async function reportsAbout(db: D1Database, about: { buildId: string } | { uid: string }): Promise<ReportRow[]> {
  const { results } = 'buildId' in about
    ? await db.prepare('SELECT * FROM reports WHERE build_id = ? ORDER BY created_at DESC').bind(about.buildId).all<ReportRow>()
    : await db.prepare('SELECT * FROM reports WHERE subject_uid = ? ORDER BY created_at DESC').bind(about.uid).all<ReportRow>()
  return results
}
