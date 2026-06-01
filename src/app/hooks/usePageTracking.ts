/*
  Author: Runor Ewhro
  Description: Sends page-view analytics whenever the current route changes.
*/

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { trackGooglePage } from '@/infra/analytics/googleAnalytics'

export function usePageTrck() {
  const location = useLocation()
  const hasTrckNtlPa = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    if (!hasTrckNtlPa.current) {
      hasTrckNtlPa.current = true
      return
    }

    void trackGooglePage({
      pagePath: `${location.pathname}${location.search}`,
      pageLocation: window.location.href,
      pageTitle: document.title,
    })
  }, [location.pathname, location.search])
}
