/*
  Author: Runor Ewhro
  description: leaderboard reads as queries: one key per request (lbKeys) and
               the options that fetch it (lbq). every key starts with ['lb'], so a
               viewer change (a settled submit, a sign-in, an edit) invalidates
               all of them at once, and each region refetches while showing its
               last data.
*/

import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import type { BoardQuery, MeResponse } from '@/domain/leaderboard/api'
import { queryClient } from '@/shared/lib/queryClient'
import { LbError, lbApi } from './client'
import { restoreLb } from './persist'

/** a player as the page reaches them: by uid, or through one of their builds when the uid is hidden. */
interface WhoRef { uid: string | null; buildId: string }

export const lbKeys = {
  all: ['lb'] as const,
  me: () => ['lb', 'me'] as const,
  boards: () => ['lb', 'boards'] as const,
  live: () => ['lb', 'live'] as const,
  activity: (limit: number) => ['lb', 'activity', limit] as const,
  board: (query: BoardQuery) => ['lb', 'board', query.resonatorId, query] as const,
  boardOf: (resonatorId: string) => ['lb', 'board', resonatorId] as const,
  boardStats: (resonatorId: string) => ['lb', 'board-stats', resonatorId] as const,
  boardCounts: (resonatorId: string) => ['lb', 'board-counts', resonatorId] as const,
  build: (buildId: string) => ['lb', 'build', buildId] as const,
  cell: (buildId: string, scenarioId: string) => ['lb', 'cell', buildId, scenarioId] as const,
  player: (who: WhoRef) => ['lb', 'player', who.uid ? `u:${who.uid}` : `b:${who.buildId}`] as const,
  myProfile: () => ['lb', 'my-profile'] as const,
  playerSocial: (ref: string) => ['lb', 'player-social', ref] as const,
  history: (ref: string) => ['lb', 'history', ref] as const,
  bookmarks: () => ['lb', 'bookmarks'] as const,
  buildSocial: (buildId: string) => ['lb', 'build-social', buildId] as const,
  comments: (buildId: string) => ['lb', 'comments', buildId] as const,
  feed: (account: string) => ['lb', 'feed', account] as const,
  notifications: () => ['lb', 'notifications'] as const,
  sanctions: () => ['lb', 'sanctions'] as const,
  staff: () => ['lb', 'staff'] as const,
  staffList: (queue: 'reports' | 'appeals' | 'documents' | 'media') => ['lb', 'staff', queue] as const,
  staffReport: (id: string) => ['lb', 'staff', 'report', id] as const,
}

/** rows the activity page lists. */
export const ACTIVITY_ROWS = 200

/** refetch interval for lists of other people's uploads while in view (paused while the tab is hidden). */
export const LIVE_MS = 60_000

