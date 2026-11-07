/*
  Author: Runor Ewhro
  description: reads one card on the reader page through browser rendering:
               opens READER_URL, waits for window.twcReader, passes the image
               bytes the api collected and returns the page's CardReadResult.
               the page never fetches the card itself. `wallMs` is the whole
               read, browser start included, for the latency numbers in /admin/health.
*/

import puppeteer, { type BrowserWorker } from '@cloudflare/puppeteer'
import type { CardReadResult } from '@/domain/leaderboard/read'

export type CardReader = (bytes: Uint8Array<ArrayBuffer>, contentType: string) => Promise<CardReadResult>

const READY_TIMEOUT_MS = 30_000

function base64(bytes: Uint8Array): string {
  let binary = ''
  // bounded chunks avoid exceeding the argument limit while converting image bytes to a browser-safe base64 string.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary)
}

export function browserReader(browserBinding: BrowserWorker, readerUrl: string, mode: string): CardReader {
  return async (bytes, contentType) => {
    const started = Date.now()
    const browser = await puppeteer.launch(browserBinding)
    try {
      const page = await browser.newPage()
      const url = new URL(readerUrl)
      url.searchParams.set('mode', mode)
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
      await page.waitForFunction('typeof window.twcReader === "object"', { timeout: READY_TIMEOUT_MS })
      await page.evaluate('window.twcReader.ready')
      const read = await page.evaluate(
        (image: string, type: string) => (globalThis as unknown as { twcReader: { read(a: string, b: string): Promise<unknown> } })
          .twcReader.read(image, type),
        base64(bytes), contentType,
      ) as CardReadResult
      return { ...read, wallMs: Date.now() - started }
    // close the browser after readiness, parsing, or transport failures as well as successful reads.
    } finally {
      await browser.close()
    }
  }
}
