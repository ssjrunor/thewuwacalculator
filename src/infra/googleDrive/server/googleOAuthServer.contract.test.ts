/*
  Author: Runor Ewhro
  Description: locks the server-side google oauth adapter contract for request
               validation, upstream error passthrough, and token exchange
               payload formatting.
*/

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  onExchangeCode,
  onRefreshToken,
} from './googleOAuthServer'

describe('google OAuth server contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects non-post exchange requests', async () => {
    await expect(
      onExchangeCode({
        env: {},
        method: 'GET',
      }),
    ).resolves.toEqual({
      body: { error: 'Method not allowed' },
      status: 405,
    })
  })

  it('rejects exchange requests without an authorization code', async () => {
    await expect(
      onExchangeCode({
        body: '{}',
        env: {
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
        },
        method: 'POST',
      }),
    ).resolves.toEqual({
      body: { error: 'Missing authorization code' },
      status: 400,
    })
  })

  it('treats malformed exchange payloads as empty input', async () => {
    await expect(
      onExchangeCode({
        body: '{',
        env: {
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
        },
        method: 'POST',
      }),
    ).resolves.toEqual({
      body: { error: 'Missing authorization code' },
      status: 400,
    })
  })

  it('returns a configuration error when refresh credentials are missing', async () => {
    await expect(
      onRefreshToken({
        body: JSON.stringify({ refresh_token: 'refresh-token' }),
        env: {},
        method: 'POST',
      }),
    ).resolves.toEqual({
      body: { error: 'Google OAuth server credentials are not configured' },
      status: 500,
    })
  })

  it('treats malformed refresh payloads as empty input', async () => {
    await expect(
      onRefreshToken({
        body: '{',
        env: {
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
        },
        method: 'POST',
      }),
    ).resolves.toEqual({
      body: { error: 'Missing refresh token' },
      status: 400,
    })
  })

  it('exchanges a code and falls back to the configured redirect uri', async () => {
    // exchange performs two network hops: token endpoint first, then userinfo
    // with the returned access token so the client receives identity metadata
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'access-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ email: 'test@example.com' }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const result = await onExchangeCode({
      body: JSON.stringify({ code: 'auth-code' }),
      env: {
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        GOOGLE_REDIRECT_URI: 'https://example.com/callback',
      },
      method: 'POST',
    })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      access_token: 'access-token',
      user: { email: 'test@example.com' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        body: expect.stringContaining('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback'),
        method: 'POST',
      }),
    )
  })

  it('returns upstream exchange details when google rejects the code', async () => {
    // preserve google's error payload in details so callers can distinguish bad
    // codes from local validation or server configuration failures
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'invalid_grant' }),
    })

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      onExchangeCode({
        body: JSON.stringify({ code: 'bad-code' }),
        env: {
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
        },
        method: 'POST',
      }),
    ).resolves.toEqual({
      body: {
        details: { error: 'invalid_grant' },
        error: 'Failed to exchange Google authorization code',
      },
      status: 400,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes access tokens with form-encoded credentials', async () => {
    // refresh uses the same token endpoint as exchange but sends the refresh
    // token grant and returns google's token json without adding user data
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'fresh-access-token',
        expires_in: 3600,
      }),
    })

    vi.stubGlobal('fetch', fetchMock)

    const result = await onRefreshToken({
      body: JSON.stringify({ refresh_token: 'refresh-token' }),
      env: {
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
      },
      method: 'POST',
    })

    expect(result).toEqual({
      body: {
        access_token: 'fresh-access-token',
        expires_in: 3600,
      },
      status: 200,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        body: expect.stringContaining('refresh_token=refresh-token'),
        method: 'POST',
      }),
    )
  })
})
