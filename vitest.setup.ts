import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { vi } from 'vitest'

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return input.url
}

const originalFetch = globalThis.fetch

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = resolveRequestUrl(input)

  if (url.startsWith('/data/')) {
    const filePath = path.join(process.cwd(), 'public', url.slice(1))
    const text = await readFile(filePath, 'utf8')

    return {
      text: async () => text,
      json: async () => JSON.parse(text),
    } as Response
  }

  if (originalFetch) {
    return originalFetch(input as RequestInfo, init)
  }

  throw new Error(`Unhandled test fetch request: ${url}`)
})

const { initializeGameData } = await import('@/data/gameData')
await initializeGameData()
