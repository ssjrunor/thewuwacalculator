/*
  Author: Runor Ewhro
  description: hourly upkeep: expires sessions and abandoned sign-ins, prunes
               notifications and projections, erases retained refused images in
               every registry shard, requeues lost card reads, runs every
               board's upkeep (catalog, stalled jobs, outbox, detail objects) and
               advances rollouts. every part is bounded, so a pass costs the
               same at any size.
*/

import type { ApiEnv, ReadMessage } from '../env.ts'
import { auditStatement } from '../lib/audit.ts'
import { purgeNotificationsStatement } from '../db/notifications.ts'
import { liveRulesetId } from '../db/rulesets.ts'
import { openRollouts } from '../db/rollouts.ts'
import { cardImageKey } from '../cards/registry.ts'
import { STALL_MS } from '../board/BoardDO.ts'
import { pruneBoardSyncStatement } from './projections.ts'
import { SLOT_MS } from './board/queries.ts'
import { advanceRollouts, type RolloutReport } from './moderation/rollouts.ts'
import { ALL_SHARDS, boardOf, cardRef, shardStub } from './stubs.ts'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
// an expired session row is kept this long (for the audit trail of recent logins), then deleted
const SESSION_GRACE_MS = DAY_MS
// pending cards older than 30 minutes are eligible for read-queue recovery
export const STUCK_PENDING_MS = HOUR_MS / 2
// uploads the activity strip and feeds read; older ones are pruned
const UPLOADS_KEEP_MS = 90 * DAY_MS
// applied outbox batches are remembered this long, well past any retry of one
const BOARD_SYNC_KEEP_MS = 7 * DAY_MS
// cards each registry shard handles per pass, for retention and for lost reads alike
const BATCH = 100
// rows per indexed prune statement; each statement stays short
const PRUNE_ROWS = 2_000
// prune statements a pass runs per table at most; the rest is pruned the next hour
const PRUNE_ROUNDS = 25

// refusals whose image is kept only for the keep window (a re-read after a parser update)
export const REFUSED_FOR_RETENTION = ['unreadable', 'uid_unreadable', 'incomplete_build', 'read_failed', 'suspended'] as const

export interface BoardSweep {
  boards: number
  unsent: number
  resumed: number
  abandoned: number
}

export interface MaintenanceReport {
  sessionsDeleted: number
  imagesErased: number
  requeued: number
  scoring: BoardSweep
  rollouts: RolloutReport
}

