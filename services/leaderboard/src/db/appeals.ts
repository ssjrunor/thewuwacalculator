/*
  Author: Runor Ewhro
  description: appeals, an account's request for staff to review a sanction on
               it or on one of its linked uids. one appeal may be open per
               sanction, and a decision upholds it or grants it, which lifts the
               sanction.
*/

import { uuidv7 } from '../lib/ids.ts'

export interface AppealRow {
  id: string
  sanction_id: string
  account_id: string
  body: string
  status: 'open' | 'upheld' | 'granted'
  response: string | null
  created_at: number
  decided_at: number | null
  decided_by: string | null
}

export function insertAppealStatement(db: D1Database, appeal: { sanctionId: string; accountId: string; body: string }, now: number) {
  const id = uuidv7(now)
  return { id, statement: db.prepare(`INSERT INTO appeals (id, sanction_id, account_id, body, status, response, created_at, decided_at, decided_by)
      VALUES (?, ?, ?, ?, 'open', NULL, ?, NULL, NULL)`).bind(id, appeal.sanctionId, appeal.accountId, appeal.body, now) }
}

export const getAppeal = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM appeals WHERE id = ?').bind(id).first<AppealRow>()

/** how many times a sanction has been appealed. */
export const appealCount = async (db: D1Database, sanctionId: string): Promise<number> =>
  (await db.prepare('SELECT COUNT(*) AS n FROM appeals WHERE sanction_id = ?').bind(sanctionId).first<{ n: number }>())?.n ?? 0

/** the newest appeal of each of these sanctions. */
export async function latestAppeals(db: D1Database, sanctionIds: string[]): Promise<Map<string, AppealRow>> {
  if (!sanctionIds.length) return new Map()
  const { results } = await db.prepare(`SELECT a.* FROM appeals a WHERE a.sanction_id IN (SELECT value FROM json_each(?))
    AND a.created_at = (SELECT MAX(created_at) FROM appeals b WHERE b.sanction_id = a.sanction_id)`)
    .bind(JSON.stringify(sanctionIds)).all<AppealRow>()
  return new Map(results.map((row) => [row.sanction_id, row]))
}

export async function appealsByStatus(db: D1Database, status: AppealRow['status'], limit: number): Promise<AppealRow[]> {
  // open appeals oldest first, decided ones newest first
  const { results } = await db.prepare(`SELECT * FROM appeals WHERE status = ? ORDER BY created_at ${status === 'open' ? 'ASC' : 'DESC'} LIMIT ?`)
    .bind(status, limit).all<AppealRow>()
  return results
}

export const decideAppealStatement = (db: D1Database, id: string, decision: { status: 'upheld' | 'granted'; response: string; by: string },
  now: number) =>
  db.prepare(`UPDATE appeals SET status = ?, response = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'open'`)
    .bind(decision.status, decision.response, now, decision.by, id)
