/*
  Author: Runor Ewhro
  description: protects the collect step: only kuro card addresses (direct or
               through discord's proxy) pass, the fetch refuses anything that
               is not a dated jpeg or png under the size cap, and freshness and
               hashes behave as the ownership rules need.
*/

import { describe, expect, it } from 'vitest'
import { cardUrlFromName, parseCardInput } from '../src/api/cards/link'
import { CardFetchError, fetchCard, sniffImageType } from '../src/api/cards/fetch'
import { CLOCK_SKEW_MS, isFreshCard } from '../src/api/cards/freshness'
import { collectCard } from '../src/api/cards/collect'
import { hmacSha256Hex, sha256Hex } from '../src/lib/hash'

const HOST = 'wutheringwaves-dc.kurogames-global.com'
const FILE = '81/81f231791761f1a9d169850c220bd16c7bbf1c7c.jpeg'
const KURO = `https://${HOST}/back/${FILE}`
const PROXIED = `https://images-ext-1.discordapp.net/external/SMi1_CIY3itdqRhE9e-W-Ob3RaXVkgdjqeRuujPGgZA/https/${HOST}/back/${FILE}?format=webp`

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
const MODIFIED = 'Sun, 01 Nov 2026 21:18:14 GMT'

function respond(body: Uint8Array | null, init: { status?: number; headers?: Record<string, string> } = {}): typeof fetch {
  return (async () => new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': 'image/jpeg', 'last-modified': MODIFIED, ...init.headers },
  })) as typeof fetch
}

async function fetchError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'resolved'
  } catch (error) {
    return error instanceof CardFetchError ? error.code : `other: ${String(error)}`
  }
}

describe('card links', () => {
  it('accepts the kuro address and unwraps the discord proxy to it', () => {
    expect(parseCardInput(KURO)).toEqual({ ok: true, url: KURO, via: 'kuro' })
    expect(parseCardInput(PROXIED)).toEqual({ ok: true, url: KURO, via: 'discord_proxy' })
    expect(parseCardInput(`  <${KURO}?x=1#y>  `)).toEqual({ ok: true, url: KURO, via: 'kuro' })
    expect(parseCardInput(KURO.toUpperCase().replace('HTTPS://', 'https://').replace(/\/BACK\/.*/, `/back/${FILE}`)).ok).toBe(true)
  })

  it('refuses malformed and non-https links', () => {
    for (const link of ['', 'not a url', KURO.replace('https', 'http'), `https://user:pw@${HOST}/back/${FILE}`,
      `https://${HOST}:8443/back/${FILE}`, 'x'.repeat(3000)]) {
      expect(parseCardInput(link)).toEqual({ ok: false, code: 'bad_link' })
    }
  })

  it('refuses anything that is not a kuro card path', () => {
    for (const link of [
      `https://${HOST}.evil.example/back/${FILE}`,
      `https://evil.example/back/${FILE}`,
      `https://${HOST}/front/${FILE}`,
      `https://${HOST}/back/../admin/${FILE}`,
      `https://${HOST}/back/82/81f231791761f1a9d169850c220bd16c7bbf1c7c.jpeg`,
      `https://${HOST}/back/81/81f231791761f1a9d169850c220bd16c7bbf1c7c.gif`,
      `https://${HOST}/back/81/81f2.jpeg`,
      `https://images-ext-1.discordapp.net.evil.example/external/t/https/${HOST}/back/${FILE}`,
      `https://images-ext-1.discordapp.net/external/t/http/${HOST}/back/${FILE}`,
      `https://images-ext-1.discordapp.net/external/t/https/evil.example/back/${FILE}`,
      `https://cdn.discordapp.com/attachments/1/2/card.jpeg`,
    ]) {
      expect(parseCardInput(link), link).toEqual({ ok: false, code: 'not_kuro' })
    }
  })

  it('finds the card from its file name alone', () => {
    const hash = '81f231791761f1a9d169850c220bd16c7bbf1c7c'
    // the shapes saved copies were found in (ref/import-cards), all resolving on kuro
    for (const name of [
      hash,
      `${hash}.jpeg`,
      `${hash}.jpg`,
      `${hash}.webp`,
      `${hash}.png`,
      `${hash} (1).webp`,
      `${hash.toUpperCase()}.JPEG`,
      `/Users/someone/Downloads/${hash}.jpeg`,
      `C:\\Users\\someone\\Downloads\\${hash}.jpeg`,
    ]) {
      expect(parseCardInput(name), name).toEqual({ ok: true, url: KURO, via: 'file_name' })
    }
    expect(cardUrlFromName(`${hash}.webp`)).toBe(KURO)
  })

  it('refuses names that are not a kuro card name', () => {
    for (const name of [
      'card.jpeg',
      'image.webp',
      '81f231791761f1a9d169850c220bd16c7bbf1c7',           // 39 characters
      '81f231791761f1a9d169850c220bd16c7bbf1c7c0.jpeg',    // 41 characters
      '81f231791761f1a9d169850c220bd16c7bbf1c7g.jpeg',     // not hex
      '81f231791761f1a9d169850c220bd16c7bbf1c7c.gif',
      '81f231791761f1a9d169850c220bd16c7bbf1c7c.jpeg.exe',
      'cards/../81f231791761f1a9d169850c220bd16c7bbf1c7c.svg',
      'ftp://x/81f231791761f1a9d169850c220bd16c7bbf1c7c.jpeg',
    ]) {
      expect(parseCardInput(name).ok, name).toBe(false)
    }
  })

  it('skips an encoded original query segment in a proxy path', () => {
    const link = `https://images-ext-2.discordapp.net/external/tok/%3Fv%3D1/https/${HOST}/back/${FILE}`
    expect(parseCardInput(link)).toEqual({ ok: true, url: KURO, via: 'discord_proxy' })
  })
})

