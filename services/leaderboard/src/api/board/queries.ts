/*
  Author: Runor Ewhro
  description: builds api responses from board reads: board pages, counts and
               fields, build pages, player profiles, the activity strip and the
               follow feed. builds and scores come from the boards
               (board/reads.ts); players, documents and the ruleset catalog come
               from D1.
*/

import type {
  ActivityResponse, ActivityRow, BoardCountsResponse, BoardResponse, BoardRow, BoardsResponse, BoardStatsResponse, BuildDetailResponse,
  BuildStats, CellDetailResponse, LiveRulesetResponse, PlayerBuild, PlayerProfileResponse, RowLook, ScenarioCell, ScenarioSummary,
} from '@lb/contract/api'
import type { ScenarioInput } from '@lb/contract/scenarioInput'
import { teamDamageOf } from '@lb/contract/api'
import { canonicalResonatorId } from '@lb/contract/identity'
import { loadoutKey, type CardDoc, type ProfileDoc } from '@lb/contract/documents'
import type { ApiEnv } from '../../env.ts'
import { HttpError } from '../../lib/http.ts'
import { formatBuildId, parseBuildId, SEED_LOCAL_FLOOR, uidToText } from '../../lib/ids.ts'
import { unpackStats } from '../../lib/statsPack.ts'
import { unpackSnapshot } from '../../lib/snapshotPack.ts'
import { getPlayer, isMasked, maskedSql, type PlayerRow } from '../../db/identity.ts'
import { getRuleset, liveRulesetId, scenarioCatalog, summaryOf } from '../../db/rulesets.ts'
import { followedUploads } from '../../db/social.ts'
import { shownDocuments } from '../documents/routes.ts'
import { linkOf } from '../../db/accounts.ts'
import { profilesOf, type Person } from '../people.ts'
import { profileCount } from '../profiles.ts'
import { playerResonators } from '../players.ts'
import { isOpen, rowsOf } from '../crossBoard.ts'
import { boardOf } from '../stubs.ts'
import { detailKey, fromBase64, gunzipJson, seedTemplateKey, type CellDetail, type DetailObject } from '../../scorer/messages.ts'
import type { FacetPick, PageRow, RowView, BuildView } from '../../board/reads.ts'
import type { SrFilter } from '../../board/rank.ts'
import type { HeadRow } from '../../board/types.ts'

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50
// the deepest offset a page may start at
const MAX_OFFSET = 10_000_000

export async function requireLiveRuleset(db: D1Database): Promise<string> {
  const id = await liveRulesetId(db)
  if (!id) throw new HttpError('not_found', "no boards yet... scoring hasn't started. check back later :P")
  return id
}

const optionalText = (params: URLSearchParams, name: string, pattern: RegExp): string | null => {
  const value = params.get(name)
  if (value == null || value === '') return null
  if (!pattern.test(value)) throw new HttpError('bad_request', `bad ${name}`)
  return value
}

export function parseResonator(resonatorId: string): number {
  if (!/^\d{4}$/.test(resonatorId)) throw new HttpError('bad_request', "hmm... we couldn't identify that resonator. reopen its board and try again.")
  return Number(canonicalResonatorId(resonatorId))
}

// a sequence and a server: a server's digit (5-9) is its region key less four (board/store.ts regionKey)
export function parseSrFilter(params: URLSearchParams): SrFilter {
  const sequence = optionalText(params, 'sequence', /^[0-6]$/)
  const region = optionalText(params, 'region', /^[5-9]$/)
  return { seq: sequence == null ? null : Number(sequence), region: region == null ? null : Number(region) - 4 }
}

export interface BoardQuery {
  resonator: number
  pick: FacetPick
  filter: SrFilter
  offset: number
  limit: number
}

export function parseBoardQuery(resonatorId: string, params: URLSearchParams): BoardQuery {
  const limit = Number(params.get('limit') ?? DEFAULT_LIMIT)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new HttpError('bad_request', `limit is 1 to ${MAX_LIMIT}`)
  const offset = Number(params.get('offset') ?? 0)
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) throw new HttpError('bad_request', 'bad offset')
  const weapon = optionalText(params, 'weapon', /^\d{8}$/)
  return {
    resonator: parseResonator(resonatorId),
    pick: { team: optionalText(params, 'team', /^\d{4}(-\d{4}){2}$/), weapon: weapon == null ? null : Number(weapon) },
    filter: parseSrFilter(params), offset, limit,
  }
}

