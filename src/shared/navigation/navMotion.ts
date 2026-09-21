/*
  Author: Runor Ewhro
  Description: Resolves whether route changes may use view transitions under current motion preferences.
*/

import { APP_ROUTES, SIMULATION_ROUTES } from '@/shared/lib/appRoutes'

// the app's own motion switch decides this, not the browser's, because the
// setting is the one the player turned off
export function motionAllowed(): boolean {
  if (typeof document === 'undefined') return false
  if (typeof document.startViewTransition !== 'function') return false
  return !document.documentElement.classList.contains('reduce-animation')
}

// Two pages that stand in the same room: the roster, the rail and the band are
// the same elements in the same places on both, and only the work between them
// differs. Handing one page to the other would blink furniture that never
// moved, so a move between them is drawn as a single dissolve instead of the
// two beats, said to the stylesheet by this class on the root.
const SAME_ROOM: string[][] = [
  [
    SIMULATION_ROUTES.modulation,
    SIMULATION_ROUTES.optimizer,
    SIMULATION_ROUTES.showcase,
    SIMULATION_ROUTES.suggestions,
  ],
]

const DISSOLVE = 'ax-dissolve'

// the class is only ever read while a transition is running, so it is dropped a
// beat after the move it was armed for rather than held for the route
const DISSOLVE_HELD = 700

let dropAt = 0

function sameRoom(from: string, to: string): boolean {
  if (from === to) return false
  return SAME_ROOM.some((room) => room.includes(from) && room.includes(to))
}

/*
  The front door gives the line more room and full ink; every other route keeps
  it quiet until you reach for it. The line is told this here, on the click,
  rather than by the chrome's own render on the route that follows.

  The reason is that the line's move is a real transition on padding and
  opacity, and a transition that only starts when the route commits is running
  while the destination is being built. A heavy surface holds the main thread
  long enough for the whole travel to pass without a frame, so the line is seen
  at one padding and then the other and reads as having been rebuilt. Armed on
  the click it has already begun, and most of it is behind us before the page it
  is going to costs anything.

  It is only the click that can arm it, so a load, a back and a forward are
  reconciled by the chrome instead; those land on a page that is already built,
  which is the case this was never about.
*/
const FRONT = 'ax-front'

export function setFrontDoor(to: string): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle(FRONT, to === APP_ROUTES.home)
}

// armed on the move itself, because which move it is cannot be read from either
// page: the page being left does not know where it is going
export function armMove(from: string, to: string): void {
  if (typeof document === 'undefined') return

  setFrontDoor(to)

  const root = document.documentElement
  window.clearTimeout(dropAt)

  if (!sameRoom(from, to)) {
    root.classList.remove(DISSOLVE)
    return
  }

  root.classList.add(DISSOLVE)
  dropAt = window.setTimeout(() => root.classList.remove(DISSOLVE), DISSOLVE_HELD)
}
