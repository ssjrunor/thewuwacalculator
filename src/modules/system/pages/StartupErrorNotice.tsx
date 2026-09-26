/*
  Author: Runor Ewhro
  Description: Adapts startup and root failures to the shared error notice.
*/

import { useEffect } from 'react'
import { ErrorNotice, readNoticeError } from './ErrorNotice'

export function StartupErrorNotice({ error, heading }: { error: unknown; heading?: string }) {
  useEffect(() => {
    window.dispatchEvent(new Event('app:startup-notice'))
  }, [])

  return (
    <ErrorNotice
      error={readNoticeError(error)}
      route={`${window.location.pathname}${window.location.search}`}
      bare
      startup
      heading={heading}
    />
  )
}
