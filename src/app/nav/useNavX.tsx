/*
  Author: Runor Ewhro
  Description: The one way the app changes page. It names the move, holds until
               the page it is moving to is actually in hand, and only then lets
               the router commit inside a view transition. Nothing is ever
               animated into a loader: the wait happens on the page you are
               still reading, said by the line at the top of the app, and the
               next page opens once there is something whole to open.
*/

import { forwardRef, useCallback } from 'react'
import type { AnchorHTMLAttributes, MouseEvent, PointerEvent, FocusEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { NavigateOptions } from 'react-router-dom'
import { armMove, motionAllowed } from '@/app/nav/navMotion'
import { useNavPrgrs } from '@/app/nav/navProgress'
import { isPathWarm, warmPath } from '@/app/nav/routeChunks'
import { isPersistentWorkspaceRoute } from '@/shared/lib/appRoutes'

// a page that will not arrive cannot hold the app forever; past this the move
// is made anyway and the route's own fallback says the rest
const ARRIVAL_CEILING = 8000

interface NavigationIntentTracker {
  begin: () => number
  isCurrent: (intent: number) => boolean
}

export function createNavigationIntentTracker(): NavigationIntentTracker {
  let current = 0
  return {
    begin: () => {
      current += 1
      return current
    },
    isCurrent: (intent) => intent === current,
  }
}

// Every AxLink has its own hook instance, so the latest intent has to be owned
// by the navigation module rather than a component-local ref.
const navigationIntent = createNavigationIntentTracker()

function pathOf(to: string): string {
  return to.split('?')[0].split('#')[0] || '/'
}

function waited(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms) })
}

export type NavX = (to: string | number, options?: NavigateOptions) => void

export function useNavX(): NavX {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return useCallback((to: string | number, options?: NavigateOptions) => {
    const intent = navigationIntent.begin()
    const progress = useNavPrgrs.getState()

    if (typeof to === 'number') {
      // a step through history is a pop; the router pairs it with the push
      // that first drew the transition and plays the same fade
      progress.end()
      navigate(to)
      return
    }

    const target = pathOf(to)
    const staysOnBuildWorkspace = isPersistentWorkspaceRoute(pathname)
      && isPersistentWorkspaceRoute(target)
    const animated = target !== pathname && !staysOnBuildWorkspace && motionAllowed()

    if (!animated) {
      progress.end()
      navigate(to, options)
      return
    }

    const commit = () => {
      if (!navigationIntent.isCurrent(intent)) return
      progress.end()
      // the move is named for the stylesheet on the way out, while the page
      // being left is still the one on the screen and about to be captured
      armMove(pathname, target)
      navigate(to, { ...options, viewTransition: isPathWarm(target) })
    }

    if (isPathWarm(target)) {
      commit()
      return
    }

    // the page is not in hand yet, so the app says so and stays where it is
    // until it is, rather than moving to a page that has nothing on it
    progress.begin()

    // A failed prefetch must not strand the current page or the progress line.
    // Commit without a transition and let the route boundary retry/render the
    // failure; createRouteChunk has already released the rejected request.
    void Promise.race([warmPath(target), waited(ARRIVAL_CEILING)]).then(
      commit,
      commit,
    )
  }, [navigate, pathname])
}

export interface AxLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string
  replace?: boolean
  state?: unknown
}

// a link that reads as an ordinary anchor and moves like the rest of the app.
// modified presses are left to the browser so a link still opens in a tab.
export const AxLink = forwardRef<HTMLAnchorElement, AxLinkProps>(function AxLink(
  { to, replace, state, onClick, onPointerEnter, onFocus, children, ...rest },
  ref,
) {
  const navX = useNavX()

  const warm = () => {
    // Intent warming is best effort. A click retries through useNavX, while a
    // hover/focus rejection must not become an unhandled promise rejection.
    void warmPath(pathOf(to)).catch(() => undefined)
  }

  return (
    <Link
      {...rest}
      ref={ref}
      to={to}
      onPointerEnter={(event: PointerEvent<HTMLAnchorElement>) => {
        onPointerEnter?.(event)
        warm()
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        onFocus?.(event)
        warm()
      }}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event)
        if (event.defaultPrevented || event.button !== 0) return
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        if (rest.target && rest.target !== '_self') return

        event.preventDefault()
        navX(to, { replace, state })
      }}
    >
      {children}
    </Link>
  )
})
