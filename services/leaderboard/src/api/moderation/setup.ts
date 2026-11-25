/*
  Author: Runor Ewhro
  description: POST /admin/players/setup, local dev only: marks uids whose builds
               were added to fill the boards as setup, or unmarks them with
               `undo`; without `apply` it only lists the changes. uids a player
               has taken (a claim, a hold or an account link) are skipped.
               called by `lb setup`.
*/

import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import type { RouteContext } from '../router.ts'
import { authorize, isLocalDevAdmin, staffAudit } from '../auth/staff.ts'
import { syncPlayerBoards } from '../players.ts'

interface SetupRequest {
  /** players first seen at or after this time (epoch ms). */
  since?: number
  uids?: string[]
  apply?: boolean
  undo?: boolean
}

interface CandidateRow {
  uid: string
  last_name: string | null
  first_seen_at: number
  setup_at: number | null
  builds: number
  taken: 0 | 1
}

export async function markSetupPlayers(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'builds.moderate')
  if (!isLocalDevAdmin(context)) throw new HttpError('forbidden', 'setup uids are only made on a local dev database')
  const body = await readJsonBody<SetupRequest>(context.request)
  const since = body.since ?? null
  const uids = body.uids ?? null
  if (since != null && !Number.isSafeInteger(since)) throw new HttpError('bad_request', 'since is epoch ms')
  if (uids != null && (!Array.isArray(uids) || !uids.every((uid) => typeof uid === 'string' && /^\d{9}$/.test(uid)))) {
    throw new HttpError('bad_request', 'uids are 9-digit strings')
  }
  if (since == null && uids == null) throw new HttpError('bad_request', 'send since, uids, or both')
  const db = context.env.LB
  const { results } = await db.prepare(`SELECT p.uid, p.last_name, p.first_seen_at, p.setup_at,
      (SELECT COALESCE(SUM(b.standing), 0) FROM player_boards b WHERE b.uid = p.uid) AS builds,
      (EXISTS (SELECT 1 FROM claims c WHERE c.uid = p.uid) OR EXISTS (SELECT 1 FROM uid_holds h WHERE h.uid = p.uid)
        OR EXISTS (SELECT 1 FROM account_uids l WHERE l.uid = p.uid)) AS taken
    FROM players p
    WHERE p.opted_out_at IS NULL AND (?1 IS NULL OR p.first_seen_at >= ?1)
      AND (?2 IS NULL OR p.uid IN (SELECT value FROM json_each(?2)))
    ORDER BY p.first_seen_at, p.uid`).bind(since, uids == null ? null : JSON.stringify(uids)).all<CandidateRow>()

  const undo = body.undo === true
  const skip = (row: CandidateRow): string | null => undo
    ? (row.setup_at == null ? 'not setup' : null)
    : row.setup_at != null ? 'already setup' : row.taken ? 'a player took it' : row.builds === 0 ? 'no builds' : null
  const rows = results.map((row) => ({ uid: row.uid, name: row.last_name, firstSeenAt: row.first_seen_at, builds: row.builds, skipped: skip(row) }))
  const change = rows.filter((row) => row.skipped == null).map((row) => row.uid)

  if (body.apply && change.length) {
    const now = context.now
    await db.batch([
      db.prepare(`UPDATE players SET setup_at = ?1, ver = ver + 1 WHERE uid IN (SELECT value FROM json_each(?2))`).bind(undo ? null : now, JSON.stringify(change)),
      ...change.map((uid) => staffAudit(context, who, { action: undo ? 'player.setup_end' : 'player.setup', subjectKind: 'player', subjectId: uid })),
    ])
    // each board shows a setup uid as anonymous from its own player copy
    for (const uid of change) await syncPlayerBoards(context.env, uid)
  }
  return json({ rows, changed: body.apply ? change.length : 0, wouldChange: change.length, undo })
}
