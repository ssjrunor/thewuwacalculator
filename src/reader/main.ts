/*
  Author: Runor Ewhro
  description: card reader page for browser rendering. loads only the game
               catalogs and the card parser, then exposes window.twcReader:
               `ready` resolves once catalogs are loaded, and `read` turns one
               card image (base64) into a leaderboard CardReadResult. reads run
               one at a time, and the page stays warm between them (echo art,
               sprite samples and ocr workers kept), so a dispatcher reuses it
               for card after card. the page never fetches the card itself; the
               caller passes the bytes it fetched from kuro.
*/

import type { CardReadResult } from '@/domain/leaderboard/read'
import { DEF_GAME_DATA_MODE, type GameDataMode } from '@/domain/entities/gameDataMode'
import { initCoreGameData } from '@/data/gameData/index'
import { keepReaderWarm, prsBldFromMg } from '@/engine/echoParser/ocrParsing'
import { CARD_PARSER_VER } from '@/engine/echoParser/version'
import { failedCardRead, makeCardRead } from '@/engine/echoParser/cardRead'
import { GAME_DATA_VER } from '@/shared/lib/appMetadata'

export interface CardReaderInfo {
  parserVer: string
  gameVer: string
  mode: GameDataMode
  // the cores the page sees, which sizes any parallel reading
  cores: number
}

export interface CardReader {
  ready: Promise<CardReaderInfo>
  read(imageBase64: string, contentType: string): Promise<CardReadResult>
  // reads this page has run, for the dispatcher to recycle a long-lived page
  reads: number
  // leases the page to one dispatcher for `ms`, or returns false while another has the lease, so a batch never queues
  // behind another's cards
  lease(ms: number): boolean
  // returns the page for the next batch
  free(): void
}

declare global {
  interface Window {
    twcReader: CardReader
  }
}

function readMode(): GameDataMode {
  const mode = new URLSearchParams(window.location.search).get('mode')
  return mode === 'live' || mode === 'beta' ? mode : DEF_GAME_DATA_MODE
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

keepReaderWarm(true)
const mode = readMode()
const gameVer = `${GAME_DATA_VER}/${mode}`
// load picker catalogs without resonator calculation bundles; each parse resolves names against this page's fixed
// data mode
const ready: Promise<CardReaderInfo> = initCoreGameData({ mode, resonatorIds: [] })
  .then(() => ({ parserVer: CARD_PARSER_VER, gameVer, mode, cores: navigator.hardwareConcurrency || 1 }))

async function readOnce(imageBase64: string, contentType: string): Promise<CardReadResult> {
  await ready
  const started = performance.now()
  const file = new File([decodeBase64(imageBase64)], 'card', { type: contentType })
  try {
    const parsed = await prsBldFromMg(file)
    return makeCardRead(parsed, gameVer, Math.round(performance.now() - started))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failedCardRead(message, Math.round(performance.now() - started))
  }
}

// queue reads because a warm parse shares one ocr worker per model
let queue: Promise<unknown> = Promise.resolve()

let leasedUntil = 0

window.twcReader = {
  ready,
  reads: 0,
  lease(ms) {
    const now = Date.now()
    if (leasedUntil > now) return false
    leasedUntil = now + ms
    return true
  },
  free() {
    leasedUntil = 0
  },
  read(imageBase64, contentType) {
    window.twcReader.reads += 1
    const next = queue.then(() => readOnce(imageBase64, contentType))
    // a failed parse does not reject the queue chain used by later reads; the caller still receives the original
    // result promise
    queue = next.catch(() => undefined)
    return next
  },
}
