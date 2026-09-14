/*
  Author: Runor Ewhro
  Description: Root application component that mounts the top-level router.
               Everything a route shares is held by the shell inside it.
*/
import { AppRouter } from '@/app/router/AppRouter'

export function AppRoot() {
  return <AppRouter />
}
