/*
  Author: Runor Ewhro
  description: owner build routes: the own profile (every build of every uid
               in the session, hidden ones included) and deleting or hiding a
               build, allowed for any session with the build's uid.
*/

import type { BuildHiddenRequest } from '@lb/contract/api'
import { HttpError, json, readJsonBody } from '../../lib/http.ts'
import type { RouteContext } from '../router.ts'
import { requireSession } from '../auth/sessions.ts'
import { deleteBuild, ownedBuild, setOwnerHidden } from './lifecycle.ts'
import { getPlayer, sessionUids } from '../../db/identity.ts'
import { playerProfile, requireLiveRuleset } from '../board/queries.ts'

/** the owner deletes a build: a session that has its uid, signed in or claimed with a fresh card. */
export async function deleteOwnBuild(context: RouteContext): Promise<Response> {
  const { ref, uid } = await ownedBuild(context, context.params.id)
  await deleteBuild(context.env, ref, uid, context.now)
  return json({ ok: true })
}

/** the owner hides one of their builds from everyone else, or shows it again. */
export async function hideOwnBuild(context: RouteContext): Promise<Response> {
  const body = await readJsonBody<Partial<BuildHiddenRequest>>(context.request)
  if (typeof body.hidden !== 'boolean') throw new HttpError('bad_request', "oopsies... we could not read that visibility setting. refresh your profile and try again.")
  const { ref, uid } = await ownedBuild(context, context.params.id)
  await setOwnerHidden(ref, uid, body.hidden)
  return json({ buildId: ref.id, hidden: body.hidden })
}

/** the viewer's own profile: every build of every uid in the session, hidden ones marked, with the account profile;
    the uid line uses the newest uid. private and not cached. */
export async function ownProfile(context: RouteContext): Promise<Response> {
  const session = await requireSession(context)
  const db = context.env.LB
  const rulesetId = await requireLiveRuleset(db)
  const uids = (await sessionUids(db, session, context.now)).map((row) => row.uid)
  const face = uids.length ? await getPlayer(db, uids[uids.length - 1]) : null
  return json(await playerProfile(context.env, rulesetId, face, true, { accountId: session.accountId, uids }, { withHidden: true }))
}
