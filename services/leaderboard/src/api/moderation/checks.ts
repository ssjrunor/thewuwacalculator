/*
  Author: Runor Ewhro
  description: sample checks for a rollout that keeps scores by data (lb verify).
               a scorer change moves every scenario fingerprint even when most
               builds score the same. the check sends the operator's tool a few
               stored live-ruleset scores from each scenario with unchanged data;
               the tool rescores them with the new scorer and posts the results
               one board at a time, and each part is compared with the board's
               numbers and the build's R2 detail object. one differing sample
               rescores that scenario in full, and other scenarios keep their
               scores (BoardDO.cellsOf). larger samples per scenario give
               stronger evidence.
*/

import type { ScenarioScore } from '@lb/scoring'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import { getRuleset, liveRulesetId } from '../../db/rulesets.ts'
import { formatBuildId, parseBuildId } from '../../lib/ids.ts'
import { toQ } from '../../lib/score.ts'
import { unpackSnapshot } from '../../lib/snapshotPack.ts'
import { cellResult } from '../../scorer/job.ts'
import { detailKey, fromBase64, gunzipJson, toBase64, type CellDetail, type DetailObject } from '../../scorer/messages.ts'
import { boardOf } from '../stubs.ts'
import type { RouteContext } from '../router.ts'
import { authorize, staffAudit as audit, staffName } from '../auth/staff.ts'
import { LEAN } from '../../board/store.ts'

/** the parts of a stored score a check compares: the board's numbers, then its detail. */
export const CHECKED_FIELDS = ['status', 'score', 'damage', 'flags', 'reason', 'stats', 'contribution', 'input', 'anchors', 'program'] as const
type Field = typeof CHECKED_FIELDS[number]

/** samples drawn per scenario: by default, and at most. */
const PER_SCENARIO = 2
const MAX_PER_SCENARIO = 10
/** results per post (the tool posts one board at a time, split to fit). */
const MAX_RESULTS = 400
/** byte limit of a check body; each result has its stats, contribution, input and anchors. */
const CHECK_BODY_BYTES = 8_000_000

/** a stored score as read by a check. */
export interface StoredScore {
  status: string
  score: number | null
  damage: number | null
  flags: number
  reason: string | null
  /** base64 of the packed stats. */
  stats: string | null
  detail: Pick<CellDetail, 'contribution' | 'input' | 'anchors' | 'program'> | null
}

async function checkTarget(context: RouteContext) {
  const ruleset = await getRuleset(context.env.LB, context.params.id)
  if (!ruleset || ruleset.status !== 'building') throw new HttpError('not_found', 'no such ruleset waiting to go live')
  if (!ruleset.scorer) throw new HttpError('bad_request', `${ruleset.id} was published without its scorer hash; publish it again with this tool`)
  const from = context.url.searchParams.get('from') ?? await liveRulesetId(context.env.LB)
  if (!from || from === ruleset.id) throw new HttpError('bad_request', 'no live ruleset to check against')
  return { ruleset, from }
}

/** scenario keys by resonator with the same data fingerprint on both rulesets, the set a data keep retains. */
async function samePairs(db: D1Database, to: string, from: string): Promise<Map<string, string[]>> {
  const { results } = await db.prepare(`SELECT n.resonator_id, substr(n.id, length(?1) + 2) AS key FROM scenarios n
      JOIN scenarios o ON o.ruleset_id = ?2 AND o.id = ?2 || substr(n.id, length(?1) + 1)
    WHERE n.ruleset_id = ?1 AND n.data_fingerprint IS NOT NULL AND n.data_fingerprint = o.data_fingerprint`)
    .bind(to, from).all<{ resonator_id: string; key: string }>()
  const pairs = new Map<string, string[]>()
  for (const row of results) pairs.set(row.resonator_id, [...pairs.get(row.resonator_id) ?? [], row.key])
  return pairs
}

/**
 * GET /admin/rulesets/:id/samples?per=&from=&resonator=: up to `per` stored scores of `from` (the live ruleset) on each
 * scenario with unchanged data, each with its build snapshot and the new scenario id; `resonator` limits the draw to
 * one board.
 */
