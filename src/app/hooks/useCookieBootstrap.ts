/*
  Author: Runor Ewhro
  Description: Hydrates cookie-related preferences from persisted browser state
               when the app first mounts.
*/

import { useEffect } from 'react'
import { mgrtLegCkCns } from '@/infra/cookies/cookieConsent'

export function useCkBoot() {
  useEffect(() => {
    mgrtLegCkCns()
  }, [])
}
