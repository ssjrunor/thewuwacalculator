/*
  Author: Runor Ewhro
  description: public read routes: GET /boards, GET /boards/:resonatorId (a page
               at any offset), /counts and /stats, GET /builds/:id and
               /builds/:id/cells/:scenarioId, GET /builds/:id/player,
               GET /players/:uid, GET /activity and GET /rulesets/live. each is
               edge-cached under its source's version (lib/cache.ts): a board's
               counter for its pages, the person's counter for a profile. a
               uid's profile covers every build of the uids on its account
               (api/people.ts); an owner's view adds their hidden builds and is
               not cached.
*/

import { HttpError, json } from '../../lib/http.ts'
import { clockJson, ownedOrPublicJson, publicJson, type CachedRead } from '../../lib/cache.ts'
import { uidToText } from '../../lib/ids.ts'
import { getListedPlayer, getPlayer, isMasked, sessionHasUid } from '../../db/identity.ts'
import { liveRulesetId } from '../../db/rulesets.ts'
import { optionalSession } from '../auth/sessions.ts'
import { personOf } from '../people.ts'
import { buildViewOf, type BuildRef } from '../builds/lifecycle.ts'
import { boardOf } from '../stubs.ts'
import type { RouteContext } from '../router.ts'
import type { BuildView } from '../../board/reads.ts'
import {
  activity, board, boardCounts, boards, boardStats, boardsVersion, buildDetail, cellDetail, liveRuleset, parseBoardQuery, parseResonator,
  parseSrFilter, playerProfile, profileVersion, requireLiveRuleset,
} from './queries.ts'

const BOARD_CACHE_S = 120
const DETAIL_CACHE_S = 600
const ACTIVITY_CACHE_S = 30
const ACTIVITY_LIMIT = 200

const read = (context: RouteContext, version: CachedRead['version']): CachedRead => ({ url: context.url, ctx: context.ctx, version })
const boardVersion = (context: RouteContext, resonator: number) => () => boardOf(context.env, resonator).ver(resonator)

export async function getBoard(context: RouteContext): Promise<Response> {
  const query = parseBoardQuery(context.params.resonatorId, context.url.searchParams)
  return publicJson(read(context, boardVersion(context, query.resonator)), BOARD_CACHE_S, () => board(context.env, query))
}

export async function getBoardCounts(context: RouteContext): Promise<Response> {
  const resonator = parseResonator(context.params.resonatorId)
  const filter = parseSrFilter(context.url.searchParams)
  return publicJson(read(context, boardVersion(context, resonator)), BOARD_CACHE_S, () => boardCounts(context.env, resonator, filter))
}

export async function getBoardStats(context: RouteContext): Promise<Response> {
  const resonator = parseResonator(context.params.resonatorId)
  return publicJson(read(context, boardVersion(context, resonator)), BOARD_CACHE_S, () => boardStats(context.env, resonator))
}

// whether the request comes from a session that has this uid (held, or linked to its account)
export async function viewerOwns(context: RouteContext, uid: string): Promise<boolean> {
  const session = await optionalSession(context)
  return session ? sessionHasUid(context.env.LB, session, uid) : false
}

// returns a build the viewer may open: a kept build, not hidden, with a listed player, or any
// kept build of the viewer's own
export async function visibleBuild(context: RouteContext): Promise<{ ref: BuildRef; view: BuildView; own: boolean; uid: string }> {
  const found = await buildViewOf(context.env, context.params.id)
  if (!found || found.view.row.state !== 'active') throw new HttpError('not_found', "hmm... this build isn't available. it may have been hidden or deleted.")
  const uid = uidToText(found.view.row.uid)
  const own = await viewerOwns(context, uid)
  if (!own && (found.view.row.ownerHidden || !await getListedPlayer(context.env.LB, uid))) throw new HttpError('not_found', "hmm... this build isn't available. it may have been hidden or deleted.")
  return { ...found, own, uid }
}

export async function getBuildDetail(context: RouteContext): Promise<Response> {
  const { ref, view, own } = await visibleBuild(context)
  return ownedOrPublicJson(read(context, boardVersion(context, ref.resonator)), own, DETAIL_CACHE_S,
    () => buildDetail(context.env, ref.resonator, ref.id, view, own))
}

