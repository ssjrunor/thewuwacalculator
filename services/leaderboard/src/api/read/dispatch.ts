/*
  Author: Runor Ewhro
  description: reads cards on the reader page through browser rendering. a reader leases an idle reader page an
               earlier batch left running (with the catalogs and ocr workers loaded), else launches a browser, and
               reads every card of the batch on that one page. only a bulk batch (keepsReaderWarm) leaves it running:
               its release() frees the page and leaves the browser up for the next batch (KEEP_ALIVE_MS), or closes it
               after RECYCLE_AFTER reads. a lone card's release() closes a browser it launched itself, because browser
               hours bill while one waits; a page it leased from a bulk batch stays up. a failed read closes the
               browser at once. the page never fetches the card itself. `wallMs` is the whole read, browser start
               included, for /admin/health.
*/

import puppeteer, { type Browser, type BrowserWorker, type Page } from '@cloudflare/puppeteer'
import type { CardReadResult } from '@lb/contract/read'
import { CARD_PARSER_VER } from '@lb/parser-version'
import type { ReadMessage } from '../../env.ts'

export type CardReader = ((bytes: Uint8Array<ArrayBuffer>, contentType: string) => Promise<CardReadResult>) & {
  // ends this reader's hold on its browser; a reader from tests may have none
  release?: () => Promise<void>
}

const READY_TIMEOUT_MS = 30_000
// how long an idle reader browser waits for the next batch; browser hours bill while it waits
const KEEP_ALIVE_MS = 60_000
// reads a page runs before its browser is closed and relaunched, which bounds a slow leak
const RECYCLE_AFTER = 300
// a batch's lease on a page: a queue consumer's longest run, so a crashed holder never locks a page for good
const LEASE_MS = 15 * 60_000
// idle sessions tried before launching; each try is a connection round trip
const REUSE_TRIES = 3

interface PageInfo { parserVer: string; mode: string; cores: number }

function base64(bytes: Uint8Array): string {
  let binary = ''
  // convert image bytes to a base64 string in bounded chunks under the argument limit
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary)
}

// a browser this reader uses; `reused` when an earlier batch left it running
interface Held { browser: Browser; page: Page; reused: boolean }

// a batch worth keeping the browser up for: several cards, or one of a bulk send split across batches
export const keepsReaderWarm = (messages: Array<Pick<ReadMessage, 'bulk'>>): boolean =>
  messages.length > 1 || messages.some((message) => message.bulk === true)

// a page's lease (window.twcReader.lease): one batch at a time, never two sharing its queue
const leasePage = (page: Page): Promise<boolean> =>
  page.evaluate(`window.twcReader ? window.twcReader.lease(${LEASE_MS}) : false`).catch(() => false) as Promise<boolean>

// an idle reader page an earlier batch left running, leased to this reader, or null. sessions with no connection
// come first; a connection id can outlive its connection (miniflare never clears one), so the lease selects the page
async function reuse(binding: BrowserWorker, target: string): Promise<Held | null> {
  let sessions
  try {
    sessions = await puppeteer.sessions(binding)
  } catch {
    return null
  }
  sessions.sort((left, right) => Number(!!left.connectionId) - Number(!!right.connectionId))
  for (const session of sessions.slice(0, REUSE_TRIES)) {
    let browser: Browser
    try {
      browser = await puppeteer.connect(binding, session.sessionId)
    } catch {
      continue
    }
    const page = (await browser.pages().catch(() => [])).find((open) => open.url() === target)
    if (page && await leasePage(page)) {
      const info = await pageInfo(page)
      if (info?.parserVer === CARD_PARSER_VER) return { browser, page, reused: true }
      // a page from an earlier reader version: close its browser and load the current page in a new one
      await browser.close().catch(() => undefined)
      continue
    }
    await browser.disconnect().catch(() => undefined)
  }
  return null
}

async function launch(binding: BrowserWorker, target: string, keepWarm: boolean): Promise<Held> {
  // a lone card's browser is closed on release and requests no keep-alive
  const browser = await puppeteer.launch(binding, keepWarm ? { keep_alive: KEEP_ALIVE_MS } : undefined)
  try {
    const page = await browser.newPage()
    await page.goto(target, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction('typeof window.twcReader === "object"', { timeout: READY_TIMEOUT_MS })
    const info = await pageInfo(page)
    await leasePage(page)
    console.log('reader page', JSON.stringify({ parserVer: info?.parserVer, expected: CARD_PARSER_VER, cores: info?.cores }))
    return { browser, page, reused: false }
  } catch (error) {
    await browser.close().catch(() => undefined)
    throw error
  }
}

async function pageInfo(page: Page): Promise<PageInfo | null> {
  return page.evaluate('window.twcReader ? window.twcReader.ready : null').catch(() => null) as Promise<PageInfo | null>
}

export function browserReader(browserBinding: BrowserWorker, readerUrl: string, mode: string,
  { keepWarm = false }: { keepWarm?: boolean } = {}): CardReader {
  const url = new URL(readerUrl)
  url.searchParams.set('mode', mode)
  const target = url.toString()
  let open: Promise<Held> | null = null

  const reader: CardReader = async (bytes, contentType) => {
    const started = Date.now()
    open ??= (async () => {
      const reused = await reuse(browserBinding, target)
      console.log('reader browser', JSON.stringify({ reused: !!reused }))
      return reused ?? launch(browserBinding, target, keepWarm)
    })()
    let held: Held
    try {
      held = await open
    } catch (error) {
      open = null
      throw error
    }
    try {
      const read = await held.page.evaluate(
        (image: string, type: string) => (globalThis as unknown as { twcReader: { read(a: string, b: string): Promise<unknown> } })
          .twcReader.read(image, type),
        base64(bytes), contentType,
      ) as CardReadResult
      return { ...read, wallMs: Date.now() - started }
    } catch (error) {
      // a transport or page failure leaves the browser in an unknown state: close it, and the batch's next card
      // starts a new one
      open = null
      await held.browser.close().catch(() => undefined)
      throw error
    }
  }

  reader.release = async () => {
    const held = await open?.catch(() => null)
    open = null
    if (!held) return
    const reads = await held.page.evaluate('window.twcReader.free(), window.twcReader.reads').catch(() => RECYCLE_AFTER) as number
    if (reads >= RECYCLE_AFTER || !(keepWarm || held.reused)) await held.browser.close().catch(() => undefined)
    // a disconnect ends this worker's connection only; the browser and its warm page stay up for the next batch
    else await held.browser.disconnect().catch(() => undefined)
  }
  return reader
}
