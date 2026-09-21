/*
  Author: Runor Ewhro
  Description: Root application composition for global providers and routing.
*/
import { AppRouter } from '@/app/router/AppRouter'
import { AppProviders } from '@/app/providers/AppProviders'

export function AppRoot() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  )
}
