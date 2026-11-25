/*
  Author: Runor Ewhro
  description: player data for the page: one cached profile request per player
               (shared by the rail, hover cards and the profile) and a profile's
               standing in a few numbers. a profile lists every build, ranked or
               not, and standing reads only the ranked ones.
*/

import type { PlayerBuild, PlayerProfileResponse, ScenarioSummary } from '@/domain/leaderboard/api'
import { APP_ROUTES } from '@/shared/lib/appRoutes'
import { queryClient } from '@/shared/lib/queryClient'
import { lbq } from '../api/queries'

/** a player reached by uid, or by one of their builds when the uid is hidden; an anonymous one is not reached at all. */
export interface Who { uid: string | null; buildId: string; anonymous?: boolean }

/** how a row names a player: an anonymous one by that word alone. */
export const playerName = (who: { name?: string | null; anonymous?: boolean }): string =>
  who.anonymous ? 'anon' : who.name ?? 'Unnamed'

/** a build holding a board rank: the active card for its resonator, scored. */
export type RankedBuild = PlayerBuild & { rank: number; score: number; damage: number; scenario: ScenarioSummary }
export const isRanked = (b: PlayerBuild): b is RankedBuild => b.rank != null && b.score != null && b.damage != null && b.scenario != null
export const rankedOf = (profile: PlayerProfileResponse | null | undefined): RankedBuild[] => profile ? profile.builds.filter(isRanked) : []

/** a player's profile from the query cache (lbq.player): the rail, hover cards and the profile share one read. */
export const loadPlayer = (who: Who): Promise<PlayerProfileResponse> => queryClient.fetchQuery(lbq.player(who))

export const playerPath = (who: Who) =>
  who.uid ? `${APP_ROUTES.leaderboard}/player/${who.uid}` : `${APP_ROUTES.leaderboard}/player/build/${who.buildId}`

export const byStanding = (a: RankedBuild, b: RankedBuild) => a.rank / Math.max(1, a.total) - b.rank / Math.max(1, b.total)
export const byDrawn = (a: PlayerBuild, b: PlayerBuild) => b.drawnAt - a.drawnAt

export interface Standing {
  /** the ranked builds, best standing first. */
  builds: RankedBuild[]
  best: RankedBuild | null
  /** builds in their board's top 10%. */
  top10: number
  /** the median build's share of its board above it, 0 to 100. */
  median: number | null
  first: number | null
  last: number | null
}

export function standingOf(profile: PlayerProfileResponse | null): Standing {
  const builds = rankedOf(profile).sort(byStanding)
  const shares = builds.map((b) => b.rank / Math.max(1, b.total) * 100)
  // first and latest read every build, ranked or not.
  const drawn = (profile?.builds ?? []).map((b) => b.drawnAt)
  return {
    builds,
    best: builds[0] ?? null,
    top10: shares.filter((s) => s <= 10).length,
    median: shares.length ? shares[Math.floor(shares.length / 2)] : null,
    first: drawn.length ? Math.min(...drawn) : null,
    last: drawn.length ? Math.max(...drawn) : null,
  }
}

/** a pin's player summary: their best ranked build, or their newest when none is ranked. */
export const pinOf = (profile: PlayerProfileResponse, standing: Standing) => {
  const lead = standing.best ?? [...profile.builds].sort(byDrawn)[0] ?? null
  return lead ? {
    uid: profile.uid,
    buildId: lead.buildId,
    name: profile.name ?? 'Unnamed',
    faces: [...new Set([...standing.builds, ...profile.builds].map((b) => b.resonatorId))].slice(0, 3),
  } : null
}
