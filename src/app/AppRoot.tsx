/*
  Author: Runor Ewhro
  Description: Root application component that boots cookie state, page
               tracking, and the top-level router.
*/
import { AppRouter } from '@/app/router/AppRouter'
import { useCkBoot } from '@/app/hooks/useCookieBootstrap'
import { usePageTrck } from '@/app/hooks/usePageTracking'

export function AppRoot() {
  useCkBoot()
  usePageTrck()

  return <AppRouter />
}
