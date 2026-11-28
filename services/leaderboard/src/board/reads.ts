/*
  Author: Runor Ewhro
  description: board reads: a page at any offset, totals per team and weapon,
               a build's rank per cell, its standing, and the score field. each
               read costs its page plus at most one bucket (rank.ts), independent
               of board size. rows are returned in board form (integer ids,
               packed stats, player flags), and the api converts them to BoardRow
               and related types.
*/

import { countEchoSets } from '@lb/scoring'
import { BUCKETS, bucketHigh, bucketLow, fromQ } from '../lib/score.ts'
import { snapshotEchoSets, unpackSnapshot } from '../lib/snapshotPack.ts'
import { bucketStartNs, NO_FILTER, srSql, type SrFilter } from './rank.ts'
import { CELL_STATUS, JOB, STATE, type BoardStore, type RulesetInfo } from './store.ts'

export interface FacetPick {
  // a team key; any weapon when weapon is null
  team: string | null
  weapon: number | null
}

// the facet a team and weapon pick, or null when the ruleset has no such team, weapon or pair (an empty board)
export function facetOf(info: RulesetInfo, pick: FacetPick): number | null {
  if (pick.team != null && pick.weapon != null) return info.pairs.get(`${pick.team}|${pick.weapon}`)?.cellFacet ?? null
  if (pick.team != null) return info.teams.get(pick.team) ?? null
  if (pick.weapon != null) return info.weapons.get(pick.weapon) ?? null
  return 0
}

export interface PageRow {
  rank: number
  local: number
  uid: number
  name: string | null
  region: number | null
  hideUid: boolean
  masked: boolean
  seq: number
  score: number
  damage: number | null
  dpr: number | null
  drawnAt: number
  // the cell the row is listed by
  cell: number
  weapon: number
  // packed stats (lib/statsPack.ts) in the cell's weapon; the card's stats until the cell is scored with stats
  stats: Uint8Array | null
  sets: Array<{ id: number; pieces: number }>
}

export interface Page {
  rulesetId: string
  total: number
  offset: number
  rows: PageRow[]
}

interface EntryRow {
  ns: number
  build: number
  sr: number
  cell: number
}

// ranks for a page in board order, matching RANK(): the first row is one more than the entries above its score,
// later rows take their own position for a lower score and share the previous rank for an equal score
export function rankPage<T extends { q: number }>(rows: T[], offset: number, firstRank: number): Array<T & { rank: number }> {
  let rank = firstRank
  return rows.map((row, index) => {
    if (index > 0 && row.q < rows[index - 1].q) rank = offset + index + 1
    return { ...row, rank }
  })
}

// the entries at `offset`..`offset + limit` of a facet, in rank order
export function entryPage(store: BoardStore, rs: number, facet: number, filter: SrFilter, offset: number, limit: number): EntryRow[] {
  const index = store.rank(rs)
  const at = index.locate(facet, filter, offset)
  if (!at) return []
  const sr = srSql(filter)
  return store.sql.all<EntryRow>(`SELECT ns, build, sr, cell FROM e${rs} WHERE facet = ? AND ns >= ?${sr.sql}
    ORDER BY ns, build LIMIT ? OFFSET ?`, facet, bucketStartNs(at.bucket), ...sr.binds, limit, at.skip)
}

// one board page: the live ruleset unless one is given, a team/weapon facet, and a seq/server filter
export function page(store: BoardStore, query: { rs?: number; pick?: FacetPick; filter?: SrFilter; offset: number; limit: number }): Page | null {
  const rs = query.rs ?? store.liveRs
  const info = rs == null ? undefined : store.ruleset(rs)
  if (!info) return null
  const filter = query.filter ?? NO_FILTER
  const facet = facetOf(info, query.pick ?? { team: null, weapon: null })
  if (facet == null) return { rulesetId: info.id, total: 0, offset: query.offset, rows: [] }
  const index = store.rank(info.rs)
  const total = index.total(facet, filter)
  const entries = entryPage(store, info.rs, facet, filter, query.offset, query.limit).map((entry) => ({ ...entry, q: -entry.ns }))
  if (!entries.length) return { rulesetId: info.id, total, offset: query.offset, rows: [] }
  const first = index.rank(facet, filter, entries[0].q)
  const rows = rankPage(entries, query.offset, first).map((entry) => rowOf(store, info, entry))
  return { rulesetId: info.id, total, offset: query.offset, rows }
}

