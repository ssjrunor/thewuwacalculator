/*
  Author: Runor Ewhro
  Description: The app's condition, at the end of the line. It is the front of
               the system report's own stamp rather than a second account of the
               same thing: the state tag the report's header wears, then the
               first of its `PATCH · COVERAGE · ISSUES · VIA` probes. Opening it
               opens that report.

               A route that carries the report itself takes the stamp instead,
               and the line sends you to its account rather than opening a copy
               of what you are already reading.

               It is a readout, so the accent is spent only on the dot, which is
               the app's state and nothing else.
*/

import { useRtChrmMen } from '@/shared/context-menu/routeMenuContext'
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
