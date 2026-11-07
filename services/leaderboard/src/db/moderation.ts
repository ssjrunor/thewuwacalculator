/*
  Author: Runor Ewhro
  description: records reports and prepares moderation changes to builds and cards.
*/

import { uuidv7 } from '../lib/ids.ts'

export interface ReportRow {
  id: string
  build_id: string
  reason: 'misread' | 'not_owner' | 'abuse' | 'other'
  details: string | null
  reporter_uid: string | null
  reporter_account: string | null
  status: 'open' | 'resolved' | 'dismissed'
  resolution: string | null
  created_at: number
  resolved_at: number | null
}

export function insertReportStatement(db: D1Database, report: { buildId: string; reason: ReportRow['reason'];
  details: string | null; reporterUid: string | null }, now: number) {
  const id = uuidv7(now)
  return { id, statement: db.prepare(`INSERT INTO reports (id, build_id, reason, details, reporter_uid, reporter_account,
      status, resolution, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, NULL, 'open', NULL, ?, NULL)`)
    .bind(id, report.buildId, report.reason, report.details, report.reporterUid, now) }
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

export const blockCardStatement = (db: D1Database, cardId: string) =>
  db.prepare(`UPDATE cards SET status = 'blocked' WHERE id = ?`).bind(cardId)