export async function checkSamples(context: RouteContext): Promise<Response> {
  await authorize(context, 'rulesets.manage')
  const { env, url } = context
  const { ruleset, from } = await checkTarget(context)
  const per = Math.max(1, Math.min(MAX_PER_SCENARIO, Number(url.searchParams.get('per') ?? PER_SCENARIO) || PER_SCENARIO))
  const only = url.searchParams.get('resonator')
  const pairs = [...await samePairs(env.LB, ruleset.id, from)].filter(([resonator]) => only == null || resonator === only)
  const drawn = await Promise.all(pairs.map(async ([resonator, keys]) =>
    ({ resonator, keys, ...await boardOf(env, Number(resonator)).samples(Number(resonator), from, keys, per) })))
  const samples = drawn.flatMap((board) => board.rows.map((row) => ({
    buildId: formatBuildId({ resonator: Number(board.resonator), local: row.local }), scenarioId: `${ruleset.id}:${row.key}`,
    fromScenarioId: `${from}:${row.key}`, snapshot: unpackSnapshot(fromBase64(row.snap)) })))
  return json({ rulesetId: ruleset.id, from, scorer: ruleset.scorer, manifestSha256: ruleset.manifest_sha256, per,
    scenarios: drawn.reduce((sum, board) => sum + board.keys.length, 0), eligible: drawn.reduce((sum, board) => sum + board.eligible, 0),
    samples })
}

/**
 * returns the checked parts of a fresh score that differ from the stored one. a ruleset id appears in a score only as
 * a scenario id prefix ('<ruleset>:...'), so that prefix is mapped to the stored ruleset's; matches inside other text
 * (a short id in a stats string) are left as they are.
 */
