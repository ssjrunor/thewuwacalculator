/*
  Author: Runor Ewhro
  description: the /api/lb contract shared by the service and the app. response
               shapes are independent of the tables, so storage can change
               without breaking clients.
*/

import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import type { CardReadResult } from '@/domain/leaderboard/read'
import type { TrustLevel } from '@/domain/leaderboard/trust'
import type { Role } from '@/domain/leaderboard/permissions'
import type { CardDoc, CardStyle, DocumentKind, ImageFrame, ProfileDoc, ViewsDoc } from '@/domain/leaderboard/documents'
import type { WeaponRole } from '@/domain/leaderboard/ruleset'
import type { ScenarioInput } from '@/domain/leaderboard/scenarioInput'
import type { SkillTypeKey } from '@/domain/entities/stats'

export interface ApiError {
  error: {
    code:
      | 'bad_link' | 'not_kuro' | 'fetch_failed' | 'too_large' | 'bad_image'
      | 'not_fresh' | 'uid_unreadable' | 'unreadable' | 'incomplete_build' | 'read_failed' | 'opted_out' | 'blocked'
      | 'duplicate' | 'rate_limited' | 'unauthorized' | 'forbidden' | 'not_found'
      | 'bad_request' | 'turnstile_failed' | 'internal'
      // a sanction stops this uid or account; the message says until when
      | 'suspended'
      | 'muted'
    message: string
  }
}

// cards

export interface SubmitCardRequest {
  // a kuro card link, a discord proxy link, or the card's file name; an upload sends only the file's name, and the
  // service fetches kuro's original
  input: string
  turnstileToken: string
}

// several cards in one submission (POST /cards/batch): one bot check for all of them
export interface SubmitCardsRequest {
  // each as SubmitCardRequest.input; at most MAX_CARDS_PER_SUBMIT, repeats sent once
  inputs: string[]
  turnstileToken: string
}

// links in one submission; each still counts against the per-minute submit limit
export const MAX_CARDS_PER_SUBMIT = 10

// one input's outcome, in request order; a refused link does not affect the others
export type SubmitCardResult = { input: string } & ({ ok: true; card: SubmitCardResponse } | { ok: false; error: ApiError['error'] })

export interface SubmitCardsResponse {
  results: SubmitCardResult[]
}

// links in pasted text, split on commas and whitespace (links and card file names contain neither), deduped
export function splitCardInputs(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))]
}

// the card's public status, as returned by GET /cards/:id
export interface SubmitCardResponse extends CardStatusResponse {
  // true when this card was submitted before; its current status follows
  duplicate: boolean
}

export type CardStatus = 'pending' | 'reading' | 'scoring' | 'scored' | 'insufficient_data' | 'rejected'

export interface CardStatusResponse {
  cardId: string
  status: CardStatus
  rejectReason?: ApiError['error']['code']
  buildId?: string
  // the build's resonator, once the card is read into a build
  resonatorId?: string
  // false when the build is off the boards (deleted, or hidden by staff); every kept build is ranked as itself
  active?: boolean
}

// auth (fresh card login)

export interface CardLoginRequest {
  // as SubmitCardRequest.input
  input: string
  turnstileToken: string
}

// a uid the session acts for: linked to the signed-in account, or proved with a fresh card by this browser's claim
// session (no account); a uid only groups builds, and these are its settings
export interface SessionUid {
  uid: string
  // the in-game name from its latest card
  name: string | null
  // true when linked to the signed-in account; false when only this browser's claim session holds it
  linked: boolean
  hideUid: boolean
  anonymous: boolean
  optedOut: boolean
}

export type LoginProvider = 'discord' | 'google'

// the signed-in account behind a session
export interface AccountSummary {
  id: string
  role: Role
  logins: Array<{ provider: LoginProvider; createdAt: number; lastUsedAt: number }>
  // unread notifications, and uploads in the follow feed since it was last read
  unread: { notifications: number; feed: number }
  // the account's write limits (domain/leaderboard/trust)
  trust: TrustLevel
  // the sanction stopping the account, if one does: its session can then only read its sanctions and appeal them
  // (GET /account/sanctions, POST /sanctions/:id/appeal)
  suspension: { sanctionId: string; kind: 'suspend' | 'ban'; reason: string; expiresAt: number | null } | null
}

