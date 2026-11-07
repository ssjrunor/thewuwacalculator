/*
  Author: Runor Ewhro
  description: handles authenticated build listing, deletion, and activation.
*/

import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import type { OwnerBuild, OwnerBuildsResponse } from '@/domain/leaderboard/api'
import { json } from '../../lib/http.ts'
import { getBuild, ownerBuilds } from '../../db/builds.ts'
import type { RouteContext } from '../router.ts'
import { requireUid } from '../auth/sessions.ts'
import { activateOwnBuild, deleteBuild, ownedBuild } from './lifecycle.ts'

export async function listOwnBuilds(context: RouteContext): Promise<Response> {
  const session = await requireUid(context)
  const resonators: Record<string, OwnerBuild[]> = {}
  for (const row of await ownerBuilds(context.env.LB, session.uid)) {
    (resonators[row.resonator_id] ??= []).push({
      buildId: row.id, resonatorId: row.resonator_id, state: row.state as OwnerBuild['state'], sequence: row.sequence,
      drawnAt: row.drawn_at, submittedAt: row.created_at,
      snapshot: row.snapshot ? JSON.parse(row.snapshot) as BuildSnapshot : null,
    })
  }
  const response: OwnerBuildsResponse = { uid: session.uid, resonators }
  return json(response)
}

export async function deleteOwnBuild(context: RouteContext): Promise<Response> {
  const session = await requireUid(context)
  const build = await ownedBuild(context.env.LB, context.params.id, session.uid)
  await deleteBuild(context.env.LB, build, context.now)
  return json({ ok: true })
}

export async function activateBuild(context: RouteContext): Promise<Response> {
  const session = await requireUid(context)
  const build = await ownedBuild(context.env.LB, context.params.id, session.uid)
  await activateOwnBuild(context.env, build, context.now)
  const after = await getBuild(context.env.LB, build.id)
  return json({ buildId: build.id, state: after?.state ?? build.state })
}
