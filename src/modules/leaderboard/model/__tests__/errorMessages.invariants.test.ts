/*
  Author: Runor Ewhro
  description: verifies that API messages reach the UI unchanged and malformed
               responses use a fallback without displaying response contents.
*/

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '@/domain/leaderboard/api'
import { lbApi, LbError } from '../../api/client'
import { errorText } from '../cardTrack'

afterEach(() => vi.restoreAllMocks())

/** the service's error body (ApiError, which its errorResponse writes), built from the shared contract. */
const STATUS = { rate_limited: 429, duplicate: 409, muted: 403, bad_request: 400 } as const
const errorResponse = (code: keyof typeof STATUS, message: string) =>
  new Response(JSON.stringify({ error: { code, message } } satisfies ApiError), { status: STATUS[code], headers: { 'content-type': 'application/json' } })

describe('leaderboard error messages', () => {
  it.each([
    ['rate_limited', 'your daily comment allowance has been used.'],
    ['rate_limited', 'your earlier uploads are awaiting staff review.'],
    ['duplicate', 'your appeal is awaiting a decision.'],
    ['muted', 'your account is muted until 2026-12-05: repeated spam.'],
    ['bad_request', 'check your display name and try again.'],
  ] as const)('displays the original %s response without rewriting it', async (code, message) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(errorResponse(code, message))
    const error = await lbApi.submit({ input: 'card', turnstileToken: 'test' }).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(LbError)
    expect(errorText(error)).toBe(message)
  })

  it('uses a safe fallback for a response without a readable API message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html>private upstream diagnostic</html>', { status: 502 }))
    const error = await lbApi.submit({ input: 'card', turnstileToken: 'test' }).catch((failure: unknown) => failure)
    expect(errorText(error)).toContain('something went wrong on our side')
    expect(errorText(error)).not.toContain('private upstream diagnostic')
    expect(errorText(error)).not.toContain('502')
  })
})