// a ruleset's scenarios named both ways the boards number them: by id, and by resonator and cell
async function scenarioNames(db: D1Database, rulesetId: string) {
  const catalog = await scenarioCatalog(db, rulesetId)
  const byCell = new Map<string, ScenarioSummary>()
  const byId = new Map<string, ScenarioSummary>()
  for (const row of catalog.values()) {
    const summary = summaryOf(row)
    byId.set(row.id, summary)
    byCell.set(`${row.resonator_id}:${row.cell}`, summary)
  }
  return { byId, byCell, ofKey: (key: string | null) => key == null ? null : byId.get(`${rulesetId}:${key}`) ?? null }
}

const statsOf = (bytes: Uint8Array | null): BuildStats | null => bytes ? unpackStats(bytes) : null

// a tuned profile's row look: its accent and approved images; null for a profile with no accent and no banner
function lookOf(doc: ProfileDoc | undefined): RowLook | null {
  if (!doc || (!doc.accent && !doc.banner)) return null
  return { displayName: doc.displayName ?? null, accent: doc.accent ?? null, avatar: doc.avatar ?? null, banner: doc.banner ?? null,
    avatarFrame: doc.avatarFrame ?? null, bannerFrame: doc.bannerFrame ?? null }
}

// row looks by uid from each uid's account profile; anonymous players get none
async function looksOf(db: D1Database, uids: string[]): Promise<(uid: string) => RowLook | null> {
  const profile = await profilesOf(db, uids)
  return (uid) => lookOf(profile(uid))
}

type Who = { uid: string | null; name: string | null; region: string | null; anonymous?: true }

// the player fields a row shows: a hidden uid drops its server, an anonymous player shows only the server
function whoOf(player: { uid: string; name: string | null; region: string | null; hideUid: boolean; masked: boolean }): Who {
  return player.masked
    ? { uid: null, name: null, region: player.region, anonymous: true }
    : { uid: player.hideUid ? null : player.uid, name: player.name, region: player.hideUid ? null : player.region }
}

const pageWho = (row: PageRow) => whoOf({ uid: uidToText(row.uid), name: row.name, region: row.region == null ? null : String(row.region),
  hideUid: row.hideUid, masked: row.masked })

function boardRow(resonator: number, row: PageRow, scenario: ScenarioSummary, look: RowLook | null): BoardRow {
  return {
    rank: row.rank, buildId: formatBuildId({ resonator, local: row.local }), ...pageWho(row), sequence: row.seq, score: row.score,
    damage: row.damage ?? 0, drawnAt: row.drawnAt, scenario, stats: statsOf(row.stats), sets: row.sets, dpr: row.dpr, look,
  }
}

export async function board(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, query: BoardQuery): Promise<BoardResponse> {
  const page = await boardOf(env, query.resonator).page(query.resonator, query)
  if (!page) throw new HttpError('not_found', "this board isn't ready for scoring yet. check back later :P")
  const [names, look] = await Promise.all([scenarioNames(env.LB, page.rulesetId),
    looksOf(env.LB, page.rows.filter((row) => !row.masked).map((row) => uidToText(row.uid)))])
  return {
    rulesetId: page.rulesetId, total: page.total, offset: page.offset,
    rows: page.rows.map((row) => boardRow(query.resonator, row, names.byCell.get(`${query.resonator}:${row.cell}`)!,
      row.masked ? null : look(uidToText(row.uid)))),
  }
}

export async function boardCounts(env: Pick<ApiEnv, 'BOARDS'>, resonator: number, filter: SrFilter): Promise<BoardCountsResponse> {
  const counts = await boardOf(env, resonator).counts(resonator, filter)
  if (!counts) throw new HttpError('not_found', "this board isn't ready for scoring yet. check back later :P")
  return counts
}

export async function boardStats(env: Pick<ApiEnv, 'BOARDS'>, resonator: number): Promise<BoardStatsResponse> {
  const field = await boardOf(env, resonator).field(resonator)
  if (!field) throw new HttpError('not_found', "this board isn't ready for scoring yet. check back later :P")
  return { rulesetId: field.rulesetId, resonatorId: String(resonator), total: field.total, field: field.field }
}

