/*
  Author: Runor Ewhro
  description: /admin/* behind cloudflare access: the reports queue, hiding or
               restoring builds, blocking cards, and the ruleset lifecycle
               (publish a ruleset uploaded to LB_DATA, rescore every active
               build into it, watch progress, make it live). every change is
               audited with the admin's identity.
*/

import type { RulesetManifest, RulesetRefsFile } from '@/domain/leaderboard/ruleset'
import { sha256Hex } from '@/domain/leaderboard/canonical'
import type { AccessIdentity } from '../../lib/access.ts'
import { verifyAccess } from '../../lib/access.ts'
import { auditStatement, type AuditEntry } from '../../lib/audit.ts'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import { endBuildStatement, getBuild, restoreHiddenStatement } from '../../db/builds.ts'
import { getCard } from '../../db/cards.ts'
import { blockCardStatement, getReport, openReports, resolveReportStatement } from '../../db/moderation.ts'
import {
  activeBuildIdsFor, dropArchivedScoresStatement, getRuleset, goLiveStatements, liveRulesetId, publishStatements, rulesetKey,
} from '../../db/rulesets.ts'
import { openJobs, removeBoardEntriesStatement } from '../../db/scores.ts'
import type { RouteContext } from '../router.ts'

async function admin(context: RouteContext): Promise<AccessIdentity> {
  return verifyAccess(context.request, { team: context.env.ACCESS_TEAM_DOMAIN, audience: context.env.ACCESS_AUD })
}

const audit = (context: RouteContext, who: AccessIdentity, entry: Omit<AuditEntry, 'actorKind' | 'actorId'>) =>
  auditStatement(context.env.LB, { actorKind: 'admin', actorId: who.email ?? who.subject, ...entry }, context.now)

export async function listReports(context: RouteContext): Promise<Response> {
  await admin(context)
  return json({ reports: await openReports(context.env.LB, 200) })
}

export async function resolveReport(context: RouteContext): Promise<Response> {
  const who = await admin(context)
  const body = await readJsonBody<{ status?: string; resolution?: string; hideBuild?: boolean; blockCard?: boolean }>(context.request)
  if (body.status !== 'resolved' && body.status !== 'dismissed') throw new HttpError('bad_request', 'status is resolved or dismissed')
  const report = await getReport(context.env.LB, context.params.id)
  if (!report) throw new HttpError('not_found', 'no such report')
  const build = await getBuild(context.env.LB, report.build_id)
  const db = context.env.LB
  await db.batch([
    resolveReportStatement(db, report.id, body.status, body.resolution ?? null, context.now),
    ...(body.hideBuild && build ? [endBuildStatement(db, build.id, 'hidden', context.now), removeBoardEntriesStatement(db, build.id)] : []),
    ...(body.blockCard && build ? [blockCardStatement(db, build.card_id)] : []),
    audit(context, who, { action: `report.${body.status}`, subjectKind: 'report', subjectId: report.id,
      data: { hideBuild: !!body.hideBuild, blockCard: !!body.blockCard } }),
  ])
  return json({ ok: true })
}

export async function hideBuild(context: RouteContext): Promise<Response> {
  const who = await admin(context)
  const build = await getBuild(context.env.LB, context.params.id)
  if (!build) throw new HttpError('not_found', 'no such build')
  const db = context.env.LB
  await db.batch([endBuildStatement(db, build.id, 'hidden', context.now), removeBoardEntriesStatement(db, build.id),
    audit(context, who, { action: 'build.hide', subjectKind: 'build', subjectId: build.id })])
  return json({ ok: true })
}

/** a restored build returns as history; the owner chooses whether it is active again. */
export async function restoreBuild(context: RouteContext): Promise<Response> {
  const who = await admin(context)
  const db = context.env.LB
  await db.batch([restoreHiddenStatement(db, context.params.id),
    audit(context, who, { action: 'build.restore', subjectKind: 'build', subjectId: context.params.id })])
  return json({ ok: true })
}

