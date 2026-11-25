/*
  Author: Runor Ewhro
  description: stores every image as media: the type is read from the bytes
               (png, jpeg or webp; the declared type is ignored), the byte size
               and pixel size are checked against the purpose's limits
               (domain/leaderboard/media) from the header without decoding, then
               the bytes go to CARDS and the row and audit entry are written.
               uploads and sign-in provider images both use it.
*/

import type { MediaPurpose } from '@lb/contract/api'
import { MEDIA_LIMITS, megabytes } from '@lb/contract/media'
import type { ApiEnv } from '../../env.ts'
import { auditStatement } from '../../lib/audit.ts'
import { sha256Hex } from '../../lib/hash.ts'
import { HttpError } from '../../lib/http.ts'
import { insertMediaStatement } from '../../db/media.ts'

type ImageType = 'image/png' | 'image/jpeg' | 'image/webp'

export const tooLarge = (purpose: MediaPurpose) => new HttpError('too_large', `woah... this ${purpose} is too large. choose an image no larger than ${megabytes(purpose)} MB :P`)

/** the image type the bytes really are, or null. */
function sniff(bytes: Uint8Array): ImageType | null {
  const starts = (...sig: number[]) => sig.every((byte, index) => bytes[index] === byte)
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

/** width and height from the image's header, or null when the header does not say. */
export function imageSize(bytes: Uint8Array, type: ImageType): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const fits = (end: number) => end <= bytes.length
  const tag = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4))
  if (type === 'image/png') {
    // the first chunk is IHDR: width and height, big-endian.
    return fits(24) && tag(12) === 'IHDR' ? { width: view.getUint32(16), height: view.getUint32(20) } : null
  }
  if (type === 'image/webp') {
    const chunk = tag(12)
    // lossy: a 14-bit width and height after the frame's start code.
    if (chunk === 'VP8 ' && fits(30)) return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    // lossless: 14-bit width-1 and height-1, packed after the signature byte.
    if (chunk === 'VP8L' && fits(25)) {
      const bits = view.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    // extended: 24-bit canvas width-1 and height-1.
    if (chunk === 'VP8X' && fits(30)) {
      const u24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
      return { width: u24(24) + 1, height: u24(27) + 1 }
    }
    return null
  }
  // jpeg: walk the segments to the frame header (any SOF marker but DHT, JPG and DAC).
  let at = 2
  while (fits(at + 9)) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1]
    if (marker === 0xff) { at += 1; continue }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) }
    }
    if (marker === 0xd9 || marker === 0xda) return null
    at += 2 + view.getUint16(at + 2)
  }
  return null
}

/** stores an account's image and returns its id; `approvedBy` is the review-exempt staff member or provider that
    approved it on arrival, and null leaves it pending review. */
export async function storeMedia(env: Pick<ApiEnv, 'LB' | 'CARDS'>, media: { accountId: string; purpose: MediaPurpose;
  bytes: Uint8Array<ArrayBuffer>; approvedBy: string | null; source?: 'discord' }, now: number): Promise<string> {
  const { accountId, purpose, bytes, approvedBy } = media
  const limit = MEDIA_LIMITS[purpose]
  if (!bytes.length) throw new HttpError('bad_image', "hmm... no image came through. choose the image again and retry :P")
  if (bytes.length > limit.bytes) throw tooLarge(purpose)
  const contentType = sniff(bytes)
  if (!contentType) throw new HttpError('bad_image', "hmm... try a PNG, JPEG or WebP image :P")
  const size = imageSize(bytes, contentType)
  if (!size || !size.width || !size.height) throw new HttpError('bad_image', "hmm... we couldn't read this image's dimensions. try saving it as a new PNG, JPEG or WebP file :P")
  if (Math.max(size.width, size.height) > limit.side) {
    throw new HttpError('too_large', `woah... this ${purpose} is too large. choose an image no larger than ${limit.side} pixels on its longest side :P`)
  }
  const made = insertMediaStatement(env.LB, { accountId, purpose, contentType, byteSize: bytes.length, sha256: await sha256Hex(bytes),
    approvedBy }, now)
  // write the bytes before the row, so every row points at stored bytes
  await env.CARDS.put(made.r2Key, bytes, { httpMetadata: { contentType } })
  await env.LB.batch([made.statement, auditStatement(env.LB, { actorKind: 'account', actorId: accountId, action: 'media.upload',
    subjectKind: 'media', subjectId: made.id, data: { purpose, byteSize: bytes.length, width: size.width, height: size.height,
      ...(approvedBy ? { approvedBy } : {}), ...(media.source ? { source: media.source } : {}) } }, now)])
  return made.id
}
