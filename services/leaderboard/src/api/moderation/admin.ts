/*
  Author: Runor Ewhro
  description: /admin/* routes for staff (auth/staff.ts): the reports queue,
               hiding and restoring builds, submitting and blocking cards, and
               the ruleset lifecycle (publishing a ruleset uploaded to LB_DATA,
               progress, manual go-live; rollouts and rescores are in
               rollouts.ts). each route requires one permission, and every change
               is audited with the staff member.
*/

import type { StaffReportsResponse } from '@lb/contract/api'
import type { RulesetManifest } from '@lb/contract/ruleset'
import { sha256Hex } from '@lb/contract/canonical'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import { getReport, openReports, resolveReportStatement } from '../../db/moderation.ts'
import {
  getRuleset, goLiveStatements, liveRulesetId, nextRulesetNo, publishStatements, rulesetKey,
  FINGERPRINT_BODY_BYTES, hexOr, scenarioFingerprintsStatement, validScenarioFingerprints,
} from '../../db/rulesets.ts'
import { buildRef, type BuildRef } from '../builds/lifecycle.ts'
import { cardRef } from '../stubs.ts'
import { rulesetJobs, syncBoards } from '../boardCommands.ts'
import type { Staff } from '../auth/staff.ts'
import type { RouteContext } from '../router.ts'
import { cardStatus, takeCard } from '../cards/routes.ts'
import { getComment } from '../../db/comments.ts'
import { authorize, staffAudit as audit } from '../auth/staff.ts'
import { staffRemoveComment } from '../social/comments.ts'
import { staffReport } from './tools.ts'
import { rolloutStatus } from './rollouts.ts'

const staffActor = (who: Staff) => `${who.actorKind}:${who.actorId}`

/** hides a build for staff; its board ranks the player's next best build in its place, and the card id is returned
    for blocking. */
async function hideOnBoard(ref: BuildRef, who: Staff): Promise<string | null> {
  return (await ref.board.endBuild(ref.resonator, ref.local, 'hidden', staffActor(who)))?.card ?? null
}

async function blockCardId(context: RouteContext, cardId: string, who: Staff): Promise<boolean> {
  const card = cardRef(context.env, cardId)
  return card ? (await card.stub.block(card.shard, card.no, staffActor(who))) != null : false
}

export async function listReports(context: RouteContext): Promise<Response> {
  await authorize(context, 'reports.review')
  const body: StaffReportsResponse = { reports: (await openReports(context.env.LB, 200)).map(staffReport) }
  return json(body)
}

export async function resolveReport(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'reports.review')
  const body = await readJsonBody<{ status?: string; resolution?: string; hideBuild?: boolean; blockCard?: boolean; removeComment?: boolean }>(
    context.request)
  if (body.status !== 'resolved' && body.status !== 'dismissed') throw new HttpError('bad_request', 'status is resolved or dismissed')
  // closing a report can also hide its build, block its card or remove its comment, each with its own permission
  if (body.hideBuild) await authorize(context, 'builds.moderate')
  if (body.blockCard) await authorize(context, 'cards.moderate')
  if (body.removeComment) await authorize(context, 'comments.moderate')
  const report = await getReport(context.env.LB, context.params.id)
  if (!report) throw new HttpError('not_found', "hmm... we couldn't find that report. refresh the queue and try again.")
  if (body.removeComment && !report.comment_id) throw new HttpError('bad_request', 'this report is not about a comment')
  const db = context.env.LB
  const ref = body.hideBuild || body.blockCard ? buildRef(context.env, report.build_id) : null
  // hiding ends the build on its board; blocking needs its card, which the board names (also for a build hidden before).
  const card = ref ? body.hideBuild ? await hideOnBoard(ref, who) : (await ref.board.build(ref.resonator, ref.local))?.card ?? null : null
  if (body.blockCard && card) await blockCardId(context, card, who)
  const comment = body.removeComment && report.comment_id ? await getComment(db, report.comment_id) : null
  await db.batch([
    resolveReportStatement(db, report.id, body.status, body.resolution ?? null, context.now),
    ...(comment?.removed_at == null && comment ? staffRemoveComment(context, who, comment, report.id) : []),
    audit(context, who, { action: `report.${body.status}`, subjectKind: 'report', subjectId: report.id,
      data: { hideBuild: !!body.hideBuild, blockCard: !!body.blockCard, removeComment: !!body.removeComment } }),
  ])
  return json({ ok: true })
}

