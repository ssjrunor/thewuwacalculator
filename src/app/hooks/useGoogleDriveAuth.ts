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

function getGoogleClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
}

function getGoogleRedirectUri(): string {
  if (typeof window === 'undefined') {
    return import.meta.env.VITE_GOOGLE_REDIRECT_URI ?? ''
  }

  return import.meta.env.VITE_GOOGLE_REDIRECT_URI ?? window.location.origin
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

// manages the browser-side oauth flow and cached token lifecycle for drive sync.
export function useGoogleDriveAuth(): UseGoogleDriveAuthResult {
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [user, setUser] = useState<GoogleDriveUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isConfigured = Boolean(getGoogleClientId())

  useEffect(() => {
    const stored = getStoredGoogleTokens()
    if (!stored?.access_token) {
      return
    }

    setAccessToken(stored.access_token)
    setUser(stored.user ?? null)
  }, [])

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
    void refresh()

    const intervalId = window.setInterval(() => {
      void refresh()
    }, 30 * 60 * 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [refresh])

  const connect = useGoogleLogin({
    flow: 'auth-code',
    scope: GOOGLE_DRIVE_SCOPE,
    redirect_uri: getGoogleRedirectUri(),
    onSuccess: async (codeResponse) => {
      try {
        setError(null)

        const response = await fetch(getGoogleAuthEndpoint('exchange-code'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code: codeResponse.code,
            redirectUri: getGoogleRedirectUri(),
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
        : 'Google Drive sign-in was cancelled or blocked.')
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
