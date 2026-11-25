/*
  Author: Runor Ewhro
  description: uid claims. only a fresh card claims a uid because only the
               owner can draw one; an older card is a submission. signed in, a
               claim links the uid to the account; signed out, the browser's
               claim session stores it. the newest fresh card wins the uid: it
               is removed from other sessions and accounts, and those accounts
               get a notification.
*/

import { limits } from '../../env.ts'
import { auditStatement, type AuditAction } from '../../lib/audit.ts'
import { HttpError } from '../../lib/http.ts'
import { newSessionToken, type SessionActor } from '../../lib/session.ts'
import { linkOf, linkUidStatement, unlinkUidStatement } from '../../db/accounts.ts'
import { notifyStatement } from '../../db/notifications.ts'
import {
  deleteHoldStatement, deleteSessionHoldsStatement, holdsOf, insertClaimSessionStatement, insertClaimStatement, liveHolder,
  revokeSessionStatement, upsertHoldStatement, upsertPlayerStatement, type HoldRow,
} from '../../db/identity.ts'
import type { RouteContext } from '../router.ts'

export interface ClaimResult {
  /** the new claim session token, set when one was started; written to the cookie. */
  token: string | null
  tokenHash: string
  expiresAt: number
}

/** the uid read off a fresh card becomes the session's: linked to its account, or held by its claim session. */
export async function claimUid(context: Pick<RouteContext, 'env' | 'now'>, session: SessionActor | null,
  claim: { uid: string; cardId: string; name: string | null }): Promise<ClaimResult> {
  const { env, now } = context
  const db = env.LB
  const [holder, link] = await Promise.all([liveHolder(db, claim.uid, now), linkOf(db, claim.uid)])
  const accountId = session?.accountId ?? null
  const audit = (action: AuditAction, data: Record<string, unknown>) => auditStatement(db, { actorKind: 'uid', actorId: claim.uid,
    action, subjectKind: 'player', subjectId: claim.uid, data: { cardId: claim.cardId, ...data } }, now)
  const statements: D1PreparedStatement[] = [upsertPlayerStatement(db, { uid: claim.uid, name: claim.name }, now)]
  const kept = (result: ClaimResult) => db.batch(statements).then(() => result)

  // already this session's: nothing to prove again.
  if (session && (accountId ? link?.account_id === accountId : holder?.token_hash === session.tokenHash)) {
    return kept({ token: null, tokenHash: session.tokenHash, expiresAt: session.expiresAt })
  }
  const { id: claimId, statement } = insertClaimStatement(db, claim, now)
  statements.push(statement)
  // taken from the claim session that held it: that session lets it go, and ends if it has nothing else.
  if (holder) statements.push(...await releaseStatements(context, holder, claim.uid))
  // taken from another account: it is told the uid left.
  if (link && link.account_id !== accountId) {
    statements.push(notifyStatement(db, { accountId: link.account_id, kind: 'uid_moved', subjectId: claim.uid, data: { uid: claim.uid } }, now))
  }

  if (accountId) {
    statements.push(linkUidStatement(db, { uid: claim.uid, accountId, claimId }, now), audit('uid.link', { from: link?.account_id ?? null }))
    return kept({ token: null, tokenHash: session!.tokenHash, expiresAt: session!.expiresAt })
  }
  // signed out, the uid leaves the account it was in: this browser's proof is newer.
  if (link) statements.push(unlinkUidStatement(db, claim.uid), audit('uid.unlink', { from: link.account_id, taken: true }))
  let result: ClaimResult
  if (session) {
    result = { token: null, tokenHash: session.tokenHash, expiresAt: session.expiresAt }
  } else {
    const made = await newSessionToken(env.SESSION_KEY)
    result = { token: made.token, tokenHash: made.tokenHash, expiresAt: now + limits(env).sessionTtlMs }
    statements.push(insertClaimSessionStatement(db, { tokenHash: made.tokenHash, claimId, now, expiresAt: result.expiresAt }))
  }
  statements.push(upsertHoldStatement(db, { uid: claim.uid, tokenHash: result.tokenHash, claimId, now }),
    audit('uid.claim', { taken: holder != null }))
  return kept(result)
}

/** removes one uid from a claim session and ends the session when no uids remain. */
export async function releaseStatements(context: Pick<RouteContext, 'env' | 'now'>, hold: Pick<HoldRow, 'token_hash'>,
  uid: string): Promise<D1PreparedStatement[]> {
  const db = context.env.LB
  const rest = (await holdsOf(db, hold.token_hash)).filter((other) => other.uid !== uid)
  return [
    deleteHoldStatement(db, uid),
    ...(rest.length ? [] : [revokeSessionStatement(db, hold.token_hash, context.now)]),
    auditStatement(db, { actorKind: 'system', actorId: null, action: 'uid.release', subjectKind: 'player', subjectId: uid }, context.now),
  ]
}

/** signing out: the session ends and every uid it held is unclaimed with it. */
export const endSessionStatements = (context: Pick<RouteContext, 'env' | 'now'>, tokenHash: string) =>
  [deleteSessionHoldsStatement(context.env.LB, tokenHash), revokeSessionStatement(context.env.LB, tokenHash, context.now)]

export function requireFresh(fresh: boolean): void {
  if (!fresh) {
    throw new HttpError('not_fresh', "oopsies... this card was first generated too long ago. change your build in game, generate a new card and send it within 15 minutes. requesting the same unchanged build can give you the old card again :P")
  }
}
