/*
  Author: Runor Ewhro
  Description: Prepares Vitest fetch handling and hydrates calculator game data
               before test modules run.
*/

import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { vi } from 'vitest'

function resReqUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return input.url
}

const origFetch = globalThis.fetch

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = resReqUrl(input)

  if (url.startsWith('/data/')) {
    const filePath = path.join(process.cwd(), 'public', url.slice(1))
    const text = await readFile(filePath, 'utf8')

    return {
      text: async () => text,
      json: async () => JSON.parse(text),
    } as Response
  }

  if (origFetch) {
    return origFetch(input as RequestInfo, init)
  }

  throw new Error(`Unhandled test fetch request: ${url}`)
})

const { initGameData } = await import('@/data/gameData')
await initGameData()
