/*
  Author: Runor Ewhro
  Description: Resolves and renders the application's route tree from the
               root route table. The router is a data router so a navigation
               can be committed inside a view transition, which is what the
               page transitions are drawn from, and so a back or forward press
               replays the transition its push registered.
*/
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { rootRoutes } from '@/app/router/routeTable'

const router = createBrowserRouter(rootRoutes)

export function AppRouter() {
  return <RouterProvider router={router} />
}
