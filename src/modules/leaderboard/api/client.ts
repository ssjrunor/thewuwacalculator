/*
  Author: Runor Ewhro
  description: typed fetch client for /api/lb using the domain/leaderboard contract.
*/

import type {
  ActivityResponse, ApiError, BoardCountsResponse, BoardQuery, BoardResponse, BoardStatsResponse, BoardsResponse, CellDetailResponse,
  BuildDetailResponse, BuildHiddenRequest, FeedResponse, FollowImportRequest, FollowsResponse, CardLoginRequest, LiveRulesetResponse, CardStatusResponse, MeResponse,
  NotificationsResponse, PlayerPatchRequest, ProvidersResponse, LoginProvider, BuildHistoryResponse, BookmarksResponse,
  BuildSocialResponse, CommentsResponse, CommentItem, CommentRequest, DocumentResponse, MediaItem, MediaListResponse, MediaPurpose,
  OwnSanctionsResponse, Appeal, StaffReportsResponse, ReportDetailResponse, ReportNote, StaffReport, SanctionRequest, Sanction,
  StaffAppealsResponse, AppealDecision, StaffDocumentsResponse, HistoryResponse, PlayerProfileResponse, PlayerSocialResponse, ReportRequest, SubmitCardRequest, SubmitCardsRequest, SubmitCardsResponse,
  SubmitCardResponse,
} from '@/domain/leaderboard/api'
import type { ProfileDoc, ViewsDoc } from '@/domain/leaderboard/documents'
import { reasonText } from '@/domain/leaderboard/messages'
import { noteResponse, serverTiming } from '@/shared/lib/requestTiming'

export const LB_API = '/api/lb'

export class LbError extends Error {
  readonly status: number
  readonly code: ApiError['error']['code']
  constructor(status: number, code: ApiError['error']['code'], message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// plain reads in flight, by path: a second ask for the same read while the first is out (StrictMode's second effect
// run in dev, two views of one board) shares its answer instead of fetching again.
const inflight = new Map<string, Promise<unknown>>()

function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  // a write always goes; a read (a GET with only hints such as priority) shares one in flight.
  if (init && ((init.method ?? 'GET') !== 'GET' || init.json !== undefined || init.body != null)) return send<T>(path, init)
  const pending = inflight.get(path)
  if (pending) return pending as Promise<T>
  const started = send<T>(path, init).finally(() => inflight.delete(path))
  inflight.set(path, started)
  return started
}

async function send<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const sent = performance.now()
  const response = await fetch(`${LB_API}${path}`, {
    credentials: 'include',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (response.status === 204) return undefined as T
  const headed = performance.now()
  const text = await response.text().catch(() => '')
  let body: T | ApiError | null = null
  try { body = text ? JSON.parse(text) as T | ApiError : null } catch { body = null }
  // the timing logs (shared/lib/requestTiming.ts) match this to the query that asked.
  const timing = { path, status: response.status, headersMs: headed - sent, bodyMs: performance.now() - headed,
    ...serverTiming(response.headers.get('server-timing')), chars: text.length }
  if (!response.ok) {
    const error = (body as ApiError | null)?.error
    const message = typeof error?.message === 'string' && error.message.trim() ? error.message : reasonText(error?.code ?? 'internal')
    const failure = new LbError(response.status, error?.code ?? 'internal', message)
    noteResponse(failure, timing)
    throw failure
  }
  noteResponse(body, timing)
  return body as T
}

const query = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '')
  return entries.length ? `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)]))}` : ''
}