function rowOf(store: BoardStore, info: RulesetInfo, entry: EntryRow & { q: number; rank: number }): PageRow {
  const build = store.sql.first<{ uid: number; seq: number; drawn_at: number; snap: Uint8Array; card_stats: Uint8Array | null }>(
    `SELECT uid, seq, drawn_at, snap, card_stats FROM builds WHERE id = ?`, entry.build)!
  const player = store.player(build.uid)
  const cell = info.cells.get(entry.cell)!
  const score = store.scoreOf(info.rs, entry.build, entry.cell)
  const stats = store.sql.first<{ stats: Uint8Array }>(`SELECT stats FROM w${info.rs} WHERE build = ? AND weapon = ?`, entry.build, cell.weaponId)
  return {
    rank: entry.rank, local: entry.build, uid: build.uid, name: player?.name ?? null, region: player?.region ?? null,
    hideUid: !!(player && player.flags & 1), masked: !!(player && player.flags & 2), seq: build.seq,
    score: fromQ(entry.q), damage: score?.damage ?? null, dpr: score?.dpr ?? null, drawnAt: build.drawn_at,
    cell: entry.cell, weapon: cell.weaponId, stats: stats?.stats ?? build.card_stats, sets: setsOf(build.snap),
  }
}

// a card's echo sets as pieces per set, most pieces first
export function setsOf(snap: Uint8Array): Array<{ id: number; pieces: number }> {
  return Object.entries(countEchoSets(snapshotEchoSets(unpackSnapshot(snap)))).map(([id, pieces]) => ({ id: Number(id), pieces }))
    .sort((a, b) => b.pieces - a.pieces || a.id - b.id)
}

export interface Counts {
  rulesetId: string
  total: number
  teams: Record<string, number>
  weapons: Record<string, number>
}

// a board's size, and the size of each team's and each weapon's board, under a filter
export function counts(store: BoardStore, filter: SrFilter = NO_FILTER, rs = store.liveRs): Counts | null {
  const info = rs == null ? undefined : store.ruleset(rs)
  if (!info) return null
  const index = store.rank(info.rs)
  return {
    rulesetId: info.id,
    total: index.total(0, filter),
    teams: Object.fromEntries([...info.teams].map(([team, facet]) => [team, index.total(facet, filter)])),
    weapons: Object.fromEntries([...info.weapons].map(([weapon, facet]) => [String(weapon), index.total(facet, filter)])),
  }
}

// a listed build's rank and each cell board's size, by cell; unlisted builds have no ranks
export function cellRanks(store: BoardStore, rs: number, local: number): Map<number, { rank: number; total: number }> {
  const info = store.ruleset(rs)
  const job = store.job(rs, local)
  const out = new Map<number, { rank: number; total: number }>()
  if (!info || !job || job.listed_sr == null) return out
  const index = store.rank(rs)
  for (const row of store.scores(rs, local)) {
    if (row.status !== CELL_STATUS.ok || row.q == null) continue
    const facet = info.cells.get(row.cell)!.cellFacet
    out.set(row.cell, { rank: index.rank(facet, NO_FILTER, row.q), total: index.total(facet) })
  }
  return out
}

export interface Standing {
  local: number
  uid: number
  state: 'active' | 'deleted' | 'hidden'
  ownerHidden: boolean
  seq: number
  drawnAt: number
  createdAt: number
  // the live job's state: scoring, scored or failed; null without a live ruleset or a job on it
  scoring: 'scoring' | 'scored' | 'failed' | null
  // the best cell and its score on the live ruleset
  bestCell: number | null
  score: number | null
  // place on the live board while listed
  rank: number | null
  total: number
}

// by state code (store's STATE; a literal, because this module loads inside store's import cycle)
const STATE_NAMES: Record<number, Standing['state']> = { 0: 'active', 2: 'deleted', 3: 'hidden' }
const JOB_NAMES = ['scoring', 'scored', 'failed'] as const

