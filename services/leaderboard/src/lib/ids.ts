/*
  Author: Runor Ewhro
  description: build, card and uid keys (gbid, public build and card ids, integer uids), timestamp-prefixed
               UUIDs, and cryptographically random URL-safe tokens.
*/

export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let time = now
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = time % 256
    time = Math.floor(time / 256)
  }
  // set the UUID version and variant bits after writing the 48-bit millisecond timestamp.
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// board keys: a build is stored on its resonator's board under a small integer `local`, and outside the board it is
// referenced by `gbid` (one integer combining resonator and local) or its public id "<resonator>-<local base36>"

/** upper bound of locals; with resonator ids below MAX_RESONATOR, every gbid is a safe integer. */
export const LOCAL_SPAN = 2 ** 39
export const MAX_RESONATOR = 10_000
/** first local of seeded builds, which keeps seeds apart from real builds and purgeable by range. */
export const SEED_LOCAL_FLOOR = 2 ** 38

export interface BuildKey {
  resonator: number
  local: number
}

function checkKey({ resonator, local }: BuildKey) {
  if (!Number.isInteger(resonator) || resonator <= 0 || resonator >= MAX_RESONATOR) throw new Error(`ids: resonator ${resonator} is out of range`)
  if (!Number.isInteger(local) || local <= 0 || local >= LOCAL_SPAN) throw new Error(`ids: build local ${local} is out of range`)
}

/** a build's global integer id. */
export function toGbid(key: BuildKey): number {
  checkKey(key)
  return key.resonator * LOCAL_SPAN + key.local
}

export function fromGbid(gbid: number): BuildKey {
  if (!Number.isSafeInteger(gbid) || gbid <= 0) throw new Error(`ids: ${gbid} is not a build id`)
  const key = { resonator: Math.floor(gbid / LOCAL_SPAN), local: gbid % LOCAL_SPAN }
  checkKey(key)
  return key
}

const BUILD_ID = /^([1-9]\d{0,3})-([0-9a-z]{1,8})$/

/** the build id the api and the app use, e.g. "1506-3kf9". */
export function formatBuildId(key: BuildKey): string {
  checkKey(key)
  return `${key.resonator}-${key.local.toString(36)}`
}

/** a public build id's key, or null when it is not one. */
export function parseBuildId(id: string): BuildKey | null {
  const match = BUILD_ID.exec(id)
  if (!match) return null
  const key = { resonator: Number(match[1]), local: parseInt(match[2], 36) }
  try {
    checkKey(key)
  } catch {
    return null
  }
  return formatBuildId(key) === id ? key : null
}

/** card registry shards, picked by the first hex digit of the card's link hash. */
export const CARD_SHARDS = 16

export interface CardKey {
  shard: number
  no: number
}

const CARD_ID = /^([0-9a-f])-([0-9a-z]{1,10})$/

/** the shard of a hex link hash. */
export function cardShardOf(linkHashHex: string): number {
  const shard = parseInt(linkHashHex[0] ?? '', 16)
  if (!Number.isInteger(shard)) throw new Error('ids: a link hash is hex')
  return shard % CARD_SHARDS
}

/** the card id the api and the app use, e.g. "a-1k2". */
export function formatCardId(key: CardKey): string {
  if (!Number.isInteger(key.shard) || key.shard < 0 || key.shard >= CARD_SHARDS) throw new Error(`ids: card shard ${key.shard} is out of range`)
  if (!Number.isSafeInteger(key.no) || key.no <= 0) throw new Error(`ids: card number ${key.no} is out of range`)
  return `${key.shard.toString(16)}-${key.no.toString(36)}`
}

export function parseCardId(id: string): CardKey | null {
  const match = CARD_ID.exec(id)
  if (!match) return null
  const key = { shard: parseInt(match[1], 16), no: parseInt(match[2], 36) }
  if (!Number.isSafeInteger(key.no) || key.no <= 0) return null
  return formatCardId(key) === id ? key : null
}

/** game uids are 9 digits; seeded test uids start with 0, which no game uid does, so they are the integers below this. */
export const SEED_UID_CEILING = 100_000_000

const UID = /^\d{9}$/

/** a uid as the database stores it, or null when the text is not a uid. */
export function uidToInt(uid: string): number | null {
  return UID.test(uid) ? Number(uid) : null
}

/** a stored uid as the 9 digits players see. */
export function uidToText(uid: number): string {
  if (!Number.isInteger(uid) || uid < 0 || uid > 999_999_999) throw new Error(`ids: ${uid} is not a uid`)
  return String(uid).padStart(9, '0')
}

export const isSeedUid = (uid: number): boolean => uid < SEED_UID_CEILING

/** a random url-safe token of `bytes` bytes (session cookies, cursors). */
export function randomToken(bytes = 32): string {
  const raw = new Uint8Array(bytes)
  crypto.getRandomValues(raw)
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
