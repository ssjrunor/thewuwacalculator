/*
  Author: Runor Ewhro
  description: fetches a card image from kuro server-side (kuro sends no cors
               headers). refuses redirects, non-200 answers, oversize bodies,
               anything that is not a jpeg or png by its own bytes, and
               answers without a last-modified date, which freshness needs.
*/

export type CardFetchErrorCode = 'fetch_failed' | 'too_large' | 'bad_image'

export class CardFetchError extends Error {
  readonly code: CardFetchErrorCode

  constructor(code: CardFetchErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CardFetchError'
    this.code = code
  }
}

export type CardContentType = 'image/jpeg' | 'image/png'

export interface FetchedCard {
  bytes: Uint8Array<ArrayBuffer>
  contentType: CardContentType
  byteSize: number
  /** epoch milliseconds from the last-modified header: when kuro first drew this
      exact build. kuro reuses the file for an unchanged build, so this is not when
      the command ran. */
  lastModified: number
}

export interface CardFetchOptions {
  maxBytes: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 8000

export function sniffImageType(bytes: Uint8Array): CardContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) return 'image/png'
  return null
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new CardFetchError('too_large', `woah... this card is too large to download. it needs to be no larger than ${maxBytes} bytes :P`)
  }
  if (!response.body) throw new CardFetchError('fetch_failed', "uh oh... Kuro sent an empty card image. try generating a new card and send its link :(")

  // the streamed byte count enforces the cap even when Content-Length is missing or understates the body.
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new CardFetchError('too_large', `woah... this card is too large to download. it needs to be no larger than ${maxBytes} bytes :P`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** fetch an address that parseCardInput already accepted. */
export async function fetchCard(url: string, options: CardFetchOptions): Promise<FetchedCard> {
  const { maxBytes, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = options
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'image/jpeg, image/png' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new CardFetchError('fetch_failed', "uh oh... we couldn't download this card from Kuro. check the link and try again in a little while :(", { cause: error })
  }

  if (response.status !== 200) {
    await response.body?.cancel()
    throw new CardFetchError('fetch_failed', "uh oh... Kuro couldn't send this card. check its link or generate a new card and try again :(", { cause: new Error(`Kuro returned HTTP ${response.status}`) })
  }

  const lastModified = Date.parse(response.headers.get('last-modified') ?? '')
  if (!Number.isFinite(lastModified)) {
    await response.body?.cancel()
    throw new CardFetchError('fetch_failed', "hmm... Kuro didn't tell us when this card was generated, so we can't check its age. try generating a new card and send its link :(")
  }

  const bytes = await readCapped(response, maxBytes)
  // identify the image from its signature bytes; response Content-Type does not establish an accepted card format.
  const contentType = sniffImageType(bytes)
  if (!contentType) throw new CardFetchError('bad_image', "hmm... this link didn't return a JPEG or PNG card image. try the original Kuro card link :P")

  return { bytes, contentType, byteSize: bytes.byteLength, lastModified }
}
