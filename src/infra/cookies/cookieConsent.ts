/*
  Author: Runor Ewhro
  Description: Stores cookie-consent acknowledgement, migrates the legacy
               notice-dismissal flag, and keeps a lightweight browser cookie
               in sync for future server-side or UI integrations.
*/

export const COOKIE_CONSENT_STORAGE_KEY = 'wwcalc.cookie-consent.v1'
export const COOKIE_CONSENT_COOKIE_NAME = 'wwa_cookie_consent'
export const COOKIE_CONSENT_EVENT_NAME = 'wwcalc:cookie-consent-changed'
const COOKIE_CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export type CookieConsentState = 'unknown' | 'acknowledged'

type CookieConsentDetail = {
  state: CookieConsentState
}

declare global {
  interface WindowEventMap {
    [COOKIE_CONSENT_EVENT_NAME]: CustomEvent<CookieConsentDetail>
  }
}

function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined'
    && typeof window.localStorage !== 'undefined'
}

function normalizeBooleanLike(value: unknown): boolean {
  return value === true
    || value === 'true'
    || value === 'acknowledged'
    || value === 'granted'
}

function writeConsentCookie(value: string, maxAgeSeconds: number): void {
  if (typeof document === 'undefined') {
    return
  }

  document.cookie = `${COOKIE_CONSENT_COOKIE_NAME}=${value}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax`
}

function removeLegacyDismissalFlag(): void {
  const directRaw = window.localStorage.getItem('cookieNoticeDismissed')
  if (directRaw != null) {
    window.localStorage.removeItem('cookieNoticeDismissed')
  }

  const namespacedRaw = window.localStorage.getItem('__misc__')
  if (!namespacedRaw) {
    return
  }

  try {
    const parsed = JSON.parse(namespacedRaw)
    if (!parsed || typeof parsed !== 'object' || !('cookieNoticeDismissed' in parsed)) {
      return
    }

    delete parsed.cookieNoticeDismissed
    window.localStorage.setItem('__misc__', JSON.stringify(parsed))
  } catch {
    // keep the legacy payload intact if it cannot be parsed safely
  }
}

function readLegacyDismissalFlag(): boolean {
  const directRaw = window.localStorage.getItem('cookieNoticeDismissed')
  if (normalizeBooleanLike(directRaw)) {
    return true
  }

  const namespacedRaw = window.localStorage.getItem('__misc__')
  if (namespacedRaw) {
    try {
      const parsed = JSON.parse(namespacedRaw)
      if (parsed && typeof parsed === 'object' && normalizeBooleanLike(parsed.cookieNoticeDismissed)) {
        return true
      }
    } catch {
      // ignore malformed legacy payloads
    }
  }

  if (typeof document !== 'undefined') {
    const consentCookie = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${COOKIE_CONSENT_COOKIE_NAME}=`))

    if (consentCookie) {
      const value = consentCookie.split('=').slice(1).join('=')
      if (normalizeBooleanLike(value)) {
        return true
      }
    }
  }

  return false
}

function emitCookieConsentChanged(state: CookieConsentState): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT_NAME, {
    detail: { state },
  }))
}

export function readCookieConsentState(): CookieConsentState {
  if (!isBrowserEnvironment()) {
    return 'unknown'
  }

  const stored = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)
  return normalizeBooleanLike(stored) ? 'acknowledged' : 'unknown'
}

export function hasAcknowledgedCookieConsent(): boolean {
  return readCookieConsentState() === 'acknowledged'
}

export function acknowledgeCookieConsent(): void {
  if (!isBrowserEnvironment()) {
    return
  }

  window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, 'acknowledged')
  writeConsentCookie('acknowledged', COOKIE_CONSENT_COOKIE_MAX_AGE_SECONDS)
  emitCookieConsentChanged('acknowledged')
}

export function clearCookieConsent(): void {
  if (!isBrowserEnvironment()) {
    return
  }

  window.localStorage.removeItem(COOKIE_CONSENT_STORAGE_KEY)
  writeConsentCookie('', 0)
  emitCookieConsentChanged('unknown')
}

export function migrateLegacyCookieConsent(): CookieConsentState {
  if (!isBrowserEnvironment()) {
    return 'unknown'
  }

  const current = readCookieConsentState()
  if (current === 'acknowledged') {
    writeConsentCookie('acknowledged', COOKIE_CONSENT_COOKIE_MAX_AGE_SECONDS)
    return current
  }

  if (!readLegacyDismissalFlag()) {
    return 'unknown'
  }

  acknowledgeCookieConsent()
  removeLegacyDismissalFlag()
  return 'acknowledged'
}

