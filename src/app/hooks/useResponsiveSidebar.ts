/*
  Author: Runor Ewhro
  Description: Tracks responsive sidebar state, mobile behavior, and
               overlay open/close transitions based on screen width.
*/

import { useEffect, useState } from 'react'

interface ResponsiveSidebarOptions {
  mobileBreakpoint?: number
  defaultWidth?: number
  closeDelayMs?: number
}

// compute the initial mobile state safely for client and server rendering
function getInitialMobileState(defaultWidth: number): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return window.innerWidth < defaultWidth
}

export function useResponsiveSidebar({
                                       mobileBreakpoint = 1070,
                                       defaultWidth = 700,
                                       closeDelayMs = 400,
                                     }: ResponsiveSidebarOptions = {}) {
  const [hamburgerOpen, setHamburgerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => getInitialMobileState(defaultWidth))
  const [isOverlayVisible, setIsOverlayVisible] = useState(false)
  const [isOverlayClosing, setIsOverlayClosing] = useState(false)

  // watch window size and keep the mobile state in sync with the breakpoint
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const handleResize = () => {
      const nextIsMobile = window.innerWidth < mobileBreakpoint
      setIsMobile(nextIsMobile)

      // when entering mobile layout, force the sidebar closed
      if (nextIsMobile) {
        setHamburgerOpen(false)
      }
    }

    const frameId = window.requestAnimationFrame(handleResize)
    window.addEventListener('resize', handleResize)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', handleResize)
    }
  }, [mobileBreakpoint])

  // manage overlay visibility and its exit animation timing
  useEffect(() => {
    let timeoutId: number | undefined
    let frameId: number | undefined

    if (hamburgerOpen) {
      // open overlay on the next frame so transitions can apply cleanly
      frameId = window.requestAnimationFrame(() => {
        setIsOverlayVisible(true)
        setIsOverlayClosing(false)
      })
    } else {
      // mark overlay as closing, then fully hide it after the exit delay
      frameId = window.requestAnimationFrame(() => {
        setIsOverlayClosing(true)
      })

      timeoutId = window.setTimeout(() => {
        setIsOverlayVisible(false)
        setIsOverlayClosing(false)
      }, closeDelayMs)
    }

    return () => {
      if (typeof frameId === 'number') {
        window.cancelAnimationFrame(frameId)
      }

      if (typeof timeoutId === 'number') {
        window.clearTimeout(timeoutId)
      }
    }
  }, [closeDelayMs, hamburgerOpen])

  return {
    hamburgerOpen,
    setHamburgerOpen,
    isMobile,
    isOverlayVisible,
    isOverlayClosing,
  }
}