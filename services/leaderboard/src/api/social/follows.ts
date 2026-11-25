/*
  Author: Runor Ewhro
  description: account follows (the app's pins, stored on the account to sync
               across devices), the upload feed from them, account blocks (by
               account, covering all of a person's uids), and a player's
               follower count. players are referenced by uid, or by one of their
               builds when the uid is hidden, and hidden uids are never returned.
*/

import type { BlocksResponse, FeedResponse, FollowImportRequest, FollowsResponse, PlayerSocialResponse } from '@lb/contract/api'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import { getAccount, linkOf } from '../../db/accounts.ts'
import { getPlayer, sessionHasUid, type PlayerRow } from '../../db/identity.ts'
import {
  BLOCK_CAP, blockCount, blockRows, blocks, blockStatement, commentAccount, FOLLOW_CAP, followCount, followedBoards, followedPlayers, followerCount,
  followsAny, followStatement, freshInFeed, isUid, playerByRef, setFeedSeenStatement, toRef, uidForRemoval, unblockStatement,
  unfollowStatement, type FollowKind,
} from '../../db/social.ts'
import type { RouteContext } from '../router.ts'
import { followFeed, requireLiveRuleset } from '../board/queries.ts'
import { rateLimit } from '../cards/routes.ts'
import { optionalSession, requireAccount } from '../auth/sessions.ts'
import { privacyOf } from '../documents/routes.ts'
import { accountRefs, personOf } from '../people.ts'

const FEED_LIMIT = 100
const isResonatorId = (value: string) => /^\d{4,6}$/.test(value)

async function follows(db: D1Database, accountId: string): Promise<FollowsResponse> {
  const [players, boards] = await Promise.all([followedPlayers(db, accountId), followedBoards(db, accountId)])
  return { boards, players: players.map((row) => ({ ...toRef(row), buildId: row.ref_build!, faces: JSON.parse(row.faces) as string[] })) }
}

/** the listed player a ref names, or a 404. */
async function playerOr404(db: D1Database, ref: string): Promise<PlayerRow> {
  const player = await playerByRef(db, ref)
  if (!player) throw new HttpError('not_found', "hmm... this player isn't available. check the UID; the profile may also be private or removed.")
  return player
}

async function underCap(db: D1Database, accountId: string, kind: FollowKind): Promise<void> {
  if (await followCount(db, accountId, kind) >= FOLLOW_CAP) throw new HttpError('bad_request', `your pinned ${kind}s are full! unpin one before adding another; the limit is ${FOLLOW_CAP} :P`)
}

/** GET /follows. */
export async function listFollows(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  return json(await follows(context.env.LB, session.accountId))
}

/** PUT /follows/players/:ref. */
export async function followPlayer(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const db = context.env.LB
  const player = await playerOr404(db, context.params.ref)
  if (await sessionHasUid(db, session, player.uid)) throw new HttpError('bad_request', "that's you! choose another player for this action :P")
  await underCap(db, session.accountId, 'player')
  await followStatement(db, session.accountId, 'player', player.uid, context.now).run()
  return json(await follows(db, session.accountId))
}

/** DELETE /follows/players/:ref: unpins the person by whichever of their uids was pinned; returns success either way,
    which reveals nothing about a uid. */
export async function unfollowPlayer(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const db = context.env.LB
  const uid = await uidForRemoval(db, context.params.ref)
  if (uid) {
    const { uids } = await personOf(db, uid, { own: true })
    await db.batch(uids.map((each) => unfollowStatement(db, session.accountId, 'player', each)))
  }
  return json(await follows(db, session.accountId))
}

/** PUT /follows/boards/:resonatorId. */
export async function followBoard(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const db = context.env.LB
  const { resonatorId } = context.params
  if (!isResonatorId(resonatorId)) throw new HttpError('not_found', "hmm... we couldn't find a board for that resonator.")
  await underCap(db, session.accountId, 'board')
  await followStatement(db, session.accountId, 'board', resonatorId, context.now).run()
  return json(await follows(db, session.accountId))
}

/** DELETE /follows/boards/:resonatorId. */
export async function unfollowBoard(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  await unfollowStatement(context.env.LB, session.accountId, 'board', context.params.resonatorId).run()
  return json(await follows(context.env.LB, session.accountId))
}

/** POST /follows/import: merges the app's local pins, skipping pins of unlisted players and pins past the cap, and
    returns the account's follows after the merge. */
