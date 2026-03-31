import { useEffect } from 'react'
import { useAnimatedVisibility } from '@/app/hooks/useAnimatedVisibility'
import {
  COOKIE_CONSENT_EVENT_NAME,
  hasAcknowledgedCookieConsent,
  acknowledgeCookieConsent,
} from '@/infra/cookies/cookieConsent'
import { loadGoogleAnalytics } from '@/infra/analytics/googleAnalytics'

const SHOW_DELAY_MS = 1400

export function useCookieBanner() {
  const { show, hide, visible, open, closing } = useAnimatedVisibility()

  useEffect(() => {
    if (hasAcknowledgedCookieConsent()) {
      return
    }

    const timer = window.setTimeout(show, SHOW_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [show])

  useEffect(() => {
    const handleConsentChanged = () => {
      if (hasAcknowledgedCookieConsent()) {
        hide()
      }
    }

    window.addEventListener(COOKIE_CONSENT_EVENT_NAME, handleConsentChanged)
    return () => window.removeEventListener(COOKIE_CONSENT_EVENT_NAME, handleConsentChanged)
  }, [hide])

  const accept = () => {
    acknowledgeCookieConsent()
    void loadGoogleAnalytics()
    hide()
  }

  return { visible, open, closing, accept }
}
