/*
  Author: Runor Ewhro
  Description: Tracks cookie-banner visibility and dismissal state for the app
               shell.
*/

import { useEffect } from 'react'
import { useAnimVis } from '@/app/hooks/useAnimatedVisibility'
import {
  CONSENT_EVENT,
  hasAckdCkCns,
  ackCkCnsn,
} from '@/infra/cookies/cookieConsent'
import { loadGglAnal } from '@/infra/analytics/googleAnalytics'

const SHOW_DLY_MS = 1400

export function useCkBnnr() {
  const { show, hide, visible, open, closing } = useAnimVis()

  useEffect(() => {
    if (hasAckdCkCns()) {
      return
    }

    const timer = window.setTimeout(show, SHOW_DLY_MS)
    return () => window.clearTimeout(timer)
  }, [show])

  useEffect(() => {
    const onConsentChange = () => {
      if (hasAckdCkCns()) {
        hide()
      }
    }

    window.addEventListener(CONSENT_EVENT, onConsentChange)
    return () => window.removeEventListener(CONSENT_EVENT, onConsentChange)
  }, [hide])

  const accept = () => {
    ackCkCnsn()
    void loadGglAnal()
    hide()
  }

  return { visible, open, closing, accept }
}
