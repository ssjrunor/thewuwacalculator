/*
  Author: Runor Ewhro
  description: one resonator's board: builds, their scores per cell, the jobs scoring them, the entries that rank
               them, and the counts ranks are read from. every write is one SQLite transaction, and the ops D1 needs
               (a player's standing, an upload, the board's top, a notice) are written to the outbox in that
               transaction and sent after it. every stored build is scored; the best on the live ruleset is the
               active, listed one; owner-hidden builds do not compete; a job's best cell is chosen once (score, then
               damage, then scenario id). entries exist only for listed builds (active, not hidden, player listed, job
               scored with a best cell) on every ruleset they are scored on, and depend only on the build's scores and
               the seq+region key stored on its job, so a build is unlisted before either changes and relisted after
               (relist).
*/

import { BUCKET_SHIFT, BUCKETS, bucketOf, fromQ, Q_OFFSET, toQ } from '../lib/score.ts'
import { formatBuildId, SEED_LOCAL_FLOOR, toGbid } from '../lib/ids.ts'
import { ensureSchema, rulesetTables, dropRulesetTables } from './schema.ts'
import { nsOf, RankIndex, srOf } from './rank.ts'
import type { SqlLike } from './sql.ts'
import { page } from './reads.ts'
import { toBase64 } from '../scorer/messages.ts'
import { emptyScores, readScore, readScores, scoredCells, writeScore, type PackedScore } from './scorePack.ts'
import { unpackSnapshot } from '../lib/snapshotPack.ts'
import { canonicalJson } from '@lb/contract/canonical'
import type { BuildSnapshot } from '@lb/contract/snapshot'
import { snapshotProgramKey } from '@lb/contract/programKey'
import type {
  CellDef, CellResult, GroupOrder, JobOrder, Lane, OldCell, OutboxOp, PlaceInput, PlaceResult, Placement, PlayerFacts, RecordAck, RecordResult,
  HeadRow, RescoreRequest, ReuseOffer, RulesetInstall, SeedInput, SeedPlaced, SeedPurged,
} from './types.ts'

// build states; every kept build is active, ranked and shown as itself
export const STATE = { active: 0, deleted: 2, hidden: 3 } as const
export const JOB = { scoring: 0, scored: 1, failed: 2 } as const
export const CELL_STATUS = { ok: 0, unsupported: 1, error: 2 } as const
const PLAYER_FLAG = { hideUid: 1, masked: 2, unlisted: 4 } as const
const RULESET = { rolling: 0, live: 1, archived: 2, cancelled: 3 } as const

export interface CellInfo extends CellDef {
  teamFacet: number
  weaponFacet: number
  cellFacet: number
}

export interface RulesetInfo {
  rs: number
  id: string
  state: number
  // a rolling ruleset's: the one its fan-out offers old scores from, or null
  reuseFrom: number | null
  cells: Map<number, CellInfo>
  // facet per team key and per weapon id, and the cell a team and weapon pick together
  teams: Map<string, number>
  weapons: Map<number, number>
  pairs: Map<string, CellInfo>
}

export interface BuildRow {
  id: number
  uid: number
  seq: number
  state: number
  owner_hidden_at: number | null
  card: string
  snap_h: string
  snap: Uint8Array
  card_stats: Uint8Array | null
  drawn_at: number
  created_at: number
  last_seen_at: number
  ended_at: number | null
  scored_at: number | null
  upload_sent: number | null
}

export interface JobRow {
  build: number
  gen: number
  expected: number
  done: number
  status: number
  best_cell: number | null
  best_q: number | null
  lane: number
  created_at: number
  progress_at: number
  sent_at: number | null
  finished_at: number | null
  resumes: number
  detail_at: number | null
  listed_sr: number | null
  detail_from: number | null
}

export interface PlayerRow {
  uid: number
  name: string | null
  region: number | null
  flags: number
  ver: number
  sent: number | null
}

export interface ScoreRow {
  cell: number
  status: number
  q: number | null
  damage: number | null
  dpr: number | null
  flags: number
  reason: number | null
}

// one entry of a listed build: its value on a facet and the source cell
export interface FacetEntry {
  facet: number
  q: number
  cell: number
}

const STATUS_CODE: Record<CellResult['status'], number> = { ok: 0, unsupported: 1, error: 2 }
// the kinds of score health tallies (x<rs>)
const DEFECT = { error: 0, overPerfect: 1 } as const
// SCORE_FLAGS.overPerfect (scorer/job.ts), not imported by the board; tests/board/explain.test.ts checks that they
// match
export const OVER_PERFECT = 2
// a score taken lean (scorer/job.ts SCORE_FLAGS.lean): its breakdown comes from a later fill
export const LEAN = 4

// a build's scores while one recordScores call takes its cells: written once, at the end
interface Recording {
  rs: number
  local: number
  cells: Uint8Array
  counted: number
  // the ruleset whose detail object the job reads (a kept result's detailFrom), null for the job's own object,
  // undefined when the results did not report it
  detailFrom?: number | null
}

// how many slots a ruleset's score blob has: one per cell number
const slotsOf = (info: RulesetInfo) => Math.max(0, ...info.cells.keys()) + 1
// how long the scenario costs a bulk order is sorted by stay in memory
const COSTS_MS = 10 * 60_000
// window of the timings behind the costs (the timings table stores 14 days)
const COSTS_WINDOW_MS = 14 * 24 * 3600_000
// most recent timings averaged for costs; a full rollout writes millions in the window, and a recent sample is
// accurate enough
const COSTS_SAMPLE = 50_000
const LANE_CODE: Record<Lane, number> = { interactive: 0, bulk: 1 }
// builds staged per range while the entries are rebuilt
const REBUILD_BUILDS = 20_000
// entry rows staged per statement; about 35 json characters each, so a chunk stays well under 1 MB
const STAGE_ROWS = 20_000
// staged entries one rebuild step copies into the new entries table, in rank order, with their counts
const SORT_ROWS = 20_000

// the paced walks over a board's builds (store.walks)
export const WALKS = ['rescore', 'fill'] as const
export type Walk = typeof WALKS[number]

// maximum builds per group message; about 300 B each, well under the queue's 128 KB message limit
export const GROUP_MAX = 200
// cpu budget per group; a scorer batch runs two, within the scorer's 300 s cpu limit even at twice the estimate
// (a worker cannot time itself out because its clock moves only on i/o)
export const GROUP_BUDGET_MS = 60_000
// a build's cost in a group before the cell has bulk timings, about the p95 of a cell scored alone
const GROUP_BUILD_MS = 1_500
// how long staged cells wait for more builds with their program before a smaller group is sent
export const GROUP_WAIT_MS = 5_000
// groups cut in one call, so one alarm's send stays small
const GROUPS_PER_CUT = 100
// open bulk jobs per ruleset fan-out; the walk admits more builds as these finish, which limits the queue to a few
// minutes of this board's work so waiting jobs never read as stalled
export const OPEN_BULK_JOBS = 2_000
// seeded builds carried over per rollout walk slice (fanOutSlice): copied rows with no open job
export const SEED_CARRY_SLICE = 2_000
// how long scoring timings are kept (cellCosts and /admin/timings read the last 14 days)
const TIMINGS_KEEP_MS = 14 * 24 * 3600_000

// a rebuild of the entries in progress (rebuildEntries): the ruleset being written, its phase, where its stage
// continues (a build local, null once every range is staged), the facets it has still to sort, the last (ns, build)
// of the first of those already copied (null before its first slice), and the rulesets after it
interface EntriesRebuild { rs: number; phase: 'stage' | 'sort'; from: number | null; facets: number[]; at?: [number, number] | null
  rest: number[] }

// an entry's count bucket in sql, from its ns (-q), as score.ts bucketOf has it
const bucketSql = (ns: string) =>
  `MAX(0, MIN(${BUCKETS - 1}, CASE WHEN ${Q_OFFSET} - ${ns} >= 0 THEN (${Q_OFFSET} - ${ns}) / ${1 << BUCKET_SHIFT} ELSE 0 END))`
export const laneName = (code: number): Lane => (code === 1 ? 'bulk' : 'interactive')

// a cell row's order as the best of a set: higher score, then higher damage, then the lower scenario id
function better(a: { q: number; damage: number; key: string }, b: { q: number; damage: number; key: string }): boolean {
  return a.q > b.q || (a.q === b.q && (a.damage > b.damage || (a.damage === b.damage && a.key < b.key)))
}

