/*
  Author: Runor Ewhro
  description: checks whether a writer may post text or images: a muted uid or
               account is refused, and the account's trust level
               (domain/leaderboard/trust) sets its daily comment cap and its
               limit of uploads pending review.
*/

import { TRUST_LIMITS, trustLevel, type TrustLevel, type TrustLimits } from '@lb/contract/trust'
import { HttpError } from '../../lib/http.ts'
import { getAccount, linksOf } from '../../db/accounts.ts'
import { lastSanctionAt, mutedBy } from '../../db/sanctions.ts'

/** a muted writer is refused, with until when. */
export async function assertNotMuted(db: D1Database, writer: { uid?: string | null; accountId: string | null }, now: number): Promise<void> {
  const mute = await mutedBy(db, writer, now)
  if (!mute) return
  const until = mute.expires_at ? ` until ${new Date(mute.expires_at).toISOString().slice(0, 10)}` : ''
  throw new HttpError('muted', `${mute.subject_kind === 'uid' ? 'your UID' : 'your account'} is muted${until}, so posting and uploads are paused. staff's reason: ${mute.reason}`)
}

export async function trustOf(db: D1Database, accountId: string, now: number): Promise<TrustLevel> {
  const [account, links, sanctionedAt] = await Promise.all([getAccount(db, accountId), linksOf(db, accountId), lastSanctionAt(db, accountId)])
  if (!account) return 'new'
  return trustLevel({ createdAt: account.created_at, linkedUids: links.length, lastSanctionAt: sanctionedAt, staff: account.role !== 'user' }, now)
}

export const limitsOf = async (db: D1Database, accountId: string, now: number): Promise<TrustLimits> => TRUST_LIMITS[await trustOf(db, accountId, now)]

const DAY_MS = 86_400_000

/** an account past its comments for the rolling day is refused. */
export async function assertCommentRoom(db: D1Database, accountId: string, now: number): Promise<void> {
  const [{ commentsPerDay }, row] = await Promise.all([limitsOf(db, accountId, now),
    db.prepare('SELECT COUNT(*) AS n FROM comments WHERE account_id = ? AND created_at > ?').bind(accountId, now - DAY_MS).first<{ n: number }>()])
  if ((row?.n ?? 0) >= commentsPerDay) throw new HttpError('rate_limited', `woah... you've reached your limit of ${commentsPerDay} comments in 24 hours. try again as your earlier comments pass the 24-hour mark :P`)
}
