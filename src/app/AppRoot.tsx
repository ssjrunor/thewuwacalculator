/**
  Author      : Runor Ewhro
  Description : Root component. Renders the application router.
*/
import { AppRouter } from '@/app/router/AppRouter'
import { useCookieBootstrap } from '@/app/hooks/useCookieBootstrap'
import { usePageTracking } from '@/app/hooks/usePageTracking'

export function AppRoot() {
  useCookieBootstrap()
  usePageTracking()

  return <AppRouter />
}