export async function blockCard(context: RouteContext): Promise<Response> {
  const who = await admin(context)
  const card = await getCard(context.env.LB, context.params.id)
  if (!card) throw new HttpError('not_found', 'no such card')
  const db = context.env.LB
  await db.batch([blockCardStatement(db, card.id), audit(context, who, { action: 'card.block', subjectKind: 'card', subjectId: card.id })])
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
  const who = await admin(context)
  const { env, params, now } = context
  const body = await readJsonBody<{ manifestSha256?: string }>(context.request)
  if (await getRuleset(env.LB, params.id)) throw new HttpError('duplicate', `ruleset ${params.id} is already published`)
  const { value: manifest, text } = await readObjectJson<RulesetManifest>(env.LB_DATA, rulesetKey(params.id, 'manifest.json'))
  const sha = await sha256Hex(text)
  if (manifest.id !== params.id || sha !== body.manifestSha256) {
    throw new HttpError('bad_request', `uploaded manifest hashes ${sha}, expected ${body.manifestSha256}`)
  }
  const refs = manifest.files.refs
    ? (await readObjectJson<RulesetRefsFile>(env.LB_DATA, rulesetKey(params.id, manifest.files.refs))).value.refs
    : []
  const statements = publishStatements(env.LB, manifest, sha, refs, now)
  // d1 batches are transactions; keep each well under the statement limit.
  for (let start = 0; start < statements.length; start += 500) await env.LB.batch(statements.slice(start, start + 500))
  await audit(context, who, { action: 'ruleset.publish', subjectKind: 'ruleset', subjectId: params.id,
    data: { manifestSha256: sha, scenarios: manifest.scenarios.length, refs: refs.length } }).run()
  return json({ rulesetId: params.id, scenarios: manifest.scenarios.length, refs: refs.length }, { status: 201 })
}

/** queue every active build of the ruleset's resonators for scoring into it. */
export async function rescoreRuleset(context: RouteContext): Promise<Response> {
  const who = await admin(context)
  const { env, params } = context
  const ruleset = await getRuleset(env.LB, params.id)
  if (!ruleset || ruleset.status === 'archived') throw new HttpError('not_found', 'no such open ruleset')
  const buildIds = await activeBuildIdsFor(env.LB, ruleset.id)
  for (let start = 0; start < buildIds.length; start += 100) {
    await env.SCORE_QUEUE.sendBatch(buildIds.slice(start, start + 100)
      .map((buildId) => ({ body: { kind: 'fanout' as const, buildId, rulesetId: ruleset.id } })))
  }
  await audit(context, who, { action: 'ruleset.rescore', subjectKind: 'ruleset', subjectId: ruleset.id,
    data: { builds: buildIds.length } }).run()
  return json({ rulesetId: ruleset.id, builds: buildIds.length }, { status: 202 })
}

export async function rulesetProgress(context: RouteContext): Promise<Response> {
  await admin(context)
  const ruleset = await getRuleset(context.env.LB, context.params.id)
  if (!ruleset) throw new HttpError('not_found', 'no such ruleset')
  const [jobs, builds] = await Promise.all([openJobs(context.env.LB, ruleset.id), activeBuildIdsFor(context.env.LB, ruleset.id)])
  return json({ rulesetId: ruleset.id, status: ruleset.status, activeBuilds: builds.length, jobs })
}

/** make a fully rescored ruleset live and archive the previous one. */
export async function activateRuleset(context: RouteContext): Promise<Response> {
  const who = await admin(context)
  const { env, params, now } = context
  const ruleset = await getRuleset(env.LB, params.id)
  if (!ruleset || ruleset.status !== 'building') throw new HttpError('not_found', 'no such building ruleset')
  const jobs = await openJobs(env.LB, ruleset.id)
  const body = await readJsonBody<{ allowFailed?: boolean }>(context.request).catch(() => ({ allowFailed: false }))
  if (jobs.scoring > 0) throw new HttpError('forbidden', `${jobs.scoring} builds are still scoring`)
  if (jobs.failed > 0 && !body.allowFailed) throw new HttpError('forbidden', `${jobs.failed} builds failed to score`)
  const previous = await liveRulesetId(env.LB)
  await env.LB.batch([...goLiveStatements(env.LB, ruleset.id, now),
    audit(context, who, { action: 'ruleset.activate', subjectKind: 'ruleset', subjectId: ruleset.id, data: { previous } })])
  if (previous && previous !== ruleset.id) await dropArchivedScoresStatement(env.LB, previous).run()
  return json({ rulesetId: ruleset.id, previous })
}
