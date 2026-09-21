/*
  Author: Runor Ewhro
  Description: Tracks pending navigation and enforces its delay, minimum
               visible duration, and failure ceiling.
*/

import { create } from 'zustand'

// Keep this synchronized with --hold-after. CSS owns the delay because module
// evaluation can block the main thread and prevent a JavaScript timer firing.
const SAY_AFTER = 120
// Once visible, progress remains mounted for at least this interval.
const SAY_FOR = 340

// Releases progress if preloading or rendering never reaches the paint signal.
const HOLD_CEILING = 12000

interface NavProgress {
  running: boolean
  to: string | null
  begin: (to: string) => void
  end: () => void
}

export const useNavPrgrs = create<NavProgress>((set, get) => ({
  running: false,
  to: null,
  begin: (to) => {
    window.clearTimeout(hideTimer)
    window.clearTimeout(ceilingTimer)
    beganAt = performance.now()
    ceilingTimer = window.setTimeout(() => get().end(), HOLD_CEILING)
    set({ to, running: true })
  },
  end: () => {
    window.clearTimeout(ceilingTimer)

    // Clear the pending destination at paint time, but retain the running state
    // until the minimum visible interval has elapsed.
    if (get().to !== null) set({ to: null })
    if (!get().running) return

    const stood = performance.now() - beganAt
    window.clearTimeout(hideTimer)

    // CSS has not exposed progress yet, so no minimum visible interval is due.
    if (stood < SAY_AFTER) {
      set({ running: false })
      return
    }

    hideTimer = window.setTimeout(
      () => set({ running: false }),
      Math.max(SAY_AFTER + SAY_FOR - stood, 0),
    )
  },
}))

let hideTimer = 0
let ceilingTimer = 0
let beganAt = 0
