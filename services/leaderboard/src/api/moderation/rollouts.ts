/*
  Author: Runor Ewhro
  description: ruleset lifecycle routes for staff with rulesets.manage. ruleset files are uploaded through the api,
               then published, then rolled out: each board installs the ruleset as rolling and scores every kept build
               into it on the bulk lane, except the boards the rollout carries over (carry.ts), which take it at
               go-live without a rescore; the ruleset goes live when every board finishes (advanceRollouts, run by the
               hourly upkeep or /admin/sweep). cancelling a rollout drops its scores on every board.
*/

import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import type { ApiEnv } from '../../env.ts'
import {
  getRuleset, goLiveStatements, liveRulesetId, rulesetKey, rulesetResonators,
  FINGERPRINT_BODY_BYTES, hexOr, fingerprintCounts, scenarioFingerprintsStatement, validScenarioFingerprints,
} from '../../db/rulesets.ts'
import { finishRolloutStatement, getRollout, openRollouts, rolloutLiveStatement, startRolloutStatement, type RolloutKeep } from '../../db/rollouts.ts'
import { auditStatement } from '../../lib/audit.ts'
import { parseBuildId } from '../../lib/ids.ts'
import type { RouteContext } from '../router.ts'
import { authorize, staffAudit as audit, staffName } from '../auth/staff.ts'
import { rolledOut, rulesetJobs, syncBoards } from '../boardCommands.ts'
import { boardOf } from '../stubs.ts'
import { STALL_MS } from '../../board/BoardDO.ts'
import { sweepBoards } from '../maintenance.ts'
import { scenariosWithoutAnchors } from '@lb/scoring'
import { carriedResonators, carrySide } from './carry.ts'
import type { RulesetManifest } from '@lb/contract/ruleset'

// a ruleset file path: what the assembler writes, nothing that climbs out of the ruleset's folder
const FILE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/

// PUT /admin/rulesets/:id/files?path=: uploads one file of an unpublished ruleset; the manifest is uploaded last
export async function uploadRulesetFile(context: RouteContext): Promise<Response> {
  await authorize(context, 'rulesets.manage')
  const { env, params, url } = context
  const path = url.searchParams.get('path') ?? ''
  if (!FILE_PATH.test(path) || path.includes('..')) throw new HttpError('bad_request', 'path names a file inside the ruleset')
  // a published ruleset is immutable: its manifest hash is on record
  if (await getRuleset(env.LB, params.id)) throw new HttpError('duplicate', `ruleset ${params.id} is already published`)
  const body = await context.request.arrayBuffer()
  await env.LB_DATA.put(rulesetKey(params.id, path), body, { httpMetadata: { contentType: 'application/json' } })
  return json({ path, bytes: body.byteLength }, { status: 201 })
}

