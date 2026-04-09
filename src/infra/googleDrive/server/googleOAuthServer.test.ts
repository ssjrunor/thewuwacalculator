import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  handleExchangeCodeRequest,
  handleRefreshTokenRequest,
} from './googleOAuthServer'

describe('googleOAuthServer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects non-post exchange requests', async () => {
    await expect(
      handleExchangeCodeRequest({
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
      handleExchangeCodeRequest({
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

  it('returns a configuration error when refresh credentials are missing', async () => {
    await expect(
      handleRefreshTokenRequest({
        body: JSON.stringify({ refresh_token: 'refresh-token' }),
        env: {},
        method: 'POST',
      }),
    ).resolves.toEqual({
      body: { error: 'Google OAuth server credentials are not configured' },
      status: 500,
    })
  })

  it('exchanges a code and falls back to the configured redirect uri', async () => {
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

    const result = await handleExchangeCodeRequest({
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
})
