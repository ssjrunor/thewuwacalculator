/*
  Author: Runor Ewhro
  description: bookmarks, an account's private saved builds. a saved build stays
               reachable after its player replaces it (through build history);
               hidden or deleted builds drop out of the list.
*/

import type { BookmarksResponse } from '@lb/contract/api'
import { HttpError, json } from '../../lib/http.ts'
import { BOOKMARK_CAP, bookmarkCount, bookmarksOf, bookmarkStatement, listedRefs, toRef, unbookmarkStatement } from '../../db/social.ts'
import { isOpen, resonatorOfId, rowsOf } from '../crossBoard.ts'
import { uidToText } from '../../lib/ids.ts'
import type { RouteContext } from '../router.ts'
import { visibleBuild } from '../board/routes.ts'
import { requireAccount } from '../auth/sessions.ts'

/** GET /bookmarks. */
export async function listBookmarks(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const marks = await bookmarksOf(context.env.LB, session.accountId)
  const rows = await rowsOf(context.env, marks.map((mark) => mark.build_id))
  const refs = await listedRefs(context.env.LB, [...rows.values()].map((row) => uidToText(row.uid)))
  const body: BookmarksResponse = { builds: marks.flatMap((mark) => {
    const row = rows.get(mark.build_id)
    const ref = row && refs.get(uidToText(row.uid))
    return isOpen(row) && ref ? [{ buildId: mark.build_id, resonatorId: resonatorOfId(mark.build_id)!, player: toRef(ref),
      at: mark.created_at }] : []
  }) }
  return json(body)
}

/** PUT /builds/:id/bookmark. */
export async function bookmarkBuild(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  const { ref } = await visibleBuild(context)
  const db = context.env.LB
  if (await bookmarkCount(db, session.accountId) >= BOOKMARK_CAP) throw new HttpError('rate_limited', `your saved builds are full! remove one before saving more; you can keep up to ${BOOKMARK_CAP} :P`)
  await bookmarkStatement(db, session.accountId, ref.id, context.now).run()
  return json({ bookmarked: true })
}

/** DELETE /builds/:id/bookmark: works on any build, so one since hidden can still be let go. */
export async function unbookmarkBuild(context: RouteContext): Promise<Response> {
  const session = await requireAccount(context)
  await unbookmarkStatement(context.env.LB, session.accountId, context.params.id).run()
  return json({ bookmarked: false })
}
