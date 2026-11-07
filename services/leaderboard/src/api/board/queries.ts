/*
  Author: Runor Ewhro
  description: turns board and build-detail requests into responses: query
               parameters checked and parsed, uids masked for players who hide
               them, scenario summaries attached. the sql is in db/scores.ts.
*/

import type {
  BoardResponse, BoardRow, BuildDetailResponse, LiveRulesetResponse, ScenarioCell, ScenarioSummary,
} from '@/domain/leaderboard/api'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import { canonicalResonatorId } from '@/domain/leaderboard/identity'
import { HttpError } from '../../lib/http.ts'
import { getBuild } from '../../db/builds.ts'
import { getRead } from '../../db/cards.ts'
import { getPlayer } from '../../db/identity.ts'
import { getRuleset, liveRulesetId, rulesetScenarios, scenarioMembers, scenariosByIds, scenariosFor, type ScenarioRow } from '../../db/rulesets.ts'
import { boardEntryFor, boardRows, cellRanks, scoresFor, type BoardFilter } from '../../db/scores.ts'

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

export async function requireLiveRuleset(db: D1Database): Promise<string> {
  const id = await liveRulesetId(db)
  if (!id) throw new HttpError('not_found', 'no live ruleset yet')
  return id
}

const optionalText = (params: URLSearchParams, name: string, pattern: RegExp): string | null => {
  const value = params.get(name)
  if (value == null || value === '') return null
  if (!pattern.test(value)) throw new HttpError('bad_request', `bad ${name}`)
  return value
}

export function parseBoardFilter(rulesetId: string, resonatorId: string, params: URLSearchParams): BoardFilter {
  if (!/^\d{4}$/.test(resonatorId)) throw new HttpError('bad_request', 'bad resonator id')
  const sequence = optionalText(params, 'sequence', /^[0-6]$/)
  const limit = Number(params.get('limit') ?? DEFAULT_LIMIT)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new HttpError('bad_request', `limit is 1 to ${MAX_LIMIT}`)
  // the current cursor is a validated numeric offset; filtering and pagination use the same ruleset.
  const cursor = optionalText(params, 'cursor', /^\d{1,7}$/)
  return {
    rulesetId,
    resonatorId: canonicalResonatorId(resonatorId),
    team: optionalText(params, 'team', /^\d{4}(-\d{4}){2}$/),
    member: optionalText(params, 'member', /^\d{4}$/),
    weapon: optionalText(params, 'weapon', /^\d{8}$/),
    sequence: sequence == null ? null : Number(sequence),
    region: optionalText(params, 'region', /^\d$/),
    limit,
    offset: cursor == null ? 0 : Number(cursor),
  }
}

export async function scenarioSummaries(db: D1Database, scenarios: ScenarioRow[]): Promise<Map<string, ScenarioSummary>> {
  const members = await scenarioMembers(db, scenarios.map((scenario) => scenario.id))
  return new Map(scenarios.map((scenario) => [scenario.id, {
    id: scenario.id, teamKey: scenario.team_key, teamRank: scenario.team_rank,
    members: members.get(scenario.id) ?? [], weaponId: scenario.weapon_id, weaponRole: scenario.weapon_role,
  }]))
}

export async function board(db: D1Database, filter: BoardFilter): Promise<BoardResponse> {
  const { rows, total } = await boardRows(db, filter)
  const summaries = await scenarioSummaries(db, await scenariosByIds(db, rows.map((row) => row.scenario_id)))
  const out: BoardRow[] = rows.map((row) => ({
    rank: row.rank, buildId: row.build_id, uid: row.hide_uid ? null : row.uid, name: row.last_name, region: row.region,
    sequence: row.sequence, score: row.score, dps: row.dps, drawnAt: row.drawn_at, scenario: summaries.get(row.scenario_id)!,
  }))
  const next = filter.offset + rows.length
  return { rulesetId: filter.rulesetId, total, rows: out, nextCursor: next < total ? String(next) : null }
}

export async function buildDetail(db: D1Database, rulesetId: string, buildId: string): Promise<BuildDetailResponse> {
  const build = await getBuild(db, buildId)
  if (!build || build.state !== 'active') throw new HttpError('not_found', 'no such build')
  const [read, player] = await Promise.all([getRead(db, build.read_id), getPlayer(db, build.uid)])
  if (!read?.snapshot || !player || player.opted_out_at != null) throw new HttpError('not_found', 'no such build')
  const scenarios = await scenariosFor(db, rulesetId, build.resonator_id)
  const [summaries, scores, ranks, entry] = await Promise.all([scenarioSummaries(db, scenarios), scoresFor(db, build.id, rulesetId),
    cellRanks(db, build.id, rulesetId), boardEntryFor(db, rulesetId, build.id)])
  const byScenario = new Map(scores.map((score) => [score.scenario_id, score]))
  const cells: ScenarioCell[] = scenarios.map((scenario) => {
    const score = byScenario.get(scenario.id)
    return {
      scenario: summaries.get(scenario.id)!,
      status: score?.status ?? 'unsupported',
      reason: score ? score.error : 'not_scored_yet',
      score: score?.status === 'ok' ? score.score : null,
      dps: score?.dps ?? null,
      damage: score?.damage ?? null,
      duration: score?.duration ?? null,
      rank: ranks.get(scenario.id) ?? null,
      programSha256: score?.program_sha256 ?? null,
    }
  })
  // the best cell is the one the board ranks the build by.
  const best = entry ? cells.find((cell) => cell.scenario.id === entry.best_scenario) ?? null : null
  const snapshot = JSON.parse(read.snapshot) as BuildSnapshot
  // privacy masking applies to both the response UID and the nested saved snapshot.
  const masked = player.hide_uid === 1
  return {
    rulesetId, buildId: build.id, uid: masked ? null : build.uid, name: player.last_name,
    submittedAt: build.created_at, drawnAt: build.drawn_at,
    snapshot: masked ? { ...snapshot, uid: '' } : snapshot,
    best, cells,
  }
}

export async function liveRuleset(db: D1Database): Promise<LiveRulesetResponse> {
  const id = await requireLiveRuleset(db)
  const ruleset = (await getRuleset(db, id))!
  const summaries = await scenarioSummaries(db, await rulesetScenarios(db, id))
  return { rulesetId: id, gameVer: ruleset.game_ver, liveAt: ruleset.live_at, scenarios: [...summaries.values()] }
}
