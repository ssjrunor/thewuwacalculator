/*
  Author: Runor Ewhro
  description: build comments by accounts, with one level of replies. a comment
               shows while it is not removed and its account is not banned, and
               viewers do not see people they block. a removed or hidden comment
               with visible replies shows as a placeholder.
*/

import { uuidv7 } from '../lib/ids.ts'

export interface CommentRow {
  id: string
  build_id: string
  parent_id: string | null
  account_id: string | null
  body: string | null
  created_at: number
  edited_at: number | null
  removed_at: number | null
  removed_by: string | null
}

/** the sql condition that comment `c` shows to the viewer account at bind `viewer` (null for anyone). */
export const shownComment = (c: string, viewer: string) => `(${c}.removed_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM sanctions s WHERE s.subject_kind = 'account' AND s.subject_id = ${c}.account_id
    AND s.kind = 'ban' AND s.lifted_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM blocks k WHERE k.account_id = ${viewer} AND k.blocked_account = ${c}.account_id))`

export function insertCommentStatement(db: D1Database, comment: { buildId: string; parentId: string | null; accountId: string; body: string },
  now: number) {
  const id = uuidv7(now)
  return { id, statement: db.prepare(`INSERT INTO comments (id, build_id, parent_id, account_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, comment.buildId, comment.parentId, comment.accountId, comment.body, now) }
}

export const getComment = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM comments WHERE id = ?').bind(id).first<CommentRow>()

/** whether a comment shows to a viewer (null for anyone). */
export const isShownComment = async (db: D1Database, id: string, viewer: string | null): Promise<boolean> =>
  (await db.prepare(`SELECT 1 AS n FROM comments c WHERE c.id = ?1 AND ${shownComment('c', '?2')}`).bind(id, viewer).first()) != null

export const editCommentStatement = (db: D1Database, id: string, body: string, now: number) =>
  db.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ? AND removed_at IS NULL').bind(body, now, id)

/** `by` is 'author', 'owner', or the staff actor. */
export const removeCommentStatement = (db: D1Database, id: string, by: string, now: number) =>
  db.prepare('UPDATE comments SET body = NULL, removed_at = ?, removed_by = ? WHERE id = ? AND removed_at IS NULL').bind(now, by, id)

/** a deleted build's comments go with it. */
export const removeBuildCommentsStatement = (db: D1Database, buildId: string, now: number) =>
  db.prepare(`UPDATE comments SET body = NULL, removed_at = ?, removed_by = 'owner' WHERE build_id = ? AND removed_at IS NULL`).bind(now, buildId)

export async function shownCommentCount(db: D1Database, buildId: string, viewer: string | null): Promise<number> {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM comments c WHERE c.build_id = ?1 AND ${shownComment('c', '?2')}`)
    .bind(buildId, viewer).first<{ n: number }>())!.n
}

export interface CommentPageRow extends CommentRow {
  shown: number
}

/** one page of a build's top-level comments, newest first, before a (created_at, id) cursor, with all their replies. */
export async function commentPage(db: D1Database, buildId: string, viewer: string | null, before: { at: number; id: string } | null,
  limit: number): Promise<{ top: CommentPageRow[]; replies: CommentPageRow[] }> {
  const columns = `c.*, ${shownComment('c', '?2')} AS shown`
  const { results: top } = await db.prepare(`SELECT ${columns} FROM comments c
    WHERE c.build_id = ?1 AND c.parent_id IS NULL AND (?3 IS NULL OR c.created_at < ?3 OR (c.created_at = ?3 AND c.id < ?4))
    ORDER BY c.created_at DESC, c.id DESC LIMIT ?5`).bind(buildId, viewer, before?.at ?? null, before?.id ?? null, limit).all<CommentPageRow>()
  if (!top.length) return { top, replies: [] }
  const { results: replies } = await db.prepare(`SELECT ${columns} FROM comments c
    WHERE c.build_id = ?1 AND c.parent_id IN (SELECT value FROM json_each(?3)) AND ${shownComment('c', '?2')}
    ORDER BY c.created_at, c.id`).bind(buildId, viewer, JSON.stringify(top.map((row) => row.id))).all<CommentPageRow>()
  return { top, replies }
}