// a build's standing on the live ruleset
export function standing(store: BoardStore, local: number): Standing | null {
  const build = store.build(local)
  if (!build) return null
  const rs = store.liveRs
  const job = rs == null ? null : store.job(rs, local)
  const index = rs == null ? null : store.rank(rs)
  const listed = job?.listed_sr != null && job.best_q != null
  return {
    local, uid: build.uid, state: STATE_NAMES[build.state], ownerHidden: build.owner_hidden_at != null, seq: build.seq,
    drawnAt: build.drawn_at, createdAt: build.created_at,
    scoring: job ? JOB_NAMES[job.status] : null,
    bestCell: job?.best_cell ?? null, score: job?.best_q == null ? null : fromQ(job.best_q),
    rank: listed ? index!.rank(0, NO_FILTER, job!.best_q!) : null,
    total: index ? index.total(0) : 0,
  }
}

// a player's builds here, each ranked as itself: for the owner, hidden or not; for anyone else, only listed ones
export function playerBuilds(store: BoardStore, uid: number, { withHidden = false }: { withHidden?: boolean } = {}): Standing[] {
  // `+state` makes the planner search builds_player (the player's few builds) and skip builds_state (nearly every
  // build)
  return store.sql.all<{ id: number }>(`SELECT id FROM builds WHERE uid = ? AND +state = ${STATE.active}`, uid)
    .map((row) => standing(store, row.id)!)
    .filter((row) => withHidden || (!row.ownerHidden && row.rank != null))
}

// at most this many points describe a board's score field
export const FIELD_MAX = 480

// a facet's scores from the top down, at most FIELD_MAX evenly spaced by rank. small boards are read exactly; large
// boards read each point from its bucket's counts, spaced evenly inside the bucket (exact to a bucket's width)
export function field(store: BoardStore, rs: number, facet = 0, filter: SrFilter = NO_FILTER): number[] {
  const index = store.rank(rs)
  const total = index.total(facet, filter)
  if (!total) return []
  if (total <= FIELD_MAX) return entryPage(store, rs, facet, filter, 0, total).map((entry) => fromQ(-entry.ns))
  const bucketCounts = index.counts(facet, filter)
  const out: number[] = []
  let bucket = BUCKETS - 1
  let before = 0
  for (let point = 0; point < FIELD_MAX; point += 1) {
    const offset = Math.round(point * (total - 1) / (FIELD_MAX - 1))
    while (before + bucketCounts[bucket] <= offset) before += bucketCounts[bucket--]
    const low = bucketLow(bucket)
    const high = bucketHigh(bucket)
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      // an open-ended edge bucket has no width to spread over: read the entry itself
      out.push(fromQ(-entryPage(store, rs, facet, filter, offset, 1)[0].ns))
      continue
    }
    const n = bucketCounts[bucket]
    out.push(fromQ(high - ((offset - before + 0.5) / n) * (high - low)))
  }
  return out
}

// what a job's status reads as on a build page
export function scoringStatus(store: BoardStore, local: number): 'scoring' | 'scored' | 'insufficient_data' {
  const rs = store.liveRs
  // a board the live ruleset does not score installs no ruleset, and its builds have nothing to score
  if (rs == null) return 'insufficient_data'
  const job = store.job(rs, local)
  if (!job) return 'scoring'
  if (job.status === JOB.scoring) return 'scoring'
  return job.best_cell != null ? 'scored' : 'insufficient_data'
}

// a build as a row outside its board (profile, feed): its live-ruleset standing, the source cell of its
// score, and the row's display fields
export interface RowView {
  local: number
  uid: number
  state: Standing['state']
  ownerHidden: boolean
  // scoring on the live ruleset
  scoring: boolean
  rank: number | null
  total: number
  // a listed build's board score, or an unlisted build's own best on the live ruleset
  score: number | null
  damage: number | null
  dpr: number | null
  seq: number
  drawnAt: number
  submittedAt: number
  rulesetId: string | null
  // the ruleset whose detail object has this build's live detail: the live id, or an earlier ruleset's when a
  // rollout kept every cell
  detailId: string | null
  // the scenario key ('<resonator>:<team>:<weapon>') the score comes from
  cellKey: string | null
  // the weapon the card was read with
  weaponId: string | null
  // packed stats in the scored cell's weapon; the card's stats until a cell scores
  stats: Uint8Array | null
  sets: Array<{ id: number; pieces: number }>
  // live score of the player's previous upload on this board, for the change between them
  previousScore: number | null
}

