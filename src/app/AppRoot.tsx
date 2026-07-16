/*
  Author: Runor Ewhro
  Description: Root application component that boots cookie state, page
               tracking, and the top-level router.
*/
import { AppRouter } from '@/app/router/AppRouter'
import { useCkBoot } from '@/app/hooks/useCookieBootstrap'
import { usePageTrck } from '@/app/hooks/usePageTracking'
import { useSeoMeta } from '@/app/hooks/useSeoMeta'

export function AppRoot() {
  useCkBoot()
  useSeoMeta()
  usePageTrck()

  return <AppRouter />
}
