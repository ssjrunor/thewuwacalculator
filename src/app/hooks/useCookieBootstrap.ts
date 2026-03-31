import { useEffect } from 'react'
import { migrateLegacyCookieConsent } from '@/infra/cookies/cookieConsent'

export function useCookieBootstrap() {
  useEffect(() => {
    migrateLegacyCookieConsent()
  }, [])
}
