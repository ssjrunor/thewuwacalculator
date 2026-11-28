/*
  Author: Runor Ewhro
  description: settings documents (src/domain/leaderboard/documents.ts): one
               row per kind and owner, holding the parsed body at its version.
*/

import type { DocumentKind } from '@lb/contract/documents'

export interface DocumentRow {
  kind: DocumentKind
  owner_id: string
  schema_ver: number
  body: string
  updated_at: number
  // when a moderator last looked at it; a write clears it
  reviewed_at: number | null
  reviewed_by: string | null
}

// the documents of these kinds for these owners, keyed `kind:owner`
export async function documentsOf(db: D1Database, kinds: DocumentKind[], ownerIds: string[]): Promise<Map<string, DocumentRow>> {
  if (!kinds.length || !ownerIds.length) return new Map()
  const { results } = await db.prepare(`SELECT * FROM documents WHERE kind IN (SELECT value FROM json_each(?1))
      AND owner_id IN (SELECT value FROM json_each(?2))`).bind(JSON.stringify(kinds), JSON.stringify(ownerIds)).all<DocumentRow>()
  return new Map(results.map((row) => [`${row.kind}:${row.owner_id}`, row]))
}

// writes a document and marks it unreviewed, unless `reviewedBy` names the staff member who wrote it
export const putDocumentStatement = (db: D1Database, doc: { kind: DocumentKind; ownerId: string; version: number; body: unknown;
  reviewedBy: string | null }, now: number) =>
  db.prepare(`INSERT INTO documents (kind, owner_id, schema_ver, body, updated_at, reviewed_at, reviewed_by) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (kind, owner_id) DO UPDATE SET schema_ver = excluded.schema_ver, body = excluded.body, updated_at = excluded.updated_at,
      reviewed_at = excluded.reviewed_at, reviewed_by = excluded.reviewed_by`)
    .bind(doc.kind, doc.ownerId, doc.version, JSON.stringify(doc.body), now, doc.reviewedBy == null ? null : now, doc.reviewedBy)

export const deleteDocumentStatement = (db: D1Database, kind: DocumentKind, ownerId: string) =>
  db.prepare('DELETE FROM documents WHERE kind = ? AND owner_id = ?').bind(kind, ownerId)

// the documents others read (not saved views), unreviewed or reviewed, newest write first, after a cursor
// `at.kind.owner`
export async function documentQueue(db: D1Database, reviewed: boolean, before: { at: number; key: string } | null,
  limit: number): Promise<DocumentRow[]> {
  const { results } = await db.prepare(`SELECT * FROM documents WHERE kind <> 'views' AND (reviewed_at IS NULL) = ?1
      AND (?2 IS NULL OR updated_at < ?2 OR (updated_at = ?2 AND kind || ':' || owner_id < ?3))
    ORDER BY updated_at DESC, kind || ':' || owner_id DESC LIMIT ?4`)
    .bind(reviewed ? 0 : 1, before?.at ?? null, before?.key ?? '', limit).all<DocumentRow>()
  return results
}

export const markReviewedStatement = (db: D1Database, kind: DocumentKind, ownerId: string, updatedAt: number, by: string, now: number) =>
  // only the version the moderator read: a later write stays unreviewed
  db.prepare('UPDATE documents SET reviewed_at = ?, reviewed_by = ? WHERE kind = ? AND owner_id = ? AND updated_at = ?')
    .bind(now, by, kind, ownerId, updatedAt)
