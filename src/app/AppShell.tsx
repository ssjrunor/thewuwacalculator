/*
  Author: Runor Ewhro
  Description: The layout every route sits inside, chrome or not. It holds what
               belongs to the app rather than to any page: the cookie boot, the
               document title, the analytics ping, and the fetching of every
               page the chrome can reach.
*/

import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useCkBoot } from '@/app/hooks/useCookieBootstrap'
import { usePageTrck } from '@/app/hooks/usePageTracking'
import { useSeoMeta } from '@/app/hooks/useSeoMeta'
import { warmReachable } from '@/app/nav/routeChunks'

export function AppShell() {
  useCkBoot()
  useSeoMeta()
  usePageTrck()

  // every page the chrome can reach is fetched once the app is quiet, so a
  // navigation transitions into its own content rather than cutting to a loader
  useEffect(() => {
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(warmReachable, { timeout: 4000 })
      : window.setTimeout(warmReachable, 2000)

    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle)
      else window.clearTimeout(idle)
    }
  }, [])

  return <Outlet />
}
