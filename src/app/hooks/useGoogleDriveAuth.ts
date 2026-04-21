import { useCallback, useEffect, useState } from 'react'
import { googleLogout, useGoogleLogin } from '@react-oauth/google'
import {
  clearStoredGoogleTokens,
  getStoredGoogleTokens,
  refreshGoogleAccessTokenIfNeeded,
  setStoredGoogleTokens,
  type StoredGoogleTokens,
  type StoredGoogleUser,
} from '@/infra/googleDrive/googleAuth'
import { getGoogleAuthEndpoint } from '@/infra/googleDrive/googleAuthEndpoints'

const GOOGLE_DRIVE_SCOPE = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')
const GOOGLE_AUTH_STATE_STORAGE_KEY = 'wwcalc.googleAuthState'

type GoogleAuthUxMode = 'popup' | 'redirect'

export type GoogleDriveUser = StoredGoogleUser

interface UseGoogleDriveAuthResult {
  accessToken: string | null
  connect: () => void
  disconnect: () => void
  error: string | null
  isConfigured: boolean
  isConnected: boolean
  refresh: () => Promise<string | null>
  user: GoogleDriveUser | null
}

function getInitialGoogleAuthState(): Pick<UseGoogleDriveAuthResult, 'accessToken' | 'user'> {
  const stored = getStoredGoogleTokens()
  return {
    accessToken: stored?.access_token ?? null,
    user: stored?.user ?? null,
  }
}

function getGoogleClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
}

function getGoogleAuthUxMode(): GoogleAuthUxMode {
  return import.meta.env.VITE_GOOGLE_AUTH_UX === 'redirect' ? 'redirect' : 'popup'
}

function getGoogleRedirectUri(mode: GoogleAuthUxMode = getGoogleAuthUxMode()): string {
  if (typeof window === 'undefined') {
    return import.meta.env.VITE_GOOGLE_REDIRECT_URI ?? ''
  }

  if (import.meta.env.VITE_GOOGLE_REDIRECT_URI) {
    return import.meta.env.VITE_GOOGLE_REDIRECT_URI
  }

  return mode === 'redirect'
    ? `${window.location.origin}${window.location.pathname}`
    : window.location.origin
}

function areGoogleUsersEqual(
  left: GoogleDriveUser | null,
  right: GoogleDriveUser | null,
): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return left.email === right.email
    && left.name === right.name
    && left.picture === right.picture
    && left.sub === right.sub
}

async function readGoogleAuthResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (!text) {
    return {}
  }

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(
      response.ok
        ? 'Google Drive sign-in returned an invalid response. Check that the Cloudflare /api routes are deployed.'
        : text,
    )
  }
}

function getGoogleAuthErrorMessage(payload: Record<string, unknown>, fallback: string): string {
  const error = typeof payload.error === 'string' ? payload.error : ''
  const details = payload.details && typeof payload.details === 'object'
    ? payload.details as Record<string, unknown>
    : null
  const detailError = typeof details?.error === 'string' ? details.error : ''
  const detailDescription = typeof details?.error_description === 'string' ? details.error_description : ''

  return detailDescription || detailError || error || fallback
}

