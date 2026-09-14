/*
  Author: Runor Ewhro
  Description: What the app says while a page is being fetched. One line at the
               very top edge, with a light running along it from left to right,
               for as long as the next page is still arriving. It stands
               outside the aperture, so it belongs to the frame rather than to
               either page and is never drawn into the move between them.
*/

import { useEffect } from 'react'
import { useAnimatedVisibility } from '@/app/hooks/useAnimatedVisibility'
import { useNavPrgrs } from '@/app/nav/navProgress'

const FADE_MS = 220

export function NavSweep() {
  const running = useNavPrgrs((state) => state.running)
  const { visible, closing, show, hide } = useAnimatedVisibility(FADE_MS)

  useEffect(() => {
    if (running) show()
    else hide()
  }, [hide, running, show])

  if (!visible) return null

  return (
    <div
      className={`ax-sweep${closing ? ' is-closing' : ''}`}
      role="progressbar"
      aria-label="Loading page"
    >
      <span className="ax-sweep-run" aria-hidden="true" />
    </div>
  )
}
