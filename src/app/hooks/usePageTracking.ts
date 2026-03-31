import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { trackGoogleAnalyticsPageView } from '@/infra/analytics/googleAnalytics'

export function usePageTracking() {
  const location = useLocation()
  const hasTrackedInitialPageRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    if (!hasTrackedInitialPageRef.current) {
      hasTrackedInitialPageRef.current = true
      return
    }

    void trackGoogleAnalyticsPageView({
      pagePath: `${location.pathname}${location.search}`,
      pageLocation: window.location.href,
      pageTitle: document.title,
    })
  }, [location.pathname, location.search])
}