function makeGoogleAuthState(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function removeGoogleAuthQueryParams(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('code')
  url.searchParams.delete('scope')
  url.searchParams.delete('state')
  url.searchParams.delete('authuser')
  url.searchParams.delete('prompt')
  url.searchParams.delete('error')
  url.searchParams.delete('error_description')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

// manages the browser-side oauth flow and cached token lifecycle for drive sync.
export function useGoogleDriveAuth(): UseGoogleDriveAuthResult {
  const [initialAuthState] = useState(getInitialGoogleAuthState)
  const [accessToken, setAccessToken] = useState<string | null>(initialAuthState.accessToken)
  const [user, setUser] = useState<GoogleDriveUser | null>(initialAuthState.user)
  const [error, setError] = useState<string | null>(null)
  const [authRequestState] = useState(() => makeGoogleAuthState())

  const isConfigured = Boolean(getGoogleClientId())
  const authUxMode = getGoogleAuthUxMode()

  const refresh = useCallback(async (): Promise<string | null> => {
    try {
      const nextToken = await refreshGoogleAccessTokenIfNeeded(accessToken)
      if (!nextToken) {
        setAccessToken(null)
        setUser(null)
        return null
      }

      const stored = getStoredGoogleTokens()
      setAccessToken((currentToken) => (currentToken === nextToken ? currentToken : nextToken))
      setUser((currentUser) => {
        const nextUser = stored?.user ?? currentUser ?? null
        return areGoogleUsersEqual(currentUser, nextUser) ? currentUser : nextUser
      })
      return nextToken
    } catch (refreshError) {
      console.error('failed to refresh cached google drive token', refreshError)
      clearStoredGoogleTokens()
      setAccessToken(null)
      setUser(null)
      setError('Google Drive session expired. Sign in again to continue.')
      return null
    }
  }, [accessToken])

  useEffect(() => {
    const refreshTimerId = window.setTimeout(() => {
      void refresh()
    }, 0)

    const intervalId = window.setInterval(() => {
      void refresh()
    }, 30 * 60 * 1000)

    return () => {
      window.clearTimeout(refreshTimerId)
      window.clearInterval(intervalId)
    }
  }, [refresh])

  const exchangeAuthCode = useCallback(async (code: string, redirectUri: string): Promise<void> => {
    const response = await fetch(getGoogleAuthEndpoint('exchange-code'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        redirectUri,
      }),
    })
    const payload = await readGoogleAuthResponse(response)

    if (!response.ok) {
      throw new Error(getGoogleAuthErrorMessage(payload, 'Google Drive sign-in failed.'))
    }

    const tokens = payload as Omit<StoredGoogleTokens, 'issued_at'> & { user?: GoogleDriveUser | null }
    const nextTokens: StoredGoogleTokens = {
      ...tokens,
      issued_at: Date.now(),
    }

    setStoredGoogleTokens(nextTokens)
    setAccessToken(nextTokens.access_token)
    setUser(nextTokens.user ?? null)
  }, [])

  useEffect(() => {
    if (authUxMode !== 'redirect' || typeof window === 'undefined') {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const redirectedError = params.get('error')
    if (redirectedError) {
      window.setTimeout(() => {
        setError(params.get('error_description') ?? redirectedError)
      }, 0)
      removeGoogleAuthQueryParams()
      return
    }

    const code = params.get('code')
    if (!code) {
      return
    }

    const expectedState = sessionStorage.getItem(GOOGLE_AUTH_STATE_STORAGE_KEY)
    const receivedState = params.get('state')
    if (!expectedState || !receivedState || expectedState !== receivedState) {
      window.setTimeout(() => {
        setError('Google Drive sign-in state did not match. Try signing in again.')
      }, 0)
      sessionStorage.removeItem(GOOGLE_AUTH_STATE_STORAGE_KEY)
      removeGoogleAuthQueryParams()
      return
    }

    sessionStorage.removeItem(GOOGLE_AUTH_STATE_STORAGE_KEY)
    const redirectUri = getGoogleRedirectUri('redirect')
    window.setTimeout(() => {
      void exchangeAuthCode(code, redirectUri)
        .catch((loginError) => {
          console.error('failed to exchange google redirect auth code', loginError)
          setError(loginError instanceof Error ? loginError.message : 'Google Drive sign-in failed.')
        })
        .finally(removeGoogleAuthQueryParams)
    }, 0)
  }, [authUxMode, exchangeAuthCode])

  const connect = useGoogleLogin({
    flow: 'auth-code',
    scope: GOOGLE_DRIVE_SCOPE,
    ux_mode: authUxMode,
    redirect_uri: getGoogleRedirectUri(authUxMode),
    state: authUxMode === 'redirect' ? authRequestState : undefined,
    onSuccess: async (codeResponse) => {
      try {
        setError(null)
        await exchangeAuthCode(codeResponse.code, getGoogleRedirectUri('popup'))
      } catch (loginError) {
        console.error('failed to exchange google auth code', loginError)
        setError(loginError instanceof Error ? loginError.message : 'Google Drive sign-in failed.')
      }
    },
    onError: (loginError) => {
      setError(loginError?.error_description ?? loginError?.error ?? 'Google Drive sign-in was cancelled or blocked.')
    },
    onNonOAuthError: (loginError) => {
      setError(loginError.type === 'popup_failed_to_open'
        ? 'Google Drive sign-in popup was blocked.'
        : `Google Drive sign-in was cancelled or blocked (${loginError.type}).`)
    },
  })

  const disconnect = () => {
    googleLogout()
    clearStoredGoogleTokens()
    setAccessToken(null)
    setUser(null)
    setError(null)
  }

  return {
    accessToken,
    connect: () => {
      if (!isConfigured) {
        setError('Set VITE_GOOGLE_CLIENT_ID before using Google Drive sync.')
        return
      }

      if (authUxMode === 'redirect') {
        sessionStorage.setItem(GOOGLE_AUTH_STATE_STORAGE_KEY, authRequestState)
        connect()
        return
      }

      connect()
    },
    disconnect,
    error,
    isConfigured,
    isConnected: Boolean(accessToken),
    refresh,
    user,
  }
}
