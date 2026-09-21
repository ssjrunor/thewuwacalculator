/*
  Author: Runor Ewhro
  Description: Keeps navigation progress active until the destination route
               has painted, with a fallback for background tabs.
*/

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAnimatedVisibility } from '@/shared/hooks/useAnimatedVisibility'
import { useNavPrgrs } from '@/shared/navigation/navProgress'

const FADE_MS = 300

/*
  A route commit can precede its first visible frame when rendering blocks the
  main thread. Two animation frames defer completion until after that commit is
  eligible to paint.
*/
function useSettleOnPaint() {
  const { pathname } = useLocation()

  useEffect(() => {
    // Background tabs may suspend animation frames indefinitely.
    if (document.visibilityState === 'hidden') {
      const idle = window.setTimeout(() => { useNavPrgrs.getState().end() }, 0)
      return () => { window.clearTimeout(idle) }
    }

    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => { useNavPrgrs.getState().end() })
    })

    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [pathname])
}

export function NavHold() {
  const running = useNavPrgrs((state) => state.running)
  const { visible, closing, show, hide } = useAnimatedVisibility(FADE_MS)

  useSettleOnPaint()

  useEffect(() => {
    if (running) show()
    else hide()
  }, [hide, running, show])

  if (!visible) return null

  return (
    <div
      className={`ax-hold${closing ? ' is-closing' : ''}`}
      role="progressbar"
      aria-label="Loading page"
    >
      <span className="ax-hold-warm" aria-hidden="true" />
    </div>
  )
}