// every board's total and its top row, from D1: each board writes its first row there with its summary
export async function boards(env: Pick<ApiEnv, 'LB'>, rulesetId: string): Promise<BoardsResponse> {
  const { results } = await env.LB.prepare(`SELECT resonator_id, total, top, top_score, head, updated_at FROM boards
    WHERE ruleset_id = ? AND total > 0 ORDER BY resonator_id`).bind(rulesetId)
    .all<{ resonator_id: string; total: number; top: string; top_score: number | null; head: string | null; updated_at: number }>()
  const names = await scenarioNames(env.LB, rulesetId)
  const tops = results.map((row): PageRow | null => {
    if (!row.head) return null
    const head = JSON.parse(row.head) as HeadRow
    return { ...head, stats: head.stats ? fromBase64(head.stats) : null }
  })
  const [look, profiles] = await Promise.all([looksOf(env.LB, tops.flatMap((row) => row && !row.masked ? [uidToText(row.uid)] : [])),
    profileCount(env.LB)])
  return { rulesetId, profiles, boards: results.map((row, i) => {
    const top = tops[i]
    const resonator = Number(row.resonator_id)
    return {
      resonatorId: row.resonator_id, total: row.total, topScore: row.top_score ?? 0,
      topBuildId: (JSON.parse(row.top) as string[])[0] ?? '', updatedAt: row.updated_at,
      top: top ? boardRow(resonator, top, names.byCell.get(`${resonator}:${top.cell}`)!, top.masked ? null : look(uidToText(top.uid))) : null,
    }
  }) }
}

// the version of the boards index: the newest change to any board's summary
export async function boardsVersion(db: D1Database): Promise<string> {
  return String((await db.prepare('SELECT MAX(updated_at) AS at FROM boards').first<{ at: number | null }>())?.at ?? 0)
}

// a build's detail object (R2), written once its job finishes; null while it is still being written
async function detailOf(env: Pick<ApiEnv, 'LB_DATA'>, rulesetId: string, resonator: number, buildId: string,
  detailId: string | null): Promise<DetailObject | null> {
  // a seeded build reads its board's template (api/moderation/seed.ts); a build a rollout kept whole reads the object
  // of the ruleset it was kept from
  const local = parseBuildId(buildId)?.local ?? 0
  const object = await env.LB_DATA.get(local >= SEED_LOCAL_FLOOR ? seedTemplateKey(rulesetId, resonator)
    : detailKey(detailId ?? rulesetId, resonator, buildId))
  return object ? gunzipJson<DetailObject>(await object.arrayBuffer()) : null
}

