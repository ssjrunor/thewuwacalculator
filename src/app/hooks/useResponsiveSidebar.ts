/*
  Author: Runor Ewhro
  Description: Tracks responsive sidebar state, mobile behavior, and
               overlay open/close transitions based on screen width.
*/

import { useEffect, useState } from 'react'

interface RspnSdbrPtns {
  mblBp?: number
  defaultWidth?: number
  closeDelayMs?: number
}

// compute the initial mobile state safely for client and server rendering
function getNtlMblStt(defaultWidth: number): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return window.innerWidth < defaultWidth
}

export function useRspnSdbr({
                                       mblBp: mblBp = 568,
                                       defaultWidth = 568,
                                       closeDelayMs = 400,
                                     }: RspnSdbrPtns = {}) {
  const [hambOpen, setHambOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => getNtlMblStt(defaultWidth))
  const [isOvrVis, setIsOvrVis] = useState(false)
  const [isOvrCls, setIsOvrCls] = useState(false)

  // watch window size and keep the mobile state in sync with the breakpoint
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const handleResize = () => {
      const nextIsMobile = window.innerWidth < mblBp
      setIsMobile(nextIsMobile)

      // when entering mobile layout, force the sidebar closed
      if (nextIsMobile) {
        setHambOpen(false)
      }
    }

    const frameId = window.requestAnimationFrame(handleResize)
    window.addEventListener('resize', handleResize)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', handleResize)
    }
  }, [mblBp])

  // manage overlay visibility and its exit animation timing
  useEffect(() => {
    let timeoutId: number | undefined
    let frameId: number | undefined

    if (hambOpen) {
      // open overlay on the next frame so transitions can apply cleanly
      frameId = window.requestAnimationFrame(() => {
        setIsOvrVis(true)
        setIsOvrCls(false)
      })
    } else {
      // mark overlay as closing, then fully hide it after the exit delay
      frameId = window.requestAnimationFrame(() => {
        setIsOvrCls(true)
      })

      timeoutId = window.setTimeout(() => {
        setIsOvrVis(false)
        setIsOvrCls(false)
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
  }, [closeDelayMs, hambOpen])

  return {
    hamburgerOpen: hambOpen,
    setHamburgerOpen: setHambOpen,
    isMobile,
    isOverlayVisible: isOvrVis,
    isOverlayClosing: isOvrCls,
  }
}