export interface MeResponse {
  // every uid the session acts for, oldest first; their builds are the person's
  uids: SessionUid[]
  // the signed-in account (the person: their profile and everything social); null for a claim session
  account: AccountSummary | null
  expiresAt: number
}

// the sign-in methods this service offers
export interface ProvidersResponse {
  providers: LoginProvider[]
}

// a session uid to act as or release
export interface UidRequest {
  uid: string
}

// either or both: hide the uid (the name still shows), or show as Anonymous (only the region shows)
export interface PlayerPatchRequest {
  hideUid?: boolean
  anonymous?: boolean
}

// PATCH /builds/:id: the owner hides a build from everyone else, or shows it again
export interface BuildHiddenRequest {
  hidden: boolean
}

// boards

export interface BoardQuery {
  resonatorId: string
  // team_key; any weapon when weapon is omitted
  team?: string
  weapon?: string
  sequence?: number
  // the uid's first digit; the app names the servers
  region?: string
  // the rank offset to start at (0 is #1)
  offset?: number
  limit?: number
}

export interface BoardRow {
  rank: number
  buildId: string
  // masked when the player hides their uid
  uid: string | null
  name: string | null
  // the uid's first digit; the app names the servers
  region: string | null
  // the player shows as Anonymous: no uid, name or profile to reach, only the region
  anonymous?: boolean
  sequence: number
  score: number
  damage: number
  // when kuro first drew this build's card: the build's age; the gear may have changed since
  drawnAt: number
  scenario: ScenarioSummary
  // the build's stats in the scenario this row ranks it by; null until scored
  stats: BuildStats | null
  // the echo sets the card shows, most pieces first
  sets: SetPieces[]
  // the DPR a row shows: the selected resonator's damage per loop, each loop averaged over its passes; null until
  // scored
  dpr: number | null
  // the player's look when their profile is tuned (an accent or a banner); null or absent for a plain one
  look?: RowLook | null
}

// a customized profile's look for rows listed outside the profile; media are approved image ids
export interface RowLook {
  // the profile's display name; its first letter replaces a missing avatar
  displayName: string | null
  accent: string | null
  avatar: string | null
  banner: string | null
  // where each image sits in its frame; absent when the service sends no framing
  avatarFrame?: ImageFrame | null
  bannerFrame?: ImageFrame | null
}

// one Sonata set on a build and how many distinct Echo identities wear it
export interface SetPieces {
  id: number
  pieces: number
}

export interface BoardResponse {
  rulesetId: string
  total: number
  // the rank offset of the first row; the next page starts at offset + rows.length
  offset: number
  rows: BoardRow[]
}

// GET /boards/:resonatorId/counts: build counts per team and weapon filter, under the board's sequence and server
// filters
export interface BoardCountsResponse {
  rulesetId: string
  total: number
  // by team key
  teams: Record<string, number>
  // by weapon id
  weapons: Record<string, number>
}

// GET /builds/:id/cells/:scenarioId: what one scored cell ran and how its damage splits
export interface CellDetailResponse {
  scenarioId: string
  contribution: ScoredContribution | null
  input: ScenarioInput | null
  anchors: { baselineDamage: number; benchDamage: number; perfectDamage: number } | null
  programSha256: string | null
}

// build detail

export interface ScenarioSummary {
  id: string
  // the resonator this scenario scores; its other members are teammates
  resonatorId: string
  teamKey: string
  teamRank: number
  members: string[]
  weaponId: string
  weaponRole: WeaponRole
}

export interface ScenarioCell {
  scenario: ScenarioSummary
  status: 'ok' | 'unsupported' | 'error'
  // why a cell is not scored, e.g. 'no_refs', 'rotation_execution_pending'
  reason: string | null
  score: number | null
  damage: number | null
  // the scored resonator's own damage per rotation
  dpr: number | null
  // the team's damage per rotation as the rotation editor totals it (`contribution.team.total`); null or absent when
  // the cell's breakdown is not kept yet, and its cell detail has the total
  teamDpr?: number | null
  // rank on that scenario's own board
  rank: number | null
  // builds scored on that scenario's own board
  total: number | null
}

export interface ScoredContribution {
  // the selected resonator's damage with each loop averaged over its passes, its Tune Breaks included (excluded when
  // the score has no team.total)
  damage: number
  features: Array<{
    resonatorId: string; skillId: string; label: string; tab: string; skillType: SkillTypeKey[]
    damage: number; weightedDamage: number; sharePct: number
  }>
  // the whole team's side of the run; absent when the score has no team ledger
  team?: TeamLedger
}