// one build's page; the caller checks visibility, and `own` is the owner's view (pending images shown, an
// anonymous owner's name kept)
export async function buildDetail(env: Pick<ApiEnv, 'LB' | 'LB_DATA' | 'BOARDS'>, resonator: number, buildId: string, view: BuildView,
  own: boolean): Promise<BuildDetailResponse> {
  const uid = uidToText(view.row.uid)
  // a board the live ruleset does not score has no cells; its builds still open
  const [player, rulesetId] = await Promise.all([getPlayer(env.LB, uid), view.row.rulesetId ?? liveRulesetId(env.LB)])
  if (!player) throw new HttpError('not_found', "hmm... this build isn't available. it may have been hidden or deleted.")
  if (!rulesetId) throw new HttpError('not_found', "no boards yet... scoring hasn't started. check back later :P")
  const resonatorId = String(resonator)
  // the card looks are the account's, for every build of the resonator across its uids
  const loadout = await linkOf(env.LB, uid).then((link) => link ? loadoutKey(link.account_id, resonatorId) : null)
  const [names, docs, detail] = await Promise.all([scenarioNames(env.LB, rulesetId),
    loadout ? shownDocuments(env.LB, ['card'], [loadout], own) : Promise.resolve(new Map()),
    view.row.cellKey ? detailOf(env, rulesetId, resonator, buildId, view.row.detailId) : Promise.resolve(null)])
  // only the active, shown build is ranked; other builds keep their scores unranked
  const ranked = view.row.state === 'active' && !view.row.ownerHidden
  const bestDetail = view.row.cellKey ? await filledDetail(env, resonator, buildId, view.row.cellKey, detail?.cells[view.row.cellKey] ?? null) : null
  const cells: ScenarioCell[] = view.cells.map((cell) => {
    const scenario = names.ofKey(cell.key)!
    const kept = cell.key === view.row.cellKey ? bestDetail : detail?.cells[cell.key] ?? null
    return {
      scenario, status: cell.status, reason: cell.reason, score: cell.score, damage: cell.damage, dpr: cell.dpr,
      teamDpr: teamDprOf(cell.dpr, scenario.resonatorId, kept), rank: ranked ? cell.rank : null, total: ranked ? cell.total : null,
    }
  })
  const best = view.row.cellKey ? cells.find((cell) => cell.scenario.id === `${rulesetId}:${view.row.cellKey}`) ?? null : null
  const snapshot = unpackSnapshot(view.snap)
  // privacy masking covers the response uid and the nested snapshot; the owner of an anonymous player sees everything
  const anonymous = isMasked(player) && !own
  const masked = player.hide_uid === 1 || anonymous
  return {
    rulesetId, buildId, uid: masked ? null : uid, name: anonymous ? null : player.last_name,
    ...(anonymous ? { anonymous: true } : {}),
    scoringStatus: view.scoringStatus,
    submittedAt: view.row.submittedAt, drawnAt: view.row.drawnAt,
    snapshot: masked ? { ...snapshot, uid: '', ...(anonymous ? { name: null } : {}) } : snapshot,
    best, cells,
    // before any scenario scores it, the stats are the submitted build's: its weapon, no teammates
    stats: statsOf(view.row.stats),
    scoredInput: (bestDetail?.input as ScenarioInput | undefined) ?? null,
    bestContribution: bestDetail?.contribution ?? null,
    card: (loadout ? docs.get(`card:${loadout}`) as CardDoc | undefined : undefined) ?? null,
  }
}

// a cell's team damage per rotation from the kept breakdown (teamDamageOf); null for a lean cell (no breakdown yet)
// or a cell without a team ledger
const teamDprOf = (dpr: number | null, resonatorId: string, cell: CellDetail | null): number | null =>
  teamDamageOf(dpr, resonatorId, cell?.contribution?.team)

// a cell's detail with its breakdown; a lean cell (bulk-scored without one) is filled by its board now or by a fill
// a page read already started, and a failed fill returns the lean cell without a contribution
async function filledDetail(env: Pick<ApiEnv, 'BOARDS'>, resonator: number, buildId: string, key: string,
  cell: CellDetail | null): Promise<CellDetail | null> {
  if (!cell?.lean) return cell
  const local = parseBuildId(buildId)?.local
  if (local == null) return cell
  return await boardOf(env, resonator).fillCell(resonator, local, key).catch((error) => {
    console.error('fill failed', buildId, key, error)
    return null
  }) ?? cell
}

// one scored cell's input and damage split, from the build's detail object
export async function cellDetail(env: Pick<ApiEnv, 'LB_DATA' | 'BOARDS'>, resonator: number, buildId: string, rulesetId: string,
  scenarioId: string, detailId: string | null): Promise<CellDetailResponse> {
  if (!scenarioId.startsWith(`${rulesetId}:`)) throw new HttpError('not_found', "this team and weapon aren't available for this build anymore. refresh the build to see the available choices.")
  const key = scenarioId.slice(rulesetId.length + 1)
  const cell = await filledDetail(env, resonator, buildId, key, (await detailOf(env, rulesetId, resonator, buildId, detailId))?.cells[key] ?? null)
  if (!cell) throw new HttpError('not_found', "hmm... we don't have the details for this team and weapon yet. try again later.")
  return { scenarioId, contribution: cell.contribution ?? null, input: (cell.input as ScenarioInput | null) ?? null,
    anchors: cell.anchors ?? null, programSha256: cell.program ?? null }
}

export async function liveRuleset(db: D1Database): Promise<LiveRulesetResponse> {
  const id = await requireLiveRuleset(db)
  const ruleset = (await getRuleset(db, id))!
  const names = await scenarioNames(db, id)
  return { rulesetId: id, gameVer: ruleset.game_ver, liveAt: ruleset.live_at, scenarios: [...names.byId.values()] }
}

