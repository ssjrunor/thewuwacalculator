/*
  Author: Runor Ewhro
  Description: Coordinates navigation intent, route preloading, progress state,
               and optional view-transition commits.
*/

import { forwardRef, useCallback } from 'react'
import type { AnchorHTMLAttributes, MouseEvent, PointerEvent, FocusEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { NavigateOptions } from 'react-router-dom'
import { armMove, motionAllowed } from '@/shared/navigation/navMotion'
import { useNavPrgrs } from '@/shared/navigation/navProgress'
import {
  isNavigationPathWarm,
  warmNavigationPath,
} from '@/shared/navigation/navigationPreload'
import { isPersistentWorkspaceRoute } from '@/shared/lib/appRoutes'

// Commit even when preloading stalls; the route boundary owns subsequent loading.
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

// Module ownership lets a newer click supersede work started by another AxLink.
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
      progress.end()
      navigate(to)
      return
    }

    const target = pathOf(to)
    const staysOnBuildWorkspace = isPersistentWorkspaceRoute(pathname)
      && isPersistentWorkspaceRoute(target)
    const animated = target !== pathname && !staysOnBuildWorkspace && motionAllowed()

    // NavHold ends progress after the destination paints, not when its chunk loads.
    const commit = () => {
      if (!navigationIntent.isCurrent(intent)) return

      if (!animated) {
        navigate(to, options)
        return
      }

      // Capture direction before the outgoing page is replaced.
      armMove(pathname, target)
      navigate(to, { ...options, viewTransition: isNavigationPathWarm(target) })
    }

    if (isNavigationPathWarm(target)) {
      progress.end()
      commit()
      return
    }

    // Record the target before preloading so navigation chrome can follow it.
    progress.begin(target)

    // A failed prefetch must not strand the current page or the progress line.
    // Commit without a transition and let the route boundary retry/render the
    // failure; createRouteChunk has already released the rejected request.
    void Promise.race([warmNavigationPath(target), waited(ARRIVAL_CEILING)]).then(
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

// Modified presses remain native so links can still open in another tab/window.
export const AxLink = forwardRef<HTMLAnchorElement, AxLinkProps>(function AxLink(
  { to, replace, state, onClick, onPointerEnter, onFocus, children, ...rest },
  ref,
) {
  const navX = useNavX()

  const warm = () => {
    // Intent warming is best effort. A click retries through useNavX, while a
    // hover/focus rejection must not become an unhandled promise rejection.
    void warmNavigationPath(pathOf(to)).catch(() => undefined)
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
