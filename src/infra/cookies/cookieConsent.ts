/*
  Author: Runor Ewhro
  Description: Stores cookie-consent acknowledgement, migrates the legacy
               notice-dismissal flag, and keeps a lightweight browser cookie
               in sync for future server-side or UI integrations.
*/

export const CONSENT_STORE = 'wwcalc.cookie-consent.v1'
export const CONSENT_COOKIE = 'wwa_cookie_consent'
export const CONSENT_EVENT = 'wwcalc:cookie-consent-changed'
const CONSENT_MAX_AGE = 60 * 60 * 24 * 365

export type ConsentState = 'unknown' | 'acknowledged'

type ConsentDetail = {
  state: ConsentState
}

declare global {
  interface WndwVntMap {
    [CONSENT_EVENT]: CustomEvent<ConsentDetail>
  }
}

function isBrwsNvrn(): boolean {
  return typeof window !== 'undefined'
    && typeof window.localStorage !== 'undefined'
}

function normBlnLike(value: unknown): boolean {
  return value === true
    || value === 'true'
    || value === 'acknowledged'
    || value === 'granted'
}

function writeConsent(value: string, maxAgeScnd: number): void {
  if (typeof document === 'undefined') {
    return
  }

  document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${maxAgeScnd}; Path=/; SameSite=Lax`
}

function rmLegDsmsFla(): void {
  const directRaw = window.localStorage.getItem('cookieNoticeDismissed')
  if (directRaw != null) {
    window.localStorage.removeItem('cookieNoticeDismissed')
  }

  const nmspRaw = window.localStorage.getItem('__misc__')
  if (!nmspRaw) {
    return
  }

  try {
    const parsed = JSON.parse(nmspRaw)
    if (!parsed || typeof parsed !== 'object' || !('cookieNoticeDismissed' in parsed)) {
      return
    }

    delete parsed.cookieNoticeDismissed
    window.localStorage.setItem('__misc__', JSON.stringify(parsed))
  } catch {
    // keep the legacy payload intact if it cannot be parsed safely
  }
}

function readLegDsmsF(): boolean {
  const directRaw = window.localStorage.getItem('cookieNoticeDismissed')
  if (normBlnLike(directRaw)) {
    return true
  }

  const nmspRaw = window.localStorage.getItem('__misc__')
  if (nmspRaw) {
    try {
      const parsed = JSON.parse(nmspRaw)
      if (parsed && typeof parsed === 'object' && normBlnLike(parsed.cookieNoticeDismissed)) {
        return true
      }
    } catch {
      // ignore malformed legacy payloads
    }
  }

  if (typeof document !== 'undefined') {
    const cnsnCk = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${CONSENT_COOKIE}=`))

    if (cnsnCk) {
      const value = cnsnCk.split('=').slice(1).join('=')
      if (normBlnLike(value)) {
        return true
      }
    }
  }

  return false
}

function emitCkCnsnCh(state: ConsentState): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, {
    detail: { state },
  }))
}

export function readCkCnsnSt(): ConsentState {
  if (!isBrwsNvrn()) {
    return 'unknown'
  }

  const stored = window.localStorage.getItem(CONSENT_STORE)
  return normBlnLike(stored) ? 'acknowledged' : 'unknown'
}

export function hasAckdCkCns(): boolean {
  return readCkCnsnSt() === 'acknowledged'
}

export function ackCkCnsn(): void {
  if (!isBrwsNvrn()) {
    return
  }

  window.localStorage.setItem(CONSENT_STORE, 'acknowledged')
  writeConsent('acknowledged', CONSENT_MAX_AGE)
  emitCkCnsnCh('acknowledged')
}

export function clearConsent(): void {
  if (!isBrwsNvrn()) {
    return
  }

  window.localStorage.removeItem(CONSENT_STORE)
  writeConsent('', 0)
  emitCkCnsnCh('unknown')
}

export function mgrtLegCkCns(): ConsentState {
  if (!isBrwsNvrn()) {
    return 'unknown'
  }

  const current = readCkCnsnSt()
  if (current === 'acknowledged') {
    writeConsent('acknowledged', CONSENT_MAX_AGE)
    return current
  }

  if (!readLegDsmsF()) {
    return 'unknown'
  }

  ackCkCnsn()
  rmLegDsmsFla()
  return 'acknowledged'
}

