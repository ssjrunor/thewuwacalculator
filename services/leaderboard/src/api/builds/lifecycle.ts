/*
  Author: Runor Ewhro
  description: selects active builds, records replacements, and queues scoring for current rulesets.
*/

import type { ApiEnv } from '../../env.ts'
import { auditStatement, type ActorKind } from '../../lib/audit.ts'
import { HttpError } from '../../lib/http.ts'
import {
  activateStatement, activeBuild, buildBySnapshot, endBuildStatement, getBuild, insertBuildStatement, linkReplacementStatement,
  retireActiveStatement, touchBuildStatement, type BuildRow,
} from '../../db/builds.ts'
import { blockCardStatement } from '../../db/moderation.ts'
import { liveRulesetId, rescoringRulesetIds } from '../../db/rulesets.ts'
import { removeBoardEntriesStatement } from '../../db/scores.ts'

export interface Placement {
  buildId: string
  active: boolean
  inactiveReason?: 'older_than_active'
  /** the same snapshot was already stored; only last_seen_at moved. */
  repeated: boolean
}

export interface PlaceInput {
  uid: string
  resonatorId: string
  cardId: string
  readId: string
  sequence: number
  drawnAt: number
  snapshotHash: string
  /** the submitter proved control of this uid. */
  owner: boolean
}

/** the statements that take `current` off the board and out of the active slot, for `next`. */
function retire(db: D1Database, current: BuildRow | null, next: string, now: number): D1PreparedStatement[] {
  return current && current.id !== next
    ? [retireActiveStatement(db, current.uid, current.resonator_id, next, now), removeBoardEntriesStatement(db, current.id)]
    : []
}

const link = (db: D1Database, current: BuildRow | null, next: string): D1PreparedStatement[] =>
  current && current.id !== next ? [linkReplacementStatement(db, current.id, next)] : []

export async function placeBuild(db: D1Database, input: PlaceInput, now: number): Promise<Placement> {
  const current = await activeBuild(db, input.uid, input.resonatorId)
  // anonymous submissions require a newer original card timestamp; an authenticated owner can select an older stored build.
  const mayReplace = (drawnAt: number) => !current || input.owner || drawnAt > current.drawn_at
  const activatedBy = input.owner ? 'owner' : 'submission'
  const actor = input.owner ? { actorKind: 'uid' as ActorKind, actorId: input.uid } : { actorKind: 'system' as ActorKind, actorId: null }

  // reuse a matching historical snapshot; its original timestamp remains authoritative for automatic replacement.
  const same = await buildBySnapshot(db, input.uid, input.resonatorId, input.snapshotHash)
  if (same && same.state !== 'hidden') {
    if (same.state === 'active' || !mayReplace(same.drawn_at)) {
      await touchBuildStatement(db, same.id, now).run()
      return same.state === 'active'
        ? { buildId: same.id, active: true, repeated: true }
        : { buildId: same.id, active: false, inactiveReason: 'older_than_active', repeated: true }
    }
    await db.batch([
      ...retire(db, current, same.id, now),
      activateStatement(db, same.id, activatedBy, now),
      ...link(db, current, same.id),
      auditStatement(db, { ...actor, action: 'build.activate', subjectKind: 'build', subjectId: same.id }, now),
    ])
    return { buildId: same.id, active: true, repeated: true }
  }

  const active = mayReplace(input.drawnAt)
  // retire the old active row before inserting its replacement, satisfying the partial unique index within one batch.
  const { id, statement } = insertBuildStatement(db, { ...input, state: active ? 'active' : 'replaced',
    activatedBy: active ? activatedBy : null }, now)
  await db.batch([
    ...(active ? retire(db, current, id, now) : []),
    statement,
    ...(active ? link(db, current, id) : []),
    auditStatement(db, { ...actor, action: active ? 'build.submit' : 'build.store', subjectKind: 'build', subjectId: id,
      data: { cardId: input.cardId, replaced: active ? current?.id ?? null : null } }, now),
  ])
  return active ? { buildId: id, active: true, repeated: false } : { buildId: id, active: false, inactiveReason: 'older_than_active', repeated: false }
}

/** the rulesets a newly active build is scored into: the live one and any being rescored. */
export async function scoringTargets(db: D1Database): Promise<string[]> {
  const live = await liveRulesetId(db)
  return [...new Set([...(live ? [live] : []), ...await rescoringRulesetIds(db)])]
}

// queue one fan-out per distinct live or rescoring ruleset after the build becomes active.
export async function startScoring(env: Pick<ApiEnv, 'LB' | 'SCORE_QUEUE'>, buildId: string): Promise<string[]> {
  const targets = await scoringTargets(env.LB)
  if (targets.length) {
    await env.SCORE_QUEUE.sendBatch(targets.map((rulesetId) => ({ body: { kind: 'fanout' as const, buildId, rulesetId } })))
  }
  return targets
}

/** returns the build when its UID matches the authenticated session. */
export async function ownedBuild(db: D1Database, buildId: string, uid: string): Promise<BuildRow> {
  const build = await getBuild(db, buildId)
  if (!build || build.state === 'deleted') throw new HttpError('not_found', 'no such build')
  if (build.uid !== uid) throw new HttpError('forbidden', 'not your build')
  return build
}

/** the owner deletes a build: tombstone it, block its card so the link cannot restore it, drop it from boards. */
export async function deleteBuild(db: D1Database, build: BuildRow, now: number): Promise<void> {
  await db.batch([
    endBuildStatement(db, build.id, 'deleted', now),
    blockCardStatement(db, build.card_id),
    removeBoardEntriesStatement(db, build.id),
    auditStatement(db, { actorKind: 'uid', actorId: build.uid, action: 'build.delete', subjectKind: 'build', subjectId: build.id }, now),
  ])
}

/** the owner makes one of their stored builds the active one, newer or older. */
export async function activateOwnBuild(env: Pick<ApiEnv, 'LB' | 'SCORE_QUEUE'>, build: BuildRow, now: number): Promise<void> {
  if (build.state === 'active') return
  if (build.state !== 'replaced') throw new HttpError('forbidden', 'this build cannot be activated')
  const current = await activeBuild(env.LB, build.uid, build.resonator_id)
  await env.LB.batch([
    ...retire(env.LB, current, build.id, now),
    activateStatement(env.LB, build.id, 'owner', now),
    ...link(env.LB, current, build.id),
    auditStatement(env.LB, { actorKind: 'uid', actorId: build.uid, action: 'build.activate', subjectKind: 'build', subjectId: build.id }, now),
  ])
  await startScoring(env, build.id)
}
