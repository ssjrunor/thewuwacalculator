/*
  Author: Runor Ewhro
  description: the Scope leaderboard's listed build shape. board rows and each
               board's #1 are a Listed (ranked); a player's builds and activity
               entries are a Row, which may be unranked. every list renders both
               with the build row.
*/

import type { ActivityRow, BoardRow, BuildStats, PlayerBuild, PlayerProfileResponse, RowLook, ScenarioSummary, SetPieces } from '@/domain/leaderboard/api'
import { APP_ROUTES } from '@/shared/lib/appRoutes'

export interface Listed {
  buildId: string
  resonatorId: string
  rank: number
  /** the board's size; 0 when unknown. */
  total: number
  /** null when the player hides their uid. */
  uid: string | null
  name: string | null
  region: string | null
  /** the player shows as Anonymous: only the region, no profile to open. */
  anonymous?: boolean
  sequence: number
  score: number
  /** the board's damage figure, unused for ranking. */
  damage: number
  /** the loop average, the DPR a row shows; null until scored. */
  dpr: number | null
  scenario: ScenarioSummary
  stats: BuildStats | null
  sets: SetPieces[]
  /** when kuro first drew the card, or when an activity entry was uploaded. */
  at: number
  /** a tuned player's look, worn by rows listed outside their profile; absent on the profile itself. */
  look?: RowLook | null
}

/** a listed build that may have no board rank (still scoring, or no verified team scores it); it lists like any
    other build with rank and score blank. */
export interface Row extends Omit<Listed, 'rank' | 'score' | 'damage' | 'scenario'> {
  rank: number | null
  score: number | null
  damage: number | null
  scenario: ScenarioSummary | null
  /** the weapon the card was read with; a row with no scenario shows it alone. */
  weaponId?: string | null
  scoring?: boolean
  /** set only on the viewer's own profile: the viewer hid this build from everyone else. */
  hidden?: boolean
}

/** one-word reason a row has no rank; null when ranked. */
export const unrankedWord = (x: Pick<Row, 'rank' | 'scoring'>): string | null => x.rank != null ? null
  : x.scoring ? 'Scoring' : 'Unranked'

export const fromBoard = (resonatorId: string, total: number, row: BoardRow): Listed => ({
  buildId: row.buildId, resonatorId, rank: row.rank, total, uid: row.uid, name: row.name, region: row.region, anonymous: row.anonymous,
  sequence: row.sequence, score: row.score, damage: row.damage, scenario: row.scenario, stats: row.stats ?? null, sets: row.sets ?? [], dpr: row.dpr ?? null, at: row.drawnAt, look: row.look ?? null,
})

export const fromPlayer = (profile: PlayerProfileResponse, build: PlayerBuild): Row => ({
  buildId: build.buildId, resonatorId: build.resonatorId, rank: build.rank, total: build.total, uid: profile.uid, name: profile.name,
  region: profile.region, sequence: build.sequence, score: build.score, damage: build.damage, scenario: build.scenario,
  stats: build.stats ?? null, sets: build.sets ?? [], dpr: build.dpr ?? null, at: build.drawnAt,
  weaponId: build.weaponId, scoring: build.scoring, hidden: build.hidden,
})

/** every upload lists as a build; one off its board (scoring, or no team can score it) is unranked. */
export const fromActivity = (row: ActivityRow): Row => ({
  buildId: row.buildId, resonatorId: row.resonatorId, rank: row.score != null ? row.rank : null,
  total: row.total ?? 0, uid: row.uid, name: row.name, region: row.region, anonymous: row.anonymous, sequence: row.sequence ?? 0,
  score: row.score, damage: row.damage, scenario: row.scenario, stats: row.stats ?? null, sets: row.sets ?? [], dpr: row.dpr ?? null,
  at: row.at, weaponId: row.weaponId, scoring: row.scoring, look: row.look ?? null,
})

/** one hue per sequence, S1 to S6, with S0 (the standard) in plain text colour. hues distinguish sequences without
    ranking them: the css draws every hue at one lightness and chroma, the hues are far apart, and the order is
    shuffled to avoid a ramp. */
export const SEQ_HUE: Array<number | null> = [null, 60, 310, 145, 15, 265, 100]

/** text colour per server, keyed by the uid's first digit. */
export const SERVER_INK: Record<string, string> = { 5: '#d9822b', 6: '#5865f2', 7: '#c2457a', 8: '#2f9e8f', 9: '#8a63d2' }

/** the share of a board at or above a rank as "top x%" shows it: "24", "4.2", "0.37", "0.004". rounded up, so a
    top 24% build never shows 23; smaller shares keep more decimals, up to three, with trailing zeros dropped and a
    floor of 0.001. */
export function share(rank: number, of: number): string {
  const p = rank / Math.max(1, of) * 100
  const places = p >= 10 ? 0 : p >= 1 ? 1 : p >= .1 ? 2 : 3
  const k = 10 ** places
  // the epsilon keeps exact shares (25 of 100) from rounding up a step on float noise
  return String(Math.max(1, Math.ceil(p * k - 1e-9)) / k)
}

/** "Top 24%" for one share, "Top 24–25%" for a run of ranks. */
export function shareSpan(a: number, b: number, of: number): string {
  const x = share(a, of), y = share(b, of)
  return x === y ? `Top ${x}%` : `Top ${x}–${y}%`
}

export const entries = (n: number) => n === 1 ? '1 entry' : `${n.toLocaleString('en-US')} entries`
export const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`
export const hm = (at: number) => new Date(at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
export const dayLabel = (at: number) => new Date(at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
export const dayKey = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }

export function agoLong(at: number, now = Date.now()): string {
  const m = Math.round((now - at) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

export const fmtUid = (uid: string) => uid.replace(/(\d{3})(?=\d)/g, '$1 ')
export const teammates = (x: { resonatorId: string; scenario: ScenarioSummary }) => x.scenario.members.filter((id) => id !== x.resonatorId)

export const LB = APP_ROUTES.leaderboard
export const boardPath = (resonatorId: string) => `${LB}/${resonatorId}`

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const eio = (t: number) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
export const eout = (t: number) => 1 - (1 - t) ** 3

/** the app's scroll container (main content scrolls, the window does not). */
export const scroller = (): HTMLElement | null => document.querySelector('.main-content')
export const reduced = () => document.documentElement.classList.contains('reduce-animation') || document.documentElement.classList.contains('no-entrance-anim')
