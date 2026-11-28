/*
  Author: Runor Ewhro
  description: the reader browser stays up only for bulk reads: a bulk batch
               launches with a keep-alive and leaves its browser up on
               release, a lone card's launch asks for none and closes it, and
               a lone card that leased a page a bulk batch left up leaves it
               up as it was.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CARD_PARSER_VER } from '@lb/parser-version'

const state = vi.hoisted(() => ({
  launches: [] as Array<unknown>,
  sessions: [] as Array<{ sessionId: string; connectionId?: string }>,
  closed: 0,
  disconnected: 0,
}))

vi.mock('@cloudflare/puppeteer', () => {
  const page = {
    url: () => 'https://reader.test/reader.html?mode=test',
    goto: async () => undefined,
    waitForFunction: async () => undefined,
    evaluate: async (script: unknown) => {
      if (typeof script === 'function') return { outcome: 'ok' }
      const text = String(script)
      if (text.includes('lease')) return true
      if (text.includes('ready')) return { parserVer: CARD_PARSER_VER, mode: 'test', cores: 4 }
      if (text.includes('free')) return 1
      return null
    },
  }
  const browser = {
    newPage: async () => page,
    pages: async () => [page],
    close: async () => { state.closed += 1 },
    disconnect: async () => { state.disconnected += 1 },
  }
  return {
    default: {
      launch: async (_binding: unknown, options: unknown) => { state.launches.push(options); return browser },
      sessions: async () => state.sessions,
      connect: async () => browser,
    },
  }
})

const { browserReader, keepsReaderWarm } = await import('../src/api/read/dispatch')

const binding = {} as never
const readOnce = async (keepWarm: boolean) => {
  const reader = browserReader(binding, 'https://reader.test/reader.html', 'test', { keepWarm })
  await reader(new Uint8Array([1, 2, 3]), 'image/png')
  await reader.release?.()
}

describe('reader keep-alive', () => {
  beforeEach(() => {
    state.launches = []
    state.sessions = []
    state.closed = 0
    state.disconnected = 0
  })

  it('leaves a bulk batch\'s browser running for the next batch', async () => {
    await readOnce(true)
    expect(state.launches).toEqual([{ keep_alive: 60_000 }])
    expect(state.closed).toBe(0)
    expect(state.disconnected).toBe(1)
  })

  it('closes the browser a lone card launched, with no keep-alive asked', async () => {
    await readOnce(false)
    expect(state.launches).toEqual([undefined])
    expect(state.closed).toBe(1)
    expect(state.disconnected).toBe(0)
  })

  it('leaves a bulk batch\'s running page open after a lone card leases it', async () => {
    state.sessions = [{ sessionId: 'warm' }]
    await readOnce(false)
    expect(state.launches).toEqual([])
    expect(state.closed).toBe(0)
    expect(state.disconnected).toBe(1)
  })

  it('counts several cards, or one of a bulk send, as bulk', () => {
    expect(keepsReaderWarm([{}])).toBe(false)
    expect(keepsReaderWarm([{ bulk: true }])).toBe(true)
    expect(keepsReaderWarm([{}, {}])).toBe(true)
  })
})