// a kept build as a profile and the feed show it
function buildFields(buildId: string, resonatorId: string, row: RowView, names: Awaited<ReturnType<typeof scenarioNames>>) {
  return {
    buildId, resonatorId, scoring: row.scoring,
    rank: row.rank, total: row.total, score: row.score, damage: row.damage, sequence: row.seq, scenario: names.ofKey(row.cellKey),
    weaponId: row.weaponId, stats: statsOf(row.stats), sets: row.sets, dpr: row.dpr,
  }
}

// a person's profile: every kept build of their uids, ranked or not, newest first, plus the account's profile
// document. `face` is the uid used to reach it (name, region and uid line; null for an account with no uid yet).
// the caller refuses opted-out players and sets uid visibility; the owner's view adds their hidden builds, marked
export async function playerProfile(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, rulesetId: string, face: PlayerRow | null, showUid: boolean,
  person: Person, { withHidden = false }: { withHidden?: boolean } = {}): Promise<PlayerProfileResponse> {
  const [boards, docs, names] = await Promise.all([Promise.all(person.uids.map(async (uid) => ({ uid, resonators: await playerResonators(env.LB, uid) }))),
    person.accountId ? shownDocuments(env.LB, ['profile'], [person.accountId], withHidden) : new Map(), scenarioNames(env.LB, rulesetId)])
  const perBoard = await Promise.all(boards.flatMap(({ uid, resonators }) => resonators.map(async (resonatorId) => {
    const resonator = Number(resonatorId)
    const rows = await boardOf(env, resonator).playerBuilds(resonator, Number(uid), withHidden)
    return rows.map((row): PlayerBuild => ({
      ...buildFields(formatBuildId({ resonator, local: row.local }), resonatorId, row, names), drawnAt: row.drawnAt,
      submittedAt: row.submittedAt, ...(withHidden ? { hidden: row.ownerHidden } : {}),
    }))
  })))
  return {
    rulesetId, uid: face && showUid ? face.uid : null, name: face?.last_name ?? null, region: face && showUid ? face.region : null,
    ...(face && isMasked(face) ? { anonymous: true } : {}),
    profile: (person.accountId ? docs.get(`profile:${person.accountId}`) as ProfileDoc | undefined : undefined) ?? null,
    builds: perBoard.flat().sort((a, b) => b.submittedAt - a.submittedAt || (a.buildId < b.buildId ? 1 : -1)),
  }
}

// what a person's profile is made of: their uids' rows and boards' standings, their account's profile and links
export async function profileVersion(db: D1Database, person: Person): Promise<string> {
  const row = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(p.ver), 0) AS ver,
      (SELECT MAX(updated_at) FROM player_boards WHERE uid IN (SELECT value FROM json_each(?1))) AS at,
      (SELECT MAX(updated_at) FROM documents WHERE kind = 'profile' AND owner_id = ?2) AS doc,
      (SELECT MAX(linked_at) FROM account_uids WHERE account_id = ?2) AS linked
    FROM players p WHERE p.uid IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(person.uids), person.accountId)
    .first<{ n: number; ver: number; at: number | null; doc: number | null; linked: number | null }>()
  return `${row?.n ?? 0}.${row?.ver ?? 0}.${row?.at ?? 0}.${row?.doc ?? 0}.${row?.linked ?? 0}`
}

// the strip draws fifteen local days; sixteen covers them from any time zone
const ACTIVITY_SPAN_MS = 16 * 24 * 3600 * 1000
export const SLOT_MS = 15 * 60 * 1000

type UploadRow = { build_id: string; uid: string; resonator_id: string; at: number }