export function differingFields(stored: StoredScore, score: ScenarioScore, key: string, to: string, from: string): Field[] {
  const fresh = cellResult({ local: 0, gen: 0, rs: 0, cell: 0, key }, score)
  const detail = JSON.parse(fresh.detail ?? 'null') as CellDetail | null
  const prefix = new RegExp(`(?<![\\w.-])${to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'g')
  const text = (value: unknown) => JSON.stringify(value ?? null).replace(prefix, `${from}:`)
  // contribution.team comes from the same run for display; scores stored before it existed compare without it
  const contribution = detail?.contribution && !stored.detail?.contribution?.team
    ? { ...detail.contribution, team: undefined } : detail?.contribution
  // a lean score (scored in bulk) has no breakdown or peaks yet: those are compared only where both scores have them.
  const lean = ((fresh.flags | stored.flags) & LEAN) !== 0
  const shown = (value: unknown) => lean ? null : value
  const input = (value: unknown) => {
    const members = (value as { members?: Array<Record<string, unknown>> } | null)?.members
    return lean && members ? { ...(value as object), members: members.map((member) => ({ ...member, controls: undefined })) } : value
  }
  const now: Record<Field, unknown> = {
    status: fresh.status, score: fresh.score == null ? null : toQ(fresh.score), damage: fresh.damage, flags: fresh.flags & ~LEAN, reason: fresh.reason,
    stats: fresh.stats ? toBase64(fresh.stats) : null,
    contribution: text(shown(contribution)), input: text(input(detail?.input)), anchors: text(detail?.anchors), program: detail?.program ?? null,
  }
  const then: Record<Field, unknown> = {
    status: stored.status, score: stored.score == null ? null : toQ(stored.score), damage: stored.damage, flags: stored.flags & ~LEAN,
    reason: stored.reason, stats: stored.stats,
    contribution: text(shown(stored.detail?.contribution)), input: text(input(stored.detail?.input)), anchors: text(stored.detail?.anchors),
    program: stored.detail?.program ?? null,
  }
  return CHECKED_FIELDS.filter((field) => now[field] !== then[field])
}

/**
 * POST /admin/rulesets/:id/verify { from, scorer, results: [{ buildId, scenarioId, result }] }: compares the ruleset
 * scorer's results for a sample (checkSamples) with the scores stored on `from` and records the check. only the
 * ruleset's own scorer may check it, and only on scenarios with unchanged data.
 */
export async function recordCheck(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'rulesets.manage')
  const body = await readJsonBody<{ from?: string; scorer?: string; results?: Array<{ buildId?: string; scenarioId?: string; result?: ScenarioScore }> }>(
    context.request, CHECK_BODY_BYTES)
  if (body.from) context.url.searchParams.set('from', body.from)
  const { env } = context
  const { ruleset, from } = await checkTarget(context)
  if (body.scorer !== ruleset.scorer) {
    throw new HttpError('bad_request', `${ruleset.id} was published with scorer ${ruleset.scorer!.slice(0, 12)}; these scores came from ${String(body.scorer).slice(0, 12)}`)
  }
  const results = Array.isArray(body.results) ? body.results : []
  if (!results.length || results.length > MAX_RESULTS) throw new HttpError('bad_request', `results holds 1 to ${MAX_RESULTS} scores`)
  const pairs = await samePairs(env.LB, ruleset.id, from)
  const differing: Array<{ buildId: string; scenarioId: string; fields: string[] }> = []
  const details = new Map<string, Promise<DetailObject | null>>()
  // a build a rollout kept whole reads an earlier ruleset's object (storedCell names it).
  const detailOf = (detailId: string, resonator: number, buildId: string) => {
    const key = detailKey(detailId, resonator, buildId)
    let found = details.get(key)
    if (!found) {
      found = env.LB_DATA.get(key).then(async (object) => object ? gunzipJson<DetailObject>(await object.arrayBuffer()) : null)
      details.set(key, found)
    }
    return found
  }
  // a check's weight is its sample count; duplicate samples count once
  const seen = new Set<string>()
  const scenarios = new Map<string, { samples: number; differing: number }>()
  for (const entry of results) {
    if (typeof entry.buildId !== 'string' || typeof entry.scenarioId !== 'string' || !entry.result || entry.result.scenarioId !== entry.scenarioId) {
      throw new HttpError('bad_request', 'each result names its build, its scenario, and the score for that scenario')
    }
    const pair = `${entry.buildId}\n${entry.scenarioId}`
    if (seen.has(pair)) throw new HttpError('bad_request', `${entry.buildId} on ${entry.scenarioId} is listed twice`)
    seen.add(pair)
    const id = parseBuildId(entry.buildId)
    const key = entry.scenarioId.startsWith(`${ruleset.id}:`) ? entry.scenarioId.slice(ruleset.id.length + 1) : null
    const notSample = () => new HttpError('bad_request', `${entry.buildId} on ${entry.scenarioId} is not a sample of ${from}`)
    if (!id || !key || !pairs.get(String(id.resonator))?.includes(key)) throw notSample()
    const numbers = await boardOf(env, id.resonator).storedCell(id.resonator, from, id.local, key)
    if (!numbers) throw notSample()
    const { detailId, ...stored } = numbers
    const detail = (await detailOf(detailId, id.resonator, entry.buildId))?.cells[key] ?? null
    const fields = differingFields({ ...stored, detail }, entry.result, key, ruleset.id, from)
    if (fields.length) differing.push({ buildId: entry.buildId, scenarioId: entry.scenarioId, fields })
    const tally = scenarios.get(key) ?? { samples: 0, differing: 0 }
    tally.samples += 1
    if (fields.length) tally.differing += 1
    scenarios.set(key, tally)
  }
  const db = env.LB
  // a scenario's verdict is what this post found of it, so checking a board again replaces that board's verdicts; the
  // totals are summed from the verdicts.
  const verdicts = [...scenarios].map(([key, tally]) => db.prepare(`INSERT INTO ruleset_check_scenarios (ruleset_id, from_ruleset, key, scorer,
      samples, differing, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (ruleset_id, from_ruleset, key) DO UPDATE SET
      scorer = excluded.scorer, samples = excluded.samples, differing = excluded.differing, checked_at = excluded.checked_at`)
    .bind(ruleset.id, from, key, ruleset.scorer, tally.samples, tally.differing, context.now))
  await db.batch([
    ...verdicts,
    db.prepare(`INSERT INTO ruleset_checks (ruleset_id, from_ruleset, scorer, samples, differing, checked_by, checked_at)
      SELECT ?1, ?2, ?3, COALESCE(SUM(samples), 0), COALESCE(SUM(differing), 0), ?4, ?5 FROM ruleset_check_scenarios
      WHERE ruleset_id = ?1 AND from_ruleset = ?2 AND scorer = ?3
      ON CONFLICT (ruleset_id, from_ruleset) DO UPDATE SET scorer = excluded.scorer, samples = excluded.samples,
        differing = excluded.differing, checked_by = excluded.checked_by, checked_at = excluded.checked_at`)
      .bind(ruleset.id, from, ruleset.scorer, staffName(who), context.now),
    audit(context, who, { action: 'ruleset.check', subjectKind: 'ruleset', subjectId: ruleset.id,
      data: { from, samples: results.length, scenarios: scenarios.size, differing: differing.slice(0, 20) } }),
  ])
  const kept = [...scenarios.values()].filter((tally) => tally.differing === 0).length
  return json({ rulesetId: ruleset.id, from, samples: results.length, differing, scenarios: { checked: scenarios.size, kept },
    keep: kept ? 'data' : 'scenario' })
}