export async function hideBuild(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'builds.moderate')
  const ref = buildRef(context.env, context.params.id)
  // the player's next best build of the resonator is ranked in its place.
  if (await hideOnBoard(ref, who) == null) throw new HttpError('not_found', "hmm... this build isn't available. it may have been hidden or deleted.")
  await audit(context, who, { action: 'build.hide', subjectKind: 'build', subjectId: ref.id }).run()
  return json({ ok: true })
}

/** a restored build returns as history, and is ranked again if it is the player's best. */
export async function restoreBuild(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'builds.moderate')
  const ref = buildRef(context.env, context.params.id)
  if (!await ref.board.restoreBuild(ref.resonator, ref.local, staffActor(who))) throw new HttpError('not_found', 'no hidden build by that id')
  await audit(context, who, { action: 'build.restore', subjectKind: 'build', subjectId: ref.id }).run()
  return json({ ok: true })
}

/**
 * submits a card for a moderator through the POST /cards intake (one fetch per link, queued read) without a turnstile
 * check or freshness limit, for test reads and re-checks; a new card is queued with 202, a known link returns its
 * current status with 200.
 */
export async function adminSubmitCard(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'cards.moderate')
  const body = await readJsonBody<{ input?: unknown }>(context.request)
  const { card, duplicate } = await takeCard(context, body.input)
  // moderator reads have no owner and claim the build for no uid
  if (!duplicate) await context.env.READ_QUEUE.send({ cardId: card.id })
  await audit(context, who, { action: 'card.admin_submit', subjectKind: 'card', subjectId: card.id, data: { duplicate } }).run()
  return json({ ...(await cardStatus(context.env, card)), duplicate }, { status: duplicate ? 200 : 202 })
}

export async function blockCard(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'cards.moderate')
  if (!await blockCardId(context, context.params.id, who)) throw new HttpError('not_found', "hmm... we couldn't find this card. check the link or submit it again :P")
  await audit(context, who, { action: 'card.block', subjectKind: 'card', subjectId: context.params.id }).run()
  return json({ ok: true })
}

async function readObjectJson<T>(bucket: R2Bucket, key: string): Promise<{ value: T; text: string }> {
  const object = await bucket.get(key)
  if (!object) throw new HttpError('not_found', `${key} is not in LB_DATA`)
  const text = await object.text()
  return { value: JSON.parse(text) as T, text }
}

