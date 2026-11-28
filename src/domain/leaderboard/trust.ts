/*
  Author: Runor Ewhro
  description: write limits by account history. new accounts (and recently
               sanctioned ones) get tight daily limits, accounts with a linked uid
               and some age get more, and staff are unlimited. the service
               computes the level from the account's record and enforces the
               limits, and the app reads them to explain a refusal.
*/

export type TrustLevel = 'new' | 'member' | 'trusted'

export interface TrustLimits {
  // uploads waiting for review at once
  pendingMedia: number
}

export const TRUST_LIMITS: Readonly<Record<TrustLevel, TrustLimits>> = {
  new: { pendingMedia: 2 },
  member: { pendingMedia: 12 },
  trusted: { pendingMedia: 30 },
}

const DAY_MS = 86_400_000

export interface TrustRecord {
  createdAt: number
  linkedUids: number
  // the newest sanction other than a warning, lifted or not; null when it has none
  lastSanctionAt: number | null
  staff: boolean
}

// new: under three days old, no linked uid, or sanctioned in the last thirty days; trusted: thirty days old with no
// sanction in ninety; member: everyone else; staff count as trusted
export function trustLevel(record: TrustRecord, now: number): TrustLevel {
  if (record.staff) return 'trusted'
  const sanctionedWithin = (days: number) => record.lastSanctionAt != null && now - record.lastSanctionAt < days * DAY_MS
  if (now - record.createdAt < 3 * DAY_MS || record.linkedUids === 0 || sanctionedWithin(30)) return 'new'
  if (now - record.createdAt >= 30 * DAY_MS && !sanctionedWithin(90)) return 'trusted'
  return 'member'
}