describe('card fetch', () => {
  it('returns bytes, the sniffed type and the creation time', async () => {
    const card = await fetchCard(KURO, { maxBytes: 100, fetchImpl: respond(JPEG) })
    expect(card).toMatchObject({ contentType: 'image/jpeg', byteSize: JPEG.length, lastModified: Date.parse(MODIFIED) })
    expect([...card.bytes]).toEqual([...JPEG])
    const png = await fetchCard(KURO, { maxBytes: 100, fetchImpl: respond(PNG, { headers: { 'content-type': 'image/png' } }) })
    expect(png.contentType).toBe('image/png')
  })

  it('refuses redirects, errors and undated answers', async () => {
    expect(await fetchError(fetchCard(KURO, { maxBytes: 100, fetchImpl: respond(null, { status: 302, headers: { location: 'https://evil.example/' } }) }))).toBe('fetch_failed')
    expect(await fetchError(fetchCard(KURO, { maxBytes: 100, fetchImpl: respond(null, { status: 404 }) }))).toBe('fetch_failed')
    expect(await fetchError(fetchCard(KURO, { maxBytes: 100, fetchImpl: respond(JPEG, { headers: { 'last-modified': '' } }) }))).toBe('fetch_failed')
    const failing = (async () => { throw new TypeError('network down') }) as typeof fetch
    expect(await fetchError(fetchCard(KURO, { maxBytes: 100, fetchImpl: failing }))).toBe('fetch_failed')
  })

  it('refuses oversize bodies, declared or streamed', async () => {
    expect(await fetchError(fetchCard(KURO, { maxBytes: 4, fetchImpl: respond(JPEG, { headers: { 'content-length': '8' } }) }))).toBe('too_large')
    expect(await fetchError(fetchCard(KURO, { maxBytes: 4, fetchImpl: respond(JPEG) }))).toBe('too_large')
  })

  it('judges the image by its bytes, not its header', async () => {
    const html = new TextEncoder().encode('<html>not a card</html>')
    expect(await fetchError(fetchCard(KURO, { maxBytes: 100, fetchImpl: respond(html) }))).toBe('bad_image')
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46]))).toBeNull()
  })
})

describe('freshness', () => {
  const now = Date.parse(MODIFIED)
  it('accepts cards inside the window and a little clock skew', () => {
    expect(isFreshCard(now - 899_000, now, 900)).toBe(true)
    expect(isFreshCard(now + CLOCK_SKEW_MS - 1, now, 900)).toBe(true)
  })
  it('refuses old cards and cards dated well in the future', () => {
    expect(isFreshCard(now - 901_000, now, 900)).toBe(false)
    expect(isFreshCard(now + CLOCK_SKEW_MS + 1, now, 900)).toBe(false)
  })
})

describe('hashes', () => {
  it('matches the standard sha-256 and hmac-sha256 vectors', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    // rfc 4231 test case 2
    expect(await hmacSha256Hex('Jefe', 'what do ya want for nothing?'))
      .toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
  })
})

describe('collect', () => {
  const options = { linkHashKey: 'k', maxBytes: 100, freshMaxAgeSeconds: 900, now: Date.parse(MODIFIED) + 60_000 }

  it('collects the same card the same way from a link, the proxy or its file name', async () => {
    const urls: string[] = []
    const recording = (async (url: string) => {
      urls.push(url)
      return respond(JPEG)(url)
    }) as typeof fetch
    const direct = await collectCard(KURO, { ...options, fetchImpl: recording })
    const proxied = await collectCard(PROXIED, { ...options, fetchImpl: recording })
    const named = await collectCard('81f231791761f1a9d169850c220bd16c7bbf1c7c (1).webp', { ...options, fetchImpl: recording })
    if (!direct.ok || !proxied.ok || !named.ok) throw new Error('expected all three to collect')
    expect(urls).toEqual([KURO, KURO, KURO])
    expect(proxied.card.linkHash).toBe(direct.card.linkHash)
    expect(named.card.linkHash).toBe(direct.card.linkHash)
    expect(named.card.via).toBe('file_name')
    expect(direct.card).toMatchObject({
      via: 'kuro',
      contentType: 'image/jpeg',
      ageMs: 60_000,
      fresh: true,
      r2Key: `cards/${direct.card.imageSha256}.jpg`,
    })
    expect(direct.card.linkHash).toBe(await hmacSha256Hex('k', KURO))
  })

  it('reports link and fetch failures as codes, never fetching a refused link', async () => {
    let called = false
    const spy = (async () => { called = true; return new Response(JPEG) }) as typeof fetch
    expect(await collectCard('https://evil.example/x.jpeg', { ...options, fetchImpl: spy })).toMatchObject({ ok: false, code: 'not_kuro' })
    expect(called).toBe(false)
    expect(await collectCard(KURO, { ...options, fetchImpl: respond(null, { status: 403 }) })).toMatchObject({ ok: false, code: 'fetch_failed' })
  })
})