// a 53-bit hash of a text (cyrb53), stored per sent op to detect whether the next one differs
export function hash53(text: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

// a player's region key: their server (1-5 for digits 5-9) unless they hide their uid without being masked
export function regionKey(player: Pick<PlayerRow, 'region' | 'flags'> | null): number {
  if (!player) return 0
  if (player.flags & PLAYER_FLAG.hideUid && !(player.flags & PLAYER_FLAG.masked)) return 0
  return player.region != null && player.region >= 5 && player.region <= 9 ? player.region - 4 : 0
}

// whether a build shows on the boards and in the activity feed: kept, not hidden by its owner, its player listed
export const shownBuild = (state: number, ownerHiddenAt: number | null, playerFlags: number) =>
  state === STATE.active && ownerHiddenAt == null && !(playerFlags & PLAYER_FLAG.unlisted)

const flagsOf = (facts: PlayerFacts) =>
  (facts.hideUid ? PLAYER_FLAG.hideUid : 0) | (facts.masked ? PLAYER_FLAG.masked : 0) | (facts.unlisted ? PLAYER_FLAG.unlisted : 0)

// what one write touched, for the outbox ops it owes at the end
interface WriteScope {
  uids: Set<number>
  uploads: Set<number>
}

// what scoring reads of a build: scenarios max the resonator's level, its skills and the weapon's level, so those are
// left out
const scoredKey = (snapshot: BuildSnapshot): string => canonicalJson({ resonator: snapshot.resonator.id,
  sequence: snapshot.resonator.sequence, weapon: snapshot.weapon.id, echoes: [...snapshot.echoes].sort((a, b) => a.slot - b.slot) })

export class BoardStore {
  readonly sql: SqlLike
  readonly resonator: number
  private rulesets = new Map<number, RulesetInfo>()
  private ranks = new Map<number, RankIndex>()
  private live: number | null = null
  private reasons = new Map<string, number>()
  private scope: WriteScope | null = null
  private costs: { at: number; byKey: Map<string, number> } | null = null
  private groupCostCache: { at: number; byKey: Map<string, number> } | null = null

  constructor(sql: SqlLike, resonator: number) {
    this.sql = sql
    this.resonator = resonator
    ensureSchema(sql)
    this.load()
  }

  // memory

  private load(): void {
    this.rulesets.clear()
    this.ranks.clear()
    this.reasons.clear()
    this.live = null
    const stored = this.meta<number>('resonator')
    if (stored == null) this.setMeta('resonator', this.resonator)
    else if (stored !== this.resonator) throw new Error(`board: this storage is resonator ${stored}'s, not ${this.resonator}'s`)
    for (const row of this.sql.all<{ rs: number; id: string; state: number; reuse_from: number | null }>(
      `SELECT rs, id, state, reuse_from FROM rulesets WHERE state IN (${RULESET.rolling}, ${RULESET.live})`)) {
      const cells = this.sql.all<{ cell: number; key: string; team_id: string; team_key: string; team_rank: number; weapon_id: number
        weapon_rank: number; weapon_role: string; members: string; team_facet: number; weapon_facet: number; cell_facet: number; reuse: number }>(
        `SELECT * FROM cells WHERE rs = ? ORDER BY cell`, row.rs).map((cell): CellInfo => ({
        cell: cell.cell, key: cell.key, teamId: cell.team_id, teamKey: cell.team_key, teamRank: cell.team_rank,
        weaponId: cell.weapon_id, weaponRank: cell.weapon_rank, weaponRole: cell.weapon_role, members: JSON.parse(cell.members),
        reuse: cell.reuse === 2 ? 'program' : cell.reuse !== 0, teamFacet: cell.team_facet, weaponFacet: cell.weapon_facet, cellFacet: cell.cell_facet,
      }))
      this.rulesets.set(row.rs, infoOf(row.rs, row.id, row.state, row.reuse_from, cells))
      this.ranks.set(row.rs, new RankIndex(this.sql, row.rs))
      if (row.state === RULESET.live) this.live = row.rs
    }
    for (const row of this.sql.all<{ code: number; text: string }>(`SELECT code, text FROM reasons`)) this.reasons.set(row.text, row.code)
  }

  meta<T>(key: string): T | null {
    return (this.sql.first<{ v: T }>(`SELECT v FROM meta WHERE k = ?`, key)?.v ?? null) as T | null
  }

  private setMeta(key: string, value: number | string | null): void {
    this.sql.run(`INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, key, value)
  }

  // the board's version: every write increments it, and caches key on it
  get ver(): number {
    return this.meta<number>('ver') ?? 0
  }

  get liveRs(): number | null {
    return this.live
  }

  ruleset(rs: number): RulesetInfo | undefined {
    return this.rulesets.get(rs)
  }

  rulesetById(id: string): RulesetInfo | undefined {
    for (const info of this.rulesets.values()) if (info.id === id) return info
    return undefined
  }

  // rulesets builds are scored and listed on: the live one and any rolling ruleset
  activeRulesets(): RulesetInfo[] {
    return [...this.rulesets.values()]
  }

  rank(rs: number): RankIndex {
    const index = this.ranks.get(rs)
    if (!index) throw new Error(`board: ruleset ${rs} is not on this board`)
    return index
  }

  gbid(local: number): number {
    return toGbid({ resonator: this.resonator, local })
  }

  publicId(local: number): string {
    return formatBuildId({ resonator: this.resonator, local })
  }

  // runs one write: a transaction, its outbox ops and the version bump; memory is restored on rollback
  write<T>(work: () => T): T {
    if (this.scope) return work()
    try {
      return this.sql.transaction(() => {
        this.scope = { uids: new Set(), uploads: new Set() }
        const result = work()
        this.settle()
        this.setMeta('ver', this.ver + 1)
        return result
      })
    } catch (error) {
      this.load()
      this.rebuildCache = undefined
      throw error
    } finally {
      this.scope = null
    }
  }

  // bookkeeping that needs no outbox or version bump: its own transaction, or the write it is called inside

  private atomic<T>(work: () => T): T {
    return this.scope ? work() : this.sql.transaction(work)
  }

  private push(op: OutboxOp): void {
    this.sql.run(`INSERT INTO outbox (op) VALUES (?)`, JSON.stringify(op))
  }

  private event(build: number, kind: string, actor: string | null, data: unknown, now: number): void {
    this.sql.run(`INSERT INTO events (build, at, kind, actor, data) VALUES (?, ?, ?, ?, ?)`, build, now, kind, actor,
      data == null ? null : JSON.stringify(data))
  }

  private reasonCode(text: string | null): number | null {
    if (text == null) return null
    let code = this.reasons.get(text)
    if (code !== undefined) return code
    this.sql.run(`INSERT OR IGNORE INTO reasons (text) VALUES (?)`, text)
    code = this.sql.first<{ code: number }>(`SELECT code FROM reasons WHERE text = ?`, text)!.code
    this.reasons.set(text, code)
    return code
  }

  reasonText(code: number | null): string | null {
    if (code == null) return null
    for (const [text, value] of this.reasons) if (value === code) return text
    const row = this.sql.first<{ text: string }>(`SELECT text FROM reasons WHERE code = ?`, code)
    return row?.text ?? null
  }

  // rows

  build(local: number): BuildRow | null {
    return this.sql.first<BuildRow>(`SELECT * FROM builds WHERE id = ?`, local)
  }

  player(uid: number): PlayerRow | null {
    return this.sql.first<PlayerRow>(`SELECT * FROM players WHERE uid = ?`, uid)
  }

  job(rs: number, local: number): JobRow | null {
    if (!this.rulesets.has(rs)) return null
    return this.sql.first<JobRow>(`SELECT * FROM j${rs} WHERE build = ?`, local)
  }

  // a build's scores on a ruleset, by cell
  scores(rs: number, local: number): ScoreRow[] {
    return readScores(this.scoreBlob(rs, local))
  }

  // one cell's score, or null
  scoreOf(rs: number, local: number, cell: number): ScoreRow | null {
    const cells = this.scoreBlob(rs, local)
    return cells ? readScore(cells, cell) : null
  }

  // detail fills

  // the lean (build, cell) pairs among these, with their job generation and snapshot, for a fill to rescore with a
  // breakdown; seeded builds share the board's template detail and are skipped
  leanCells(rs: number, pairs: ReadonlyArray<{ local: number; cell: number }>): Array<{ local: number; cell: number; gen: number; snap: Uint8Array }> {
    const info = this.rulesets.get(rs)
    if (!info) return []
    const out: Array<{ local: number; cell: number; gen: number; snap: Uint8Array }> = []
    for (const { local, cell } of pairs) {
      if (local >= SEED_LOCAL_FLOOR || !info.cells.has(cell)) continue
      const score = this.scoreOf(rs, local, cell)
      if (!score || !(score.flags & LEAN)) continue
      const job = this.job(rs, local)
      const build = job ? this.build(local) : null
      if (job && build) out.push({ local, cell, gen: job.gen, snap: build.snap })
    }
    return out
  }

  // where a fill's breakdown goes: the job's staged detail while its object is unwritten ('staged'), else its R2
  // object ('object'); null when the fill is stale (a newer score, or a cell that is not lean)
  fillTarget(rs: number, local: number, gen: number, cell: number): 'staged' | 'object' | null {
    const job = this.job(rs, local)
    if (!job || job.gen !== gen) return null
    const score = this.scoreOf(rs, local, cell)
    if (!score || !(score.flags & LEAN)) return null
    const staged = job.detail_at == null && this.sql.first(`SELECT 1 AS x FROM d${rs} WHERE build = ? AND cell = ?`, local, cell) != null
    return staged ? 'staged' : 'object'
  }

  // a fill landed: the cell's breakdown replaces its staged body (`body`), or is already in its R2 object (no body);
  // the score is marked not lean, and cached build pages read again (the write bumps the version)
  filled(rs: number, local: number, gen: number, cell: number, body?: string): boolean {
    return this.write(() => {
      if (this.fillTarget(rs, local, gen, cell) == null) return false
      if (body != null) this.sql.run(`UPDATE d${rs} SET body = ? WHERE build = ? AND cell = ?`, body, local, cell)
      const cells = this.scoreBlob(rs, local)!
      const score = readScore(cells, cell)!
      this.sql.run(`INSERT INTO s${rs} (build, cells) VALUES (?, ?) ON CONFLICT (build) DO UPDATE SET cells = excluded.cells`,
        local, writeScore(cells, { ...score, flags: score.flags & ~LEAN }))
      return true
    })
  }

  // up to `per` random ok scores per named cell from active builds with finished jobs (a sample check's draw), each
  // with its build's packed snapshot; `eligible` counts the source builds. builds are found by probing random ids
  // without walking the board, and each build gives one cell that still needs samples
  sampleScores(rs: number, cells: number[], per: number): { eligible: number; rows: Array<{ local: number; key: string; snap: string }> } {
    const info = this.rulesets.get(rs)!
    const eligible = this.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM j${rs} WHERE status = ?`, JOB.scored)!.n
    const span = this.sql.first<{ lo: number | null; hi: number | null }>(`SELECT MIN(build) AS lo, MAX(build) AS hi FROM j${rs}`)!
    const rows: Array<{ local: number; key: string; snap: string }> = []
    if (span.lo == null || span.hi == null || !eligible || per <= 0 || !cells.length) return { eligible, rows }
    const wanted = new Map(cells.map((cell) => [cell, per]))
    const seen = new Set<number>()
    for (let probe = 0; probe < cells.length * per * 8 && wanted.size; probe += 1) {
      const from = span.lo + Math.floor(Math.random() * (span.hi - span.lo + 1))
      const hit = this.sql.first<{ build: number; snap: Uint8Array }>(`SELECT j.build, b.snap FROM j${rs} j JOIN builds b ON b.id = j.build
        WHERE j.build >= ? AND +j.status = ? AND b.state = ? ORDER BY j.build LIMIT 1`, from, JOB.scored, STATE.active)
      if (!hit || seen.has(hit.build)) continue
      seen.add(hit.build)
      const scores = this.scoreBlob(rs, hit.build)
      const ok = scores ? [...wanted.keys()].filter((cell) => readScore(scores, cell)?.status === CELL_STATUS.ok) : []
      if (!ok.length) continue
      const cell = ok[Math.floor(Math.random() * ok.length)]
      rows.push({ local: hit.build, key: info.cells.get(cell)!.key, snap: toBase64(hit.snap) })
      const left = wanted.get(cell)! - 1
      if (left) wanted.set(cell, left)
      else wanted.delete(cell)
    }
    return { eligible, rows }
  }

  // a build's packed scores on a ruleset (scorePack.ts), or null before any cell is in
  scoreBlob(rs: number, local: number): Uint8Array | null {
    return this.sql.first<{ cells: Uint8Array }>(`SELECT cells FROM s${rs} WHERE build = ?`, local)?.cells ?? null
  }

  // rulesets

  // installs a ruleset on the board: its tables and cells, numbered into facets; an installed ruleset is left
  // unchanged
  installRuleset(def: RulesetInstall, now: number, { live = false }: { live?: boolean } = {}): RulesetInfo {
    return this.write(() => {
      const found = this.rulesets.get(def.rs)
      if (found) return found
      if (this.sql.first(`SELECT 1 FROM rulesets WHERE rs = ? OR id = ?`, def.rs, def.id)) {
        throw new Error(`board: ruleset ${def.id} (${def.rs}) was here before and ended; it does not come back`)
      }
      for (const statement of rulesetTables(def.rs)) this.sql.run(statement)
      const cells = numberFacets(def.cells)
      for (const cell of cells) {
        this.sql.run(`INSERT INTO cells (rs, cell, key, team_id, team_key, team_rank, weapon_id, weapon_rank, weapon_role, members,
          team_facet, weapon_facet, cell_facet, reuse) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, def.rs, cell.cell, cell.key, cell.teamId,
        cell.teamKey, cell.teamRank, cell.weaponId, cell.weaponRank, cell.weaponRole, JSON.stringify(cell.members), cell.teamFacet,
        cell.weaponFacet, cell.cellFacet, cell.reuse === false ? 0 : cell.reuse === 'program' ? 2 : 1)
      }
      const state = live && this.live == null ? RULESET.live : RULESET.rolling
      const reuseFrom = state === RULESET.rolling ? def.reuseFrom ?? null : null
      this.sql.run(`INSERT INTO rulesets (rs, id, state, installed_at, live_at, reuse_from) VALUES (?, ?, ?, ?, ?, ?)`, def.rs, def.id, state, now,
        state === RULESET.live ? now : null, reuseFrom)
      const info = infoOf(def.rs, def.id, state, reuseFrom, cells)
      this.rulesets.set(def.rs, info)
      this.ranks.set(def.rs, new RankIndex(this.sql, def.rs))
      if (state === RULESET.live) this.live = def.rs
      // a rollout's entries are written once when its walk is done (endDeferrals) for every build at once
      else this.setMeta('entries_deferred', JSON.stringify([...this.deferredRulesets(), def.rs]))
      return info
    })
  }

  // makes a rolling ruleset live (its entries are written once its walk finishes) and drops the old ruleset's
  // tables. entries not yet written (the rollout waits for them in rulesetSettled) are written by the bounded
  // rebuild across alarms
  goLive(rs: number, now: number): void {
    this.write(() => {
      const info = this.rulesets.get(rs)
      if (!info) throw new Error(`board: ruleset ${rs} is not on this board`)
      if (info.state === RULESET.live) return
      if (this.isDeferred(rs)) this.endDeferral([rs])
      const old = this.live
      this.sql.run(`UPDATE rulesets SET state = ?, live_at = ? WHERE rs = ?`, RULESET.live, now, rs)
      info.state = RULESET.live
      this.live = rs
      if (old != null) this.retire(old, RULESET.archived, now)
      // players' best builds are read on the live ruleset: every standing is rechecked, a slice of players per alarm
      // (standingsSlice), and only changed standings are sent
      this.setMeta('standings_from', 0)
    })
  }

  // whether the live ruleset's tables can be carried to a ruleset with these cells unchanged: the same cells in the
  // same facets (api/moderation/carry.ts compares their scores)
  carries(cells: CellDef[]): boolean {
    const info = this.live == null ? undefined : this.rulesets.get(this.live)
    if (!info) return false
    const next = numberFacets(cells)
    return next.length === info.cells.size && next.every((cell) => {
      const was = info.cells.get(cell.cell)
      return !!was && was.key === cell.key && was.teamId === cell.teamId && was.teamKey === cell.teamKey && was.teamRank === cell.teamRank
        && was.weaponId === cell.weaponId && was.weaponRank === cell.weaponRank && was.weaponRole === cell.weaponRole
        && JSON.stringify(was.members) === JSON.stringify(cell.members)
        && was.teamFacet === cell.teamFacet && was.weaponFacet === cell.weaponFacet && was.cellFacet === cell.cellFacet
    })
  }

  // whether a carry can run now: no entries rebuild is pending or in progress (its state names the rulesets it walks)
  carryReady(): boolean {
    return !this.entriesStale() && this.rebuildJob() == null && !this.unlistedRulesets().length
  }

  // makes a ruleset live by renaming the live ruleset's tables to it, for a board the rollout carries over: no build
  // row is written again except its job's detail_from, which reads the old ruleset's detail object. the
  // indexes are made again under the new number, the cells and timings move with it, and the old ruleset is archived
  // with nothing to drop or purge (the new jobs read its objects; they are deleted when the new ruleset ends)
  carryLive(def: RulesetInstall, now: number): RulesetInfo {
    return this.write(() => {
      const from = this.live
      if (from == null || this.rulesets.has(def.rs) || !this.carries(def.cells) || !this.carryReady()) {
        throw new Error(`board: ruleset ${def.id} cannot be carried from the live ruleset here`)
      }
      if (this.sql.first(`SELECT 1 FROM rulesets WHERE rs = ? OR id = ?`, def.rs, def.id)) {
        throw new Error(`board: ruleset ${def.id} (${def.rs}) was here before and ended; it does not come back`)
      }
      const named = (rs: number) => dropRulesetTables(rs).map((statement) => statement.slice('DROP TABLE IF EXISTS '.length))
      const tables = named(from)
      const renamed = named(def.rs)
      const held = new Set(this.sql.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((row) => row.name))
      // named indexes are dropped with their old names; rulesetTables creates the ones every ruleset has under the
      // new number
      for (const index of this.sql.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL
        AND tbl_name IN (SELECT value FROM json_each(?))`, JSON.stringify(tables))) this.sql.run(`DROP INDEX ${index.name}`)
      tables.forEach((table, index) => { if (held.has(table)) this.sql.run(`ALTER TABLE ${table} RENAME TO ${renamed[index]}`) })
      for (const statement of rulesetTables(def.rs)) this.sql.run(statement)
      this.sql.run(`UPDATE j${def.rs} SET detail_from = ? WHERE detail_from IS NULL AND detail_at IS NOT NULL`, from)
      this.sql.run(`UPDATE cells SET rs = ? WHERE rs = ?`, def.rs, from)
      this.sql.run(`UPDATE timings SET rs = ? WHERE rs = ?`, def.rs, from)
      this.sql.run(`UPDATE rulesets SET state = ?, ended_at = ? WHERE rs = ?`, RULESET.archived, now, from)
      this.sql.run(`INSERT INTO rulesets (rs, id, state, installed_at, live_at, reuse_from) VALUES (?, ?, ?, ?, ?, NULL)`,
        def.rs, def.id, RULESET.live, now, now)
      // walks in progress continue under the new number
      for (const kind of WALKS) {
        const walks = JSON.parse(this.meta<string>(`${kind}_walk`) ?? '{}') as Record<number, number>
        if (walks[from] == null) continue
        walks[def.rs] = walks[from]
        delete walks[from]
        this.setMeta(`${kind}_walk`, JSON.stringify(walks))
      }
      const cells = [...this.rulesets.get(from)!.cells.values()]
      const info = infoOf(def.rs, def.id, RULESET.live, null, cells)
      this.rulesets.delete(from)
      this.ranks.delete(from)
      this.rulesets.set(def.rs, info)
      this.ranks.set(def.rs, new RankIndex(this.sql, def.rs))
      this.live = def.rs
      return info
    })
  }

  // drops the tables of a rolling ruleset that will not go live
  cancelRuleset(rs: number, now: number): void {
    this.write(() => {
      const info = this.rulesets.get(rs)
      if (!info || info.state !== RULESET.rolling) return
      this.retire(rs, RULESET.cancelled, now)
    })
  }

  private retire(rs: number, state: number, now: number): void {
    // the earlier rulesets whose objects its jobs read: with this one gone, some of those may have no readers
    const origins = this.sql.all<{ rs: number }>(`SELECT DISTINCT detail_from AS rs FROM j${rs} WHERE detail_from IS NOT NULL`)
    for (const statement of dropRulesetTables(rs)) this.sql.run(statement)
    this.sql.run(`UPDATE rulesets SET state = ?, ended_at = ? WHERE rs = ?`, state, now, rs)
    // its detail objects in R2 are deleted too, a slice per alarm (BoardDO.purgeDetail), except those a later job
    // still reads
    this.queueDetailPurge(this.rulesets.get(rs)!.id)
    for (const origin of origins) if (!this.rulesets.has(origin.rs)) this.queueDetailPurge(this.rulesetIdOf(origin.rs))
    this.rulesets.delete(rs)
    this.ranks.delete(rs)
    if (this.live === rs) this.live = null
  }

  // players

  // applies D1's player row when it is newer than the copy here, and relists their builds when it changes their
  // listing
  syncPlayer(facts: PlayerFacts): void {
    this.write(() => this.upsertPlayer(facts))
  }

  private upsertPlayer(facts: PlayerFacts): void {
    const before = this.player(facts.uid)
    if (before && before.ver >= facts.ver) return
    const flags = flagsOf(facts)
    this.sql.run(`INSERT INTO players (uid, name, region, flags, ver) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (uid) DO UPDATE SET name = excluded.name, region = excluded.region, flags = excluded.flags, ver = excluded.ver`,
    facts.uid, facts.name, facts.region, flags, facts.ver)
    if (!before) return
    const moved = before.flags !== flags || regionKey(before) !== regionKey({ region: facts.region, flags })
    if (!moved) return
    for (const { id } of this.sql.all<{ id: number }>(`SELECT id FROM builds WHERE uid = ? AND +state = 0`, facts.uid)) this.relist(id)
    this.scope!.uids.add(facts.uid)
  }

  // builds

  // the player's kept build that scores as this snapshot would, or null. a staff-hidden one does not match and is
  // stored as a new build
  private sameBuild(uid: number, snapHash: string, snapshot: BuildSnapshot): BuildRow | null {
    const exact = this.sql.first<BuildRow>(`SELECT * FROM builds WHERE uid = ? AND snap_h = ? AND state = ${STATE.active}
      ORDER BY id DESC LIMIT 1`, uid, snapHash)
    if (exact) return exact
    // a card that differs only in what scoring maxes (levels, skills) is the same build. a player keeps few builds
    // per board, so theirs are compared one by one
    const key = scoredKey(snapshot)
    for (const build of this.sql.all<BuildRow>(`SELECT * FROM builds WHERE uid = ? AND +state = ${STATE.active} ORDER BY id DESC`, uid)) {
      if (scoredKey(unpackSnapshot(build.snap)) === key) return build
    }
    return null
  }

  // stores a read build, or matches an already stored one, and returns the scoring it needs
  place(input: PlaceInput): PlaceResult {
    return this.write(() => {
      const { now } = input
      this.upsertPlayer(input.player)
      this.scope!.uids.add(input.uid)
      const actor = input.owner ? `uid:${input.uid}` : null
      const same = this.sameBuild(input.uid, input.snapHash, unpackSnapshot(input.snap))
      if (same) {
        // a re-read of the build's own card replaces what that card was read as (what scoring maxes, and the name)
        if (same.card === input.card && same.snap_h !== input.snapHash) {
          this.sql.run(`UPDATE builds SET snap = ?, snap_h = ? WHERE id = ?`, input.snap, input.snapHash, same.id)
          this.event(same.id, 'build.reread', null, { card: input.card }, now)
        }
        if (input.claimSetup) this.claimSetupBuild(same.id, actor, input.card, now)
        else this.sql.run(`UPDATE builds SET last_seen_at = ? WHERE id = ?`, now, same.id)
        const placement: Placement = input.claimSetup ? { local: same.id, active: true, repeated: false, claimed: true }
          : { local: same.id, active: true, repeated: true }
        return { placement, jobs: this.ensureJobs(same.id, 'interactive', now) }
      }
      // every build is ranked as itself and listed once its live job scores it
      const local = this.nextLocal()
      this.sql.run(`INSERT INTO builds (id, uid, seq, state, card, snap_h, snap, drawn_at, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, local, input.uid, input.seq, STATE.active, input.card, input.snapHash, input.snap,
      input.drawnAt, now, now)
      this.event(local, 'build.submit', actor, { card: input.card }, now)
      this.scope!.uploads.add(local)
      return { placement: { local, active: true, repeated: false }, jobs: this.ensureJobs(local, 'interactive', now) }
    })
  }

  // makes the card's sender the first uploader of a setup uid's build at this time, keeping its scores; false when
  // the build is not the uid's or was removed
  claimSetup(local: number, uid: number, card: string, now: number): boolean {
    return this.write(() => {
      const build = this.build(local)
      if (!build || build.uid !== uid || build.state !== STATE.active) return false
      this.scope!.uids.add(uid)
      this.claimSetupBuild(local, `uid:${uid}`, card, now)
      return true
    })
  }

  private claimSetupBuild(local: number, actor: string | null, card: string, now: number): void {
    this.sql.run(`UPDATE builds SET created_at = ?, last_seen_at = ? WHERE id = ?`, now, now, local)
    this.event(local, 'build.submit', actor, { card, setup: true }, now)
    this.scope!.uploads.add(local)
  }

  // a job generation unused on this board, so results for earlier jobs (restarted, or ended with their build) never
  // count toward later ones
  private nextGen(): number {
    const next = this.meta<number>('next_gen') ?? 1
    this.setMeta('next_gen', next + 1)
    return next
  }

  private nextLocal(): number {
    const next = this.meta<number>('next_local') ?? 1
    this.setMeta('next_local', next + 1)
    return next
  }

  // creates a job on every live or rolling ruleset without one for the build, and returns every unsent job's orders
  private ensureJobs(local: number, lane: Lane, now: number): JobOrder[] {
    const orders: JobOrder[] = []
    for (const info of this.rulesets.values()) {
      let job = this.job(info.rs, local)
      if (!job) {
        this.sql.run(`INSERT INTO j${info.rs} (build, gen, expected, done, status, lane, created_at, progress_at)
          VALUES (?, ?, ?, 0, 0, ?, ?, ?)`, local, this.nextGen(), info.cells.size, LANE_CODE[lane], now, now)
        job = this.job(info.rs, local)!
      }
      if (job.status === JOB.scoring && job.sent_at == null) orders.push(this.orderOf(info, job))
    }
    return orders
  }

  private orderOf(info: RulesetInfo, job: JobRow): JobOrder {
    const done = new Set(scoredCells(this.scoreBlob(info.rs, job.build)))
    let cells = [...info.cells.values()].filter((cell) => !done.has(cell.cell)).map((cell) => ({ cell: cell.cell, key: cell.key }))
    // bulk work sends its slowest scenarios first, so the longest cell is never last; new uploads keep team order, so
    // the best team scores first
    if (job.lane === LANE_CODE.bulk && cells.length > 1) {
      const costs = this.cellCosts()
      cells = cells.map((cell, index) => ({ cell, index, ms: costs.get(cell.key) ?? 0 }))
        .sort((a, b) => b.ms - a.ms || a.index - b.index).map((entry) => entry.cell)
    }
    return { rs: info.rs, rulesetId: info.id, local: job.build, gen: job.gen, lane: laneName(job.lane), cells }
  }

  // each scenario's mean scoring time on this board over the last two weeks, by key, shared across rulesets
  cellCosts(now = Date.now()): Map<string, number> {
    if (this.costs && now - this.costs.at < COSTS_MS) return this.costs.byKey
    this.costs = { at: now, byKey: this.meanCosts(now, null) }
    return this.costs.byKey
  }

  // each scenario's mean bulk-lane cost per build (a group's builds each record their share of it), by key
  groupCosts(now = Date.now()): Map<string, number> {
    if (this.groupCostCache && now - this.groupCostCache.at < COSTS_MS) return this.groupCostCache.byKey
    this.groupCostCache = { at: now, byKey: this.meanCosts(now, 'bulk') }
    return this.groupCostCache.byKey
  }

  // mean ms by scenario key over the latest COSTS_SAMPLE timings in the window (of one lane, or all)
  private meanCosts(now: number, lane: Lane | null): Map<string, number> {
    const rows = this.sql.all<{ key: string; ms: number }>(`SELECT c.key, AVG(t.ms) AS ms FROM (SELECT rs, cell, ms, lane FROM timings
      WHERE at >= ? ORDER BY at DESC LIMIT ?) t JOIN cells c ON c.rs = t.rs AND c.cell = t.cell
      ${lane ? 'WHERE t.lane = ?' : ''} GROUP BY c.key`, now - COSTS_WINDOW_MS, COSTS_SAMPLE, ...(lane ? [lane] : []))
    return new Map(rows.map((row) => [row.key, row.ms]))
  }

  // builds per group for a cell: what fits GROUP_BUDGET_MS at the cell's per-build cost, up to GROUP_MAX
  groupSize(key: string, now = Date.now()): number {
    const ms = this.groupCosts(now).get(key) ?? GROUP_BUILD_MS
    return Math.max(1, Math.min(GROUP_MAX, Math.floor(GROUP_BUDGET_MS / Math.max(1, ms))))
  }

  // the reuse offer of a rolling ruleset's fan-out: the build's scores on the source ruleset for scenarios both
  // score, from a finished job there, with error rows rescored. undefined when the rollout reuses nothing, the source
  // ruleset is gone, or the job has started
  private reuseOffer(info: RulesetInfo, job: JobRow): ReuseOffer | undefined {
    const from = info.reuseFrom == null || info.rs === this.live ? null : this.rulesets.get(info.reuseFrom)
    if (!from || job.done > 0 || job.resumes > 0) return undefined
    const old = this.job(from.rs, job.build)
    if (!old || old.status !== JOB.scored) return undefined
    // a cell its sample check found scoring differently is scored again without offering its old score
    const byKey = new Map([...info.cells.values()].map((cell) => [cell.key, cell.reuse ?? true]))
    const wanted = new Set([...byKey].filter(([, reuse]) => reuse !== false).map(([key]) => key))
    const stats = new Map(this.sql.all<{ weapon: number; stats: Uint8Array }>(`SELECT weapon, stats FROM w${from.rs} WHERE build = ?`, job.build)
      .map((row) => [row.weapon, row.stats]))
    const cells: OldCell[] = []
    for (const row of this.scores(from.rs, job.build)) {
      const cell = from.cells.get(row.cell)
      if (!cell || !wanted.has(cell.key) || row.status === CELL_STATUS.error) continue
      cells.push({ key: cell.key, status: row.status === CELL_STATUS.ok ? 'ok' : 'unsupported', score: row.q == null ? null : fromQ(row.q),
        damage: row.damage, dpr: row.dpr, flags: row.flags, reason: this.reasonText(row.reason), stats: stats.get(cell.weaponId) ?? null,
        ...(byKey.get(cell.key) === 'program' ? { program: true as const } : {}) })
    }
    // the old job's detail may itself be an earlier ruleset's object: the offer names it
    const detailId = old.detail_from != null ? this.rulesetIdOf(old.detail_from) : from.id
    return cells.length ? { from: from.rs, fromId: from.id, detailId, old: cells } : undefined
  }

  // an order with the reuse offer its job may still take
  private offered(info: RulesetInfo, job: JobRow): JobOrder {
    const order = this.orderOf(info, job)
    const reuse = this.reuseOffer(info, job)
    return reuse ? { ...order, reuse } : order
  }

  // the orders were handed to the queue
  markSent(orders: Array<Pick<JobOrder, 'rs' | 'local' | 'gen'>>, now: number): void {
    if (!orders.length) return
    this.write(() => {
      for (const order of orders) {
        if (!this.rulesets.has(order.rs)) continue
        this.sql.run(`UPDATE j${order.rs} SET sent_at = ? WHERE build = ? AND gen = ? AND status = 0`, now, order.local, order.gen)
      }
    })
  }

  // restarts a build's job on a ruleset (a rescore): its scores there are deleted with its entries
  restartJob(rs: number, local: number, lane: Lane, now: number): JobOrder | null {
    return this.write(() => {
      const info = this.rulesets.get(rs)
      const build = this.build(local)
      if (!info || !build || build.state !== STATE.active) return null
      this.unlist(rs, local)
      this.dropScores(rs, local)
      // an object it read from an ended ruleset may have no readers left: that ruleset's purge checks again
      const from = this.job(rs, local)?.detail_from
      if (from != null && !this.rulesets.has(from)) this.queueDetailPurge(this.rulesetIdOf(from))
      const gen = this.nextGen()
      this.sql.run(`INSERT INTO j${rs} (build, gen, expected, done, status, lane, created_at, progress_at)
        VALUES (?, ?, ?, 0, 0, ?, ?, ?) ON CONFLICT (build) DO UPDATE SET gen = excluded.gen, expected = excluded.expected, done = 0,
        status = 0, best_cell = NULL, best_q = NULL, lane = excluded.lane, created_at = excluded.created_at,
        progress_at = excluded.progress_at, sent_at = NULL, finished_at = NULL, resumes = 0, detail_at = NULL, listed_sr = NULL,
        detail_from = NULL`,
      local, gen, info.cells.size, LANE_CODE[lane], now, now)
      // its best player standing may change with the scores it lost
      if (rs === this.live) this.scope!.uids.add(build.uid)
      return this.orderOf(info, this.job(rs, local)!)
    })
  }

  private dropScores(rs: number, local: number): void {
    this.sql.run(`DELETE FROM s${rs} WHERE build = ?`, local)
    this.sql.run(`DELETE FROM x${rs} WHERE kind IN (${DEFECT.error}, ${DEFECT.overPerfect}) AND build = ?`, local)
    this.sql.run(`DELETE FROM w${rs} WHERE build = ?`, local)
    this.sql.run(`DELETE FROM d${rs} WHERE build = ?`, local)
    this.sql.run(`DELETE FROM n${rs} WHERE build = ?`, local)
  }

  // grouped bulk work

  // a build's program key hash (domain/leaderboard/programKey.ts): builds with equal ones are sent together
  private programKeyOf(local: number, cache: Map<number, number>): number {
    let key = cache.get(local)
    if (key === undefined) {
      const build = this.build(local)
      key = build ? hash53(snapshotProgramKey(unpackSnapshot(build.snap), true)) : 0
      cache.set(local, key)
    }
    return key
  }

  // stages bulk orders without a reuse offer for group messages (cutGroups) and marks their jobs sent; staged rows
  // are stored here, so a staged job counts as sent. the live ruleset's first cell of each also measures the card's
  // own stats
  stage(orders: JobOrder[], now: number): void {
    if (!orders.length) return
    this.write(() => {
      const keys = new Map<number, number>()
      for (const order of orders) {
        if (!this.rulesets.has(order.rs)) continue
        const pkey = this.programKeyOf(order.local, keys)
        order.cells.forEach((cell, index) => this.sql.run(`INSERT INTO n${order.rs} (cell, pkey, build, at, cs) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (cell, pkey, build) DO NOTHING`, cell.cell, pkey, order.local, now, index === 0 && order.rs === (this.liveRs ?? order.rs) ? 1 : 0))
        this.sql.run(`UPDATE j${order.rs} SET sent_at = ? WHERE build = ? AND gen = ? AND status = 0`, now, order.local, order.gen)
      }
    })
  }

  // stages the cells a reuse message did not keep with the rest of the bulk work
  private stageRescore(rescore: RescoreRequest[], now: number): void {
    const keys = new Map<number, number>()
    for (const request of rescore) {
      const info = this.rulesets.get(request.rs)
      const job = info && this.job(request.rs, request.local)
      if (!info || !job || job.status !== JOB.scoring || job.gen !== request.gen) continue
      const pkey = this.programKeyOf(request.local, keys)
      for (const cell of request.cells) {
        if (!info.cells.has(cell)) continue
        this.sql.run(`INSERT INTO n${request.rs} (cell, pkey, build, at, cs) VALUES (?, ?, ?, ?, 0) ON CONFLICT (cell, pkey, build) DO NOTHING`,
          cell, pkey, request.local, now)
      }
    }
  }

  // whether bulk cells wait to be sent, and when the oldest was staged
  stagedSince(): number | null {
    let oldest: number | null = null
    for (const rs of this.rulesets.keys()) {
      const row = this.sql.first<{ at: number | null }>(`SELECT MIN(at) AS at FROM n${rs}`)
      if (row?.at != null && (oldest == null || row.at < oldest)) oldest = row.at
    }
    return oldest
  }

  // cuts staged cells into group messages per ruleset, cell and program key, up to groupSize builds; a group is cut
  // when full or once its oldest cell has waited `wait` ms (every group with `flush`). builds whose job moved on
  // (finished, restarted) are dropped. rows are removed as they are cut, and a group lost after this is a stalled job
  // the sweep resumes
  cutGroups(now: number, wait = GROUP_WAIT_MS, flush = false): GroupOrder[] {
    return this.write(() => {
      const out: GroupOrder[] = []
      for (const info of this.rulesets.values()) {
        const size = new Map([...info.cells.values()].map((cell) => [cell.cell, this.groupSize(cell.key, now)]))
        const ready = this.sql.all<{ cell: number; pkey: number; n: number; first: number }>(`SELECT cell, pkey, COUNT(*) AS n, MIN(at) AS first
          FROM n${info.rs} GROUP BY cell, pkey`).filter((group) => flush || group.n >= (size.get(group.cell) ?? 1) || group.first <= now - wait)
          .sort((a, b) => b.n - a.n)
        for (const group of ready) {
          const most = size.get(group.cell) ?? 1
          let left = group.n
          while (left > 0 && out.length < GROUPS_PER_CUT) {
            const rows = this.sql.all<{ build: number; cs: number }>(`SELECT build, cs FROM n${info.rs} WHERE cell = ? AND pkey = ?
              ORDER BY build LIMIT ?`, group.cell, group.pkey, most)
            if (!rows.length) break
            // a partial remainder waits for more builds unless it is old enough or `flush` is set
            if (rows.length < most && !flush && group.first > now - wait) break
            const builds: GroupOrder['builds'] = []
            for (const row of rows) {
              this.sql.run(`DELETE FROM n${info.rs} WHERE cell = ? AND pkey = ? AND build = ?`, group.cell, group.pkey, row.build)
              const job = this.job(info.rs, row.build)
              if (job && job.status === JOB.scoring) builds.push({ local: row.build, gen: job.gen, cs: row.cs === 1 })
            }
            left -= rows.length
            const cell = info.cells.get(group.cell)
            if (cell && builds.length) out.push({ rs: info.rs, rulesetId: info.id, cell: group.cell, key: cell.key, builds })
          }
          if (out.length >= GROUPS_PER_CUT) return out
        }
      }
      return out
    })
  }

  // open bulk jobs of a ruleset (scoring), counted on j<rs>_status
  openBulkJobs(rs: number): number {
    return this.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM j${rs} WHERE status = 0`)?.n ?? 0
  }

  // prune timings older than the window cellCosts and /admin/timings read, a slice at a time
  pruneTimings(now: number, limit = 10_000): number {
    return this.write(() => {
      // delete by rowid, which caps each statement at the limit even for runs of equal times
      const before = now - TIMINGS_KEEP_MS
      const rows = this.sql.all<{ id: number }>(`SELECT rowid AS id FROM timings WHERE at < ? ORDER BY at LIMIT ?`, before, limit)
      if (!rows.length) return 0
      this.sql.run(`DELETE FROM timings WHERE rowid IN (SELECT value FROM json_each(?))`, JSON.stringify(rows.map((row) => row.id)))
      return rows.length
    })
  }

  // scores

  // records scored cells. a cell counts once per job generation; repeats and results for restarted jobs change
  // nothing, except an ok result replacing an earlier failure without counting again. a job finishes here when
  // every cell is in
  recordScores(results: CellResult[], now: number, rescore: RescoreRequest[] = []): RecordResult {
    return this.write(() => {
      const acks: RecordAck[] = []
      const touched = new Map<string, Recording>()
      for (const result of results) acks.push(this.recordOne(result, now, touched))
      // stage the cells a reuse message did not keep, and record the kept ones in the same write
      if (rescore.length) this.stageRescore(rescore, now)
      // each touched build's scores and job progress, written once however many of its cells came in
      for (const entry of touched.values()) {
        this.sql.run(`INSERT INTO s${entry.rs} (build, cells) VALUES (?, ?) ON CONFLICT (build) DO UPDATE SET cells = excluded.cells`,
          entry.local, entry.cells)
        this.sql.run(`UPDATE j${entry.rs} SET done = done + ?, progress_at = ? WHERE build = ?`, entry.counted, now, entry.local)
        if (entry.detailFrom !== undefined) this.sql.run(`UPDATE j${entry.rs} SET detail_from = ? WHERE build = ?`, entry.detailFrom, entry.local)
      }
      const finished: RecordResult['finished'] = []
      for (const { rs, local } of touched.values()) {
        const job = this.job(rs, local)
        if (job && job.status === JOB.scoring && job.done >= job.expected) {
          this.finalize(rs, local, now)
          finished.push({ rs, local, gen: job.gen })
        }
      }
      return { acks, finished }
    })
  }

  private recordOne(result: CellResult, now: number, touched: Map<string, Recording>): RecordAck {
    const info = this.rulesets.get(result.rs)
    if (!info || !info.cells.has(result.cell)) return 'stale'
    const job = this.job(result.rs, result.local)
    if (!job || job.status !== JOB.scoring || job.gen !== result.gen) return 'stale'
    const status = STATUS_CODE[result.status]
    const q = result.status === 'ok' && result.score != null ? toQ(result.score) : null
    const key = `${result.rs}:${result.local}`
    const held = touched.get(key)
    const cells = held?.cells ?? this.scoreBlob(result.rs, result.local) ?? emptyScores(slotsOf(info))
    const existing = readScore(cells, result.cell)
    let ack: RecordAck
    if (!existing) ack = 'counted'
    else if (existing.status !== CELL_STATUS.ok && status === CELL_STATUS.ok) ack = 'upgraded'
    else return 'kept'
    const score: PackedScore = { cell: result.cell, status, q, damage: result.damage, dpr: result.dpr, flags: result.flags,
      reason: this.reasonCode(result.reason) }
    // a kept result references the object with its detail; other results include their own
    const detailFrom = result.detailFrom != null && result.detail == null ? this.rsOfId(result.detailFrom) ?? null
      : result.detail != null ? null : held?.detailFrom
    touched.set(key, { rs: result.rs, local: result.local, cells: writeScore(cells, score), counted: (held?.counted ?? 0) + (ack === 'counted' ? 1 : 0),
      detailFrom })
    this.noteDefects(result.rs, result.local, existing, score)
    if (result.stats) {
      // a weapon's stats are written when they differ, because a build's cells share a few weapons and a kept score
      // repeats them
      this.sql.run(`INSERT INTO w${result.rs} (build, weapon, stats) VALUES (?, ?, ?)
        ON CONFLICT (build, weapon) DO UPDATE SET stats = excluded.stats WHERE stats IS NOT excluded.stats`, result.local, result.weapon, result.stats)
    }
    if (result.cardStats) {
      // card stats come from the live ruleset, or from the first result while none exists
      this.sql.run(`UPDATE builds SET card_stats = ? WHERE id = ? AND (? OR card_stats IS NULL)`, result.cardStats, result.local,
        result.rs === this.live ? 1 : 0)
    }
    if (result.detail != null) {
      this.sql.run(`INSERT INTO d${result.rs} (build, cell, body) VALUES (?, ?, ?)
        ON CONFLICT (build, cell) DO UPDATE SET body = excluded.body`, result.local, result.cell, result.detail)
    }
    if (result.timing) {
      const timing = result.timing
      this.sql.run(`INSERT INTO timings (at, rs, cell, lane, runner, status, ms, wall_ms, stages, anchor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        now, result.rs, result.cell, timing.lane, timing.runner, status, timing.ms, timing.wallMs, timing.stages, timing.anchorSource)
    }
    return ack
  }

  // a score that replaces another moves the health tally (x<rs>): a cell that failed, a score past perfect
  private noteDefects(rs: number, local: number, before: PackedScore | null, after: PackedScore): void {
    if (before?.status === CELL_STATUS.error) this.sql.run(`DELETE FROM x${rs} WHERE kind = ? AND build = ? AND cell = ?`, DEFECT.error, local, before.cell)
    if (before && before.flags & OVER_PERFECT) this.sql.run(`DELETE FROM x${rs} WHERE kind = ? AND build = ? AND cell = ?`, DEFECT.overPerfect, local, before.cell)
    if (after.status === CELL_STATUS.error) this.sql.run(`INSERT OR REPLACE INTO x${rs} (kind, build, cell, q) VALUES (?, ?, ?, NULL)`, DEFECT.error, local, after.cell)
    if (after.flags & OVER_PERFECT) this.sql.run(`INSERT OR REPLACE INTO x${rs} (kind, build, cell, q) VALUES (?, ?, ?, ?)`, DEFECT.overPerfect, local, after.cell, after.q)
  }

  // a job failed as a whole (its fan-out dead-lettered): it finishes without a score
  failJob(rs: number, local: number, gen: number, now: number): boolean {
    return this.write(() => {
      const job = this.job(rs, local)
      if (!job || job.status !== JOB.scoring || job.gen !== gen) return false
      this.sql.run(`UPDATE j${rs} SET status = ?, finished_at = ? WHERE build = ?`, JOB.failed, now, local)
      if (rs !== this.live) return true
      this.event(local, 'score.fail', null, { rs }, now)
      const build = this.build(local)
      if (build) this.scope!.uids.add(build.uid)
      return true
    })
  }

  // finishes a complete job: its best cell, the build's entries, the player's standing, and the scoring news
  private finalize(rs: number, local: number, now: number): void {
    const info = this.rulesets.get(rs)!
    const build = this.build(local)!
    let best: { cell: number; q: number; damage: number; key: string } | null = null
    for (const row of this.scores(rs, local)) {
      if (row.status !== CELL_STATUS.ok || row.q == null || row.damage == null) continue
      const candidate = { cell: row.cell, q: row.q, damage: row.damage, key: info.cells.get(row.cell)!.key }
      if (!best || better(candidate, best)) best = candidate
    }
    const isLive = rs === this.live
    // read who held #1 (another player) before this build can take it
    const top = isLive && best ? this.topOther(rs, build.uid) : null
    this.sql.run(`UPDATE j${rs} SET status = ?, finished_at = ?, best_cell = ?, best_q = ? WHERE build = ?`,
      JOB.scored, now, best?.cell ?? null, best?.q ?? null, local)
    // a job reading an earlier ruleset's object has no object to write
    this.sql.run(`UPDATE j${rs} SET detail_at = ? WHERE build = ? AND detail_from IS NOT NULL`, now, local)
    if (!isLive) {
      // a rolling ruleset's job changes only that ruleset's entries: D1 shows nothing new until it goes live, and
      // events would add a row per build per rollout. rollout entries wait for the walk (list skips them)
      this.unlist(rs, local)
      this.list(rs, local)
      return
    }
    this.event(local, 'score.finish', null, { rs, best: best ? best.key : null }, now)
    this.relist(local)
    this.scope!.uids.add(build.uid)
    const listed = this.job(rs, local)!.listed_sr != null
    if (best && listed && top && best.q > top.q) {
      this.push({ op: 'notify', kind: 'dethroned', uid: top.uid, subject: this.gbid(top.build), build: this.gbid(top.build),
        actorUid: build.uid, at: now,
        data: { resonatorId: String(this.resonator), score: fromQ(best.q), previousScore: fromQ(top.q), byBuild: this.publicId(local) } })
    }
    if (build.scored_at == null) {
      this.sql.run(`UPDATE builds SET scored_at = ? WHERE id = ?`, now, local)
      const index = this.rank(rs)
      this.push({ op: 'notify', kind: 'scored', uid: build.uid, subject: this.gbid(local), build: this.gbid(local), actorUid: null, at: now,
        data: { resonatorId: String(this.resonator), score: best ? fromQ(best.q) : null,
          rank: listed && best ? index.rank(0, { seq: null, region: null }, best.q) : null, total: index.total(0) } })
    }
  }

  // the board's #1 entry held by another player, if any
  private topOther(rs: number, uid: number): { build: number; q: number; uid: number } | null {
    const rows = this.sql.all<{ build: number; ns: number; uid: number }>(`SELECT e.build, e.ns, b.uid FROM e${rs} e
      JOIN builds b ON b.id = e.build WHERE e.facet = 0 ORDER BY e.ns, e.build LIMIT 2`)
    const max = rows[0]?.ns
    const other = rows.find((row) => row.ns === max && row.uid !== uid)
    return other ? { build: other.build, q: -other.ns, uid: other.uid } : null
  }

  // entries

  // a build's entries on a ruleset, from its scores: its best cell, its best per team and per weapon, every cell
  facetEntries(rs: number, local: number, bestCell: number, bestQ: number): FacetEntry[] {
    return entriesOf(this.rulesets.get(rs)!, this.scores(rs, local), bestCell, bestQ)
  }

  // whether a build is listed on a ruleset now
  private listable(build: BuildRow, job: JobRow | null): boolean {
    if (!job || job.status !== JOB.scored || job.best_cell == null || job.best_q == null) return false
    return shownBuild(build.state, build.owner_hidden_at, this.player(build.uid)?.flags ?? 0)
  }

  private unlist(rs: number, local: number): void {
    const job = this.job(rs, local)
    if (!job || job.listed_sr == null) return
    const index = this.rank(rs)
    for (const entry of this.facetEntries(rs, local, job.best_cell!, job.best_q!)) {
      this.sql.run(`DELETE FROM e${rs} WHERE facet = ? AND ns = ? AND build = ?`, entry.facet, nsOf(entry.q), local)
      index.add(entry.facet, job.listed_sr, entry.q, -1)
      this.mirrorEntry(rs, local, entry, job.listed_sr, -1)
    }
    this.sql.run(`UPDATE j${rs} SET listed_sr = NULL WHERE build = ?`, local)
    if (rs === this.live) this.scope!.uploads.add(local)
  }

  private list(rs: number, local: number): void {
    if (this.isDeferred(rs)) return
    const build = this.build(local)
    const job = this.job(rs, local)
    if (!build || !job || job.listed_sr != null || !this.listable(build, job)) return
    const sr = srOf(build.seq, regionKey(this.player(build.uid)))
    const index = this.rank(rs)
    for (const entry of this.facetEntries(rs, local, job.best_cell!, job.best_q!)) {
      this.sql.run(`INSERT INTO e${rs} (facet, ns, build, sr, cell) VALUES (?, ?, ?, ?, ?)`, entry.facet, nsOf(entry.q), local, sr, entry.cell)
      index.add(entry.facet, sr, entry.q, 1)
      this.mirrorEntry(rs, local, entry, sr, 1)
    }
    this.sql.run(`UPDATE j${rs} SET listed_sr = ? WHERE build = ?`, sr, local)
    if (rs === this.live) this.scope!.uploads.add(local)
  }

  // updates a build's entries on every ruleset to match its current state
  private relist(local: number): void {
    for (const rs of this.rulesets.keys()) {
      this.unlist(rs, local)
      this.list(rs, local)
    }
    const build = this.build(local)
    if (build) this.scope!.uids.add(build.uid)
    // its upload's visibility follows the same facts
    this.scope!.uploads.add(local)
  }

  // owner and staff

  // the owner hides a build from everyone else, or shows it again; it is ranked again from the scores it has
  setOwnerHidden(local: number, uid: number, hidden: boolean, now: number): boolean {
    return this.write(() => {
      const build = this.build(local)
      if (!build || build.uid !== uid || build.state !== STATE.active) return false
      if ((build.owner_hidden_at != null) === hidden) return true
      this.sql.run(`UPDATE builds SET owner_hidden_at = ? WHERE id = ?`, hidden ? now : null, local)
      this.event(local, hidden ? 'build.hide_own' : 'build.show_own', `uid:${uid}`, null, now)
      this.relist(local)
      return true
    })
  }

  // a build is removed for good (the owner deleted it) or until a moderator restores it (hidden): its entries and
  // scores are deleted
  endBuild(local: number, state: 'deleted' | 'hidden', actor: string, now: number, { uid }: { uid?: number } = {}): BuildRow | null {
    return this.write(() => {
      const build = this.build(local)
      if (!build || build.state === STATE.deleted || (uid != null && build.uid !== uid)) return null
      if (state === 'hidden' && build.state === STATE.hidden) return build
      for (const rs of this.rulesets.keys()) {
        this.unlist(rs, local)
        this.dropScores(rs, local)
        this.sql.run(`DELETE FROM j${rs} WHERE build = ?`, local)
      }
      this.sql.run(`UPDATE builds SET state = ?, ended_at = ? WHERE id = ?`, STATE[state], now, local)
      this.event(local, state === 'deleted' ? 'build.delete' : 'build.hide', actor, null, now)
      if (state === 'deleted') this.push({ op: 'build_gone', gbid: this.gbid(local) })
      this.scope!.uploads.add(local)
      this.scope!.uids.add(build.uid)
      return build
    })
  }

  // staff fill in what the reader missed (the name, levels and skills, which scoring maxes): the snapshot is replaced
  // when the build still has the one staff edited, else false
  editSnapshot(local: number, snap: Uint8Array, snapHash: string, expect: string, actor: string, fields: string[], now: number): boolean {
    return this.write(() => {
      const build = this.build(local)
      if (!build || build.state === STATE.deleted || build.snap_h !== expect) return false
      this.sql.run(`UPDATE builds SET snap = ?, snap_h = ? WHERE id = ?`, snap, snapHash, local)
      this.event(local, 'build.edit', actor, { fields }, now)
      return true
    })
  }

  // a moderator restores a hidden build: it is scored again and ranked once scored
  restoreBuild(local: number, actor: string, now: number): JobOrder[] | null {
    return this.write(() => {
      const build = this.build(local)
      if (!build || build.state !== STATE.hidden) return null
      this.sql.run(`UPDATE builds SET state = ?, ended_at = NULL WHERE id = ?`, STATE.active, local)
      this.event(local, 'build.restore', actor, null, now)
      this.scope!.uids.add(build.uid)
      this.scope!.uploads.add(local)
      return this.ensureJobs(local, 'interactive', now)
    })
  }

  // a player opted out: every build of theirs here is deleted
  deletePlayerBuilds(uid: number, now: number): number[] {
    return this.write(() => {
      const ids = this.sql.all<{ id: number }>(`SELECT id FROM builds WHERE uid = ? AND state <> 2`, uid).map((row) => row.id)
      for (const id of ids) this.endBuild(id, 'deleted', 'system', now)
      return ids
    })
  }

  // after each write

  // a player's D1 row for this board (player_boards): their kept build count, their best build (highest live score,
  // then newest) and their best listed build, used by profile and social links and profile highlights
  standingOf(uid: number): Omit<Extract<OutboxOp, { op: 'player_board' }>, 'op'> {
    const live = this.live
    const builds = this.sql.all<{ id: number; seq: number; created_at: number; best_q: number | null; listed_sr: number | null }>(
      `SELECT b.id, b.seq, b.created_at, ${live == null ? 'NULL AS best_q, NULL AS listed_sr' : 'j.best_q, j.listed_sr'} FROM builds b
      ${live == null ? '' : `LEFT JOIN j${live} j ON j.build = b.id`} WHERE b.uid = ? AND +b.state = 0`, uid)
    const order = (a: typeof builds[number], b: typeof builds[number]) =>
      (b.best_q ?? -Infinity) - (a.best_q ?? -Infinity) || b.created_at - a.created_at || b.id - a.id
    const best = [...builds].sort(order)[0] ?? null
    const listed = builds.filter((build) => build.listed_sr != null).sort(order)[0] ?? null
    return { uid, standing: builds.length, active: best ? this.gbid(best.id) : null, listed: listed ? this.gbid(listed.id) : null,
      listedAt: listed ? listed.created_at : null, seq: best?.seq ?? null }
  }

  // the outbox ops a write owes: each touched player's standing here, each touched upload, and the board's top
  private settle(): void {
    const scope = this.scope!
    for (const uid of scope.uids) {
      const op: OutboxOp = { op: 'player_board', ...this.standingOf(uid) }
      // a standing D1 already has is not sent again: most writes leave the player's best build unchanged
      const sent = hash53(JSON.stringify(op))
      const player = this.player(uid)
      if (player?.sent === sent) continue
      if (player) this.sql.run(`UPDATE players SET sent = ? WHERE uid = ?`, sent, uid)
      this.push(op)
    }
    for (const local of scope.uploads) {
      const build = this.build(local)
      // a deleted build's upload is removed with it (build_gone)
      if (!build || build.state === STATE.deleted) continue
      // the activity feed shows every build, scored or not, while its player is listed and it is not hidden
      const shown = shownBuild(build.state, build.owner_hidden_at, this.player(build.uid)?.flags ?? 0)
      // its row in D1 changes only with whether it is shown
      if (build.upload_sent === (shown ? 1 : 0)) continue
      this.sql.run(`UPDATE builds SET upload_sent = ? WHERE id = ?`, shown ? 1 : 0, local)
      this.push({ op: 'upload', gbid: this.gbid(local), uid: build.uid, at: build.created_at, shown })
    }
    this.summarize()
  }

  // the board's summary for D1 (total, the builds tied at #1, the first row), queued when it changed
  private summarize(): void {
    if (this.live == null) return
    const live = this.rulesets.get(this.live)!
    const total = this.rank(this.live).total(0)
    const rows = this.sql.all<{ build: number; ns: number }>(`SELECT build, ns FROM e${this.live} WHERE facet = 0 ORDER BY ns, build LIMIT 8`)
    const topQ = rows.length ? -rows[0].ns : null
    const top = rows.filter((row) => row.ns === rows[0].ns).map((row) => this.gbid(row.build))
    // include the first row, so the boards index reads D1 alone; changes to it (a rename, a hidden uid) count
    const first = page(this, { rs: this.live, offset: 0, limit: 1 })?.rows[0] ?? null
    const head: HeadRow | null = first ? { ...first, stats: first.stats ? toBase64(first.stats) : null } : null
    const summary = JSON.stringify([live.id, total, top, topQ, head])
    if (summary !== this.meta<string>('summary')) {
      this.setMeta('summary', summary)
      this.push({ op: 'board', rulesetId: live.id, total, top, topQ, head, at: Date.now() })
    }
  }

  // the summary checked outside a write (upkeep): sends one the board owes, as when its shape grew, without a version
  // bump
  resummarize(): void {
    if (this.scope) return
    this.sql.transaction(() => this.summarize())
  }

  // outbox

  // the oldest ops not yet applied to D1, oldest first
  outbox(limit = 500): Array<{ seq: number; op: OutboxOp }> {
    return this.sql.all<{ seq: number; op: string }>(`SELECT seq, op FROM outbox ORDER BY seq LIMIT ?`, limit)
      .map((row) => ({ seq: row.seq, op: JSON.parse(row.op) as OutboxOp }))
  }

  // D1 has applied every op up to `seq`
  outboxApplied(seq: number): void {
    this.atomic(() => this.sql.run(`DELETE FROM outbox WHERE seq <= ?`, seq))
  }

  // detail staging

  // a finished job's staged cell detail, by cell, for its R2 object
  stagedDetail(rs: number, local: number): Map<number, string> {
    if (!this.rulesets.has(rs)) return new Map()
    return new Map(this.sql.all<{ cell: number; body: string }>(`SELECT cell, body FROM d${rs} WHERE build = ?`, local)
      .map((row) => [row.cell, row.body]))
  }

  // clears a job's staging once its R2 object is written; a job restarted in between retains its own staging
  detailWritten(rs: number, local: number, gen: number, now: number): void {
    if (!this.rulesets.has(rs)) return
    this.atomic(() => {
      const job = this.job(rs, local)
      if (!job || job.gen !== gen || job.status === JOB.scoring) return
      this.sql.run(`DELETE FROM d${rs} WHERE build = ?`, local)
      this.sql.run(`UPDATE j${rs} SET detail_at = ? WHERE build = ?`, now, local)
      // bump the version: a build page cached before its detail object existed lacks the best cell's split
      this.setMeta('ver', this.ver + 1)
    })
  }

  // finished jobs whose detail object is still to be written
  pendingDetail(limit = 50): Array<{ rs: number; local: number; gen: number }> {
    const out: Array<{ rs: number; local: number; gen: number }> = []
    for (const rs of this.rulesets.keys()) {
      for (const row of this.sql.all<{ build: number; gen: number }>(`SELECT build, gen FROM j${rs}
        WHERE status <> 0 AND detail_at IS NULL LIMIT ?`, limit - out.length)) out.push({ rs, local: row.build, gen: row.gen })
      if (out.length >= limit) break
    }
    return out
  }

  // upkeep

  // the next kept builds a ruleset's rollout walk has not reached (by build id), as bulk-lane job orders; done once
  // the walk passes the last build
  fanOutSlice(rs: number, limit: number, now: number): { orders: JobOrder[]; done: boolean } {
    return this.write(() => {
      if (!this.rulesets.has(rs)) return { orders: [], done: true }
      // paced: the walk admits builds only while the ruleset has fewer than OPEN_BULK_JOBS open jobs; carried-over
      // seeds open no jobs and use a separate budget
      const room = Math.min(limit, OPEN_BULK_JOBS - this.openBulkJobs(rs))
      if (room <= 0) return { orders: [], done: false }
      const cursor = this.sql.first<{ cursor: number }>(`SELECT cursor FROM rulesets WHERE rs = ?`, rs)!.cursor
      const ids = this.sql.all<{ id: number }>(`SELECT id FROM builds WHERE id > ? AND state = 0 ORDER BY id LIMIT ?`, cursor, room + SEED_CARRY_SLICE)
      const orders: JobOrder[] = []
      let scored = 0, carried = 0, last: number | null = null
      for (const { id } of ids) {
        const seed = id >= SEED_LOCAL_FLOOR
        if (seed && carried >= SEED_CARRY_SLICE) break // the next slice continues from here
        if (seed && this.carrySeed(rs, id, now)) { carried += 1; last = id; continue }
        if (scored >= room) break
        scored += 1
        last = id
        for (const order of this.ensureJobs(id, 'bulk', now)) {
          const info = this.rulesets.get(order.rs)!
          orders.push(order.rs === rs ? this.offered(info, this.job(rs, id)!) : order)
        }
      }
      if (last != null) this.sql.run(`UPDATE rulesets SET cursor = ? WHERE rs = ?`, last, rs)
      return { orders, done: last == null ? ids.length === 0 : last === ids[ids.length - 1]!.id && ids.length < room + SEED_CARRY_SLICE }
    })
  }

  // copies a seeded build (test data, api/moderation/seed.ts) into a rollout. its scores are the seed tool's model,
  // so the rolling ruleset copies them cell by cell from the source ruleset (or the live one) on the scenarios both
  // score, finished at once like a written seed (no object of its own, entries with the rollout's). false when
  // nothing finished exists to copy, and the build is scored normally
  private carrySeed(rs: number, local: number, now: number): boolean {
    const info = this.rulesets.get(rs)!
    if (this.job(rs, local)) return true
    const from = this.rulesets.get(info.reuseFrom ?? this.live ?? -1)
    if (!from || from.rs === rs) return false
    const old = this.job(from.rs, local)
    if (!old || (old.status !== JOB.scored && old.status !== JOB.failed)) return false
    const byKey = new Map([...info.cells.values()].map((cell) => [cell.key, cell]))
    let cells = emptyScores(slotsOf(info))
    let count = 0
    let best: { cell: number; q: number; damage: number; key: string } | null = null
    for (const row of this.scores(from.rs, local)) {
      const cell = byKey.get(from.cells.get(row.cell)?.key ?? '')
      if (!cell || row.status === CELL_STATUS.error) continue
      const score: PackedScore = { ...row, cell: cell.cell }
      cells = writeScore(cells, score)
      this.noteDefects(rs, local, null, score)
      count += 1
      if (row.status === CELL_STATUS.ok && row.q != null && row.damage != null) {
        const candidate = { cell: cell.cell, q: row.q, damage: row.damage, key: cell.key }
        if (!best || better(candidate, best)) best = candidate
      }
    }
    if (count) this.sql.run(`INSERT INTO s${rs} (build, cells) VALUES (?, ?)`, local, cells)
    this.sql.run(`INSERT INTO w${rs} (build, weapon, stats) SELECT build, weapon, stats FROM w${from.rs} WHERE build = ?`, local)
    // detail_at 0: finished with no object of its own (seeds read the board's template); listed with the rollout's
    // entries
    this.sql.run(`INSERT INTO j${rs} (build, gen, expected, done, status, best_cell, best_q, lane, created_at, progress_at, sent_at,
        finished_at, detail_at, listed_sr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
    local, this.nextGen(), info.cells.size, count, best ? JOB.scored : JOB.failed, best?.cell ?? null, best?.q ?? null, LANE_CODE.bulk,
    now, now, now, now)
    return true
  }

  // whether a rolling-out ruleset or a rescore walk still has builds to reach and room to admit them now
  hasRolloutWork(): boolean {
    for (const info of this.activeRulesets()) {
      if (info.rs === this.live || this.openBulkJobs(info.rs) >= OPEN_BULK_JOBS) continue
      const cursor = this.sql.first<{ cursor: number }>(`SELECT cursor FROM rulesets WHERE rs = ?`, info.rs)!.cursor
      if (this.sql.first(`SELECT 1 FROM builds WHERE id > ? AND state = 0 LIMIT 1`, cursor)) return true
    }
    for (const kind of WALKS) {
      for (const rs of Object.keys(this.walks(kind)).map(Number)) if (this.openBulkJobs(rs) < OPEN_BULK_JOBS) return true
    }
    return false
  }

  // paced walks

  // rulesets with a walk in progress, mapped to the last build id reached (meta 'rescore_walk' / 'fill_walk'). a
  // rescore walk rescores every kept build; a fill walk creates a job for each build without one there (a seed
  // batch's unscored builds)
  walks(kind: Walk): Record<number, number> {
    const walks = JSON.parse(this.meta<string>(`${kind}_walk`) ?? '{}') as Record<number, number>
    for (const rs of Object.keys(walks).map(Number)) if (!this.rulesets.has(rs)) delete walks[rs]
    return walks
  }

  // rulesets a rescore of every build is walking
  rescoreWalks(): Record<number, number> {
    return this.walks('rescore')
  }

  // rescores every kept build on a ruleset, paced like a rollout: the walk restarts builds by id while the ruleset
  // has fewer than OPEN_BULK_JOBS open jobs (walkSlice, from the alarm), and a walk in progress restarts from the
  // first build. returns the number of builds to restart
  startRescoreWalk(rs: number): number {
    return this.write(() => {
      if (!this.rulesets.has(rs)) return 0
      this.setMeta('rescore_walk', JSON.stringify({ ...this.walks('rescore'), [rs]: 0 }))
      return this.keptBuilds()
    })
  }

  // a fill walk on every ruleset from just before `from`, or from the position of a walk in progress when that is
  // earlier
  private startFillWalk(from: number): void {
    const walks = this.walks('fill')
    for (const rs of this.rulesets.keys()) walks[rs] = Math.min(walks[rs] ?? Infinity, from - 1)
    this.setMeta('fill_walk', JSON.stringify(walks))
  }

  // the next builds of a rescore walk restarted on the bulk lane, as orders; the walk ends past the last build
  rescoreSlice(rs: number, limit: number, now: number): JobOrder[] {
    return this.walkSlice('rescore', rs, limit, now)
  }

  // the next walk builds as bulk orders, up to the ruleset's free room: a rescore walk restarts each, a fill walk
  // creates each missing job; the walk ends after the last build
  walkSlice(kind: Walk, rs: number, limit: number, now: number): JobOrder[] {
    return this.write(() => {
      const walks = this.walks(kind)
      if (walks[rs] == null) return []
      const room = Math.min(limit, OPEN_BULK_JOBS - this.openBulkJobs(rs))
      if (room <= 0) return []
      const info = this.rulesets.get(rs)!
      const ids = this.sql.all<{ id: number }>(`SELECT id FROM builds WHERE id > ? AND state = 0 ORDER BY id LIMIT ?`, walks[rs], room)
      const orders: JobOrder[] = []
      for (const { id } of ids) {
        if (kind === 'rescore') {
          const order = this.restartJob(rs, id, 'bulk', now)
          if (order) orders.push(order)
        } else if (!this.job(rs, id)) {
          this.sql.run(`INSERT INTO j${rs} (build, gen, expected, done, status, lane, created_at, progress_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)`,
            id, this.nextGen(), info.cells.size, LANE_CODE.bulk, now, now)
          orders.push(this.orderOf(info, this.job(rs, id)!))
        }
      }
      if (ids.length < room) delete walks[rs]
      else walks[rs] = ids[ids.length - 1].id
      this.setMeta(`${kind}_walk`, JSON.stringify(walks))
      return orders
    })
  }

  // whether a ruleset's walk over the board has finished, none of its jobs is still scoring and its entries are
  // written
  rulesetSettled(rs: number): boolean {
    if (!this.rulesets.has(rs)) return true
    return this.walked(rs) && !this.entriesPending(rs)
  }

  // whether a ruleset's walk over the board has finished and none of its jobs is still scoring
  private walked(rs: number): boolean {
    if (!this.rulesets.has(rs)) return true
    const cursor = this.sql.first<{ cursor: number }>(`SELECT cursor FROM rulesets WHERE rs = ?`, rs)!.cursor
    const behind = this.sql.first(`SELECT 1 FROM builds WHERE id > ? AND state = 0 LIMIT 1`, cursor)
    return !behind && !this.sql.first(`SELECT 1 FROM j${rs} WHERE status = 0 LIMIT 1`)
  }

  // jobs whose orders were never sent (the queue send failed after the write)
  unsentOrders(limit = 200): JobOrder[] {
    const out: JobOrder[] = []
    for (const info of this.rulesets.values()) {
      for (const job of this.sql.all<JobRow>(`SELECT * FROM j${info.rs} WHERE status = 0 AND sent_at IS NULL LIMIT ?`, limit - out.length)) {
        out.push(job.lane === LANE_CODE.bulk ? this.offered(info, job) : this.orderOf(info, job))
      }
      if (out.length >= limit) break
    }
    return out
  }

  // jobs sent but with no result since `before`
  stalledJobs(before: number, limit = 200): Array<{ rs: number; local: number; gen: number; resumes: number }> {
    const out: Array<{ rs: number; local: number; gen: number; resumes: number }> = []
    for (const rs of this.rulesets.keys()) {
      for (const job of this.sql.all<JobRow>(`SELECT * FROM j${rs} WHERE status = 0 AND progress_at < ? LIMIT ?`, before, limit - out.length)) {
        if (job.sent_at != null) out.push({ rs, local: job.build, gen: job.gen, resumes: job.resumes })
      }
      if (out.length >= limit) break
    }
    return out
  }

  // resends a stalled job's missing cells; results already recorded count once, so late results are no-ops
  resumeJob(rs: number, local: number, gen: number, now: number): JobOrder | null {
    return this.write(() => {
      const info = this.rulesets.get(rs)
      const job = this.job(rs, local)
      if (!info || !job || job.status !== JOB.scoring || job.gen !== gen) return null
      this.sql.run(`UPDATE j${rs} SET resumes = resumes + 1, progress_at = ?, sent_at = ? WHERE build = ?`, now, now, local)
      return this.orderOf(info, this.job(rs, local)!)
    })
  }

  // a job given up on: its missing cells are errors, and it finishes on what did score
  abandonJob(rs: number, local: number, gen: number, reason: string, now: number): boolean {
    return this.write(() => {
      const info = this.rulesets.get(rs)
      const job = this.job(rs, local)
      if (!info || !job || job.status !== JOB.scoring || job.gen !== gen) return false
      const order = this.orderOf(info, job)
      this.recordScores(order.cells.map((cell) => ({ rs, local, gen, cell: cell.cell, status: 'error' as const, score: null, damage: null,
        dpr: null, flags: 0, reason, weapon: info.cells.get(cell.cell)!.weaponId, stats: null, detail: null })), now)
      return true
    })
  }

  // builds kept here, counted on builds_state without reading the table and its snapshots
  keptBuilds(): number {
    return this.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM builds WHERE state = 0`)!.n
  }

  // a ruleset's jobs per status, each counted on j<rs>_status
  jobCounts(rs: number): { scoring: number; scored: number; failed: number } {
    const count = (status: number) => this.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM j${rs} WHERE status = ?`, status)!.n
    return { scoring: count(JOB.scoring), scored: count(JOB.scored), failed: count(JOB.failed) }
  }

  // a ruleset's cells that could not score, and how many scores passed the perfect build with the highest few (x<rs>)
  scoreDefects(rs: number, top = 5): { errorRows: number; over: number; overTop: Array<{ build: number; cell: number; q: number }> } {
    const count = (kind: number) => this.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM x${rs} WHERE kind = ?`, kind)!.n
    return {
      errorRows: count(DEFECT.error),
      over: count(DEFECT.overPerfect),
      overTop: this.sql.all<{ build: number; cell: number; q: number }>(`SELECT build, cell, q FROM x${rs} WHERE kind = ?
        ORDER BY q DESC LIMIT ?`, DEFECT.overPerfect, top),
    }
  }

  hasOpenJobs(): boolean {
    for (const rs of this.rulesets.keys()) if (this.sql.first(`SELECT 1 FROM j${rs} WHERE status = 0 LIMIT 1`)) return true
    return false
  }

  // rulesets that ended here whose detail objects are still in R2
  detailPurges(): string[] {
    return JSON.parse(this.meta<string>('detail_purge') ?? '[]') as string[]
  }

  // every detail object of the ruleset here is deleted
  detailPurged(id: string): void {
    this.atomic(() => {
      this.setMeta('detail_purge', JSON.stringify(this.detailPurges().filter((entry) => entry !== id)))
      this.setMeta('detail_purge_after', null)
    })
  }

  // the last R2 key listed by the purge in progress, so objects already listed are skipped
  detailPurgeAfter(): string | null {
    return this.meta<string>('detail_purge_after') ?? null
  }

  detailPurgeProgress(after: string): void {
    this.atomic(() => this.setMeta('detail_purge_after', after))
  }

  private queueDetailPurge(id: string): void {
    const queued = this.detailPurges()
    if (!queued.includes(id)) this.setMeta('detail_purge', JSON.stringify([...queued, id]))
  }

  // of the builds named, those whose job on a ruleset still held reads ruleset `id`'s detail object
  detailReaders(id: string, locals: number[]): Set<number> {
    const origin = this.rsOfId(id)
    const out = new Set<number>()
    if (origin == null || !locals.length) return out
    for (const rs of this.rulesets.keys()) {
      for (const row of this.sql.all<{ build: number }>(`SELECT build FROM j${rs} WHERE build IN (SELECT value FROM json_each(?))
        AND detail_from = ?`, JSON.stringify(locals), origin)) out.add(row.build)
    }
    return out
  }

  // the ruleset id of the object with a job's detail: its own, or the earlier one a rollout kept it from
  detailIdOf(rs: number, local: number): string | null {
    const info = this.rulesets.get(rs)
    if (!info) return null
    const from = this.job(rs, local)?.detail_from
    return from != null ? this.rulesetIdOf(from) : info.id
  }

  // a ruleset's id by its number here, ended ones included
  rulesetIdOf(rs: number): string {
    return this.sql.first<{ id: string }>(`SELECT id FROM rulesets WHERE rs = ?`, rs)!.id
  }

  // a ruleset's number on this board by id, ended ones included; undefined when the board never had it
  rsOfId(id: string): number | undefined {
    return this.sql.first<{ rs: number }>(`SELECT rs FROM rulesets WHERE id = ?`, id)?.rs
  }

  // test data

  // inserts a seed batch's builds in bulk (api/moderation/seed.ts), each at a local in the batch's range. written
  // builds (with scores) finish at once on the live ruleset, each ranked as itself; the rest wait for the scorer like
  // uploads. rows are inserted with one statement per table from json. written builds' entries are deferred because
  // chunked writes would scatter them across the entry index (dozens of random pages per build): the board marks
  // entries stale and writes them all in key order when the batch finishes (rebuildEntries). builds already present
  // (a resent chunk) are left as they are
  seed(input: SeedInput): SeedPlaced {
    return this.write(() => {
      const [lo, hi] = input.range
      if (lo < SEED_LOCAL_FLOOR || hi < lo || input.builds.some((build) => build.local < lo || build.local > hi)) {
        throw new Error('board: a seeded build takes a local in its batch\'s range')
      }
      if ([...this.rulesets.values()].some((info) => info.state === RULESET.rolling)) throw new Error('board: no seeding while a rollout runs')
      const placed: SeedPlaced = { inserted: 0, players: [], uploads: [], orders: [] }
      if (!input.builds.length) return placed
      const locals = input.builds.map((build) => build.local)
      const here = new Set(this.sql.all<{ id: number }>(`SELECT id FROM builds WHERE id BETWEEN ? AND ?`, Math.min(...locals), Math.max(...locals))
        .map((row) => row.id))
      const fresh = input.builds.filter((build) => !here.has(build.local))
      this.sql.run(`INSERT INTO players (uid, name, region, flags, ver)
        SELECT value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4 FROM json_each(?) WHERE true ON CONFLICT (uid) DO NOTHING`,
      JSON.stringify(input.players.map((facts) => [facts.uid, facts.name, facts.region, flagsOf(facts), facts.ver])))
      if (!fresh.length) return placed
      placed.inserted = fresh.length
      const written = fresh.every((build) => build.scores)
      if (!written && fresh.some((build) => build.scores)) throw new Error('board: a chunk is written or scored, not both')
      const live = this.live == null ? null : this.rulesets.get(this.live)!
      if (written && !live) throw new Error('board: written seeds need a live ruleset')
      const byUid = new Map<number, typeof fresh>()
      for (const build of fresh) byUid.set(build.uid, [...byUid.get(build.uid) ?? [], build])
      const players = new Map(this.sql.all<PlayerRow>(`SELECT * FROM players WHERE uid IN (SELECT value FROM json_each(?))`,
        JSON.stringify([...byUid.keys()])).map((row) => [row.uid, row]))
      const hex = (bytes: Uint8Array | null) => (bytes ? Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') : null)
      const buildRows: unknown[][] = []
      if (!written) {
        for (const [uid, group] of byUid) {
          for (const build of group) {
            buildRows.push([build.local, uid, build.seq, STATE.active, build.card, build.snapHash, hex(build.snap), build.drawnAt, build.at,
              build.at, null])
          }
        }
        this.insertBuilds(buildRows)
        // their jobs come from a paced walk over the batch (walkSlice 'fill'), because a batch can hold millions of
        // builds
        this.startFillWalk(Math.min(...fresh.map((build) => build.local)))
      } else {
        const info = live!
        const byKey = new Map([...info.cells.values()].map((cell) => [cell.key, cell]))
        const scoreRows: unknown[][] = [], statRows: unknown[][] = [], jobRows: unknown[][] = []
        let gen = this.meta<number>('next_gen') ?? 1
        for (const [uid, group] of byUid) {
          const scored = group.map((build) => {
            const rows = build.scores!.flatMap((row) => {
              const cell = byKey.get(row.key)
              return cell ? [{ cell: cell.cell, status: CELL_STATUS.ok, q: toQ(row.score), damage: row.damage, dpr: row.dpr, key: cell.key }] : []
            })
            const best = rows.reduce<typeof rows[number] | null>((top, row) => (!top || better(row, top) ? row : top), null)
            return { build, rows, best }
          })
          const player = players.get(uid) ?? null
          for (const { build, rows, best } of scored) {
            buildRows.push([build.local, uid, build.seq, STATE.active, build.card, build.snapHash, hex(build.snap), build.drawnAt, build.at,
              build.at, build.at])
            let cells = emptyScores(slotsOf(info))
            for (const row of rows) cells = writeScore(cells, { cell: row.cell, status: CELL_STATUS.ok, q: row.q, damage: row.damage, dpr: row.dpr, flags: 0, reason: null })
            if (rows.length) scoreRows.push([build.local, hex(cells)])
            if (best && build.stats) statRows.push([build.local, info.cells.get(best.cell)!.weaponId, hex(build.stats)])
            const listed = best != null && !(player && player.flags & PLAYER_FLAG.unlisted)
            const sr = listed ? srOf(build.seq, regionKey(player)) : null
            // detail_at 0: finished with no object of its own (seeds read the board's template)
            jobRows.push([build.local, gen++, info.cells.size, rows.length, best ? JOB.scored : JOB.failed, best?.cell ?? null, best?.q ?? null,
              build.at, sr])
          }
        }
        this.setMeta('next_gen', gen)
        const rs = info.rs
        this.insertBuilds(buildRows)
        this.sql.run(`INSERT INTO s${rs} (build, cells) SELECT value ->> 0, unhex(value ->> 1) FROM json_each(?)`, JSON.stringify(scoreRows))
        this.sql.run(`INSERT INTO w${rs} (build, weapon, stats) SELECT value ->> 0, value ->> 1, unhex(value ->> 2) FROM json_each(?)`,
          JSON.stringify(statRows))
        this.sql.run(`INSERT INTO j${rs} (build, gen, expected, done, status, best_cell, best_q, lane, created_at, progress_at, sent_at,
            finished_at, detail_at, listed_sr)
          SELECT value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5, value ->> 6, 1, value ->> 7, value ->> 7,
            value ->> 7, value ->> 7, 0, value ->> 8 FROM json_each(?)`, JSON.stringify(jobRows))
        // listed builds' entries are written by the rebuild and stay stale until then; a rebuild in progress started
        // before these rows restarts
        this.abandonRebuild()
        this.markStale('all', input.now)
      }
      // what D1 shows of each player and upload here
      for (const uid of byUid.keys()) {
        placed.players.push(this.standingOf(uid))
        const flags = players.get(uid)?.flags ?? 0
        for (const build of byUid.get(uid)!) {
          placed.uploads.push({ gbid: this.gbid(build.local), uid, at: build.at, shown: shownBuild(STATE.active, null, flags) })
        }
      }
      return placed
    })
  }

  private insertBuilds(rows: unknown[][]): void {
    this.sql.run(`INSERT INTO builds (id, uid, seq, state, card, snap_h, snap, drawn_at, created_at, last_seen_at, scored_at)
      SELECT value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5, unhex(value ->> 6), value ->> 7, value ->> 8,
        value ->> 9, value ->> 10 FROM json_each(?)`, JSON.stringify(rows))
  }

  // removes a seed batch: every build at a local in `range`, and every player in `uids` left with no builds. a large
  // batch fills most of its board, so filled tables are copied without it and swapped in; a small batch is deleted in
  // place. counts are recomputed from the remaining entries
  purgeSeeds(range: [number, number], uids: [number, number]): SeedPurged {
    return this.write(() => {
      const [lo, hi] = range
      if (lo < SEED_LOCAL_FLOOR || hi < lo) throw new Error('board: a seed range starts at SEED_LOCAL_FLOOR')
      const doomed = this.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM builds WHERE id BETWEEN ? AND ?`, lo, hi)!.n
      const purged: SeedPurged = { builds: doomed, players: 0, detail: [] }
      if (doomed) {
        const all = this.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM builds`)!.n
        const swap = doomed * 2 > all
        for (const info of this.rulesets.values()) {
          for (const row of this.sql.all<{ build: number; from: number | null }>(`SELECT build, detail_from AS "from" FROM j${info.rs}
            WHERE build BETWEEN ? AND ? AND detail_at > 0`, lo, hi)) {
            purged.detail.push({ rulesetId: row.from == null ? info.id : this.rulesetIdOf(row.from), local: row.build })
          }
          for (const table of ['s', 'x', 'w', 'j', 'd']) this.cut(`${table}${info.rs}`, 'build', lo, hi, swap)
          // entries are removed the same way and their counts recomputed from what remains; a stale board's rebuild
          // restarts on the remaining rows
          this.cut(`e${info.rs}`, 'build', lo, hi, swap)
          this.countEntries(info.rs)
        }
        this.cut('events', 'build', lo, hi, swap)
        this.cut('builds', 'id', lo, hi, swap)
        // a rebuild in progress started over removed rows, so it restarts on the remaining ones
        if (this.entriesStale()) this.abandonRebuild()
      }
      const before = this.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM players WHERE uid BETWEEN ? AND ?`, uids[0], uids[1])!.n
      this.sql.run(`DELETE FROM players WHERE uid BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM builds b WHERE b.uid = players.uid)`,
        uids[0], uids[1])
      purged.players = before - this.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM players WHERE uid BETWEEN ? AND ?`, uids[0], uids[1])!.n
      return purged
    })
  }

  // whether written seeds wait for their entries (seed)
  entriesStale(): boolean {
    return this.meta<number>('entries_stale') != null
  }

  // when a written seed last left the entries stale, or null
  entriesStaleSince(): number | null {
    return this.meta<number>('entries_stale')
  }

  // rewrites every ruleset's entries and counts from the listed builds' scores, `steps` steps per call (at least one;
  // a step stages one range of `rangeSize` builds or copies `sortRows` staged entries in rank order) in one
  // transaction, so each call stays short on a large board. the budget counts work because workerd's clock does not
  // advance during synchronous sql. returns whether it is done; reads use the old entries until then. per ruleset it
  // runs two phases, each writing in key order:
  //   stage  builds in ranges of the job table: each build's entries (entriesOf's rules, in sql) go to a staging table
  //          keyed (facet, build), which appends to the end of every facet
  //   sort   facet by facet, a slice at a time: staged rows in rank order (the staging table's rank index) go into a
  //          new entries table, with their counts
  // the new tables then take the old tables' names. a list or unlist during the rebuild is mirrored into the rows
  // already written (mirrorEntry)
  rebuildEntries(steps = Infinity, rangeSize = REBUILD_BUILDS, sortRows = SORT_ROWS): boolean {
    if (!this.entriesStale()) return true
    let done = false
    this.write(() => {
      let job = this.rebuildJob() ?? this.beginRebuild(this.staleRulesets() ?? [...this.rulesets.keys()])
      let taken = 0
      const spent = () => taken > 0 && taken >= steps
      while (job) {
        if (!this.rulesets.has(job.rs)) {
          this.dropRebuildTables(job.rs)
          job = this.beginRebuild(job.rest)
          continue
        }
        if (job.phase === 'stage') {
          while (job.from != null && !spent()) {
            job.from = this.stageEntries(job.rs, job.from, rangeSize)
            taken += 1
          }
          if (job.from != null) break
          job.phase = 'sort'
        }
        while (job.facets.length && !spent()) {
          // one step copies up to sortRows entries, through as many facets as that reaches
          let budget = sortRows
          while (job.facets.length && budget > 0) {
            const { done, rows } = this.sortSlice(job, budget)
            budget -= Math.max(1, rows)
            if (done) {
              job.facets.shift()
              job.at = null
            }
          }
          taken += 1
        }
        if (job.facets.length) break
        this.swapEntries(job.rs)
        this.setUnlisted(this.unlistedRulesets().filter((other) => other !== job!.rs))
        job = this.beginRebuild(job.rest)
      }
      if (job) this.setRebuildJob(job)
      else {
        this.setRebuildJob(null)
        this.setMeta('entries_stale', null)
        this.setMeta('entries_stale_rs', null)
        done = true
      }
    })
    return done
  }

  // a seed batch is complete: its entries skip the quiet window
  hurryEntries(): void {
    if (this.entriesStale()) this.atomic(() => this.setMeta('entries_stale', 0))
  }

  // whether a go-live's recheck of every player's standing is in progress (standingsSlice)
  standingsPending(): boolean {
    return this.meta<number>('standings_from') != null
  }

  // starts the recheck a go-live starts, which repairs D1's player_boards: only changed standings are sent
  recheckStandings(): void {
    if (!this.standingsPending()) this.atomic(() => this.setMeta('standings_from', 0))
  }

  // rechecks a slice of players (by uid) and sends changed standings to D1; after a go-live the live ruleset sets
  // each player's best build. returns whether players remain
  standingsSlice(limit: number): boolean {
    const from = this.meta<number>('standings_from')
    if (from == null) return false
    return this.write(() => {
      // walk builds_player (uid first); `+state` removes builds_state from the plan, because that index reads every
      // row
      const uids = this.sql.all<{ uid: number }>(`SELECT DISTINCT uid FROM builds WHERE uid > ? AND +state = 0 ORDER BY uid LIMIT ?`, from, limit)
      for (const { uid } of uids) this.scope!.uids.add(uid)
      this.setMeta('standings_from', uids.length === limit ? uids.at(-1)!.uid : null)
      return uids.length === limit
    })
  }

  // whether timings older than TIMINGS_KEEP_MS wait to be pruned (pruneTimings)
  timingsToPrune(now: number): boolean {
    return this.sql.first(`SELECT 1 FROM timings WHERE at < ? LIMIT 1`, now - TIMINGS_KEEP_MS) != null
  }

  // whether an entries rebuild is in progress, which schedules the alarm soon
  rebuilding(): boolean {
    return this.rebuildJob() != null
  }

  // deferred entries
  // a rollout rescores every build on a ruleset that has no readers until it goes live, so its entries are deferred:
  // the bounded rebuild (stage, then sort in key order) lists them once after the walk passes every build, which
  // writes the index in key order

  // rolling rulesets whose entries wait for their walk (meta 'entries_deferred')
  deferredRulesets(): number[] {
    const text = this.meta<string>('entries_deferred')
    return text ? (JSON.parse(text) as number[]).filter((rs) => this.rulesets.has(rs)) : []
  }

  private isDeferred(rs: number): boolean {
    return this.meta<string>('entries_deferred') != null && this.deferredRulesets().includes(rs)
  }

  // rulesets whose deferral ended and whose rebuild has not swapped in yet (meta 'entries_unlisted')
  private unlistedRulesets(): number[] {
    const text = this.meta<string>('entries_unlisted')
    return text ? (JSON.parse(text) as number[]).filter((rs) => this.rulesets.has(rs)) : []
  }

  private setUnlisted(rulesets: number[]): void {
    this.setMeta('entries_unlisted', rulesets.length ? JSON.stringify(rulesets) : null)
  }

  // whether a ruleset's entries table is missing listed builds: deferred, or its first rebuild unfinished
  entriesWaiting(rs: number): boolean {
    return this.isDeferred(rs) || this.unlistedRulesets().includes(rs)
  }

  // the rulesets a stale board rebuilds (meta 'entries_stale_rs'); null for every one
  private staleRulesets(): number[] | null {
    const text = this.meta<string>('entries_stale_rs')
    return text ? (JSON.parse(text) as number[]).filter((rs) => this.rulesets.has(rs)) : null
  }

  // entries to rebuild: every ruleset's, or these rulesets' (added to the ones already stale, and to a rebuild in
  // progress)
  private markStale(rulesets: number[] | 'all', at: number): void {
    const wasStale = this.entriesStale()
    const known = wasStale ? this.staleRulesets() : []
    if (rulesets === 'all' || (wasStale && known == null)) this.setMeta('entries_stale_rs', null)
    else this.setMeta('entries_stale_rs', JSON.stringify([...new Set([...known ?? [], ...rulesets])]))
    // marking every ruleset stale resets the time (a seed batch's chunks extend its quiet window); marking a few only
    // starts it
    if (!wasStale || rulesets === 'all') this.setMeta('entries_stale', at)
    // a rebuild in progress rebuilds the newly marked rulesets after its own
    const job = this.rebuildJob()
    if (job && rulesets !== 'all') {
      for (const rs of rulesets) if (job.rs !== rs && !job.rest.includes(rs)) job.rest.push(rs)
      this.setRebuildJob(job)
    }
  }

  // whether a ruleset's entries are not all written: deferred, or waiting on a rebuild
  private entriesPending(rs: number): boolean {
    if (this.entriesWaiting(rs)) return true
    if (!this.entriesStale()) return false
    const stale = this.staleRulesets()
    return stale == null || stale.includes(rs)
  }

  // rolling rulesets whose walk is done and whose entries still wait for it
  deferralsDue(): number[] {
    return this.deferredRulesets().filter((rs) => this.walked(rs))
  }

  // each done walk's ruleset is listed: its entries rebuilt, a bounded step per alarm (rebuildEntries)
  endDeferrals(): number[] {
    return this.write(() => {
      const due = this.deferralsDue()
      if (due.length) this.endDeferral(due)
      return due
    })
  }

  // rulesets listed from this point, their entries so far written by a rebuild; until it swaps in, they wait
  private endDeferral(rulesets: number[]): void {
    this.setMeta('entries_deferred', JSON.stringify(this.deferredRulesets().filter((rs) => !rulesets.includes(rs))))
    this.setUnlisted([...new Set([...this.unlistedRulesets(), ...rulesets])])
    this.markStale(rulesets, 0)
  }


  private rebuildCache: EntriesRebuild | null | undefined

  private rebuildJob(): EntriesRebuild | null {
    if (this.rebuildCache === undefined) {
      const text = this.meta<string>('entries_rebuild')
      this.rebuildCache = text ? JSON.parse(text) as EntriesRebuild : null
    }
    return this.rebuildCache
  }

  private setRebuildJob(job: EntriesRebuild | null): void {
    this.setMeta('entries_rebuild', job ? JSON.stringify(job) : null)
    this.rebuildCache = job
  }

  // the first of `rulesets` to rebuild, with its new tables made; null when none is left
  private beginRebuild(rulesets: number[]): EntriesRebuild | null {
    const deferred = this.deferredRulesets()
    const [rs, ...rest] = rulesets.filter((candidate) => this.rulesets.has(candidate) && !deferred.includes(candidate))
    if (rs == null) return null
    this.dropRebuildTables(rs)
    const [e, c] = rulesetTables(rs).filter((statement) => statement.includes(`TABLE IF NOT EXISTS e${rs} `) || statement.includes(`TABLE IF NOT EXISTS c${rs} `))
    this.sql.run(e.replace(`e${rs} `, `e${rs}_new `))
    this.sql.run(c.replace(`c${rs} `, `c${rs}_new `))
    this.sql.run(`CREATE TABLE e${rs}_stage (facet INTEGER NOT NULL, build INTEGER NOT NULL, ns INTEGER NOT NULL, sr INTEGER NOT NULL,
      cell INTEGER NOT NULL, PRIMARY KEY (facet, build)) WITHOUT ROWID`)
    // the sort reads each facet in rank order a slice at a time from here
    this.sql.run(`CREATE INDEX e${rs}_stage_rank ON e${rs}_stage (facet, ns, build)`)
    const info = this.rulesets.get(rs)!
    const facets = [...new Set([0, ...[...info.cells.values()].flatMap((cell) => [cell.teamFacet, cell.weaponFacet, cell.cellFacet])])].sort((a, b) => a - b)
    const first = this.sql.first<{ build: number | null }>(`SELECT MIN(build) AS build FROM j${rs}`)
    const job: EntriesRebuild = { rs, phase: 'stage', from: first?.build ?? null, facets, at: null, rest }
    this.setRebuildJob(job)
    return job
  }

  private dropRebuildTables(rs: number): void {
    for (const table of [`e${rs}_new`, `c${rs}_new`, `e${rs}_stage`]) this.sql.run(`DROP TABLE IF EXISTS ${table}`)
  }

  // stops a rebuild in progress and drops its tables; the entries stay stale, so it restarts from the beginning
  private abandonRebuild(): void {
    const job = this.rebuildJob()
    if (!job) return
    this.dropRebuildTables(job.rs)
    this.setRebuildJob(null)
  }

  // stages the entries of one range of the job table from `from`; returns the next range's start, or null after
  // the last
  private stageEntries(rs: number, from: number, size: number): number | null {
    const next = this.sql.first<{ build: number }>(`SELECT build FROM j${rs} WHERE build >= ? ORDER BY build LIMIT 1 OFFSET ?`,
      from, size)?.build ?? null
    const to = next == null ? Number.MAX_SAFE_INTEGER : next - 1
    const info = this.rulesets.get(rs)!
    // compute each scored build's listing the way list() does, rewriting listed_sr where it differs
    const scored = this.sql.all<{ build: number; best_cell: number; best_q: number; listed_sr: number | null; state: number; seq: number
      hidden: number | null; region: number | null; flags: number | null; cells: Uint8Array | null }>(`SELECT j.build, j.best_cell, j.best_q,
        j.listed_sr, b.state, b.seq, b.owner_hidden_at AS hidden, p.region, p.flags, s.cells FROM j${rs} j JOIN builds b ON b.id = j.build
        LEFT JOIN players p ON p.uid = b.uid LEFT JOIN s${rs} s ON s.build = j.build
      WHERE j.build BETWEEN ? AND ? AND j.status = ${JOB.scored} AND j.best_cell IS NOT NULL`, from, to)
    const rows: Array<[number, number, number, number, number]> = []
    for (const row of scored) {
      const sr = shownBuild(row.state, row.hidden, row.flags ?? 0) ? srOf(row.seq, regionKey({ region: row.region, flags: row.flags ?? 0 })) : null
      if (sr !== row.listed_sr) this.sql.run(`UPDATE j${rs} SET listed_sr = ? WHERE build = ?`, sr, row.build)
      if (sr == null) continue
      for (const entry of entriesOf(info, readScores(row.cells), row.best_cell, row.best_q)) rows.push([entry.facet, row.build, nsOf(entry.q), sr, entry.cell])
    }
    // insert in chunks because one range's entries as a single json text exceed the store's bound string limit
    // (SQLITE_TOOBIG); rows are in build order, so each chunk follows the previous one in key order
    for (let at = 0; at < rows.length; at += STAGE_ROWS) {
      this.sql.run(`INSERT INTO e${rs}_stage (facet, build, ns, sr, cell)
        SELECT value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4 FROM json_each(?) ORDER BY value ->> 1, value ->> 0`,
      JSON.stringify(rows.slice(at, at + STAGE_ROWS)))
    }
    return next
  }

  // copies the next `rows` staged entries of the job's first facet into the new entries table in rank order, with
  // their counts; returns whether the facet is done and how many rows were copied, and moves job.at to the last
  // (ns, build) copied
  private sortSlice(job: EntriesRebuild, rows: number): { done: boolean; rows: number } {
    const { rs } = job
    const facet = job.facets[0]
    const past = job.at ? ' AND (ns > ? OR (ns = ? AND build > ?))' : ''
    const pastBinds = job.at ? [job.at[0], job.at[0], job.at[1]] : []
    const end = this.sql.first<{ ns: number; build: number }>(`SELECT ns, build FROM e${rs}_stage WHERE facet = ?${past}
      ORDER BY ns, build LIMIT 1 OFFSET ?`, facet, ...pastBinds, rows - 1)
    const upto = end ? ' AND (ns < ? OR (ns = ? AND build <= ?))' : ''
    const binds = [facet, ...pastBinds, ...(end ? [end.ns, end.ns, end.build] : [])]
    this.sql.run(`INSERT INTO e${rs}_new (facet, ns, build, sr, cell)
      SELECT facet, ns, build, sr, cell FROM e${rs}_stage WHERE facet = ?${past}${upto} ORDER BY ns, build`, ...binds)
    const copied = end ? rows : this.sql.first<{ n: number }>(`SELECT changes() AS n`)!.n
    this.sql.run(`INSERT INTO c${rs}_new (facet, sr, bucket, n)
      SELECT ${facet}, sr, ${bucketSql('ns')} AS b, COUNT(*) FROM e${rs}_stage WHERE facet = ?${past}${upto} GROUP BY sr, b
      ON CONFLICT (facet, sr, bucket) DO UPDATE SET n = n + excluded.n`, ...binds)
    if (!end) return { done: true, rows: copied }
    job.at = [end.ns, end.build]
    return { done: false, rows: copied }
  }

  // the rebuilt tables take the old ones' names; the counts in memory are read again
  private swapEntries(rs: number): void {
    this.sql.run(`DROP TABLE e${rs}_stage`)
    this.sql.run(`DROP TABLE e${rs}`)
    this.sql.run(`ALTER TABLE e${rs}_new RENAME TO e${rs}`)
    this.sql.run(`DROP TABLE c${rs}`)
    this.sql.run(`ALTER TABLE c${rs}_new RENAME TO c${rs}`)
    this.rank(rs).reset()
  }

  // an entry listed (1) or unlisted (-1) while a rebuild runs, written where the rebuild has already been: the
  // staging table for a build it staged and a facet it has not sorted, the new tables for a facet it has
  private mirrorEntry(rs: number, local: number, entry: FacetEntry, sr: number, delta: 1 | -1): void {
    const job = this.rebuildJob()
    if (!job || job.rs !== rs) return
    const ns = nsOf(entry.q)
    // already copied: a facet the sort is done with, or the one it is in up to its cursor
    const at = job.facets[0] === entry.facet ? job.at : null
    const sorted = job.phase === 'sort' && (!job.facets.includes(entry.facet) || (at != null && (ns < at[0] || (ns === at[0] && local <= at[1]))))
    if (!sorted) {
      // a build the stage has not reached is read from its scores when the stage reaches it
      if (job.phase === 'stage' && (job.from == null || local >= job.from)) return
      if (delta < 0) this.sql.run(`DELETE FROM e${rs}_stage WHERE facet = ? AND build = ?`, entry.facet, local)
      else this.sql.run(`INSERT OR REPLACE INTO e${rs}_stage (facet, build, ns, sr, cell) VALUES (?, ?, ?, ?, ?)`, entry.facet, local, nsOf(entry.q), sr, entry.cell)
      return
    }
    if (delta < 0) this.sql.run(`DELETE FROM e${rs}_new WHERE facet = ? AND ns = ? AND build = ?`, entry.facet, nsOf(entry.q), local)
    else this.sql.run(`INSERT INTO e${rs}_new (facet, ns, build, sr, cell) VALUES (?, ?, ?, ?, ?)`, entry.facet, nsOf(entry.q), local, sr, entry.cell)
    this.sql.run(`INSERT INTO c${rs}_new (facet, sr, bucket, n) VALUES (?, ?, ?, ?)
      ON CONFLICT (facet, sr, bucket) DO UPDATE SET n = n + excluded.n`, entry.facet, sr, bucketOf(entry.q), delta)
  }

  // a ruleset's counts from its entries; the bucket of q = -ns as score.ts bucketOf has it
  private countEntries(rs: number): void {
    this.sql.run(`DELETE FROM c${rs}`)
    this.sql.run(`INSERT INTO c${rs} (facet, sr, bucket, n) SELECT facet, sr, ${bucketSql('ns')} AS b, COUNT(*) FROM e${rs} GROUP BY facet, sr, b`)
    this.rank(rs).reset()
  }

  // a table without the rows whose `column` is in [lo, hi]: deleted in place, or (swap) the rest copied to a new
  // table that takes its name and indexes
  private cut(table: string, column: string, lo: number, hi: number, swap: boolean): void {
    if (!swap) {
      this.sql.run(`DELETE FROM ${table} WHERE ${column} BETWEEN ? AND ?`, lo, hi)
      return
    }
    const ddl = this.sql.all<{ type: string; sql: string }>(`SELECT type, sql FROM sqlite_master WHERE tbl_name = ? AND sql IS NOT NULL`, table)
    const create = ddl.find((row) => row.type === 'table')
    if (!create) throw new Error(`board: no table ${table}`)
    const kept = `${table}_kept`
    this.sql.run(`DROP TABLE IF EXISTS ${kept}`)
    this.sql.run(create.sql.replace(/^CREATE TABLE (IF NOT EXISTS )?"?\w+"?/i, `CREATE TABLE ${kept}`))
    this.sql.run(`INSERT INTO ${kept} SELECT * FROM ${table} WHERE ${column} NOT BETWEEN ? AND ?`, lo, hi)
    this.sql.run(`DROP TABLE ${table}`)
    this.sql.run(`ALTER TABLE ${kept} RENAME TO ${table}`)
    for (const index of ddl.filter((row) => row.type === 'index')) this.sql.run(index.sql)
  }

  // the builds a card made here, newest first
  buildsOfCard(card: string): BuildRow[] {
    return this.sql.all<BuildRow>(`SELECT * FROM builds WHERE card = ? ORDER BY id DESC`, card)
  }
}

// numbers a ruleset's cells into facets: 0 is the whole board, then each team, each weapon, each cell
export function numberFacets(cells: CellDef[]): CellInfo[] {
  const teams = [...new Map([...cells].sort((a, b) => a.teamRank - b.teamRank || a.teamKey.localeCompare(b.teamKey))
    .map((cell) => [cell.teamKey, 0])).keys()]
  const weapons = [...new Set(cells.map((cell) => cell.weaponId))].sort((a, b) => a - b)
  const teamFacet = new Map(teams.map((team, index) => [team, 1 + index]))
  const weaponFacet = new Map(weapons.map((weapon, index) => [weapon, 1 + teams.length + index]))
  const base = 1 + teams.length + weapons.length
  const seen = new Set<number>()
  return [...cells].sort((a, b) => a.cell - b.cell).map((cell) => {
    if (seen.has(cell.cell)) throw new Error(`board: cell ${cell.cell} twice`)
    seen.add(cell.cell)
    return { ...cell, teamFacet: teamFacet.get(cell.teamKey)!, weaponFacet: weaponFacet.get(cell.weaponId)!, cellFacet: base + cell.cell }
  })
}

// a build's entries on a ruleset from its score rows: its best cell, its best per team and per weapon, every cell
function entriesOf(info: RulesetInfo, rows: Iterable<{ cell: number; status: number; q: number | null; damage: number | null }>, bestCell: number,
  bestQ: number): FacetEntry[] {
  const entries: FacetEntry[] = [{ facet: 0, q: bestQ, cell: bestCell }]
  const groups = new Map<number, { q: number; damage: number; key: string; cell: number }>()
  for (const row of rows) {
    if (row.status !== CELL_STATUS.ok || row.q == null || row.damage == null) continue
    const cell = info.cells.get(row.cell)!
    const candidate = { q: row.q, damage: row.damage, key: cell.key, cell: row.cell }
    entries.push({ facet: cell.cellFacet, q: row.q, cell: row.cell })
    for (const facet of [cell.teamFacet, cell.weaponFacet]) {
      const held = groups.get(facet)
      if (!held || better(candidate, held)) groups.set(facet, candidate)
    }
  }
  for (const [facet, held] of groups) entries.push({ facet, q: held.q, cell: held.cell })
  return entries
}

function infoOf(rs: number, id: string, state: number, reuseFrom: number | null, cells: CellInfo[]): RulesetInfo {
  return {
    rs, id, state, reuseFrom,
    cells: new Map(cells.map((cell) => [cell.cell, cell])),
    teams: new Map(cells.map((cell) => [cell.teamKey, cell.teamFacet])),
    weapons: new Map(cells.map((cell) => [cell.weaponId, cell.weaponFacet])),
    pairs: new Map(cells.map((cell) => [`${cell.teamKey}|${cell.weaponId}`, cell])),
  }
}
