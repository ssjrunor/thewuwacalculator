/*
  Author: Runor Ewhro
  description: validates card links, fetches image bytes, and resolves their hashes and freshness.
*/

import {
  DEFAULT_CARD_LINK_RULES,
  parseCardInput,
  type CardInputKind,
  type CardLinkError,
  type CardLinkRules,
} from './link.ts'
import { CardFetchError, fetchCard, type CardContentType, type CardFetchErrorCode } from './fetch.ts'
import { cardAgeMs, isFreshCard } from './freshness.ts'
import { linkHash, sha256Hex } from '../../lib/hash.ts'

export interface CollectOptions {
  linkHashKey: string
  maxBytes: number
  freshMaxAgeSeconds: number
  rules?: CardLinkRules
  now?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface CollectedCard {
  linkHash: string
  /** how the user gave us the card: kuro link, discord proxy link or file name. */
  via: CardInputKind
  imageSha256: string
  /** content-addressed key for the private CARDS bucket. */
  r2Key: string
  contentType: CardContentType
  byteSize: number
  bytes: Uint8Array<ArrayBuffer>
  lastModified: number
  ageMs: number
  fresh: boolean
}

export type CollectError = CardLinkError | CardFetchErrorCode

export type CollectResult =
  | { ok: true; card: CollectedCard }
  | { ok: false; code: CollectError; message: string }

const EXTENSION: Record<CardContentType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' }

export type IdentifyResult =
  | { ok: true; url: string; via: CardInputKind; linkHash: string }
  | { ok: false; code: CardLinkError; message: string }

/**
 * the card a link names, without fetching it. kuro names a card file by its build
 * and never rewrites it, so a known link hash is a card already collected.
 */
export async function identifyCard(input: string, options: Pick<CollectOptions, 'linkHashKey' | 'rules'>): Promise<IdentifyResult> {
  const parsed = parseCardInput(input, options.rules ?? DEFAULT_CARD_LINK_RULES)
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code,
      message: parsed.code === 'not_kuro' ? 'not a kuro build card link' : 'not a card link or card file name',
    }
  }
  return { ok: true, url: parsed.url, via: parsed.via, linkHash: await linkHash(options.linkHashKey, parsed.url) }
}

/** `input` is a card link, a discord proxy link, or a card file name. */
export async function collectCard(input: string, options: CollectOptions): Promise<CollectResult> {
  const identified = await identifyCard(input, options)
  return identified.ok ? fetchIdentified(identified, options) : identified
}

/** fetch, hash and date a card already identified. */
export async function fetchIdentified(parsed: Extract<IdentifyResult, { ok: true }>, options: CollectOptions): Promise<CollectResult> {

  try {
    const fetched = await fetchCard(parsed.url, {
      maxBytes: options.maxBytes,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    })
    const now = options.now ?? Date.now()
    const imageSha256 = await sha256Hex(fetched.bytes)
    return {
      ok: true,
      card: {
        linkHash: parsed.linkHash,
        via: parsed.via,
        imageSha256,
        r2Key: `cards/${imageSha256}.${EXTENSION[fetched.contentType]}`,
        contentType: fetched.contentType,
        byteSize: fetched.byteSize,
        bytes: fetched.bytes,
        lastModified: fetched.lastModified,
        ageMs: cardAgeMs(fetched.lastModified, now),
        fresh: isFreshCard(fetched.lastModified, now, options.freshMaxAgeSeconds),
      },
    }
  } catch (error) {
    if (error instanceof CardFetchError) return { ok: false, code: error.code, message: error.message }
    throw error
  }
}
