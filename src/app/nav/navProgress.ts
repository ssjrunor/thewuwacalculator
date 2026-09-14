/*
  Author: Runor Ewhro
  Description: The wait before a page opens. A navigation now holds until the
               page it is going to is actually in hand, so instead of cutting
               to a loader the app says it is fetching and then opens cleanly.

               The saying is governed rather than literal. Almost every page is
               already in hand, so a wait that resolves in a frame shows
               nothing at all; and a wait that does show is held long enough to
               be read, so the line never strobes on a fast connection.
*/

import { create } from 'zustand'

// under this, the wait is not worth announcing
const SAY_AFTER = 120
// once said, it stands at least this long, which is one pass of the sweep
const SAY_FOR = 340

interface NavProgress {
  running: boolean
  begin: () => void
  end: () => void
}

export const useNavPrgrs = create<NavProgress>((set, get) => ({
  running: false,
  begin: () => {
    window.clearTimeout(hideTimer)
    window.clearTimeout(showTimer)
    showTimer = window.setTimeout(() => {
      shownAt = performance.now()
      set({ running: true })
    }, SAY_AFTER)
  },
  end: () => {
    window.clearTimeout(showTimer)
    if (!get().running) return

    const stood = performance.now() - shownAt
    window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(
      () => set({ running: false }),
      Math.max(SAY_FOR - stood, 0),
    )
  },
}))

let showTimer = 0
let hideTimer = 0
let shownAt = 0
