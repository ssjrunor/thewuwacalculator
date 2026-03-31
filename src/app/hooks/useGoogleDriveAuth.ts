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
      setAccessToken(nextToken)
      setUser(stored?.user ?? user)
      return nextToken
    } catch (refreshError) {
      console.error('failed to refresh cached google drive token', refreshError)
      clearStoredGoogleTokens()
      setAccessToken(null)
      setUser(null)
      setError('Google Drive session expired. Sign in again to continue.')
      return null
    }
  }, [accessToken, user])

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

        const response = await fetch('/api/exchange-code', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code: codeResponse.code,
            redirectUri: getGoogleRedirectUri(),
          }),
        })

        if (!response.ok) {
          const message = await response.text()
          throw new Error(message || 'Google Drive sign-in failed.')
        }

        const tokens = await response.json() as Omit<StoredGoogleTokens, 'issued_at'> & { user?: GoogleDriveUser | null }
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
    onError: () => {
      setError('Google Drive sign-in was cancelled or blocked.')
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
