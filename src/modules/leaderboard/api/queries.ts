/*
  Author: Runor Ewhro
  description: leaderboard reads as queries: one key per request (lbKeys) and
               the options that fetch it (lbq). every key starts with ['lb'], so a
               viewer change (a settled submit, a sign-in, an edit) invalidates
               all of them at once, and each region refetches while showing its
               last data.
*/

import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import type { BoardQuery, MeResponse, ProfilesQuery } from '@/domain/leaderboard/api'
import { queryClient } from '@/shared/lib/queryClient'
import { LbError, lbApi } from './client'
import { restoreLb } from './persist'

// a player as the page reaches them: by uid, or through one of their builds when the uid is hidden
interface WhoRef { uid: string | null; buildId: string }

export const lbKeys = {
  all: ['lb'] as const,
  me: () => ['lb', 'me'] as const,
  boards: () => ['lb', 'boards'] as const,
  live: () => ['lb', 'live'] as const,
  activity: (limit: number, from?: number) => ['lb', 'activity', limit, from ?? null] as const,
  board: (query: BoardQuery) => ['lb', 'board', query.resonatorId, query] as const,
  boardOf: (resonatorId: string) => ['lb', 'board', resonatorId] as const,
  boardStats: (resonatorId: string) => ['lb', 'board-stats', resonatorId] as const,
  boardCounts: (resonatorId: string) => ['lb', 'board-counts', resonatorId] as const,
  build: (buildId: string) => ['lb', 'build', buildId] as const,
  cell: (buildId: string, scenarioId: string) => ['lb', 'cell', buildId, scenarioId] as const,
  player: (who: WhoRef) => ['lb', 'player', who.uid ? `u:${who.uid}` : `b:${who.buildId}`] as const,
  myProfile: () => ['lb', 'my-profile'] as const,
  profiles: (query: Omit<ProfilesQuery, 'offset'>) => ['lb', 'profiles', query] as const,
  playerSocial: (ref: string) => ['lb', 'player-social', ref] as const,
  bookmarks: () => ['lb', 'bookmarks'] as const,
  buildSocial: (buildId: string) => ['lb', 'build-social', buildId] as const,
  feed: (account: string) => ['lb', 'feed', account] as const,
  notifications: () => ['lb', 'notifications'] as const,
  sanctions: () => ['lb', 'sanctions'] as const,
  blocks: () => ['lb', 'blocks'] as const,
  media: () => ['lb', 'media'] as const,
  presets: () => ['lb', 'presets'] as const,
  staff: () => ['lb', 'staff'] as const,
  staffList: (queue: 'reports' | 'appeals' | 'documents' | 'media') => ['lb', 'staff', queue] as const,
  staffReport: (id: string) => ['lb', 'staff', 'report', id] as const,
  staffBuildCard: (buildId: string) => ['lb', 'staff', 'build-card', buildId] as const,
  staffCard: (cardId: string) => ['lb', 'staff', 'card', cardId] as const,
}

// rows the activity page lists
export const ACTIVITY_ROWS = 200

// local days the activity strip draws, today last
export const ACTIVITY_DAYS = 15

// the strip's first local midnight: the activity page's per-board counts start there
export function activityFrom(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (ACTIVITY_DAYS - 1)).getTime()
}

// refetch interval for lists of other people's uploads while in view (paused while the tab is hidden)
export const LIVE_MS = 60_000

