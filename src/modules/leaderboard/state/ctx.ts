/*
  Author: Runor Ewhro
  description: what every leaderboard view reads from the page: who is viewing,
               the boards' sizes, and how to move between pages.
*/

import { createContext, useContext } from 'react'
import type { BoardsResponse, LiveRulesetResponse, MeResponse, PlayerProfileResponse } from '@/domain/leaderboard/api'
import type { Session } from '../chrome/chrome'

export interface ScopeCtxValue {
  /** the viewer, from the chrome's one /me reader; null while unknown and when signed out (session tells which). */
  me: MeResponse | null
  session: Session
  /** the viewer's own standings; null when signed out. */
  mine: PlayerProfileResponse | null
  boards: BoardsResponse | null
  live: LiveRulesetResponse | null
  /** navigate inside the leaderboard (scrolls to the top). */
  go: (path: string) => void
  /** a player's page path: by uid, or by one of their builds when the uid is hidden; the viewer's own is /me. */
  playerTo: (who: { uid: string | null; buildId: string }) => string
  /** after the viewer changed something: reload what depends on them. */
  changed: (message?: string) => void
  toast: (message: string, bad?: boolean) => void
}

export const ScopeCtx = createContext<ScopeCtxValue | null>(null)

export function useScope(): ScopeCtxValue {
  const value = useContext(ScopeCtx)
  if (!value) throw new Error('useScope outside the leaderboard')
  return value
}