// a cell's team damage per rotation from its kept breakdown: the ledger's editor total, or, for a score without
// one, `dpr` plus the teammates' damage. null without a breakdown
export function teamDamageOf(dpr: number | null, resonatorId: string, team: TeamLedger | null | undefined): number | null {
  if (team?.total != null) return team.total
  if (dpr == null || !team?.members.length) return null
  return dpr + team.members.reduce((sum, member) => member.resonatorId === resonatorId ? sum : sum + member.damage, 0)
}

// what the team did in a scored run: every member's damage, and each teammate effect that reached the scored
// resonator
export interface TeamLedger {
  // the team's damage per rotation as the rotation editor totals it: every damage row, Tune Break included, each loop
  // averaged over its passes. absent when the score has no team total
  total?: number
  // each member's damage per rotation as the editor splits it (loops averaged over their passes, its own Tune Breaks
  // included; on a score without `total`, Tune Break is excluded and each value rounded), the scored one included:
  // its entry is `damage`. unrounded: displays truncate
  members: Array<{ resonatorId: string; damage: number }>
  buffs: TeamBuff[]
}

export interface TeamBuff {
  // the teammate it came from
  from: string
  // the effect source: the teammate's kit, weapon, main echo or echo set
  source: { type: string; id: string }
  // its name as the game shows it: the state or skill, the passive, the echo, "Rejuvenating Glow 5pc"
  name: string
  // where it sits in the teammate's kit: "Outro Skill", "Inherent", "Weapon", "Echoes" and so on
  kind: string
  // what it does to the scored resonator, each as a label and its value: "Crit Rate", "+12.5%"
  effects: Array<{ text: string; value: string }>
  // the share of the scored resonator's damage dealt while it was on, in percent
  covers: number
}

export interface BuildDetailResponse {
  scoringStatus: 'scoring' | 'scored' | 'insufficient_data'
  rulesetId: string
  buildId: string
  uid: string | null
  name: string | null
  // the player shows as Anonymous: no uid, name or profile (the snapshot's are blanked too)
  anonymous?: boolean
  submittedAt: number
  // when kuro first drew this build's card
  drawnAt: number
  snapshot: BuildSnapshot
  // the cell the board ranks the build by, or the build's own best off the board; null before any score
  best: ScenarioCell | null
  cells: ScenarioCell[]
  // the build's stats in its best scenario, or the submitted build's own (its weapon, no teammates) before a score
  stats: BuildStats | null
  // the exact input behind the best scenario; absent on stored scores without one
  scoredInput?: ScenarioInput | null
  // the best cell's damage split; any other cell's is at GET /builds/:id/cells/:scenarioId
  bestContribution?: ScoredContribution | null
  // the owner's showcase card for this build; images not yet approved are left out
  card: CardDoc | null
}

// build stats

// a build's stats as the showcase card's build column shows them: the scored seat at level 90 with the scenario's
// weapon, before team and rotation buffs
export interface BuildStats {
  atk: number
  hp: number
  def: number
  energyRegen: number
  critRate: number
  critDmg: number
  // the resonator's own attribute DMG bonus
  attributeBonus: number
  basicAttack: number
  heavyAttack: number
  resonanceSkill: number
  resonanceLiberation: number
  // 2 x crit rate + crit dmg over the five echoes, main stats included
  critValue: number
  // the crit value the app grades: minus 44 per four-cost echo (two at most), over five echoes; absent on stats
  // scored without it
  critGrade?: number
}

export type BuildStatKey = keyof BuildStats

// one stat across a board: the median build and the value the top 1% reach
export interface StatSpread {
  median: number
  top1: number
}

export interface BoardStatsResponse {
  rulesetId: string
  resonatorId: string
  total: number
  // every entry's build score in board order, best first, thinned to at most 480 evenly spaced ranks on large boards;
  // the shape of the whole board
  field: number[]
}

// boards index

export interface BoardSummary {
  resonatorId: string
  total: number
  topScore: number
  topBuildId: string
  // the latest board entry write
  updatedAt: number
  // the board's #1 build as its row; null if it could not be read
  top: BoardRow | null
}

