/*
  Author: Runor Ewhro
  description: fills an account's empty profile fields (display name, avatar,
               banner, accent) from the provider profile when the account is
               created and on the first login that returns a profile. fields the
               player set or cleared are left as they are. provider images are
               copied into media as approved; reports on the profile still go
               to staff.
*/

import { DOCUMENTS, readDocument, type ProfileDoc } from '@lb/contract/documents'
import { auditStatement } from '../../lib/audit.ts'
import { providerProfileOf, type ProviderProfile } from '../../db/accounts.ts'
import { documentsOf, putDocumentStatement } from '../../db/documents.ts'
import { mutedBy, stoppedBy } from '../../db/sanctions.ts'
import { MEDIA_LIMITS } from '@lb/contract/media'
import { storeMedia } from '../media/store.ts'
import type { RouteContext } from '../router.ts'
import { isProviderImage } from './oauth.ts'

/** how the media and document records name the provider that approved them. */
const BY = 'provider:discord'

type Filled = Pick<ProfileDoc, 'displayName' | 'avatar' | 'banner' | 'accent'>

/** the provider's image as approved media of the account, or null when there is none or it cannot be had. */
async function importImage(context: Pick<RouteContext, 'env' | 'now'>, accountId: string, purpose: 'avatar' | 'banner',
  url: string | null): Promise<string | null> {
  if (!url || !isProviderImage(url)) return null
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) })
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MEDIA_LIMITS[purpose].bytes) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    return await storeMedia(context.env, { accountId, purpose, bytes, approvedBy: BY, source: 'discord' }, context.now)
  } catch {
    return null
  }
}

/** fills the account's empty profile fields from its provider profile; failures leave the field empty and
    never fail the request. */
export async function fillProfile(context: Pick<RouteContext, 'env' | 'now'>, accountId: string): Promise<void> {
  const db = context.env.LB
  try {
    const profile = await providerProfileOf(db, accountId)
    if (!profile || await stoppedBy(db, 'account', accountId, context.now)) return
    if (await mutedBy(db, { uid: null, accountId }, context.now)) return
    const row = (await documentsOf(db, ['profile'], [accountId])).get(`profile:${accountId}`)
    const body = row ? readDocument('profile', row.schema_ver, row.body) as ProfileDoc | null : {}
    if (!body) return
    const image = (purpose: 'avatar' | 'banner', url: string | null) => importImage(context, accountId, purpose, url)
    const fill = await fieldsFor(body, profile, image)
    if (!Object.keys(fill).length) return
    const parsed = DOCUMENTS.profile.schema.safeParse({ ...body, ...fill })
    if (!parsed.success) return
    // provider text is stored as reviewed; a document already pending review stays pending
    const reviewedBy = !row || row.reviewed_at != null ? BY : null
    await db.batch([putDocumentStatement(db, { kind: 'profile', ownerId: accountId, version: DOCUMENTS.profile.version, body: parsed.data,
      reviewedBy }, context.now),
      auditStatement(db, { actorKind: 'account', actorId: accountId, action: 'document.write', subjectKind: 'document',
        subjectId: `profile:${accountId}`, data: { source: 'discord', fields: Object.keys(fill) } }, context.now)])
  } catch (error) {
    console.error('profile fill failed', error)
  }
}

async function fieldsFor(body: Partial<ProfileDoc>, profile: ProviderProfile,
  image: (purpose: 'avatar' | 'banner', url: string | null) => Promise<string | null>): Promise<Partial<Filled>> {
  const fill: Partial<Filled> = {}
  const name = profile.name?.slice(0, 24).trim()
  if (body.displayName == null && name) fill.displayName = name
  if (body.accent == null && profile.accent) fill.accent = profile.accent
  if (body.avatar == null) { const id = await image('avatar', profile.avatarUrl); if (id) fill.avatar = id }
  if (body.banner == null) { const id = await image('banner', profile.bannerUrl); if (id) fill.banner = id }
  return fill
}
