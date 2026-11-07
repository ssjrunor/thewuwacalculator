/*
  Author: Runor Ewhro
  description: the /api/lb/v1 contract shared by the service and the app.
               response shapes are independent of the tables, so storage can
               change without breaking clients.
*/

import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import type { WeaponRole } from '@/domain/leaderboard/ruleset'

export interface ApiError {
  error: {
    code:
      | 'bad_link' | 'not_kuro' | 'fetch_failed' | 'too_large' | 'bad_image'
      | 'not_fresh' | 'uid_unreadable' | 'unreadable' | 'incomplete_build' | 'read_failed' | 'opted_out' | 'blocked'
      | 'duplicate' | 'rate_limited' | 'unauthorized' | 'forbidden' | 'not_found'
      | 'bad_request' | 'turnstile_failed' | 'internal'
    message: string
  }
}

// cards

export interface SubmitCardRequest {
  /** a kuro card link, a discord proxy link, or the card's file name. an upload
      sends only the file's name; the service fetches kuro's original. */
  input: string
  turnstileToken: string
}

export interface SubmitCardResponse {
  cardId: string
  /** true when this card was submitted before; its current status follows. */
  duplicate: boolean
  status: CardStatus
}

export type CardStatus = 'pending' | 'reading' | 'scoring' | 'scored' | 'rejected'

export interface CardStatusResponse {
  cardId: string
  status: CardStatus
  rejectReason?: ApiError['error']['code']
  buildId?: string
  /** false when the build was stored but not made active: an anonymous card
      first drawn earlier than the active build. the owner can activate it. */
  active?: boolean
  inactiveReason?: 'older_than_active'
}

// auth (fresh card login)

export interface CardLoginRequest {
  /** as SubmitCardRequest.input. */
  input: string
  turnstileToken: string
}

export interface MeResponse {
  uid: string | null
  /** later, when accounts exist. */
  accountId: string | null
  expiresAt: number
  player: { hideUid: boolean; optedOut: boolean } | null
}

export interface PlayerPatchRequest {
  hideUid: boolean
}

/** one stored build of the session's uid. */
export interface OwnerBuild {
  buildId: string
  resonatorId: string
  state: 'active' | 'replaced'
  sequence: number
  drawnAt: number
  submittedAt: number
  snapshot: BuildSnapshot | null
}

export interface OwnerBuildsResponse {
  uid: string
  /** per resonator, newest card first; at most one is active. */
  resonators: Record<string, OwnerBuild[]>
}

// boards

export interface BoardQuery {
  resonatorId: string
  /** team_key; any weapon when weapon is omitted. */
  team?: string
  /** any team containing this resonator. */
  member?: string
  weapon?: string
  sequence?: number
  /** the uid's first digit; the app names the servers. */
  region?: string
  cursor?: string
  limit?: number
}

export interface BoardRow {
  rank: number
  buildId: string
  /** masked when the player hides their uid. */
  uid: string | null
  name: string | null
  /** the uid's first digit; the app names the servers. */
  region: string | null
  sequence: number
  score: number
  dps: number
  /** when kuro first drew this build's card: the build's age, not proof it is still equipped. */
  drawnAt: number
  scenario: ScenarioSummary
}

export interface BoardResponse {
  rulesetId: string
  total: number
  rows: BoardRow[]
  nextCursor: string | null
}

// build detail

export interface ScenarioSummary {
  id: string
  teamKey: string
  teamRank: number
  members: string[]
  weaponId: string
  weaponRole: WeaponRole
}

export interface ScenarioCell {
  scenario: ScenarioSummary
  status: 'ok' | 'unsupported' | 'error'
  /** why a cell is not scored, e.g. 'no_refs', 'rotation_execution_pending'. */
  reason: string | null
  score: number | null
  dps: number | null
  damage: number | null
  duration: number | null
  /** rank on that scenario's own board. */
  rank: number | null
  programSha256: string | null
}

export interface BuildDetailResponse {
  rulesetId: string
  buildId: string
  uid: string | null
  name: string | null
  submittedAt: number
  /** when kuro first drew this build's card. */
  drawnAt: number
  snapshot: BuildSnapshot
  /** null while nothing has scored (scoring, or every scenario unsupported). */
  best: ScenarioCell | null
  cells: ScenarioCell[]
}

// rulesets

export interface LiveRulesetResponse {
  rulesetId: string
  gameVer: string
  liveAt: number | null
  scenarios: ScenarioSummary[]
}

// reports

export interface ReportRequest {
  buildId: string
  reason: 'misread' | 'not_owner' | 'abuse' | 'other'
  details?: string
  turnstileToken: string
}

export interface ReportResponse {
  reportId: string
}
