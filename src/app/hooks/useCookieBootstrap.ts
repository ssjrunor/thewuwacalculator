import { useEffect } from 'react'
import { loadGoogleAnalytics } from '@/infra/analytics/googleAnalytics'
import { migrateLegacyCookieConsent } from '@/infra/cookies/cookieConsent'

export function useCookieBootstrap() {
  useEffect(() => {
    migrateLegacyCookieConsent()
    void loadGoogleAnalytics()
  }, [])
}
