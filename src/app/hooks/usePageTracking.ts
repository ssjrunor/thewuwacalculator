import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackGoogleAnalyticsPageView } from '@/infra/analytics/googleAnalytics'
import { COOKIE_CONSENT_EVENT_NAME } from '@/infra/cookies/cookieConsent'

export function usePageTracking() {
  const location = useLocation()

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    void trackGoogleAnalyticsPageView({
      pagePath: `${location.pathname}${location.search}`,
      pageLocation: window.location.href,
      pageTitle: document.title,
    })
  }, [location.pathname, location.search])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    const handleConsentChanged = () => {
      void trackGoogleAnalyticsPageView({
        pagePath: `${location.pathname}${location.search}`,
        pageLocation: window.location.href,
        pageTitle: document.title,
      })
    }

    window.addEventListener(COOKIE_CONSENT_EVENT_NAME, handleConsentChanged)
    return () => window.removeEventListener(COOKIE_CONSENT_EVENT_NAME, handleConsentChanged)
  }, [location.pathname, location.search])
}