export const lbq = {
  /** the signed-in viewer: null comes only from a 401 and means signed out, and other failures retry. */
  me: () => queryOptions({
    queryKey: lbKeys.me(),
    queryFn: (): Promise<MeResponse | null> => lbApi.me().catch((error: unknown) => {
      if (error instanceof LbError && error.status === 401) return null
      throw error
    }),
    staleTime: 0,
    // with no first response the chrome has nothing to draw, so it retries every few seconds
    retry: (count, error) => !(error instanceof LbError && error.status < 500) && (count < 2 || queryClient.getQueryData(lbKeys.me()) === undefined),
    retryDelay: 3_000,
  }),
  boards: () => queryOptions({ queryKey: lbKeys.boards(), queryFn: () => lbApi.boards() }),
  live: () => queryOptions({ queryKey: lbKeys.live(), queryFn: () => lbApi.liveRuleset(), staleTime: 5 * 60_000 }),
  activity: (limit: number) => queryOptions({ queryKey: lbKeys.activity(limit), queryFn: () => lbApi.activity(limit) }),
  board: (query: BoardQuery) => queryOptions({ queryKey: lbKeys.board(query), queryFn: () => lbApi.board(query) }),
  boardStats: (resonatorId: string) => queryOptions({ queryKey: lbKeys.boardStats(resonatorId), queryFn: () => lbApi.boardStats(resonatorId) }),
  boardCounts: (resonatorId: string) => queryOptions({ queryKey: lbKeys.boardCounts(resonatorId), queryFn: () => lbApi.boardCounts(resonatorId) }),
  /** a build's detail: what it scored changes only when it is scored again, which invalidates every key. */
  build: (buildId: string) => queryOptions({ queryKey: lbKeys.build(buildId), queryFn: () => lbApi.build(buildId), staleTime: 5 * 60_000 }),
  cell: (buildId: string, scenarioId: string) => queryOptions({ queryKey: lbKeys.cell(buildId, scenarioId),
    queryFn: () => lbApi.cell(buildId, scenarioId), staleTime: 5 * 60_000 }),
  player: (who: WhoRef) => queryOptions({ queryKey: lbKeys.player(who),
    queryFn: () => who.uid ? lbApi.player(who.uid) : lbApi.buildPlayer(who.buildId) }),
  myProfile: () => queryOptions({ queryKey: lbKeys.myProfile(), queryFn: () => lbApi.myProfile() }),
  playerSocial: (ref: string) => queryOptions({ queryKey: lbKeys.playerSocial(ref), queryFn: () => lbApi.playerSocial(ref) }),
  history: (ref: string) => queryOptions({ queryKey: lbKeys.history(ref), queryFn: () => lbApi.history(ref) }),
  bookmarks: () => queryOptions({ queryKey: lbKeys.bookmarks(), queryFn: () => lbApi.bookmarks() }),
  buildSocial: (buildId: string) => queryOptions({ queryKey: lbKeys.buildSocial(buildId), queryFn: () => lbApi.buildSocial(buildId) }),
  /** a build's comments a page at a time, newest first; `next` names the older page. */
  comments: (buildId: string) => infiniteQueryOptions({
    queryKey: lbKeys.comments(buildId),
    queryFn: ({ pageParam }) => lbApi.comments(buildId, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  }),
  /** the pinned feed, keyed per account so another account's feed never shows. */
  feed: (account: string) => queryOptions({ queryKey: lbKeys.feed(account), queryFn: () => lbApi.feed() }),
  notifications: () => queryOptions({ queryKey: lbKeys.notifications(), queryFn: () => lbApi.notifications(), staleTime: 0 }),
  sanctions: () => queryOptions({ queryKey: lbKeys.sanctions(), queryFn: () => lbApi.sanctions() }),
  staffReports: () => queryOptions({ queryKey: lbKeys.staffList('reports'), queryFn: () => lbApi.staff.reports() }),
  staffAppeals: () => queryOptions({ queryKey: lbKeys.staffList('appeals'), queryFn: () => lbApi.staff.appeals() }),
  staffDocuments: () => queryOptions({ queryKey: lbKeys.staffList('documents'), queryFn: () => lbApi.staff.documents() }),
  staffMedia: () => queryOptions({ queryKey: lbKeys.staffList('media'), queryFn: () => lbApi.staff.media() }),
  staffReport: (id: string) => queryOptions({ queryKey: lbKeys.staffReport(id), queryFn: () => lbApi.staff.report(id) }),
}

/** marks only these keys stale (a write touched them); each region showing one refetches. */
export const invalidate = (...keys: ReadonlyArray<readonly unknown[]>) =>
  Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))

/** one scored cell's input and splits from the cache, read by an opened build and the kit hovers. */
export const loadCellDetail = (buildId: string, scenarioId: string) => queryClient.fetchQuery(lbq.cell(buildId, scenarioId))

/**
 * the route loader: starts the page shell's reads while its code loads, so the page finds them in flight or done.
 * nothing is awaited, so navigation never waits, and fresh responses are not refetched.
 */
export function prefetchLb({ params }: { params: Record<string, string | undefined> }): null {
  // paint this browser's last data at once; every query below refetches behind it
  restoreLb()
  // who is viewing first: the header and every region that differs by viewer wait on it.
  void queryClient.prefetchQuery(lbq.me())
  void queryClient.prefetchQuery(lbq.boards())
  void queryClient.prefetchQuery(lbq.live())
  // prefetch the main page's list before the page code loads
  if (!params['*']) void queryClient.prefetchQuery(lbq.activity(ACTIVITY_ROWS))
  return null
}

/** marks every leaderboard read stale: regions in view refetch, the rest when next shown. */
export const invalidateLb = () => queryClient.invalidateQueries({ queryKey: lbKeys.all })