export async function importFollows(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  await rateLimit(context.env.SUBMIT_LIMIT, `follow-import:${session.accountId}`)
  const db = context.env.LB
  const body = await readJsonBody<FollowImportRequest>(context.request, 65_536)
  const boards = (Array.isArray(body.boards) ? body.boards : []).filter((id): id is string => typeof id === 'string' && isResonatorId(id))
  const refs = (Array.isArray(body.players) ? body.players : []).flatMap((pin) => {
    const ref = typeof pin?.uid === 'string' && isUid(pin.uid) ? pin.uid : typeof pin?.buildId === 'string' ? pin.buildId : null
    return ref ? [ref] : []
  })
  if (boards.length > FOLLOW_CAP || refs.length > FOLLOW_CAP) throw new HttpError('bad_request', `woah... you can import up to ${FOLLOW_CAP} players and ${FOLLOW_CAP} boards at once :P`)
  const players = await Promise.all(refs.map((ref) => playerByRef(db, ref)))
  const owned = await Promise.all(players.map((player) => player ? sessionHasUid(db, session, player.uid) : true))
  const uids = [...new Set(players.filter((player, index): player is PlayerRow => player != null && !owned[index]).map((player) => player.uid))]
  const [haveBoards, havePlayers] = await Promise.all([followCount(db, session.accountId, 'board'), followCount(db, session.accountId, 'player')])
  const statements = [
    ...[...new Set(boards)].slice(0, Math.max(0, FOLLOW_CAP - haveBoards)).map((id) => followStatement(db, session.accountId, 'board', id, context.now)),
    ...uids.slice(0, Math.max(0, FOLLOW_CAP - havePlayers)).map((uid) => followStatement(db, session.accountId, 'player', uid, context.now)),
  ]
  if (statements.length) await db.batch(statements)
  return json(await follows(db, session.accountId))
}

/** GET /players/:ref/social: a person's followers across their uids and whether the viewer follows or blocks them;
    a hidden-uid player is requested by one of their builds, or by uid by themselves. */
export async function playerSocial(context: RouteContext): Promise<Response> {
  const db = context.env.LB
  const { ref } = context.params
  const session = await optionalSession(context)
  const own = session && isUid(ref) ? await sessionHasUid(db, session, ref) : false
  const player = own ? await getPlayer(db, ref) : await playerOr404(db, ref)
  if (!player) throw new HttpError('not_found', "hmm... this player isn't available. check the UID; the profile may also be private or removed.")
  const viewer = session?.accountId ?? null
  const person = await personOf(db, player.uid, { own })
  const [followers, following, blocked, privacy] = await Promise.all([followerCount(db, person.uids),
    viewer ? followsAny(db, viewer, person.uids) : false, viewer ? blocks(db, viewer, person.accountId) : false,
    own ? null : privacyOf(db, person.accountId)])
  // players can make their follower count private
  const body: PlayerSocialResponse = { followers: privacy && !privacy.followers ? null : followers, following, blocked }
  return json(body)
}

/** GET /feed: uploads from what the account follows, newest first, and how many came since it was last read. */
export async function getFeed(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const db = context.env.LB
  const rulesetId = await requireLiveRuleset(db)
  const account = (await getAccount(db, session.accountId))!
  const seenAt = account.feed_seen_at
  const [rows, fresh] = await Promise.all([followFeed(context.env, rulesetId, session.accountId, FEED_LIMIT),
    freshInFeed(db, session.accountId, seenAt ?? account.created_at)])
  const body: FeedResponse = { rulesetId, rows, seenAt, fresh }
  return json(body)
}

/** POST /feed/seen: everything in the feed now counts as read. */
export async function markFeedSeen(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  await setFeedSeenStatement(context.env.LB, session.accountId, context.now).run()
  return json({ ok: true })
}

async function blockList(db: D1Database, accountId: string): Promise<BlocksResponse> {
  const rows = await blockRows(db, accountId)
  const refOf = await accountRefs(db, rows.map((row) => row.blocked_account))
  return { players: rows.map((row) => ({ id: row.id, ...refOf(row.blocked_account), at: row.created_at })) }
}

/** the account behind a ref: a uid's or a build's (any of them, for lifting), or a comment's writer, who may show no
    uid at all. */
async function accountOfRef(db: D1Database, ref: string): Promise<string | null> {
  const uid = await uidForRemoval(db, ref)
  return uid ? (await linkOf(db, uid))?.account_id ?? null : commentAccount(db, ref)
}

/** GET /blocks. */
export async function listBlocks(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  return json(await blockList(context.env.LB, session.accountId))
}

/** PUT /blocks/:ref: blocks the person behind a listed player's uid or build, or behind a comment; uids on no account
    cannot comment and have nothing to block. */
export async function blockPlayer(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const db = context.env.LB
  const { ref } = context.params
  const player = await playerByRef(db, ref)
  const target = player ? (await linkOf(db, player.uid))?.account_id ?? null : await commentAccount(db, ref)
  if (!player && !target) throw new HttpError('not_found', "hmm... this player isn't available. check the UID; the profile may also be private or removed.")
  if (!target) throw new HttpError('bad_request', "hmm... this player isn't on an account, so there's nothing of theirs to block :P")
  if (target === session.accountId) throw new HttpError('bad_request', "that's you! choose another player for this action :P")
  if (await blockCount(db, session.accountId) >= BLOCK_CAP) throw new HttpError('bad_request', `your blocked players list is full. unblock someone before adding another; the limit is ${BLOCK_CAP}.`)
  await blockStatement(db, session.accountId, target, context.now).run()
  return json(await blockList(db, session.accountId))
}

/** DELETE /blocks/:ref: lifts a block, named by its id (from GET /blocks) or by a ref to the person. */
export async function unblockPlayer(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const db = context.env.LB
  const { ref } = context.params
  await unblockStatement(db, session.accountId, ref, await accountOfRef(db, ref)).run()
  return json(await blockList(db, session.accountId))
}