// one cell's input and damage split for the app's cell card
export async function getCellDetail(context: RouteContext): Promise<Response> {
  const { ref, view, own } = await visibleBuild(context)
  if (!view.row.rulesetId) throw new HttpError('not_found', "no boards yet... scoring hasn't started. check back later :P")
  return ownedOrPublicJson(read(context, boardVersion(context, ref.resonator)), own, DETAIL_CACHE_S,
    () => cellDetail(context.env, ref.resonator, ref.id, view.row.rulesetId!, context.params.scenarioId, view.row.detailId))
}

export async function getLiveRuleset(context: RouteContext): Promise<Response> {
  return publicJson(read(context, async () => (await liveRulesetId(context.env.LB)) ?? ''), BOARD_CACHE_S, () => liveRuleset(context.env.LB))
}

export async function getBoards(context: RouteContext): Promise<Response> {
  const rulesetId = await requireLiveRuleset(context.env.LB)
  return publicJson(read(context, () => boardsVersion(context.env.LB)), BOARD_CACHE_S, () => boards(context.env, rulesetId))
}

// a public profile by uid; hidden uids are not looked up by their digits, so a hidden uid cannot be probed, and
// anonymous profiles return only to their owner
export async function getPlayerProfile(context: RouteContext): Promise<Response> {
  const { env, params } = context
  if (!/^\d{9}$/.test(params.uid)) throw new HttpError('bad_request', "hmm... a UID needs all 9 digits. check it and try again :P")
  const rulesetId = await requireLiveRuleset(env.LB)
  const player = await getListedPlayer(env.LB, params.uid)
  if (!player) throw new HttpError('not_found', "hmm... this player isn't available. check the UID; the profile may also be private or removed.")
  if (player.hide_uid || isMasked(player)) {
    // the uid's owner reads their own profile without the hidden and anonymous checks, and that response is not
    // cached
    if (!await viewerOwns(context, params.uid)) throw new HttpError('not_found', "hmm... this player isn't available. check the UID; the profile may also be private or removed.")
    return json(await playerProfile(env, rulesetId, player, true, await personOf(env.LB, player.uid, { own: true })))
  }
  const person = await personOf(env.LB, player.uid)
  return publicJson(read(context, () => profileVersion(env.LB, person)), BOARD_CACHE_S, () => playerProfile(env, rulesetId, player, true, person))
}

// the profile of a build's owner; reaches players with hidden uids, but not anonymous players
export async function getBuildPlayer(context: RouteContext): Promise<Response> {
  const { env } = context
  const rulesetId = await requireLiveRuleset(env.LB)
  const { own, uid } = await visibleBuild(context)
  const player = await getPlayer(env.LB, uid)
  if (!player || (isMasked(player) && !own)) throw new HttpError('not_found', "hmm... this player isn't available. check the UID; the profile may also be private or removed.")
  const person = await personOf(env.LB, uid, { own })
  return ownedOrPublicJson(read(context, () => profileVersion(env.LB, person)), own, BOARD_CACHE_S,
    () => playerProfile(env, rulesetId, player, player.hide_uid !== 1, person))
}

export async function getActivity(context: RouteContext): Promise<Response> {
  const rulesetId = await requireLiveRuleset(context.env.LB)
  const raw = context.url.searchParams.get('limit')
  const limit = raw == null ? 20 : Number(raw)
  if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVITY_LIMIT) throw new HttpError('bad_request', `limit is 1 to ${ACTIVITY_LIMIT}`)
  // `from`: the first moment the page shows, for its per-board counts (a local midnight, so one url a day per zone)
  const rawFrom = context.url.searchParams.get('from')
  const from = rawFrom == null ? undefined : Number(rawFrom)
  if (from !== undefined && !Number.isSafeInteger(from)) throw new HttpError('bad_request', 'from is a time in milliseconds')
  return clockJson(context, 15_000, ACTIVITY_CACHE_S, () => activity(context.env, rulesetId, limit, Date.now(), from))
}