/** record a ruleset already uploaded to LB_DATA as `building`; the caller names the manifest hash it uploaded. */
export async function publishRuleset(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'rulesets.manage')
  const { env, params, now } = context
  const body = await readJsonBody<{ manifestSha256?: string; fingerprint?: string; scorer?: string; generator?: string; evaluation?: string
    scenarios?: unknown; data?: unknown }>(context.request, FINGERPRINT_BODY_BYTES)
  if (await getRuleset(env.LB, params.id)) throw new HttpError('duplicate', `ruleset ${params.id} is already published`)
  const { value: manifest, text } = await readObjectJson<RulesetManifest>(env.LB_DATA, rulesetKey(params.id, 'manifest.json'))
  const sha = await sha256Hex(text)
  if (manifest.id !== params.id || sha !== body.manifestSha256) {
    throw new HttpError('bad_request', `uploaded manifest hashes ${sha}, expected ${body.manifestSha256}`)
  }
  // reference values stay in the R2 package; the catalog stores the scenarios, numbered into each resonator's cells
  const statements = publishStatements(env.LB, manifest, sha, await nextRulesetNo(env.LB), now)
  // d1 batches are transactions; keep each well under the statement limit.
  for (let start = 0; start < statements.length; start += 500) await env.LB.batch(statements.slice(start, start + 500))
  if (typeof body.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(body.fingerprint)) {
    const scorer = hexOr(body.scorer)
    // the scorer's parts go with it, or not at all.
    const parts = scorer ? [hexOr(body.generator), hexOr(body.evaluation)] : [null, null]
    await env.LB.prepare('UPDATE rulesets SET fingerprint = ?, scorer = ?, generator_fp = ?, evaluation_fp = ? WHERE id = ?')
      .bind(body.fingerprint, scorer, ...(parts[0] && parts[1] ? parts : [null, null]), params.id).run()
    // scenario fingerprints let a rollout keep the scores of scenarios that score the same on this ruleset
    const scenarios = validScenarioFingerprints(body.scenarios)
    if (scenarios) await scenarioFingerprintsStatement(env.LB, params.id, scenarios).run()
    const data = validScenarioFingerprints(body.data)
    if (data) await scenarioFingerprintsStatement(env.LB, params.id, data, 'data_fingerprint').run()
  }
  await audit(context, who, { action: 'ruleset.publish', subjectKind: 'ruleset', subjectId: params.id,
    data: { manifestSha256: sha, scenarios: manifest.scenarios.length } }).run()
  return json({ rulesetId: params.id, scenarios: manifest.scenarios.length }, { status: 201 })
}

export async function rulesetProgress(context: RouteContext): Promise<Response> {
  await authorize(context, 'rulesets.manage')
  const ruleset = await getRuleset(context.env.LB, context.params.id)
  if (!ruleset) throw new HttpError('not_found', 'no such ruleset')
  const [jobs, { rollout, progress }] = await Promise.all([rulesetJobs(context.env, ruleset.id, { force: false }),
    rolloutStatus(context.env, ruleset.id)])
  return json({ rulesetId: ruleset.id, status: ruleset.status, fingerprint: ruleset.fingerprint ?? null, activeBuilds: jobs.builds,
    jobs, rollout, progress })
}

/** make a fully rescored ruleset live and archive the previous one. */
export async function activateRuleset(context: RouteContext): Promise<Response> {
  const who = await authorize(context, 'rulesets.manage')
  const { env, params, now } = context
  const ruleset = await getRuleset(env.LB, params.id)
  if (!ruleset || ruleset.status !== 'building') throw new HttpError('not_found', 'no such building ruleset')
  const jobs = await rulesetJobs(env, ruleset.id)
  const body = await readJsonBody<{ allowFailed?: boolean }>(context.request).catch(() => ({ allowFailed: false }))
  if (jobs.scoring > 0) throw new HttpError('forbidden', `${jobs.scoring} builds are still scoring`)
  // a board lists a rollout's builds after its walk finishes; going live earlier would list them all at once
  if (jobs.installed === jobs.boards && jobs.settled < jobs.boards) {
    throw new HttpError('forbidden', `${jobs.boards - jobs.settled} boards are still walking or writing their entries`)
  }
  if (jobs.failed > 0 && !body.allowFailed) throw new HttpError('forbidden', `${jobs.failed} builds failed to score`)
  const previous = await liveRulesetId(env.LB)
  await env.LB.batch([...goLiveStatements(env.LB, ruleset.id, now),
    audit(context, who, { action: 'ruleset.activate', subjectKind: 'ruleset', subjectId: ruleset.id, data: { previous } })])
  // each board drops the old ruleset's tables when it goes live (BoardDO.syncCatalog)
  await syncBoards(env, ruleset.id)
  return json({ rulesetId: ruleset.id, previous })
}
