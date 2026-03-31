/**
  Author: Runor Ewhro
  Description: Resolves and renders the application's route tree from the
               root route table.
*/
import { useRoutes } from 'react-router-dom'
import { rootRoutes } from '@/app/router/routeTable'

export function AppRouter() {
  return useRoutes(rootRoutes)
}