// uploads as feed rows: each one's standing from its board, its player from D1; an upload whose build is hidden or
// deleted, or whose player left the boards, is dropped
async function uploadRows(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, rulesetId: string, uploads: UploadRow[]): Promise<ActivityRow[]> {
  if (!uploads.length) return []
  const [rows, names, { results: players }] = await Promise.all([rowsOf(env, uploads.map((upload) => upload.build_id)),
    scenarioNames(env.LB, rulesetId),
    env.LB.prepare(`SELECT p.uid, p.last_name, p.hide_uid, p.region, ${maskedSql('p')} AS masked FROM listed_players p
      WHERE p.uid IN (SELECT value FROM json_each(?))`).bind(JSON.stringify([...new Set(uploads.map((upload) => upload.uid))]))
      .all<{ uid: string; last_name: string | null; hide_uid: 0 | 1; region: string | null; masked: 0 | 1 }>()])
  const byUid = new Map(players.map((player) => [player.uid, player]))
  const look = await looksOf(env.LB, players.filter((player) => !player.masked).map((player) => player.uid))
  return uploads.flatMap((upload): ActivityRow[] => {
    const row = rows.get(upload.build_id)
    const player = byUid.get(upload.uid)
    if (!isOpen(row) || !player) return []
    return [{
      ...buildFields(upload.build_id, upload.resonator_id, row, names),
      ...whoOf({ uid: player.uid, name: player.last_name, region: player.region, hideUid: player.hide_uid === 1, masked: player.masked === 1 }),
      look: player.masked ? null : look(player.uid), previousScore: row.previousScore, at: upload.at,
    }]
  })
}

export async function activity(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, rulesetId: string, limit: number, now = Date.now(),
  from?: number): Promise<ActivityResponse> {
  const since = now - ACTIVITY_SPAN_MS
  // the per-board counts cover the days the page shows (its first local midnight), else the whole span
  const boardsFrom = from == null ? since : Math.min(now, Math.max(since, Math.floor(from / SLOT_MS) * SLOT_MS))
  const [uploads, counted, topped, perBoard, totals] = await env.LB.batch([
    env.LB.prepare('SELECT build_id, uid, resonator_id, at FROM recent_uploads WHERE shown = 1 ORDER BY at DESC LIMIT ?').bind(limit),
    // counted as uploads are added and removed (upload_slots, updated by triggers on recent_uploads)
    env.LB.prepare(`SELECT q, entries FROM upload_slots WHERE q >= ? AND entries > 0 ORDER BY q`).bind(Math.floor(since / SLOT_MS)),
    // an upload is at #1 when its build is one of its board's tied best
    env.LB.prepare(`SELECT CAST(r.at / ${SLOT_MS} AS INTEGER) AS q, COUNT(*) AS tops FROM boards b, json_each(b.top) t
      JOIN recent_uploads r ON r.build_id = t.value WHERE b.ruleset_id = ?1 AND r.shown = 1 AND r.at >= ?2 GROUP BY q`).bind(rulesetId, since),
    env.LB.prepare(`SELECT resonator_id, COUNT(*) AS entries FROM recent_uploads WHERE shown = 1 AND at >= ? GROUP BY resonator_id`)
      .bind(boardsFrom),
    // ranked: on a live board; kept: every kept build (migrations/0012_build_totals.sql)
    env.LB.prepare(`SELECT (SELECT COALESCE(SUM(total), 0) FROM boards WHERE ruleset_id = ?) AS ranked,
      (SELECT COALESCE(MAX(n), 0) FROM totals WHERE key = 'kept_builds') AS kept`).bind(rulesetId),
  ]) as [D1Result<UploadRow>, D1Result<{ q: number; entries: number }>, D1Result<{ q: number; tops: number }>,
    D1Result<{ resonator_id: string; entries: number }>, D1Result<{ ranked: number; kept: number }>]
  const tops = new Map(topped.results.map((row) => [row.q, row.tops]))
  return {
    rulesetId,
    rows: await uploadRows(env, rulesetId, uploads.results),
    slots: counted.results.map((slot) => ({ at: slot.q * SLOT_MS, entries: slot.entries, tops: tops.get(slot.q) ?? 0 })),
    builds: { ranked: totals.results[0]?.ranked ?? 0, unranked: Math.max(0, (totals.results[0]?.kept ?? 0) - (totals.results[0]?.ranked ?? 0)) },
    boards: { from: boardsFrom, counts: perBoard.results.map((row) => ({ resonatorId: row.resonator_id, entries: row.entries })) },
  }
}

// an account's follow feed: uploads from the boards and players it follows, newest first
export async function followFeed(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, rulesetId: string, accountId: string, limit: number): Promise<ActivityRow[]> {
  const { results } = await env.LB.prepare(`SELECT build_id, uid, resonator_id, at FROM (${followedUploads('?1', '0', '?2')})
    ORDER BY at DESC LIMIT ?2`).bind(accountId, limit).all<UploadRow>()
  return uploadRows(env, rulesetId, results)
}
