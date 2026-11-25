/*
  Author: Runor Ewhro
  description: GET /players/:ref/history?resonator=: every build of a player's
               uids on each resonator, newest card first, with its current rank
               (each build is ranked on its own) and the changes from the same
               uid's previous build. profile privacy.history makes it private;
               the owner's view adds their hidden builds and is not cached.
*/

import { diffBuilds } from '@lb/contract/buildDiff'
import type { BuildHistoryResponse, HistoryEntry } from '@lb/contract/api'
import { ownedOrPublicJson } from '../../lib/cache.ts'
import { HttpError } from '../../lib/http.ts'
import { formatBuildId } from '../../lib/ids.ts'
import { unpackSnapshot } from '../../lib/snapshotPack.ts'
import { getPlayer, sessionHasUid } from '../../db/identity.ts'
import { isUid, playerByRef } from '../../db/social.ts'
import type { RouteContext } from '../router.ts'
import { optionalSession } from '../auth/sessions.ts'
import { privacyOf } from '../documents/routes.ts'
import { playerResonators } from '../players.ts'
import { boardOf } from '../stubs.ts'
import { personOf } from '../people.ts'
import { profileVersion } from './queries.ts'

const HISTORY_CACHE_S = 120

export async function getHistory(context: RouteContext): Promise<Response> {
  const db = context.env.LB
  const { ref } = context.params
  const resonator = context.url.searchParams.get('resonator')
  if (resonator != null && !/^\d{4}$/.test(resonator)) throw new HttpError('bad_request', "hmm... we couldn't identify that resonator. reopen its board and try again.")
  const session = await optionalSession(context)
  // the owner looks up their own uid even while hidden; other viewers go through playerByRef
  const own = session && isUid(ref) ? await sessionHasUid(db, session, ref, context.now) : false
  const player = own ? await getPlayer(db, ref) : await playerByRef(db, ref)
  if (!player) throw new HttpError('not_found', "hmm... this player isn't available. check the UID; the profile may also be private or removed.")
  const owner = own || (session ? await sessionHasUid(db, session, player.uid, context.now) : false)
  const person = await personOf(db, player.uid, { own: owner })
  if (!owner && !(await privacyOf(db, person.accountId)).history) throw new HttpError('forbidden', "this player has chosen to keep their build history private.")
  const cached = { url: context.url, ctx: context.ctx, version: () => profileVersion(db, person) }
  return ownedOrPublicJson(cached, owner, HISTORY_CACHE_S, async () => {
    const { results: hidden } = await db.prepare('SELECT uid FROM players WHERE hide_uid = 1 AND uid IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(person.uids)).all<{ uid: string }>()
    const masked = new Set(hidden.map((row) => row.uid))
    // each uid's builds of a resonator are one line of cards, each changed from the one before it; a person's history
    // of a resonator is every such line, newest card first.
    const lines = await Promise.all(person.uids.map(async (uid) => {
      const resonators = (await playerResonators(db, uid)).filter((id) => resonator == null || id === resonator)
      return Promise.all(resonators.map(async (resonatorId) => {
        const res = Number(resonatorId)
        const list = await boardOf(context.env, res).history(res, Number(uid), owner)
        const snaps = list.map((row) => unpackSnapshot(row.snap))
        return { resonatorId, entries: list.map((row, index): HistoryEntry => ({
          buildId: formatBuildId({ resonator: res, local: row.local }), resonatorId,
          drawnAt: row.drawnAt, submittedAt: row.submittedAt, rulesetId: row.rulesetId, score: row.score, rank: row.rank,
          // a place reads "#rank of total"; unranked builds have neither
          total: row.rank == null ? null : row.total,
          snapshot: masked.has(uid) ? { ...snaps[index], uid: '' } : snaps[index],
          // rows are newest first, so the previous build is the next row
          changes: index + 1 < list.length ? diffBuilds(snaps[index + 1], snaps[index]) : [],
          ...(owner ? { hidden: row.ownerHidden } : {}),
        })) }
      }))
    }))
    const byResonator = new Map<string, HistoryEntry[]>()
    for (const line of lines.flat()) byResonator.set(line.resonatorId, [...byResonator.get(line.resonatorId) ?? [], ...line.entries])
    const body: BuildHistoryResponse = {
      uid: masked.has(player.uid) ? null : player.uid, name: player.last_name,
      resonators: [...byResonator].filter(([, entries]) => entries.length).sort(([a], [b]) => a.localeCompare(b))
        .map(([resonatorId, entries]) => ({ resonatorId, entries: entries.sort((a, b) => b.submittedAt - a.submittedAt) })),
    }
    return body
  })
}
