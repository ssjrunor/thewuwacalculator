/*
  Author: Runor Ewhro
  description: records fresh-card ownership claims and issues sessions for their UIDs.
*/

import { limits } from '../../env.ts'
import { auditStatement } from '../../lib/audit.ts'
import { HttpError } from '../../lib/http.ts'
import { newSessionToken } from '../../lib/session.ts'
import { insertClaimStatement, insertSessionStatement, upsertPlayerStatement } from '../../db/identity.ts'
import type { RouteContext } from '../router.ts'

export async function issueSession(context: RouteContext, claim: { uid: string; cardId: string; name: string | null }) {
  const { env, now } = context
  const { sessionTtlMs } = limits(env)
  const { token, tokenHash } = await newSessionToken(env.SESSION_KEY)
  const { id: claimId, statement } = insertClaimStatement(env.LB, claim, now)
  const expiresAt = now + sessionTtlMs
  // create the player update, fresh-card claim, hashed session record, and audit event together.
  await env.LB.batch([
    upsertPlayerStatement(env.LB, { uid: claim.uid, name: claim.name }, now),
    statement,
    insertSessionStatement(env.LB, { tokenHash, uid: claim.uid, claimId, now, expiresAt }),
    auditStatement(env.LB, { actorKind: 'uid', actorId: claim.uid, action: 'session.create', subjectKind: 'player',
      subjectId: claim.uid, data: { cardId: claim.cardId } }, now),
  ])
  return { token, expiresAt, ttlSeconds: Math.floor(sessionTtlMs / 1000) }
}

export function requireFresh(fresh: boolean): void {
  if (!fresh) {
    throw new HttpError('not_fresh', 'this card was first drawn too long ago: change your build in game, ' +
      'run the bot again and send the new card')
  }
}
