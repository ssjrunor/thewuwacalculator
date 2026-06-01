/*
  Author: Runor Ewhro
  Description: Manages browser-side google drive oauth state, including login,
               redirect handling, token refresh, and cached user/session state.
*/

import { useCallback, useEffect, useState } from 'react'
import { googleLogout, useGoogleLogin as useGglLgn } from '@react-oauth/google'
import {
  clrStrdGglTk,
  getStrdGglTk,
  rfrsGglCcssT,
  setStrdGglTk,
  type StrdGglTkns,
  type StrdGglUser,
} from '@/infra/googleDrive/googleAuth'
import { getGglAuthNd } from '@/infra/googleDrive/googleAuthEndpoints'

const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')
const DRIVE_STATE_KEY = 'wwcalc.googleAuthState'

type GglAuthUxMod = 'popup' | 'redirect'

export type GglDrvUser = StrdGglUser

interface UseGglDrvAut {
  accessToken: string | null
  connect: () => void
  disconnect: () => void
  error: string | null
  isConfigured: boolean
  isConnected: boolean
  refresh: () => Promise<string | null>
  user: GglDrvUser | null
}

function getNtlGglAut(): Pick<UseGglDrvAut, 'accessToken' | 'user'> {
  const stored = getStrdGglTk()
  return {
    accessToken: stored?.access_token ?? null,
    user: stored?.user ?? null,
  }
}

function getGglClntId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
}

function getGglAuthUx(): GglAuthUxMod {
  return import.meta.env.VITE_GOOGLE_AUTH_UX === 'redirect' ? 'redirect' : 'popup'
}

function getGglRdrcUr(mode: GglAuthUxMod = getGglAuthUx()): string {
  // redirect mode needs the current page url so google can return the user
  // back to the same route after consent completes.
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

function areGglSrsQl(
  left: GglDrvUser | null,
  right: GglDrvUser | null,
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

async function readGglAuthR(response: Response): Promise<Record<string, unknown>> {
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

function getGglAuthRr(payload: Record<string, unknown>, fallback: string): string {
  const error = typeof payload.error === 'string' ? payload.error : ''
  const details = payload.details && typeof payload.details === 'object'
    ? payload.details as Record<string, unknown>
    : null
  const detailError = typeof details?.error === 'string' ? details.error : ''
  const dtlDscr = typeof details?.error_description === 'string' ? details.error_description : ''

  return dtlDscr || detailError || error || fallback
}

function makeGoogleState(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function clrAuthQry(): void {
  // once redirect-mode auth finishes, strip oauth params so refreshes and
  // future routing do not keep replaying the callback state.
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
export function useGglDrvAut(): UseGglDrvAut {
  const [initAuthStt] = useState(getNtlGglAut)
  const [accessToken, setAccTok] = useState<string | null>(initAuthStt.accessToken)
  const [user, setUser] = useState<GglDrvUser | null>(initAuthStt.user)
  const [error, setError] = useState<string | null>(null)
  const [authRqstStt] = useState(() => makeGoogleState())

  const isConfigured = Boolean(getGglClntId())
  const authUxMode = getGglAuthUx()

  const refresh = useCallback(async (): Promise<string | null> => {
    try {
      const nextToken = await rfrsGglCcssT(accessToken)
      if (!nextToken) {
        setAccTok(null)
        setUser(null)
        return null
      }

      const stored = getStrdGglTk()
      setAccTok((currentToken) => (currentToken === nextToken ? currentToken : nextToken))
      setUser((currentUser) => {
        const nextUser = stored?.user ?? currentUser ?? null
        return areGglSrsQl(currentUser, nextUser) ? currentUser : nextUser
      })
      return nextToken
    } catch (refreshError) {
      console.error('failed to refresh cached google drive token', refreshError)
      clrStrdGglTk()
      setAccTok(null)
      setUser(null)
      setError('Google Drive session expired. Sign in again to continue.')
      return null
    }
  }, [accessToken])

  useEffect(() => {
    // refresh once immediately after mount, then periodically while the app is
    // open so drive sync keeps working without manual reconnects.
    const rfrsTmrId = window.setTimeout(() => {
      void refresh()
    }, 0)

    const intervalId = window.setInterval(() => {
      void refresh()
    }, 30 * 60 * 1000)

    return () => {
      window.clearTimeout(rfrsTmrId)
      window.clearInterval(intervalId)
    }
  }, [refresh])

  const xchnAuthCode = useCallback(async (code: string, redirectUri: string): Promise<void> => {
    const response = await fetch(getGglAuthNd('exchange-code'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        redirectUri,
      }),
    })
    const payload = await readGglAuthR(response)

    if (!response.ok) {
      throw new Error(getGglAuthRr(payload, 'Google Drive sign-in failed.'))
    }

    const tokens = payload as Omit<StrdGglTkns, 'issued_at'> & { user?: GglDrvUser | null }
    // stamp a local issue time so later refresh checks can reason about expiry.
    const nextTokens: StrdGglTkns = {
      ...tokens,
      issued_at: Date.now(),
    }

    setStrdGglTk(nextTokens)
    setAccTok(nextTokens.access_token)
    setUser(nextTokens.user ?? null)
  }, [])

  useEffect(() => {
    if (authUxMode !== 'redirect' || typeof window === 'undefined') {
      return
    }

    // redirect-mode sign-in comes back through normal page navigation, so this
    // effect owns the one-time callback exchange and cleanup.
    const params = new URLSearchParams(window.location.search)
    const rdrcRrr = params.get('error')
    if (rdrcRrr) {
      window.setTimeout(() => {
        setError(params.get('error_description') ?? rdrcRrr)
      }, 0)
      clrAuthQry()
      return
    }

    const code = params.get('code')
    if (!code) {
      return
    }

    const xpctStt = sessionStorage.getItem(DRIVE_STATE_KEY)
    const rcvdStt = params.get('state')
    if (!xpctStt || !rcvdStt || xpctStt !== rcvdStt) {
      window.setTimeout(() => {
        setError('Google Drive sign-in state did not match. Try signing in again.')
      }, 0)
      sessionStorage.removeItem(DRIVE_STATE_KEY)
      clrAuthQry()
      return
    }

    sessionStorage.removeItem(DRIVE_STATE_KEY)
    const redirectUri = getGglRdrcUr('redirect')
    window.setTimeout(() => {
      void xchnAuthCode(code, redirectUri)
        .catch((loginError) => {
          console.error('failed to exchange google redirect auth code', loginError)
          setError(loginError instanceof Error ? loginError.message : 'Google Drive sign-in failed.')
        })
        .finally(clrAuthQry)
    }, 0)
  }, [authUxMode, xchnAuthCode])

  const connect = useGglLgn({
    flow: 'auth-code',
    scope: DRIVE_SCOPES,
    ux_mode: authUxMode,
    redirect_uri: getGglRdrcUr(authUxMode),
    state: authUxMode === 'redirect' ? authRqstStt : undefined,
    onSuccess: async (codeResponse) => {
      try {
        setError(null)
        await xchnAuthCode(codeResponse.code, getGglRdrcUr('popup'))
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
    clrStrdGglTk()
    setAccTok(null)
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
        sessionStorage.setItem(DRIVE_STATE_KEY, authRqstStt)
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
