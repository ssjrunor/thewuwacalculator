/*
  Author: Runor Ewhro
  Description: Locks the Worker share-token API contract for KV-backed create
               and fetch behavior.
*/

import { describe, expect, it } from 'vitest'
import {
  onShareRequest,
  type ShareKvNamespace,
} from './shareServer'

function makeKv(initial: Record<string, string> = {}): ShareKvNamespace & {
  data: Map<string, string>
  puts: Array<{ key: string; value: string; options?: { expirationTtl?: number } }>
} {
  const data = new Map(Object.entries(initial))
  const puts: Array<{ key: string; value: string; options?: { expirationTtl?: number } }> = []

  return {
    data,
    puts,
    async get(key) {
      return data.get(key) ?? null
    },
    async put(key, value, options) {
      puts.push({ key, value, options })
      data.set(key, value)
    },
  }
}

const rotationPayload = {
  source: 'wuwa-calculator',
  kind: 'rotation-export',
  version: 1,
  rotation: {
    name: 'Test',
    resonatorId: '1204',
    resonatorName: 'Test',
    items: [],
  },
}

describe('share server contract', () => {
  it('creates a KV-backed share and returns a calculator token url', async () => {
    const kv = makeKv()
    const result = await onShareRequest({
      body: JSON.stringify(rotationPayload),
      env: { SHARES: kv },
      method: 'POST',
      requestUrl: 'https://thewuwacalculator.com/api/shares',
    })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{16,96}$/),
      url: expect.stringMatching(/^https:\/\/thewuwacalculator\.com\/modulation\?s=[A-Za-z0-9_-]+$/),
    })
    const sharePut = kv.puts.find((entry) => entry.key.startsWith('share:v1:'))
    expect(sharePut?.key).toMatch(/^share:v1:[A-Za-z0-9_-]+$/)
    expect(sharePut?.value).toBe(JSON.stringify(rotationPayload))
    expect(sharePut?.options?.expirationTtl).toBeGreaterThan(0)
    expect(kv.puts.find((entry) => entry.key.startsWith('share-rate:v1:'))?.value).toBe('1')
  })

  it('fetches a stored share payload by token', async () => {
    const payload = JSON.stringify(rotationPayload)
    const result = await onShareRequest({
      env: { SHARES: makeKv({ 'share:v1:abc123abc123abc1': payload }) },
      method: 'GET',
      requestUrl: 'https://thewuwacalculator.com/api/shares/abc123abc123abc1',
    })

    expect(result).toEqual({
      body: payload,
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  })

  it('rejects malformed or oversized create payloads', async () => {
    await expect(
      onShareRequest({
        body: JSON.stringify({ kind: 'rotation-export', version: 1 }),
        env: { SHARES: makeKv() },
        method: 'POST',
        requestUrl: 'https://thewuwacalculator.com/api/shares',
      }),
    ).resolves.toEqual({
      body: { error: 'Invalid or oversized share payload' },
      status: 400,
    })
  })

  it('returns 404 for missing share tokens', async () => {
    await expect(
      onShareRequest({
        env: { SHARES: makeKv() },
        method: 'GET',
        requestUrl: 'https://thewuwacalculator.com/api/shares/abc123abc123abc1',
      }),
    ).resolves.toEqual({
      body: { error: 'Share not found' },
      status: 404,
    })
  })

  it('requires the KV binding', async () => {
    await expect(
      onShareRequest({
        body: JSON.stringify(rotationPayload),
        env: {},
        method: 'POST',
        requestUrl: 'https://thewuwacalculator.com/api/shares',
      }),
    ).resolves.toEqual({
      body: { error: 'Share storage is not configured' },
      status: 500,
    })
  })

  it('rate limits create requests by client id', async () => {
    const kv = makeKv({ 'share-rate:v1:test-client': '60' })
    await expect(
      onShareRequest({
        body: JSON.stringify(rotationPayload),
        clientId: 'test-client',
        env: { SHARES: kv },
        method: 'POST',
        requestUrl: 'https://thewuwacalculator.com/api/shares',
      }),
    ).resolves.toEqual({
      body: { error: 'Too many share requests' },
      status: 429,
    })
  })
})
