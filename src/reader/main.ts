/*
  Author: Runor Ewhro
  description: card reader page for browser rendering. loads only the game
               catalogs and the card parser, then exposes window.twcReader:
               `ready` resolves once catalogs are loaded, and `read` turns one
               card image (base64) into a leaderboard CardReadResult. reads run
               one at a time. the page never fetches the card itself; the
               caller passes the bytes it fetched from kuro.
*/

import type { CardReadResult } from '@/domain/leaderboard/read'
import { DEF_GAME_DATA_MODE, type GameDataMode } from '@/domain/entities/gameDataMode'
import { initCoreGameData } from '@/data/gameData/index'
import { prsBldFromMg } from '@/engine/echoParser/ocrParsing'
import { CARD_PARSER_VER } from '@/engine/echoParser/version'
import { failedCardRead, makeCardRead } from '@/engine/echoParser/cardRead'
import { GAME_DATA_VER } from '@/shared/lib/appMetadata'

export interface CardReaderInfo {
  parserVer: string
  gameVer: string
  mode: GameDataMode
}

export interface CardReader {
  ready: Promise<CardReaderInfo>
  read(imageBase64: string, contentType: string): Promise<CardReadResult>
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

const mode = readMode()
const gameVer = `${GAME_DATA_VER}/${mode}`
// load picker catalogs without resonator calculation bundles; each parse resolves names against this page's fixed data mode.
const ready: Promise<CardReaderInfo> = initCoreGameData({ mode, resonatorIds: [] })
  .then(() => ({ parserVer: CARD_PARSER_VER, gameVer, mode }))

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

// queue reads because each parse uses a single ocr worker.
let queue: Promise<unknown> = Promise.resolve()

window.twcReader = {
  ready,
  read(imageBase64, contentType) {
    const next = queue.then(() => readOnce(imageBase64, contentType))
    // a failed parse does not reject the queue chain used by later reads; the caller still receives the original result promise.
    queue = next.catch(() => undefined)
    return next
  },
}
