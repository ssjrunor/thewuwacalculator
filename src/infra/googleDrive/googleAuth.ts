export interface StoredGoogleUser {
  email?: string
  name?: string
  picture?: string
  sub?: string
}

export interface StoredGoogleTokens {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
  issued_at: number
  user?: StoredGoogleUser | null
}

const GOOGLE_TOKENS_STORAGE_KEY = 'wwcalc.googleTokens'

// reads the cached google oauth tokens from local storage.
export function getStoredGoogleTokens(): StoredGoogleTokens | null {
  try {
    const raw = localStorage.getItem(GOOGLE_TOKENS_STORAGE_KEY)
    if (!raw) {
      return null
    }

    return JSON.parse(raw) as StoredGoogleTokens
  } catch (error) {
    console.warn('failed to parse cached google tokens', error)
    return null
  }
}

// writes the latest google oauth tokens back into local storage.
export function setStoredGoogleTokens(tokens: StoredGoogleTokens): void {
  localStorage.setItem(GOOGLE_TOKENS_STORAGE_KEY, JSON.stringify(tokens))
}

// clears all cached google oauth state.
export function clearStoredGoogleTokens(): void {
  localStorage.removeItem(GOOGLE_TOKENS_STORAGE_KEY)
}

// refreshes the access token when the cached token is missing or near expiry.
export async function refreshGoogleAccessTokenIfNeeded(
  currentAccessToken?: string | null,
): Promise<string | null> {
  const tokens = getStoredGoogleTokens()
  if (!tokens?.access_token || !tokens.refresh_token) {
    return currentAccessToken ?? tokens?.access_token ?? null
  }

  const safeExpirySeconds = Number(tokens.expires_in) || 3600
  const expiresAt = tokens.issued_at + safeExpirySeconds * 1000
  const stillValid = Date.now() < expiresAt - 60_000
  if (stillValid) {
    return tokens.access_token
  }

  const response = await fetch('/api/refresh-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refresh_token: tokens.refresh_token,
    }),
  })

  if (!response.ok) {
    console.error('failed to refresh google access token', await response.text())
    clearStoredGoogleTokens()
    return null
  }

  const refreshed = await response.json() as Partial<StoredGoogleTokens>
  const nextTokens: StoredGoogleTokens = {
    ...tokens,
    ...refreshed,
    issued_at: Date.now(),
  }

  setStoredGoogleTokens(nextTokens)
  return nextTokens.access_token
}
