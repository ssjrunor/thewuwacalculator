/*
  Author: Runor Ewhro
  description: the viewer's sanction state: a suspension or ban stops the account and a mute pauses its writes.
*/

import type { MeResponse, OwnSanction } from '@/domain/leaderboard/api'
import { fmtUid } from './listed'

export const KIND: Record<OwnSanction['kind'], string> = { warn: 'Warning', mute: 'Mute', suspend: 'Suspension', ban: 'Ban' }

// whether a sanction is in force: not lifted and not expired
export const running = (s: OwnSanction, now: number) => s.liftedAt == null && (s.expiresAt == null || s.expiresAt > now)
// the subject a sanction applies to, as shown
export const covers = (s: OwnSanction) => s.subjectKind === 'uid' ? `UID ${fmtUid(s.subjectId)}` : 'This account'

export type Trouble = 'banned' | 'suspended' | 'muted' | null

// what stops or pauses the viewer now; a warning alone returns nothing
export function troubleOf(me: MeResponse | null, sanctions: OwnSanction[] | null | undefined, now = Date.now()): Trouble {
  const stop = me?.account?.suspension
  if (stop) return stop.kind === 'ban' ? 'banned' : 'suspended'
  return sanctions?.some((s) => s.kind === 'mute' && running(s, now)) ? 'muted' : null
}

export const TROUBLE_WORD: Record<Exclude<Trouble, null>, string> = { banned: 'Banned', suspended: 'Suspended', muted: 'Muted' }