export interface BoardsResponse {
  rulesetId: string
  boards: BoardSummary[]
  // uids the profiles index lists; absent when the service has no profiles index
  profiles?: number
}

// profiles index

// how the profiles index orders: last card upload, first upload (profile age), kept builds, or in-game name
export type ProfileSort = 'upload' | 'age' | 'builds' | 'name'

// GET /profiles: one page of the uids with a profile anyone may open
export interface ProfilesQuery {
  sort?: ProfileSort
  // each sort's natural order is upload newest, age oldest, builds most and name A to Z; true reverses it
  reverse?: boolean
  // the uid's first digit; a uid shown with its server only (hidden uids drop out)
  region?: string
  // part of an in-game or display name, or the start of a uid
  q?: string
  offset?: number
  limit?: number
}

// one uid in the profiles index: its own name, server and counts, with the look of the account it is linked to
export interface ProfileListRow {
  // null when the player hides their uid; buildId then reaches them
  uid: string | null
  // one of the uid's listed builds
  buildId: string
  // the in-game name on the uid's latest card
  name: string | null
  // the uid's first digit; null with a hidden uid
  region: string | null
  // kept builds across every board
  builds: number
  // resonators of the uid's newest listed builds, up to three
  resonators: string[]
  firstSeenAt: number
  lastSeenAt: number
  // the linked account's profile look (approved images only); null for a uid on no account or with no profile
  look: RowLook | null
  bio: string | null
}

export interface ProfilesResponse {
  // uids matching the query
  total: number
  offset: number
  rows: ProfileListRow[]
}

// players

// one build a player submitted; every kept build is ranked as itself once scored
export interface PlayerBuild {
  buildId: string
  resonatorId: string
  // true while the build is still being scored on this ruleset
  scoring: boolean
  // the board rank; null when unranked (scoring, or no verified team can score it)
  rank: number | null
  // the board's size
  total: number
  // the build's board score; null when it has none on this ruleset
  score: number | null
  damage: number | null
  sequence: number
  drawnAt: number
  submittedAt: number
  // the scenario the score comes from; null with the score
  scenario: ScenarioSummary | null
  // the weapon the card was read with; a build with no scenario shows it alone
  weaponId: string | null
  // the stats in that scenario, or the submitted build's own (its weapon, no teammates) without a score
  stats: BuildStats | null
  sets: SetPieces[]
  // set only on the owner's own profile: the owner hid it from everyone else
  hidden?: boolean
  // the DPR a row shows: the selected resonator's damage per loop, each loop averaged over its passes; null until
  // scored
  dpr: number | null
}

export interface PlayerProfileResponse {
  rulesetId: string
  // null when the player hides their uid
  uid: string | null
  name: string | null
  region: string | null
  // only the owner opens an anonymous profile; this tells them it shows to no one else
  anonymous?: boolean
  // every build that stands, ranked or not
  builds: PlayerBuild[]
  // the player's profile document without unapproved images (the owner's own view includes them)
  profile: ProfileDoc | null
}

// activity

export interface ActivityRow {
  buildId: string
  resonatorId: string
  uid: string | null
  name: string | null
  region: string | null
  anonymous?: boolean
  // true while the build is still being scored on this ruleset
  scoring: boolean
  // the board rank of a scored build; null otherwise
  rank: number | null
  // the board's size
  total: number
  // the build's board score; null when it has none on this ruleset
  score: number | null
  damage: number | null
  sequence: number
  // the scenario the score comes from; null with the score
  scenario: ScenarioSummary | null
  // the stats in that scenario, or the submitted build's own (its weapon, no teammates) without a score
  stats: BuildStats | null
  // the weapon the card was read with; a row with no scenario shows it alone
  weaponId: string | null
  sets: SetPieces[]
  // the DPR a row shows: the selected resonator's damage per loop, each loop averaged over its passes; null until
  // scored
  dpr: number | null
  // the score the player's previous build on this board held; null for a first entry
  previousScore: number | null
  // the player's look when their profile is tuned; null or absent for a plain one
  look?: RowLook | null
  // when the build was uploaded
  at: number
}

// uploads in one quarter hour
export interface ActivitySlot {
  // the quarter hour's start
  at: number
  entries: number
  // uploads that stand at #1 on their board
  tops: number
}