// POST /admin/rulesets/:id/fingerprint { fingerprint, scorer, scenarios, data, manifestSha256 }: stamps fingerprints
// on a ruleset that has none; existing values are not replaced. the ruleset, scorer and scenario fingerprints
// (scenario fingerprints include the scorer) are accepted only from a checkout that fingerprints the ruleset
// unchanged, because a different scorer's fingerprints would let a rollout keep scores they do not describe. data
// fingerprints include no scorer and are accepted from any checkout with the published manifest hash; they replace
// the recorded ones, because they are the folder's data read by this checkout's rules (tools/lib/fingerprint.mjs),
// and rulesets are compared by the same rules
export async function stampFingerprint(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'rulesets.manage')
  const { env, params } = context
  const body = await readJsonBody<{ fingerprint?: string; scorer?: string; generator?: string; evaluation?: string; scenarios?: unknown
    data?: unknown; manifestSha256?: string }>(
    context.request, FINGERPRINT_BODY_BYTES)
  if (typeof body.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(body.fingerprint)) throw new HttpError('bad_request', 'fingerprint is 64 hex characters')
  const parsed = (value: unknown) => {
    if (value === undefined) return null
    const fps = validScenarioFingerprints(value)
    if (!fps) throw new HttpError('bad_request', 'scenario fingerprints map <resonator>:<team>:<weapon> to 64 hex characters')
    return fps
  }
  const scenarios = parsed(body.scenarios), data = parsed(body.data)
  const scorer = typeof body.scorer === 'string' && /^[0-9a-f]{64}$/.test(body.scorer) ? body.scorer : null
  const ruleset = await getRuleset(env.LB, params.id)
  if (!ruleset) throw new HttpError('not_found', 'no such ruleset')
  if (data && body.manifestSha256 !== ruleset.manifest_sha256) {
    throw new HttpError('bad_request', `data fingerprints come from ${ruleset.id}'s published folder (manifest ${ruleset.manifest_sha256.slice(0, 12)})`)
  }
  const sameScorer = !ruleset.fingerprint || ruleset.fingerprint === body.fingerprint
  if (!sameScorer && !data) {
    throw new HttpError('duplicate', `${ruleset.id} was fingerprinted ${ruleset.fingerprint!.slice(0, 12)}, this checkout ${body.fingerprint.slice(0, 12)}: it scores differently`)
  }
  if (ruleset.fingerprint && sameScorer && !scenarios && !data) throw new HttpError('duplicate', `${ruleset.id} already has a fingerprint`)
  await env.LB.batch([
    ...(sameScorer ? [
      env.LB.prepare('UPDATE rulesets SET fingerprint = COALESCE(fingerprint, ?), scorer = COALESCE(scorer, ?) WHERE id = ?')
        .bind(body.fingerprint, scorer, ruleset.id),
      // scorer parts for a ruleset fingerprinted without parts, accepted only with its own scorer
      ...(scorer && (!ruleset.scorer || ruleset.scorer === scorer) && hexOr(body.generator) && hexOr(body.evaluation) ? [
        env.LB.prepare('UPDATE rulesets SET generator_fp = COALESCE(generator_fp, ?), evaluation_fp = COALESCE(evaluation_fp, ?) WHERE id = ?')
          .bind(hexOr(body.generator), hexOr(body.evaluation), ruleset.id)] : []),
      ...(scenarios ? [scenarioFingerprintsStatement(env.LB, ruleset.id, scenarios)] : []),
    ] : []),
    ...(data ? [scenarioFingerprintsStatement(env.LB, ruleset.id, data, 'data_fingerprint', { replace: true })] : []),
    audit(context, who, { action: 'ruleset.publish', subjectKind: 'ruleset', subjectId: ruleset.id,
      data: { fingerprint: sameScorer ? body.fingerprint : null, stamped: true, scenarios: sameScorer && scenarios ? Object.keys(scenarios).length : 0,
        data: data ? Object.keys(data).length : 0 } }),
  ])
  return json({ rulesetId: ruleset.id, fingerprint: sameScorer ? body.fingerprint : ruleset.fingerprint, ...await fingerprintCounts(env.LB, ruleset.id) })
}

// GET /admin/rulesets: every ruleset, newest first, with its rollout
export async function listRulesets(context: RouteContext): Promise<Response> {
  await authorize(context, 'rulesets.manage')
  const db = context.env.LB
  const { results } = await db.prepare(`SELECT r.id, r.no, r.status, r.engine_ver, r.rotation_ver, r.fingerprint, r.scorer, r.created_at, r.live_at,
      o.status AS rollout_status, o.started_at AS rollout_started_at, o.live_at AS rollout_live_at
    FROM rulesets r LEFT JOIN rollouts o ON o.ruleset_id = r.id ORDER BY r.created_at DESC LIMIT 50`).all()
  return json({ live: await liveRulesetId(db), rulesets: results })
}

