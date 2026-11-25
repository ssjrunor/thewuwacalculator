/*
  Author: Runor Ewhro
  description: leaderboard settings documents, one per owner and kind: an
               account's profile (the person's, across every uid), a build's
               notes, the account's showcase card per resonator (carried to each
               new build of it), and the account's saved board views. each is
               validated json with a version, and the service stores the parsed
               result (unknown keys dropped) without the raw body. images are
               uploaded media referenced by id; outside urls are rejected.
*/

import * as z from 'zod/mini'
import { showcaseCardSchema } from './showcaseCard'

/** an uploaded image, by its id; it shows publicly only once a moderator approves it. */
const mediaId = z.string().check(z.regex(/^[0-9a-f-]{36}$/))
/** card image field prefix: `media:<id>` (or empty), restricting the app's image fields to uploaded media. */
export const MEDIA_REF = 'media:'
export const mediaRefId = (value: string | null): string | null =>
  value?.startsWith(MEDIA_REF) ? value.slice(MEDIA_REF.length) : null

const text = (max: number) => z.string().check(z.trim(), z.maxLength(max))
const hex = z.string().check(z.regex(/^#[0-9a-f]{6}$/i))

/** an uploaded image's position in every frame showing it. the image stays whole; each frame covers itself with it,
    places the image's x%, y% point at the frame's x%, y% (as object-position reads it) and zooms around that point,
    so one framing fits frames of any shape. */
const imageFrame = z.object({
  x: z.number().check(z.minimum(0), z.maximum(100)),
  y: z.number().check(z.minimum(0), z.maximum(100)),
  zoom: z.number().check(z.minimum(1), z.maximum(4)),
})

export const profileDocSchema = z.object({
  /** the person's name, shown in place of the in-game names; the uids and in-game names stay on record. */
  displayName: z.optional(z.string().check(z.trim(), z.minLength(1), z.maxLength(24))),
  bio: z.optional(text(280)),
  links: z._default(z.array(z.object({
    label: z.string().check(z.trim(), z.minLength(1), z.maxLength(24)),
    url: z.url({ protocol: /^https$/ }),
  })).check(z.maxLength(4)), []),
  accent: z.optional(hex),
  avatar: z.optional(mediaId),
  banner: z.optional(mediaId),
  /** avatar and banner framing; unset uses each frame's default. */
  avatarFrame: z.optional(imageFrame),
  bannerFrame: z.optional(imageFrame),
  /** the profile's featured builds in order, each one of the profile's own (pins are follows stored on the follower's
        account). */
  featured: z._default(z.array(z.string().check(z.maxLength(64))).check(z.maxLength(6)), []),
  /** visibility of everything beyond the shown builds to others; owners see everything. */
  privacy: z._default(z.object({
    /** every card the player sent per resonator, and what changed between them. */
    history: z._default(z.boolean(), true),
    /** how many accounts follow this player. */
    followers: z._default(z.boolean(), true),
  }), { history: true, followers: true }),
})

export const buildDocSchema = z.object({
  title: z.optional(z.string().check(z.trim(), z.minLength(1), z.maxLength(48))),
  note: z.optional(text(500)),
  tags: z._default(z.array(z.string().check(z.regex(/^[a-z0-9-]{1,20}$/))).check(z.maxLength(8)), []),
  /** the owner closes the build to new comments; the ones written stay. */
  commentsOpen: z._default(z.boolean(), true),
})

/** a build's showcase card: the app's card customization, without custom css and with uploaded images only. */
export const cardDocSchema = showcaseCardSchema.check(
  z.refine((card) => card.style.customCss == null, 'custom css is not stored on the leaderboard'),
  z.refine((card) => [card.style.portraitImage, card.style.backdropImage]
    .every((image) => image == null || /^media:[0-9a-f-]{36}$/.test(image)), 'card images must be uploaded media'),
)

const boardViewSchema = z.object({
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(32)),
  resonatorId: z.string().check(z.regex(/^\d{4}$/)),
  /** the board filter, named like the board's query parameters. */
  team: z.optional(z.string().check(z.regex(/^\d{4}(-\d{4}){2}$/))),
  member: z.optional(z.string().check(z.regex(/^\d{4}$/))),
  weapon: z.optional(z.string().check(z.regex(/^\d{8}$/))),
  sequence: z.optional(z.number().check(z.int(), z.minimum(0), z.maximum(6))),
  region: z.optional(z.string().check(z.regex(/^\d$/))),
})

/** an account's saved board views, in its order. */
export const viewsDocSchema = z.object({
  views: z._default(z.array(boardViewSchema).check(z.maxLength(30)), []),
})

export type ProfileDoc = z.infer<typeof profileDocSchema>
export type ImageFrame = z.infer<typeof imageFrame>
export type BuildDoc = z.infer<typeof buildDocSchema>
export type CardDoc = z.infer<typeof cardDocSchema>
export type CardStyle = CardDoc['style']
export type ViewsDoc = z.infer<typeof viewsDocSchema>
export type BoardView = ViewsDoc['views'][number]

/** a card document's owner: the account's resonator, `accountId:resonatorId`. */
export const loadoutKey = (accountId: string, resonatorId: string) => `${accountId}:${resonatorId}`

/** every kind with its owner type, current version and schema; version bumps add a migration here. */
export const DOCUMENTS = {
  profile: { owner: 'account', version: 1, schema: profileDocSchema },
  build: { owner: 'build', version: 1, schema: buildDocSchema },
  card: { owner: 'loadout', version: 1, schema: cardDocSchema },
  views: { owner: 'account', version: 1, schema: viewsDocSchema },
} as const

export type DocumentKind = keyof typeof DOCUMENTS
export const isDocumentKind = (value: string): value is DocumentKind => Object.hasOwn(DOCUMENTS, value)

/** media ids a document shows, used by public reads to withhold unapproved images. */
export function documentMedia(kind: DocumentKind, body: ProfileDoc | BuildDoc | CardDoc | ViewsDoc): string[] {
  if (kind === 'profile') {
    const doc = body as ProfileDoc
    return [doc.avatar, doc.banner].filter((id): id is string => id != null)
  }
  if (kind === 'card') {
    const doc = body as CardDoc
    return [mediaRefId(doc.style.portraitImage), mediaRefId(doc.style.backdropImage)].filter((id): id is string => id != null)
  }
  return []
}

type AnyDoc = ProfileDoc | BuildDoc | CardDoc | ViewsDoc

/** a stored document as its kind reads today: parsed (defaults filled) at its version, or null if it no longer parses. */
export function readDocument(kind: DocumentKind, version: number, json: string): AnyDoc | null {
  if (version !== DOCUMENTS[kind].version) return null
  const result = DOCUMENTS[kind].schema.safeParse(JSON.parse(json))
  return result.success ? result.data : null
}

/** the public view of a document, with unapproved images removed. */
export function withApprovedMedia<T extends AnyDoc>(kind: DocumentKind, body: T, approved: Set<string>): T {
  if (kind === 'profile') {
    const doc = body as ProfileDoc
    return { ...doc, avatar: doc.avatar && approved.has(doc.avatar) ? doc.avatar : undefined,
      banner: doc.banner && approved.has(doc.banner) ? doc.banner : undefined } as T
  }
  if (kind === 'card') {
    const doc = body as CardDoc
    const keep = (image: string | null) => { const id = mediaRefId(image); return id && approved.has(id) ? image : null }
    return { ...doc, style: { ...doc.style, portraitImage: keep(doc.style.portraitImage), backdropImage: keep(doc.style.backdropImage) } } as T
  }
  return body
}