// boards with scoring work: those of the live ruleset and any rolling ruleset
async function activeBoards(db: D1Database): Promise<string[]> {
  const rulesets = [await liveRulesetId(db), ...(await openRollouts(db)).map((rollout) => rollout.ruleset_id)].filter((id): id is string => !!id)
  if (!rulesets.length) return []
  const { results } = await db.prepare('SELECT DISTINCT resonator_id FROM scenarios WHERE ruleset_id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(rulesets)).all<{ resonator_id: string }>()
  return results.map((row) => row.resonator_id)
}

// every active board's upkeep: catalog, unsent and stalled jobs, detail objects, outbox
export async function sweepBoards(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, stallMs = STALL_MS, { standings = false } = {}): Promise<BoardSweep> {
  const boards = await activeBoards(env.LB)
  const reports = await Promise.all(boards.map((id) => boardOf(env, id).upkeep(Number(id), stallMs, { standings })
    .catch((error) => { console.error('board upkeep failed', id, error); return null })))
  const total: BoardSweep = { boards: boards.length, unsent: 0, resumed: 0, abandoned: 0 }
  for (const report of reports) {
    if (!report) continue
    total.unsent += report.unsent
    total.resumed += report.resumed
    total.abandoned += report.abandoned
  }
  return total
}

type MaintenanceEnv = Pick<ApiEnv, 'LB' | 'BOARDS' | 'CARD_REGISTRY' | 'CARDS' | 'READ_QUEUE' | 'REFUSED_IMAGE_KEEP_DAYS'>

// repeats a bounded delete (at most `limit` rows) until it deletes fewer or PRUNE_ROUNDS is reached; returns the rows
// deleted
async function pruned(statement: (limit: number) => D1PreparedStatement, limit = PRUNE_ROWS): Promise<number> {
  let total = 0
  for (let round = 0; round < PRUNE_ROUNDS; round += 1) {
    const changes = (await statement(limit).run()).meta.changes ?? 0
    total += changes
    if (changes < limit) break
  }
  return total
}

export async function maintain(env: MaintenanceEnv, now: number, options: { stallMs?: number } = {}): Promise<MaintenanceReport> {
  const db = env.LB
  const ended = now - SESSION_GRACE_MS
  // delete an ended session's holds (they stop counting at its end), then the session; holds are one row per held
  // uid, so the whole table is read to find ended ones
  await pruned((limit) => db.prepare(`DELETE FROM uid_holds WHERE uid IN (SELECT h.uid FROM uid_holds h
    JOIN sessions s ON s.token_hash = h.token_hash WHERE s.expires_at < ? OR s.revoked_at IS NOT NULL LIMIT ?)`).bind(ended, limit))
  const sessionsDeleted = await pruned((limit) => db.prepare(`DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions
    WHERE expires_at < ? LIMIT ?)`).bind(ended, limit))
  // a pending sign-in that was never completed
  await pruned((limit) => db.prepare(`DELETE FROM oauth_states WHERE state_hash IN (SELECT state_hash FROM oauth_states
    WHERE expires_at < ? LIMIT ?)`).bind(now, limit))
  // read notifications are kept 90 days, unread ones a year
  await pruned((limit) => purgeNotificationsStatement(db, now - 90 * DAY_MS, now - 365 * DAY_MS, limit))
  await pruned((limit) => db.prepare(`DELETE FROM recent_uploads WHERE build_id IN (SELECT build_id FROM recent_uploads
    WHERE at < ? LIMIT ?)`).bind(now - UPLOADS_KEEP_MS, limit))
  await pruned((limit) => db.prepare(`DELETE FROM upload_slots WHERE q IN (SELECT q FROM upload_slots WHERE q < ? LIMIT ?)`)
    .bind(Math.floor((now - UPLOADS_KEEP_MS) / SLOT_MS), limit))
  await pruned((limit) => pruneBoardSyncStatement(db, now - BOARD_SYNC_KEEP_MS, limit))

  // per shard: erase refused images past the keep window and requeue lost reads, with a shorter stall window in local
  // dev, where each hot reload drops the queue
  const keepMs = Math.max(1, Number(env.REFUSED_IMAGE_KEEP_DAYS) || 30) * DAY_MS
  const stuckMs = Math.min(STUCK_PENDING_MS, options.stallMs ?? STUCK_PENDING_MS)
  let imagesErased = 0, requeued = 0
  await Promise.all(ALL_SHARDS.map(async (shard) => {
    const stub = shardStub(env, shard)
    const expired = await stub.refusedImages(shard, now - keepMs, BATCH, REFUSED_FOR_RETENTION)
    if (expired.length) {
      await env.CARDS.delete(expired.map((card) => cardImageKey(card)))
      await stub.markErased(shard, expired.map((card) => card.no), now)
      imagesErased += expired.length
    }
    const stuck = await stub.stuckPending(shard, now - stuckMs, BATCH)
    if (stuck.length) {
      await env.READ_QUEUE.sendBatch(stuck.map((card) => ({ body: { cardId: card.id, ...(stuck.length > 1 ? { bulk: true } : {}) } })))
      requeued += stuck.length
    }
  }))
  if (imagesErased) {
    await auditStatement(db, { actorKind: 'system', actorId: null, action: 'card.retention_erase', subjectKind: 'card',
      subjectId: 'batch', data: { cards: imagesErased } }, now).run()
  }

  const scoring = await sweepBoards(env, options.stallMs ?? STALL_MS)
  const rollouts = await advanceRollouts(env, now)
  return { sessionsDeleted, imagesErased, requeued, scoring, rollouts }
}

// record exhausted reads as `read_failed`; a later submission can queue the retained image for another attempt
export async function settleDeadReads(batch: MessageBatch<ReadMessage>, env: Pick<ApiEnv, 'LB' | 'CARD_REGISTRY'>, now: number): Promise<void> {
  for (const message of batch.messages) {
    const ref = cardRef(env, message.body.cardId)
    const card = ref ? await ref.stub.get(ref.shard, ref.no) : null
    if (ref && card?.status === 'pending') {
      await ref.stub.setStatus(ref.shard, card.no, 'rejected', 'read_failed')
      await auditStatement(env.LB, { actorKind: 'system', actorId: null, action: 'card.dead_letter', subjectKind: 'card',
        subjectId: card.id, data: { attempts: message.attempts } }, now).run()
    }
    message.ack()
  }
}
