/*
  Author: Runor Ewhro
  description: the media store reads an image's width and height from its
               header, for every type it accepts, without decoding it.
*/

import { describe, expect, it } from 'vitest'
import { imageSize } from '../src/api/media/store.ts'
import { pngOf } from './accountHarness.ts'

/** a webp header: RIFF, WEBP, then one chunk's name, a zero size, and `body` from byte 20. */
const riff = (chunk: string, body: number[]) => {
  const bytes = new Uint8Array(20 + body.length)
  bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
  bytes.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8)
  bytes.set([...chunk].map((c) => c.charCodeAt(0)), 12)
  bytes.set(body, 20)
  return bytes
}

describe('imageSize', () => {
  it('reads a png\'s IHDR', () => {
    expect(imageSize(pngOf(3200, 900), 'image/png')).toEqual({ width: 3200, height: 900 })
  })

  it('walks a jpeg\'s segments to its frame header', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)]
    // a progressive frame (SOF2) after a DHT segment, which is not a frame header.
    const dht = [0xff, 0xc4, 0x00, 0x04, 0, 0]
    const sof = [0xff, 0xc2, 0x00, 0x11, 0x08, 0x02, 0x58, 0x04, 0x00, 0x03, ...new Array(9).fill(0)]
    expect(imageSize(new Uint8Array([0xff, 0xd8, ...app0, ...dht, ...sof]), 'image/jpeg')).toEqual({ width: 1024, height: 600 })
    expect(imageSize(new Uint8Array([0xff, 0xd8, ...app0, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0]), 'image/jpeg')).toBeNull()
  })

  it('reads lossy, lossless and extended webp', () => {
    expect(imageSize(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x04, 0x58, 0x02]), 'image/webp'))
      .toEqual({ width: 1024, height: 600 })
    // lossless: 14 bits of width-1 (1023), then 14 of height-1 (599).
    const bits = 1023 | (599 << 14)
    expect(imageSize(riff('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]), 'image/webp'))
      .toEqual({ width: 1024, height: 600 })
    expect(imageSize(riff('VP8X', [0, 0, 0, 0, 0xff, 0x03, 0x00, 0x57, 0x02, 0x00]), 'image/webp')).toEqual({ width: 1024, height: 600 })
  })
})