export interface ActivityResponse {
  rulesetId: string
  rows: ActivityRow[]
  // every upload over the last sixteen days per quarter hour, omitting empty quarters; rows has only the newest few
  slots: ActivitySlot[]
  // every kept build on the server: ranked on a live board, and the rest (scoring, unscorable, hidden by their
  // owner, or on a resonator with no board)
  builds: { ranked: number; unranked: number }
  // every upload since `from` (the request's, clamped to the span) per board
  boards: { from: number; counts: Array<{ resonatorId: string; entries: number }> }
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

// documents and media

// PUT /players/me/documents/profile, PUT /builds/:id/documents/:kind: the whole document, replacing the last
export interface DocumentResponse<T = ProfileDoc | CardDoc | ViewsDoc> {
  kind: DocumentKind
  ownerId: string
  body: T
  updatedAt: number
}

export type MediaPurpose = 'avatar' | 'banner' | 'card'
export type MediaStatus = 'pending' | 'approved' | 'rejected'

// an uploaded image as its owner and staff see it, shown to others once approved
export interface MediaItem {
  id: string
  purpose: MediaPurpose
  contentType: string
  byteSize: number
  status: MediaStatus
  createdAt: number
}

export interface MediaListResponse {
  media: MediaItem[]
}

// staff

export interface StaffReport {
  id: string
  // null while a card report's build is not placed (the reader refused the card for its uid)
  buildId: string | null
  // the refused card a reader's report is about
  cardId: string | null
  reason: ReportRequest['reason']
  details: string | null
  status: 'open' | 'resolved' | 'dismissed'
  resolution: string | null
  createdAt: number
  resolvedAt: number | null
  // the staff member who took it, as the audit log names them
  assignedTo: string | null
  assignedAt: number | null
}

export interface ReportNote {
  id: string
  author: string
  body: string
  createdAt: number
}

// a card as staff inspect it: its stored Kuro image (GET /admin/cards/:id/image), its record, and what was read
// off it
export interface StaffCardResponse {
  cardId: string
  status: 'pending' | 'read' | 'rejected' | 'blocked'
  rejectReason: string | null
  // when Kuro first drew it
  drawnAt: number
  fetchedAt: number
  // false once retention erased the image
  imageKept: boolean
  // the build it made, once placed
  buildId: string | null
  // every read, one per card reader version, oldest first
  reads: Array<{ parserVer: string; outcome: string; uid: string | null; resonatorId: string | null; at: number }>
  // what happened to the card, oldest first
  events: Array<{ at: number; kind: string; actor: string | null; data: unknown }>
  // the newest read in full: its snapshot, and the flags and corrections behind any doubts
  read: CardReadResult | null
  // the build it was asked for by, as stored (staff edits included); null when asked for by card
  build: { id: string; uid: string; snapshot: BuildSnapshot; removed: boolean } | null
}

// what staff fill in on a build (POST /admin/builds/:id/details): only what scoring maxes, so scores and ownership
// stay; a name also renames the player
export interface StaffBuildDetails {
  name?: string
  level?: number
  weaponLevel?: number
  // the weapon, for a card that drew none or one the reader misread
  weaponId?: string
  skillLevels?: Record<string, number>
}

export interface StaffReportsResponse {
  reports: StaffReport[]
}

export interface ReportDetailResponse {
  report: StaffReport
  notes: ReportNote[]
  // the reported build's own history
  history: HistoryEvent[]
}

// warn: recorded only; mute: no profile text, card looks or uploads; suspend: no actions for a time; ban: suspended
// until lifted, with banned uids excluded from every list
export type SanctionKind = 'warn' | 'mute' | 'suspend' | 'ban'

export interface Sanction {
  id: string
  subjectKind: 'uid' | 'account'
  subjectId: string
  kind: SanctionKind
  reason: string
  reportId: string | null
  issuedBy: string
  createdAt: number
  // when a suspension (or a mute given a length) ends
  expiresAt: number | null
  liftedAt: number | null
  liftedBy: string | null
}

// POST /admin/sanctions; suspensions require `days`
export interface SanctionRequest {
  subjectKind: 'uid' | 'account'
  subjectId: string
  kind: SanctionKind
  reason: string
  reportId?: string
  // a suspension's length (required), or a mute's (omitted: until lifted)
  days?: number
}

// one entry of a subject's history: who did what, when
export interface HistoryEvent {
  id: string
  at: number
  actorKind: 'uid' | 'account' | 'admin' | 'system'
  actorId: string | null
  action: string
  data: unknown
}

export interface HistoryResponse {
  subjectKind: string
  subjectId: string
  events: HistoryEvent[]
  // for a uid or an account
  sanctions: Sanction[]
  // for a build, the reports on it; for a uid, the reports on its builds
  reports: StaffReport[]
}

export interface RoleRequest {
  role: Role
}

// social: follows, saves, blocks and notifications; every write requires a signed-in account

// a player ref in social responses; players with a hidden uid are referenced through buildId
export interface PlayerRef {
  uid: string | null
  // one of their listed builds, the way to reach a player who hides their uid; null when there is none
  buildId: string | null
  name: string | null
  // an anonymous player: nothing to name or reach them by
  anonymous?: boolean
}

export interface FollowedPlayer extends PlayerRef {
  // resonators of their builds, ranked ones first, for the capsule
  faces: string[]
}
export interface FollowsResponse {
  players: FollowedPlayer[]
  // resonator ids
  boards: string[]
}
// the app's local pins, merged into the account's follows at sign-in
export interface FollowImportRequest {
  boards?: string[]
  players?: Array<{ uid?: string | null; buildId?: string }>
}

export interface BuildSocialResponse {
  // whether the viewer follows the build's player
  following: boolean
  // saved by the viewer (private to them)
  bookmarked: boolean
}
export interface PlayerSocialResponse {
  // null when the player's follower count is private
  followers: number | null
  following: boolean
  blocked: boolean
}

// scored: a submitted build finished scoring (data: rank, total, score); dethroned: another player's build took #1
// from the recipient's (actor: that player); appeal: the recipient's appeal was decided (data: status, response);
// uid_moved: a fresh card proved one of the recipient's uids elsewhere and moved it off the account (data: uid)
export type NotificationKind = 'sanction' | 'media' | 'scored' | 'dethroned' | 'appeal' | 'uid_moved'
export interface NotificationItem {
  id: string
  kind: NotificationKind
  at: number
  read: boolean
  // repeats are grouped: how many since it was last read
  count: number
  buildId: string | null
  resonatorId: string | null
  actor: PlayerRef | null
  // kind-specific: a sanction's kind and end, a media item's purpose and outcome
  data: unknown
}
export interface NotificationsResponse {
  notifications: NotificationItem[]
  unread: number
  next: string | null
}

// uploads from the boards and players the account follows, newest first
export interface FeedResponse {
  rulesetId: string
  rows: ActivityRow[]
  // when the feed was last marked read; rows after it are new
  seenAt: number | null
  fresh: number
}

// the people an account blocks; a block is lifted by its id
export interface BlocksResponse {
  players: Array<PlayerRef & { id: string; at: number }>
}

export interface BookmarksResponse {
  // newest first, while the build is kept
  builds: Array<{ buildId: string; resonatorId: string; player: PlayerRef; at: number }>
}

// appeals

export interface OwnSanction extends Sanction {
  appeal: Appeal | null
}
export interface OwnSanctionsResponse {
  // sanctions on the account and on the uids linked to it, newest first
  sanctions: OwnSanction[]
}
export interface AppealRequest {
  body: string
}
export interface Appeal {
  id: string
  sanctionId: string
  status: 'open' | 'upheld' | 'granted'
  body: string
  response: string | null
  createdAt: number
  decidedAt: number | null
}
export interface StaffAppeal extends Appeal {
  accountId: string
  decidedBy: string | null
  sanction: Sanction
}
export interface StaffAppealsResponse {
  appeals: StaffAppeal[]
}
export interface AppealDecision {
  // granted lifts the sanction
  status: 'upheld' | 'granted'
  response: string
}

// staff review of what people write

export interface StaffDocument {
  kind: DocumentKind
  ownerId: string
  body: unknown
  updatedAt: number
  reviewedAt: number | null
  reviewedBy: string | null
}
export interface StaffDocumentsResponse {
  documents: StaffDocument[]
  next: string | null
}

// showcase card presets

export interface CardPreset {
  id: string
  name: string
  style: CardStyle
  // shared presets open for anyone with the id; their images show once approved
  shared: boolean
  own: boolean
  createdAt: number
  updatedAt: number
}
export interface CardPresetRequest {
  name: string
  style: unknown
  shared?: boolean
}
export interface CardPresetsResponse {
  presets: CardPreset[]
}
