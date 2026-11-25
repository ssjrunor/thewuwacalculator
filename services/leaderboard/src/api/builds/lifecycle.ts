/*
  Author: Runor Ewhro
  description: api-side build operations: resolving a public id to its board,
               owner checks, and owner changes (delete, hide). ranking and
               delete cascades run in the board (board/store.ts), and D1 rows
               tied to a build follow through the board's outbox.
*/

import type { ApiEnv } from '../../env.ts'
import { auditStatement } from '../../lib/audit.ts'
import { HttpError } from '../../lib/http.ts'
import { formatBuildId, parseBuildId, uidToInt, uidToText, type BuildKey } from '../../lib/ids.ts'
import type { SessionActor } from '../../lib/session.ts'
import { endSetupStatement } from '../../db/identity.ts'
import { requireLinkedUid, requireOwnUid } from '../auth/sessions.ts'
import type { RouteContext } from '../router.ts'
import type { BuildView } from '../../board/reads.ts'
import { boardOf, cardRef } from '../stubs.ts'

export interface BuildRef extends BuildKey {
  id: string
  board: ReturnType<typeof boardOf>
}

/** a public build id's board and local id; not_found for an id that is not one. */
export function buildRef(env: Pick<ApiEnv, 'BOARDS'>, id: string): BuildRef {
  const key = parseBuildId(id)
  if (!key) throw new HttpError('not_found', "hmm... this build isn't available. it may have been hidden or deleted.")
  return { ...key, id: formatBuildId(key), board: boardOf(env, key.resonator) }
}

/** a build as its board shows it, or null. */
export async function buildViewOf(env: Pick<ApiEnv, 'BOARDS'>, id: string): Promise<{ ref: BuildRef; view: BuildView } | null> {
  const ref = buildRef(env, id)
  const view = await ref.board.build(ref.resonator, ref.local)
  return view ? { ref, view } : null
}

/** a kept build of a uid the session has, with that uid; `linked` requires the uid on the signed-in account, which
    writing a build's notes and looks needs (hiding and deleting do not). */
export async function ownedBuild(context: Pick<RouteContext, 'request' | 'env' | 'now'>, id: string,
  { linked = false }: { linked?: boolean } = {}): Promise<{ ref: BuildRef; view: BuildView; uid: string; session: SessionActor }> {
  const found = await buildViewOf(context.env, id)
  if (!found || found.view.row.state === 'deleted' || found.view.row.state === 'hidden') throw new HttpError('not_found', "hmm... this build isn't available. it may have been hidden or deleted.")
  const uid = uidToText(found.view.row.uid)
  const session = linked ? await requireLinkedUid(context, uid) : await requireOwnUid(context, uid)
  return { ...found, uid, session }
}

/** a player acted for a setup uid: it is an ordinary player from now on (the board takes the build as uploaded now). */
export function endSetupStatements(db: D1Database, uid: string, buildId: string | null, now: number) {
  return [
    endSetupStatement(db, uid),
    auditStatement(db, { actorKind: 'system', actorId: null, action: 'player.setup_end', subjectKind: 'player', subjectId: uid,
      data: { buildId } }, now),
  ]
}

/** deletes an owner's build: the board drops it and ranks their next best, and the card is blocked against
    resubmission; likes, bookmarks and documents are removed through the board's outbox. */
export async function deleteBuild(env: Pick<ApiEnv, 'LB' | 'BOARDS' | 'CARD_REGISTRY'>, ref: BuildRef, uid: string, now: number): Promise<void> {
  const ended = await ref.board.endBuild(ref.resonator, ref.local, 'deleted', `uid:${uid}`, uidToInt(uid) ?? undefined)
  if (!ended) throw new HttpError('not_found', "hmm... this build isn't available. it may have been hidden or deleted.")
  const card = cardRef(env, ended.card)
  if (card) await card.stub.block(card.shard, card.no, `uid:${uid}`)
  await auditStatement(env.LB, { actorKind: 'uid', actorId: uid, action: 'build.delete', subjectKind: 'build', subjectId: ref.id }, now).run()
}

/** the owner hides a build from everyone else, or shows it again; it competes again from the scores it has. */
export async function setOwnerHidden(ref: BuildRef, uid: string, hidden: boolean): Promise<void> {
  if (!await ref.board.setOwnerHidden(ref.resonator, ref.local, uidToInt(uid)!, hidden)) throw new HttpError('forbidden', "hmm... this build cannot be hidden right now. refresh your profile and try again.")
}
