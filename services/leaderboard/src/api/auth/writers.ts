/*
  Author: Runor Ewhro
  description: checks whether a writer may post text or images: a muted uid or
               account is refused, and the account's trust level
               (domain/leaderboard/trust) sets its limit of uploads pending
               review.
*/

import { TRUST_LIMITS, trustLevel, type TrustLevel, type TrustLimits } from '@lb/contract/trust'
import { HttpError } from '../../lib/http.ts'
import { getAccount, linksOf } from '../../db/accounts.ts'
import { lastSanctionAt, mutedBy } from '../../db/sanctions.ts'

// a muted writer is refused, with until when
export async function assertNotMuted(db: D1Database, writer: { uid?: string | null; accountId: string | null }, now: number): Promise<void> {
  const mute = await mutedBy(db, writer, now)
  if (!mute) return
  const until = mute.expires_at ? ` until ${new Date(mute.expires_at).toISOString().slice(0, 10)}` : ''
  throw new HttpError('muted', `${mute.subject_kind === 'uid' ? 'your UID' : 'your account'} is muted${until}, so profile edits, card looks and uploads are paused. staff's reason: ${mute.reason}`)
}

export async function trustOf(db: D1Database, accountId: string, now: number): Promise<TrustLevel> {
  const [account, links, sanctionedAt] = await Promise.all([getAccount(db, accountId), linksOf(db, accountId), lastSanctionAt(db, accountId)])
  if (!account) return 'new'
  return trustLevel({ createdAt: account.created_at, linkedUids: links.length, lastSanctionAt: sanctionedAt, staff: account.role !== 'user' }, now)
}

export const limitsOf = async (db: D1Database, accountId: string, now: number): Promise<TrustLimits> => TRUST_LIMITS[await trustOf(db, accountId, now)]