export const lbq = {
  // the signed-in viewer: null comes only from a 401 and means signed out, and other failures retry
  me: () => queryOptions({
    queryKey: lbKeys.me(),
    queryFn: (): Promise<MeResponse | null> => lbApi.me().catch((error: unknown) => {
      if (error instanceof LbError && error.status === 401) return null
      throw error
    }),
    staleTime: 0,
    // with no first response the chrome has nothing to render, so it retries every few seconds
    retry: (count, error) => !(error instanceof LbError && error.status < 500) && (count < 2 || queryClient.getQueryData(lbKeys.me()) === undefined),
    retryDelay: 3_000,
  }),
  boards: () => queryOptions({ queryKey: lbKeys.boards(), queryFn: () => lbApi.boards() }),
  live: () => queryOptions({ queryKey: lbKeys.live(), queryFn: () => lbApi.liveRuleset(), staleTime: 5 * 60_000 }),
  activity: (limit: number, from?: number) => queryOptions({ queryKey: lbKeys.activity(limit, from), queryFn: () => lbApi.activity(limit, from) }),
  board: (query: BoardQuery) => queryOptions({ queryKey: lbKeys.board(query), queryFn: () => lbApi.board(query) }),
  boardStats: (resonatorId: string) => queryOptions({ queryKey: lbKeys.boardStats(resonatorId), queryFn: () => lbApi.boardStats(resonatorId) }),
  boardCounts: (resonatorId: string) => queryOptions({ queryKey: lbKeys.boardCounts(resonatorId), queryFn: () => lbApi.boardCounts(resonatorId) }),
  // a build's detail: its scores change only when it is scored again, which invalidates every key
  build: (buildId: string) => queryOptions({ queryKey: lbKeys.build(buildId), queryFn: () => lbApi.build(buildId), staleTime: 5 * 60_000 }),
  cell: (buildId: string, scenarioId: string) => queryOptions({ queryKey: lbKeys.cell(buildId, scenarioId),
    queryFn: () => lbApi.cell(buildId, scenarioId), staleTime: 5 * 60_000 }),
  player: (who: WhoRef) => queryOptions({ queryKey: lbKeys.player(who),
    queryFn: () => who.uid ? lbApi.player(who.uid) : lbApi.buildPlayer(who.buildId) }),
  myProfile: () => queryOptions({ queryKey: lbKeys.myProfile(), queryFn: () => lbApi.myProfile() }),
  // the profiles index, a page at a time from offset 0 until every match is read
  profiles: (query: Omit<ProfilesQuery, 'offset'>) => infiniteQueryOptions({ queryKey: lbKeys.profiles(query),
    queryFn: ({ pageParam }) => lbApi.profiles({ ...query, offset: pageParam }), initialPageParam: 0,
    getNextPageParam: (last) => last.offset + last.rows.length < last.total && last.rows.length ? last.offset + last.rows.length : undefined }),
  playerSocial: (ref: string) => queryOptions({ queryKey: lbKeys.playerSocial(ref), queryFn: () => lbApi.playerSocial(ref) }),
  bookmarks: () => queryOptions({ queryKey: lbKeys.bookmarks(), queryFn: () => lbApi.bookmarks() }),
  buildSocial: (buildId: string) => queryOptions({ queryKey: lbKeys.buildSocial(buildId), queryFn: () => lbApi.buildSocial(buildId) }),
  // the pinned feed, keyed per account so another account's feed never shows
  feed: (account: string) => queryOptions({ queryKey: lbKeys.feed(account), queryFn: () => lbApi.feed() }),
  notifications: () => queryOptions({ queryKey: lbKeys.notifications(), queryFn: () => lbApi.notifications(), staleTime: 0 }),
  sanctions: () => queryOptions({ queryKey: lbKeys.sanctions(), queryFn: () => lbApi.sanctions() }),
  blocks: () => queryOptions({ queryKey: lbKeys.blocks(), queryFn: () => lbApi.blocks() }),
  media: () => queryOptions({ queryKey: lbKeys.media(), queryFn: () => lbApi.myMedia() }),
  presets: () => queryOptions({ queryKey: lbKeys.presets(), queryFn: () => lbApi.presets() }),
  staffReports: () => queryOptions({ queryKey: lbKeys.staffList('reports'), queryFn: () => lbApi.staff.reports() }),
  staffAppeals: () => queryOptions({ queryKey: lbKeys.staffList('appeals'), queryFn: () => lbApi.staff.appeals() }),
  staffDocuments: () => queryOptions({ queryKey: lbKeys.staffList('documents'), queryFn: () => lbApi.staff.documents() }),
  staffMedia: () => queryOptions({ queryKey: lbKeys.staffList('media'), queryFn: () => lbApi.staff.media() }),
  staffReport: (id: string) => queryOptions({ queryKey: lbKeys.staffReport(id), queryFn: () => lbApi.staff.report(id) }),
  staffBuildCard: (buildId: string) => queryOptions({ queryKey: lbKeys.staffBuildCard(buildId), queryFn: () => lbApi.staff.buildCard(buildId) }),
}

// marks only these keys stale (a write touched them); each region showing one refetches
export const invalidate = (...keys: ReadonlyArray<readonly unknown[]>) =>
  Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))

// one scored cell's input and splits from the cache, read by an opened build and the kit hovers
export const loadCellDetail = (buildId: string, scenarioId: string) => queryClient.fetchQuery(lbq.cell(buildId, scenarioId))

// the route loader: starts the page shell's reads while its code loads, so the page finds them in flight or done;
// nothing is awaited, so navigation never waits, and fresh responses are not refetched
export function prefetchLb({ params }: { params: Record<string, string | undefined> }): null {
  // render this browser's last data at once; every query below refetches behind it
  restoreLb()
  // the viewer first: the header and every region that differs by viewer wait on it
  void queryClient.prefetchQuery(lbq.me())
  void queryClient.prefetchQuery(lbq.boards())
  void queryClient.prefetchQuery(lbq.live())
  // prefetch the main page's list before the page code loads
  if (!params['*']) void queryClient.prefetchQuery(lbq.activity(ACTIVITY_ROWS, activityFrom()))
  return null
}

// marks every leaderboard read stale: regions in view refetch, the rest when next shown
export const invalidateLb = () => queryClient.invalidateQueries({ queryKey: lbKeys.all })
