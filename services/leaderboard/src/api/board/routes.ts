/*
  Author: Runor Ewhro
  description: the public reads: GET /boards/:resonatorId, GET /builds/:id,
               GET /builds/:id/scenarios/:scenarioId/rotation and
               GET /rulesets/live. all are edge-cached; a build change purges
               nothing yet, so caches stay short.
*/

import { HttpError, json } from '../../lib/http.ts'
import { getBuild } from '../../db/builds.ts'
import { scoresFor } from '../../db/scores.ts'
import type { RouteContext } from '../router.ts'
import { board, buildDetail, liveRuleset, parseBoardFilter, requireLiveRuleset } from './queries.ts'

const BOARD_CACHE_S = 120
const DETAIL_CACHE_S = 600

export async function getBoard(context: RouteContext): Promise<Response> {
  const rulesetId = await requireLiveRuleset(context.env.LB)
  const filter = parseBoardFilter(rulesetId, context.params.resonatorId, context.url.searchParams)
  return json(await board(context.env.LB, filter), { cacheSeconds: BOARD_CACHE_S })
}

export async function getBuildDetail(context: RouteContext): Promise<Response> {
  const rulesetId = await requireLiveRuleset(context.env.LB)
  return json(await buildDetail(context.env.LB, rulesetId, context.params.id), { cacheSeconds: DETAIL_CACHE_S })
}

/** the generated program behind one cell, served from LB_DATA by its content hash. */
export async function getRotation(context: RouteContext): Promise<Response> {
  const { env, params } = context
  const rulesetId = await requireLiveRuleset(env.LB)
  const build = await getBuild(env.LB, params.id)
  if (!build || build.state !== 'active') throw new HttpError('not_found', 'no such build')
  const score = (await scoresFor(env.LB, build.id, rulesetId)).find((row) => row.scenario_id === params.scenarioId)
  if (!score?.program_sha256) throw new HttpError('not_found', 'no rotation for this scenario')
  const object = await env.LB_DATA.get(`rotations/${score.program_sha256}.json`)
  if (!object) throw new HttpError('not_found', 'rotation not stored')
  return new Response(object.body, { headers: { 'content-type': 'application/json; charset=utf-8',
    // content-addressed, so it never changes.
    'cache-control': 'public, max-age=86400, immutable', etag: `"${score.program_sha256}"` } })
}

export async function getLiveRuleset(context: RouteContext): Promise<Response> {
  return json(await liveRuleset(context.env.LB), { cacheSeconds: BOARD_CACHE_S })
}
