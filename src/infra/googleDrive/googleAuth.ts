/*
  Author: Runor Ewhro
  Description: Stores browser-side google oauth tokens and refreshes access
               tokens through the worker-backed refresh endpoint when needed.
*/

import { getGglAuthNd } from './googleAuthEndpoints'

export interface StrdGglUser {
  email?: string
  name?: string
  picture?: string
  sub?: string
}

export interface StrdGglTkns {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
  issued_at: number
  user?: StrdGglUser | null
}

const GGLTKNSSTORE = 'wwcalc.googleTokens'

// reads the cached google oauth tokens from local storage.
export function getStrdGglTk(): StrdGglTkns | null {
  try {
    const raw = localStorage.getItem(GGLTKNSSTORE)
    if (!raw) {
      return null
    }

    return JSON.parse(raw) as StrdGglTkns
  } catch (error) {
    console.warn('failed to parse cached google tokens', error)
    return null
  }
}

// writes the latest google oauth tokens back into local storage.
export function setStrdGglTk(tokens: StrdGglTkns): void {
  localStorage.setItem(GGLTKNSSTORE, JSON.stringify(tokens))
}

// clears all cached google oauth state.
export function clrStrdGglTk(): void {
  localStorage.removeItem(GGLTKNSSTORE)
}

// refreshes the access token when the cached token is missing or near expiry.
export async function rfrsGglCcssT(
  curCcssTkn?: string | null,
): Promise<string | null> {
  const tokens = getStrdGglTk()
  if (!tokens?.access_token || !tokens.refresh_token) {
    return curCcssTkn ?? tokens?.access_token ?? null
  }

  const safeXpryScnd = Number(tokens.expires_in) || 3600
  const expiresAt = tokens.issued_at + safeXpryScnd * 1000
  // refresh a little early so in-flight drive requests do not race the exact
  // expiry boundary.
  const stillValid = Date.now() < expiresAt - 60_000
  if (stillValid) {
    return tokens.access_token
  }

  const response = await fetch(getGglAuthNd('refresh-token'), {
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
    clrStrdGglTk()
    return null
  }

  const refreshed = await response.json() as Partial<StrdGglTkns>
  const nextTokens: StrdGglTkns = {
    ...tokens,
    ...refreshed,
    issued_at: Date.now(),
  }

  setStrdGglTk(nextTokens)
  return nextTokens.access_token
}
