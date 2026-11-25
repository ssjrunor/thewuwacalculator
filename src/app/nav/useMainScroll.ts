/*
  Author: Runor Ewhro
  description: restores each page's scroll position. a push lands at the top of
               the new page and a back step at the exact previous position, so
               the transition never animates a page into a scroll position it did
               not have; a replace on the same path (a query param such as an open
               row) keeps the position.
*/

import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// keep at most 40 scroll history entries; evict the oldest on overflow.
const KEPT = 40
const left = new Map<string, number>()

function remember(key: string, top: number) {
  left.delete(key)
  left.set(key, top)
  while (left.size > KEPT) {
    const oldest = left.keys().next().value
    if (oldest === undefined) break
    left.delete(oldest)
  }
}

export function useMainScroll(ref: RefObject<HTMLElement | null>): void {
  const location = useLocation()
  const navigationType = useNavigationType()
  const { key, pathname } = location
  const lastPath = useRef<string | null>(null)

  useLayoutEffect(() => {
    const surface = ref.current
    const samePage = lastPath.current === pathname
    lastPath.current = pathname
    if (!surface) return

    // same page with new params: keep the scroll position
    if (navigationType === 'REPLACE' && samePage) {
      remember(key, surface.scrollTop)
      return
    }
    const stored = left.get(key)
    surface.scrollTop = navigationType === 'POP' && stored !== undefined ? stored : 0
  }, [key, pathname, navigationType, ref])

  useEffect(() => {
    const surface = ref.current
    if (!surface) return

    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        remember(key, surface.scrollTop)
      })
    }

    surface.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      surface.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [key, ref])
}