// POST /admin/rulesets/:id/rollout { force, keep }: scores every kept build into a published ruleset
export async function startRollout(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'rulesets.manage')
  const { env, params, now } = context
  const db = env.LB
  const body = await readJsonBody<{ force?: boolean; keep?: boolean; allowSearch?: boolean }>(context.request)
    .catch(() => ({ force: false, keep: undefined, allowSearch: false }))
  const ruleset = await getRuleset(db, params.id)
  if (!ruleset || ruleset.status !== 'building') throw new HttpError('not_found', 'no such ruleset waiting to go live')
  // a scenario without offline anchors runs its own search per build, about a minute per cell, or days on a full
  // board
  if (!body.allowSearch) {
    const manifest = await (await env.LB_DATA.get(rulesetKey(ruleset.id, 'manifest.json')))?.json<RulesetManifest>()
    const missing = manifest ? scenariosWithoutAnchors(manifest) : []
    if (missing.length) {
      throw new HttpError('bad_request', `${missing.length} scenarios of ${ruleset.id} have no offline anchors (${missing.slice(0, 5).join(', ')}`
        + `${missing.length > 5 ? ', ...' : ''}): run anchorgen for them, or allow search to roll out anyway`)
    }
  }
  if (await getRollout(db, ruleset.id)) throw new HttpError('duplicate', `ruleset ${ruleset.id} was already rolled out`)
  const open = await openRollouts(db)
  if (open.length) throw new HttpError('duplicate', `ruleset ${open[0].ruleset_id} is still rolling out`)
  const from = await liveRulesetId(db)
  const live = from ? await getRuleset(db, from) : null
  // an unchanged scorer and data would score every build the same again
  if (!body.force && live?.fingerprint && live.fingerprint === ruleset.fingerprint) {
    throw new HttpError('bad_request', `${ruleset.id} has the live ruleset's fingerprint: nothing would score differently (force to rescore anyway)`)
  }
  // with a new scorer, old scores are kept on the scenarios whose every checked sample scored alike (BoardDO.cellsOf)
  const trusted = from && ruleset.scorer ? (await db.prepare(`SELECT COUNT(*) AS n FROM ruleset_check_scenarios WHERE ruleset_id = ?
      AND from_ruleset = ? AND scorer = ? AND samples > 0 AND differing = 0`).bind(ruleset.id, from, ruleset.scorer).first<{ n: number }>())?.n ?? 0
    : 0
  const keep: RolloutKeep = body.keep === false ? 'none' : trusted > 0 ? 'data' : 'scenario'
  const boards = (await rulesetResonators(db, ruleset.id)).length
  // boards the new ruleset leaves as they are take it at go-live without a rescore; a forced rollout or one with
  // keep 'none' rescores every board
  const carried = from && keep !== 'none' && !body.force ? await carriedBoards(env, from, ruleset.id) : []
  await db.batch([
    startRolloutStatement(db, { ruleset_id: ruleset.id, from_ruleset: from, keep, boards, started_by: staffName(who), started_at: now }),
    ...(carried.length ? [db.prepare(`INSERT INTO rollout_carry (ruleset_id, resonator_id) SELECT ?, value FROM json_each(?)`)
      .bind(ruleset.id, JSON.stringify(carried))] : []),
    audit(context, who, { action: 'ruleset.rollout', subjectKind: 'ruleset', subjectId: ruleset.id,
      data: { from, boards, keep, carried: carried.length } }),
  ])
  // each board installs the ruleset and fans its builds out from its alarm; a carried board waits for go-live
  await syncBoards(env, ruleset.id)
  return json({ rulesetId: ruleset.id, from, boards, keep, carried }, { status: 202 })
}

// the boards a rollout from `from` to `to` leaves as they are, or none when either ruleset's files are missing
async function carriedBoards(env: ApiEnv, from: string, to: string): Promise<string[]> {
  const [before, after] = await Promise.all([carrySide(env, from), carrySide(env, to)])
  return before && after ? carriedResonators(before, after) : []
}

// POST /admin/rulesets/:id/rollout/cancel: stops rescoring; each board drops the rolling ruleset's tables
export async function cancelRollout(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'rulesets.manage')
  const { env, params, now } = context
  const rollout = await getRollout(env.LB, params.id)
  if (!rollout || rollout.status !== 'scoring') throw new HttpError('not_found', 'no rollout in progress for this ruleset')
  await env.LB.batch([finishRolloutStatement(env.LB, rollout.ruleset_id, 'cancelled', now),
    audit(context, who, { action: 'ruleset.rollout_cancel', subjectKind: 'ruleset', subjectId: rollout.ruleset_id })])
  await syncBoards(env, rollout.ruleset_id)
  return json({ rulesetId: rollout.ruleset_id, cancelled: true })
}

