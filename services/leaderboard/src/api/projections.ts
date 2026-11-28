/*
  Author: Runor Ewhro
  description: D1's per-board projections, written only from board outboxes
               (board/store.ts). a board flushes its ops in order as one D1
               batch led by a board_sync row; a resent batch (the board stopped
               after D1 applied it and before dropping its ops) fails on that row
               and changes nothing, and the board reads D1's last seq from it.
               every op except a notice is a state write, so a repeat is also
               harmless.
*/

import { formatBuildId, fromGbid, uidToText } from '../lib/ids.ts'
import { fromQ } from '../lib/score.ts'
import type { OutboxOp } from '../board/types.ts'

const publicId = (gbid: number) => formatBuildId(fromGbid(gbid))

function statementsOf(db: D1Database, resonator: string, op: OutboxOp, now: number): D1PreparedStatement[] {
  switch (op.op) {
    case 'player_board':
      return [op.standing > 0
        ? db.prepare(`INSERT INTO player_boards (uid, resonator_id, standing, active, listed, listed_at, sequence, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (uid, resonator_id) DO UPDATE SET standing = excluded.standing,
            active = excluded.active, listed = excluded.listed, listed_at = excluded.listed_at, sequence = excluded.sequence,
            updated_at = excluded.updated_at`)
          .bind(uidToText(op.uid), resonator, op.standing, op.active == null ? null : publicId(op.active),
            op.listed == null ? null : publicId(op.listed), op.listedAt, op.seq, now)
        : db.prepare('DELETE FROM player_boards WHERE uid = ? AND resonator_id = ?').bind(uidToText(op.uid), resonator)]
    case 'upload':
      return [db.prepare(`INSERT INTO recent_uploads (build_id, uid, resonator_id, at, shown) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (build_id) DO UPDATE SET at = excluded.at, shown = excluded.shown`)
        .bind(publicId(op.gbid), uidToText(op.uid), resonator, op.at, op.shown ? 1 : 0)]
    case 'board':
      return [db.prepare(`INSERT INTO boards (resonator_id, ruleset_id, total, top, top_score, head, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (resonator_id) DO UPDATE SET ruleset_id = excluded.ruleset_id, total = excluded.total, top = excluded.top,
          top_score = excluded.top_score, head = excluded.head, updated_at = excluded.updated_at`)
        .bind(resonator, op.rulesetId, op.total, JSON.stringify(op.top.map(publicId)), op.topQ == null ? null : fromQ(op.topQ),
          op.head ? JSON.stringify(op.head) : null, op.at)]
    case 'notify': {
      // notifications go to the account the uid is linked to; a uid on no account gets none
      const build = publicId(op.build)
      return [db.prepare(`INSERT INTO notifications (id, account_id, kind, subject_id, build_id, actor_uid, count, data, created_at, read_at)
          SELECT ?1, l.account_id, ?2, ?3, ?4, ?5, 1, ?6, ?7, NULL FROM account_uids l WHERE l.uid = ?8
          ON CONFLICT (account_id, kind, subject_id) WHERE read_at IS NULL
          DO UPDATE SET count = count + 1, created_at = excluded.created_at, actor_uid = excluded.actor_uid, data = excluded.data`)
        .bind(crypto.randomUUID(), op.kind, publicId(op.subject), build, op.actorUid == null ? null : uidToText(op.actorUid),
          JSON.stringify(op.data), op.at, uidToText(op.uid))]
    }
    case 'build_gone': {
      // rows attached to a deleted build: its uploads row, bookmarks and notifications
      const id = publicId(op.gbid)
      return [
        db.prepare('DELETE FROM recent_uploads WHERE build_id = ?').bind(id),
        db.prepare('DELETE FROM bookmarks WHERE build_id = ?').bind(id),
        db.prepare('DELETE FROM notifications WHERE build_id = ?').bind(id),
      ]
    }
  }
}

// applies one board's ops oldest first and returns D1's last seq: this batch's, or the seq recorded by an earlier
// copy of it
export async function applyOutbox(db: D1Database, resonator: string, ops: Array<{ seq: number; op: OutboxOp }>, now: number): Promise<number> {
  if (!ops.length) return 0
  const first = ops[0].seq
  const last = ops[ops.length - 1].seq
  try {
    await db.batch([
      db.prepare('INSERT INTO board_sync (resonator_id, first_seq, last_seq, at) VALUES (?, ?, ?, ?)').bind(resonator, first, last, now),
      ...ops.flatMap((entry) => statementsOf(db, resonator, entry.op, now)),
    ])
    return last
  } catch (error) {
    const done = await db.prepare('SELECT last_seq FROM board_sync WHERE resonator_id = ? AND first_seq = ?').bind(resonator, first)
      .first<{ last_seq: number }>()
    if (done) return done.last_seq
    throw error
  }
}

// board_sync rows are needed only until their board has dropped the ops
export const pruneBoardSyncStatement = (db: D1Database, before: number, limit: number) => db.prepare(`DELETE FROM board_sync
  WHERE (resonator_id, first_seq) IN (SELECT resonator_id, first_seq FROM board_sync WHERE at < ? LIMIT ?)`).bind(before, limit)
