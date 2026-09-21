/*
  Author: Runor Ewhro
  Description: Projects canonical application health into the chrome and delegates full status inspection.
*/

import { useRtChrmMen } from '@/application/context-menu/routeMenuContext'
import { APP_CONDITION } from '@/data/content/appStatus'

interface AppStampProps {
  // where this route sends the stamp, when it has taken it
  go?: () => void
}

export function AppStamp({ go }: AppStampProps) {
  const rtChrmMenu = useRtChrmMen()

  return (
    <button
      type="button" className="ax-stamp"
      onClick={() => (go ? go() : rtChrmMenu.actions.openStatus())}
      aria-label={
        go
          ? `App status: ${APP_CONDITION.label}, patch ${APP_CONDITION.patch}. Read it on this page`
          : `App status: ${APP_CONDITION.label}, patch ${APP_CONDITION.patch}`
      }
    >
      <span className={`ax-stamp__dot${APP_CONDITION.ok ? '' : ' is-warn'}`} aria-hidden="true" />
      <span>{APP_CONDITION.label}</span>
      <span className="ax-stamp__mid" aria-hidden="true">·</span>
      Patch <b>v{APP_CONDITION.patch}</b>
    </button>
  )
}