export const lbApi = {
  boards: () => call<BoardsResponse>('/boards'),
  board: ({ resonatorId, ...rest }: BoardQuery) => call<BoardResponse>(`/boards/${resonatorId}${query({ ...rest })}`),
  boardStats: (resonatorId: string) => call<BoardStatsResponse>(`/boards/${resonatorId}/stats`),
  /** how many builds each team and weapon filter holds, under the same sequence and server filters. */
  boardCounts: (resonatorId: string, filter: Pick<BoardQuery, 'sequence' | 'region'> = {}) =>
    call<BoardCountsResponse>(`/boards/${resonatorId}/counts${query({ ...filter })}`),
  build: (buildId: string) => call<BuildDetailResponse>(`/builds/${buildId}`),
  buildPlayer: (buildId: string) => call<PlayerProfileResponse>(`/builds/${buildId}/player`),
  /** one scored cell's team input and damage split; the detail carries only the best cell's. */
  cell: (buildId: string, scenarioId: string) => call<CellDetailResponse>(`/builds/${buildId}/cells/${encodeURIComponent(scenarioId)}`),
  player: (uid: string) => call<PlayerProfileResponse>(`/players/${uid}`),
  liveRuleset: () => call<LiveRulesetResponse>('/rulesets/live'),
  activity: (limit = 20) => call<ActivityResponse>(`/activity${query({ limit })}`),

  /** who is signed in. asked first and ahead of the page's heavier reads: the chrome draws from it. */
  me: () => call<MeResponse>('/me', { priority: 'high' }),
  /** your own profile: every build, the ones you hid included. */
  myProfile: () => call<PlayerProfileResponse>('/players/me/profile'),
  setHidden: (buildId: string, hidden: boolean) => call<void>(`/builds/${buildId}`, { method: 'PATCH', json: { hidden } satisfies BuildHiddenRequest }),
  /** a uid the session has: its hide-uid and anonymous settings. */
  patchUid: (uid: string, patch: PlayerPatchRequest) => call<MeResponse>(`/players/me/uids/${uid}`, { method: 'PATCH', json: patch }),
  optOut: (uid: string) => call<MeResponse | { ok: true }>(`/players/me/uids/${uid}/opt-out`, { method: 'POST' }),
  optIn: (uid: string) => call<MeResponse>(`/players/me/uids/${uid}/opt-out`, { method: 'DELETE' }),
  login: (request: CardLoginRequest) => call<MeResponse>('/auth/card', { method: 'POST', json: request }),
  logout: () => call<void>('/auth/logout', { method: 'POST' }),
  /** let a uid this browser claimed go; it is unclaimed at once. answers { ok } when it was the last one. */
  release: (uid: string) => call<MeResponse | { ok: true }>('/auth/release', { method: 'POST', json: { uid } }),
  submit: (request: SubmitCardRequest) => call<SubmitCardResponse>('/cards', { method: 'POST', json: request }),
  /** several cards under one bot check; each answers on its own. */
  submitMany: (request: SubmitCardsRequest) => call<SubmitCardsResponse>('/cards/batch', { method: 'POST', json: request }),
  cardStatus: (cardId: string) => call<CardStatusResponse>(`/cards/${cardId}`),
  deleteBuild: (buildId: string) => call<void>(`/builds/${buildId}`, { method: 'DELETE' }),
  report: (request: ReportRequest) => call<void>('/reports', { method: 'POST', json: request }),

  /** the account's pins (the service calls them follows): players and boards. */
  pins: () => call<FollowsResponse>('/follows'),
  /** merge pins kept in this browser into the account's; answers the account's pins after. */
  importPins: (request: FollowImportRequest) => call<FollowsResponse>('/follows/import', { method: 'POST', json: request }),
  /** a player is named by uid, or by one of their builds when the uid is hidden. each answers the pins after. */
  pinPlayer: (ref: string) => call<FollowsResponse>(`/follows/players/${ref}`, { method: 'PUT' }),
  unpinPlayer: (ref: string) => call<FollowsResponse>(`/follows/players/${ref}`, { method: 'DELETE' }),
  pinBoard: (resonatorId: string) => call<FollowsResponse>(`/follows/boards/${resonatorId}`, { method: 'PUT' }),
  unpinBoard: (resonatorId: string) => call<FollowsResponse>(`/follows/boards/${resonatorId}`, { method: 'DELETE' }),
  /** uploads from what the account pins, newest first, and how many came since it was last read. */
  feed: () => call<FeedResponse>('/feed'),
  /** everything in the feed now counts as read. */
  feedSeen: () => call<void>('/feed/seen', { method: 'POST' }),
  /** how many accounts pin a player (null when they keep it private), and whether the viewer does. */
  playerSocial: (ref: string) => call<PlayerSocialResponse>(`/players/${ref}/social`),
  /** the account's notifications, newest first; `before` is the previous page's `next`. */
  notifications: (before?: string) => call<NotificationsResponse>(`/notifications${query({ before })}`),
  /** mark these read, or every one when no ids are given. */
  readNotifications: (ids?: string[]) => call<void>('/notifications/read', { method: 'POST', json: ids ? { ids } : {} }),

  // accounts
  providers: () => call<ProvidersResponse>('/auth/providers'),
  /** a full page load: the provider signs in and sends the browser back to `back` with ?signin=. */
  signInUrl: (provider: LoginProvider, back: string) => `${LB_API}/auth/oauth/${provider}/start${query({ return: back })}`,
  removeLogin: (provider: LoginProvider) => call<void>(`/account/logins/${provider}`, { method: 'DELETE' }),
  unlinkUid: (uid: string) => call<void>(`/account/uids/${uid}`, { method: 'DELETE' }),

  // what people keep: history, saved builds, board views
  history: (ref: string, resonatorId?: string) => call<BuildHistoryResponse>(`/players/${ref}/history${query({ resonator: resonatorId })}`),
  bookmarks: () => call<BookmarksResponse>('/bookmarks'),
  save: (buildId: string) => call<void>(`/builds/${buildId}/bookmark`, { method: 'PUT' }),
  unsave: (buildId: string) => call<void>(`/builds/${buildId}/bookmark`, { method: 'DELETE' }),
  views: () => call<DocumentResponse<ViewsDoc> | null>('/account/documents/views'),
  putViews: (body: ViewsDoc) => call<DocumentResponse<ViewsDoc>>('/account/documents/views', { method: 'PUT', json: body }),

  // a profile's own words and images
  putProfile: (body: ProfileDoc) => call<DocumentResponse<ProfileDoc>>('/players/me/documents/profile', { method: 'PUT', json: body }),
  putBuildDoc: (buildId: string, body: { commentsOpen: boolean; title?: string; note?: string; tags?: string[] }) =>
    call<DocumentResponse>(`/builds/${buildId}/documents/build`, { method: 'PUT', json: body }),
  /** an image readied by prepareImage. */
  upload: (purpose: MediaPurpose, image: Blob) => call<MediaItem>(`/media${query({ purpose })}`, { method: 'POST', body: image, headers: { 'Content-Type': image.type } }),
  myMedia: () => call<MediaListResponse>('/media'),
  mediaUrl: (id: string) => `${LB_API}/media/${id}`,

  // likes and comments
  buildSocial: (buildId: string) => call<BuildSocialResponse>(`/builds/${buildId}/social`),
  like: (buildId: string) => call<{ likes: number; liked: boolean }>(`/builds/${buildId}/like`, { method: 'PUT' }),
  unlike: (buildId: string) => call<{ likes: number; liked: boolean }>(`/builds/${buildId}/like`, { method: 'DELETE' }),
  comments: (buildId: string, before?: string) => call<CommentsResponse>(`/builds/${buildId}/comments${query({ before })}`),
  comment: (buildId: string, request: CommentRequest) => call<CommentItem>(`/builds/${buildId}/comments`, { method: 'POST', json: request }),
  editComment: (id: string, body: string) => call<CommentItem>(`/comments/${id}`, { method: 'PATCH', json: { body } }),
  removeComment: (id: string) => call<void>(`/comments/${id}`, { method: 'DELETE' }),

  // sanctions on the viewer, and appeals
  sanctions: () => call<OwnSanctionsResponse>('/account/sanctions'),
  appeal: (sanctionId: string, body: string) => call<Appeal>(`/sanctions/${sanctionId}/appeal`, { method: 'POST', json: { body } }),

  // staff
  staff: {
    reports: () => call<StaffReportsResponse>('/admin/reports'),
    report: (id: string) => call<ReportDetailResponse>(`/admin/reports/${id}`),
    take: (id: string, take: boolean) => call<StaffReport>(`/admin/reports/${id}/assign`, { method: 'POST', json: { take } }),
    note: (id: string, body: string) => call<ReportNote>(`/admin/reports/${id}/notes`, { method: 'POST', json: { body } }),
    resolve: (id: string, body: { status: 'resolved' | 'dismissed'; resolution?: string; hideBuild?: boolean; removeComment?: boolean }) =>
      call<unknown>(`/admin/reports/${id}`, { method: 'POST', json: body }),
    sanction: (request: SanctionRequest) => call<Sanction>('/admin/sanctions', { method: 'POST', json: request }),
    lift: (id: string) => call<unknown>(`/admin/sanctions/${id}/lift`, { method: 'POST' }),
    history: (kind: string, id: string) => call<HistoryResponse>(`/admin/history/${kind}/${id}`),
    appeals: (status: 'open' | 'upheld' | 'granted' = 'open') => call<StaffAppealsResponse>(`/admin/appeals${query({ status })}`),
    decide: (id: string, decision: AppealDecision) => call<unknown>(`/admin/appeals/${id}`, { method: 'POST', json: decision }),
    documents: (status: 'unreviewed' | 'reviewed' = 'unreviewed', cursor?: string) => call<StaffDocumentsResponse>(`/admin/documents${query({ status, cursor })}`),
    reviewed: (kind: string, ownerId: string, updatedAt: number) => call<unknown>(`/admin/documents/${kind}/${ownerId}/reviewed`, { method: 'POST', json: { updatedAt } }),
    clear: (kind: string, ownerId: string) => call<unknown>(`/admin/documents/${kind}/${ownerId}`, { method: 'DELETE' }),
    media: (status: 'pending' | 'approved' | 'rejected' = 'pending') => call<MediaListResponse>(`/admin/media${query({ status })}`),
    reviewMedia: (id: string, status: 'approved' | 'rejected') => call<MediaItem>(`/admin/media/${id}`, { method: 'POST', json: { status } }),
  },
}