// POST /admin/rulesets/:id/rescore { buildIds }: start these builds over (or every kept one) on the ruleset
export async function rescoreBuilds(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'rulesets.manage')
  const { env, params } = context
  const ruleset = await getRuleset(env.LB, params.id)
  if (!ruleset || ruleset.status === 'archived') throw new HttpError('not_found', 'no such open ruleset')
  const body = await readJsonBody<{ buildIds?: unknown }>(context.request).catch(() => ({ buildIds: undefined }))
  const named = Array.isArray(body.buildIds) ? body.buildIds.filter((id): id is string => typeof id === 'string') : null
  const byBoard = new Map<number, number[] | 'all'>()
  if (named) {
    for (const id of named) {
      const key = parseBuildId(id)
      if (!key) throw new HttpError('bad_request', `${id} is not a build id`)
      const list = byBoard.get(key.resonator)
      byBoard.set(key.resonator, [...(Array.isArray(list) ? list : []), key.local])
    }
  } else {
    for (const id of await rulesetResonators(env.LB, ruleset.id)) byBoard.set(Number(id), 'all')
  }
  // named builds run in the interactive lane; a whole ruleset runs as bulk work
  const lane = named ? 'interactive' as const : 'bulk' as const
  const sent = await Promise.all([...byBoard].map(([resonator, locals]) => boardOf(env, resonator).rescore(resonator, ruleset.no, locals, lane)))
  const builds = sent.reduce((a, b) => a + b, 0)
  await audit(context, who, { action: 'ruleset.rescore', subjectKind: 'ruleset', subjectId: ruleset.id, data: { builds, named: !!named } }).run()
  return json({ rulesetId: ruleset.id, builds }, { status: 202 })
}

// POST /admin/sweep { stallMs }: runs every board's upkeep and the rollout pass immediately
export async function sweepNow(context: RouteContext): Promise<Response> {
  await authorize(context, 'rulesets.manage')
  const body = await readJsonBody<{ stallMs?: number; standings?: boolean }>(context.request).catch(() => ({ stallMs: undefined, standings: false }))
  const stallMs = typeof body.stallMs === 'number' && body.stallMs >= 0 ? body.stallMs : STALL_MS
  // standings: every board rechecks each player's standing, as at a go-live (a repair for D1's player_boards)
  return json({ scoring: await sweepBoards(context.env, stallMs, { standings: body.standings === true }),
    rollouts: await advanceRollouts(context.env, context.now) })
}

export interface RolloutReport {
  // rulesets made live in this pass
  live: string[]
  // rollouts finished this pass
  done: string[]
}

// makes a rollout live once every board finishes; each board retires the old ruleset on its next catalog sync
export async function advanceRollouts(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, now: number): Promise<RolloutReport> {
  const db = env.LB
  const report: RolloutReport = { live: [], done: [] }
  for (const rollout of await openRollouts(db)) {
    if (!rolledOut(await rulesetJobs(env, rollout.ruleset_id, { force: false }))) continue
    const ruleset = await getRuleset(db, rollout.ruleset_id)
    const system = { actorKind: 'system' as const, actorId: null, subjectKind: 'ruleset' as const, subjectId: rollout.ruleset_id }
    if (ruleset?.status === 'building') {
      const previous = await liveRulesetId(db)
      await db.batch([...goLiveStatements(db, rollout.ruleset_id, now), rolloutLiveStatement(db, rollout.ruleset_id, now),
        auditStatement(db, { ...system, action: 'ruleset.activate', data: { previous, rollout: true } }, now)])
      report.live.push(rollout.ruleset_id)
    }
    await finishRolloutStatement(db, rollout.ruleset_id, 'done', now).run()
    await syncBoards(env, rollout.ruleset_id)
    report.done.push(rollout.ruleset_id)
  }
  return report
}

// GET /admin/rulesets/:id/progress: a ruleset's rollout and its boards' jobs
export async function rolloutStatus(env: Pick<ApiEnv, 'LB' | 'BOARDS'>, rulesetId: string) {
  const [rollout, progress] = await Promise.all([getRollout(env.LB, rulesetId), rulesetJobs(env, rulesetId, { force: false })])
  return { rollout, progress }
}