export function rowView(store: BoardStore, local: number): RowView | null {
  const base = standing(store, local)
  if (!base) return null
  const build = store.build(local)!
  const rs = store.liveRs
  const info = rs == null ? undefined : store.ruleset(rs)
  const cell = info && base.bestCell != null ? info.cells.get(base.bestCell) ?? null : null
  const score = cell && rs != null ? store.scoreOf(rs, local, cell.cell) : null
  const stats = cell && rs != null
    ? store.sql.first<{ stats: Uint8Array }>(`SELECT stats FROM w${rs} WHERE build = ? AND weapon = ?`, local, cell.weaponId)?.stats ?? null
    : null
  const snapshot = unpackSnapshot(build.snap)
  const before = store.sql.first<{ id: number }>(`SELECT id FROM builds WHERE uid = ? AND +state = ${STATE.active} AND (created_at < ?
    OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT 1`, build.uid, build.created_at, build.created_at, local)
  const previous = before && rs != null ? store.job(rs, before.id)?.best_q ?? null : null
  return {
    local, uid: base.uid, state: base.state, ownerHidden: base.ownerHidden, scoring: base.scoring === 'scoring',
    rank: base.rank, total: base.total, score: base.score, damage: score?.damage ?? null, dpr: score?.dpr ?? null, seq: base.seq,
    drawnAt: base.drawnAt, submittedAt: base.createdAt, rulesetId: info?.id ?? null,
    detailId: rs == null ? null : store.detailIdOf(rs, local), cellKey: cell?.key ?? null,
    weaponId: snapshot.weapon?.id ?? null, stats: stats ?? build.card_stats, sets: setsOf(build.snap),
    previousScore: previous == null ? null : fromQ(previous),
  }
}

export interface CellView {
  cell: number
  key: string
  status: 'ok' | 'unsupported' | 'error'
  reason: string | null
  score: number | null
  damage: number | null
  dpr: number | null
  flags: number
  rank: number | null
  total: number | null
}

// a build page's board data: its row, its snapshot, every live-ruleset cell with its rank, and its stats in each
// scored weapon
export interface BuildView {
  row: RowView
  card: string
  snap: Uint8Array
  cardStats: Uint8Array | null
  scoringStatus: 'scoring' | 'scored' | 'insufficient_data'
  cells: CellView[]
  statsByWeapon: Record<string, Uint8Array>
}

const CELL_STATUS_NAMES = ['ok', 'unsupported', 'error'] as const

export function buildView(store: BoardStore, local: number): BuildView | null {
  const row = rowView(store, local)
  if (!row) return null
  const build = store.build(local)!
  const rs = store.liveRs
  const info = rs == null ? undefined : store.ruleset(rs)
  const cells: CellView[] = []
  const statsByWeapon: Record<string, Uint8Array> = {}
  if (info && rs != null) {
    const ranks = cellRanks(store, rs, local)
    const scored = new Map(store.scores(rs, local).map((score) => [score.cell, score]))
    for (const cell of info.cells.values()) {
      const score = scored.get(cell.cell)
      cells.push({
        cell: cell.cell, key: cell.key, status: score ? CELL_STATUS_NAMES[score.status] : 'unsupported',
        reason: score ? store.reasonText(score.reason) : 'not_scored_yet',
        score: score?.status === CELL_STATUS.ok && score.q != null ? fromQ(score.q) : null,
        damage: score?.damage ?? null, dpr: score?.dpr ?? null, flags: score?.flags ?? 0,
        rank: ranks.get(cell.cell)?.rank ?? null, total: ranks.get(cell.cell)?.total ?? null,
      })
    }
    for (const entry of store.sql.all<{ weapon: number; stats: Uint8Array }>(`SELECT weapon, stats FROM w${rs} WHERE build = ?`, local)) {
      statsByWeapon[String(entry.weapon)] = entry.stats
    }
  }
  return { row, card: build.card, snap: build.snap, cardStats: build.card_stats, scoringStatus: scoringStatus(store, local), cells, statsByWeapon }
}
