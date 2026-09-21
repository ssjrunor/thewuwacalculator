/*
  Author: Runor Ewhro
  Description: Defines Home, Read, Simulation, and temporary legacy routes.
*/

import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { RouteObject } from 'react-router-dom'
import { AppLayout } from '@/app/shell/AppLayout'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
import {
  changelogChunk,
  docsChunk,
  guidesChunk,
  homeChunk,
  notFoundChunk,
  privacyChunk,
  calibrationChunk,
  simulationChunk,
  termsChunk,
} from '@/app/nav/routeChunks'
import {
  APP_ROUTES,
  LEGACY_HOME_ROUTE,
  LEGACY_NESTED_SIMULATION_ROUTES,
  LEGACY_PROGRESSION_ALIAS,
  LEGACY_SETTINGS_ROUTE,
  LEGACY_WHATS_NEW_ROUTE,
  SIMULATION_ROUTES,
  SIMULATION_SURFACE_IDS,
  SIMULATION_SURFACES,
  whatsNewHref,
} from '@/shared/lib/appRoutes'
import type { SimulationSurfaceHandle } from '@/modules/simulation/api/route'

const SimulationPage = simulationChunk.Mount
const CalibrationPage = calibrationChunk.Mount
const GuidesPage = guidesChunk.Mount
const DocsPage = docsChunk.Mount
const ChngPage = changelogChunk.Mount
const PrvcPlcyPage = privacyChunk.Mount
const TrmsOfSrvcPa = termsChunk.Mount
const NotFoundPage = notFoundChunk.Mount
const HomePage = homeChunk.Mount

const routeFallback = (
  <AppLdrVrly
    mode="centered" className="app-loader-fallback--route"
    text="Loading..."
  />
)

function lazyRoute(node: ReactNode) {
  return <Suspense fallback={routeFallback}>{node}</Suspense>
}

function PreserveLocationRedirect({ to }: { to: string }) {
  const location = useLocation()
  return <Navigate to={{ pathname: to, search: location.search, hash: location.hash }} replace />
}

// Preserve legacy What's New hashes when redirecting to the home release section.
function WhatsNewRedirect() {
  const location = useLocation()
  const entryId = decodeURIComponent(location.hash.replace(/^#/, ''))
  return <Navigate to={whatsNewHref(entryId || null)} replace />
}

// One pathless layout holds every simulation surface. Moving between its
// children keeps SimulationPage (and everything it initializes) mounted; the
// page picks its pane from the matched child's handle.
const simulationRoute: RouteObject = {
  element: lazyRoute(<SimulationPage />),
  children: SIMULATION_SURFACE_IDS.map((surface) => ({
    path: SIMULATION_SURFACES[surface].path,
    // The surface is rendered by the persistent parent from this route's
    // handle. An explicit inert element keeps the leaf route well-formed.
    element: <></>,
    handle: { surface } satisfies SimulationSurfaceHandle,
  })),
}

export const rootRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: lazyRoute(<HomePage />) },
      simulationRoute,
      { path: LEGACY_HOME_ROUTE, element: <PreserveLocationRedirect to={APP_ROUTES.home} /> },
      { path: LEGACY_PROGRESSION_ALIAS, element: <PreserveLocationRedirect to={SIMULATION_ROUTES.modulation} /> },
      {
        path: LEGACY_NESTED_SIMULATION_ROUTES.optimizer,
        element: <PreserveLocationRedirect to={SIMULATION_ROUTES.optimizer} />,
      },
      {
        path: LEGACY_NESTED_SIMULATION_ROUTES.benchmark,
        element: <PreserveLocationRedirect to={SIMULATION_ROUTES.modulation} />,
      },
      {
        path: LEGACY_NESTED_SIMULATION_ROUTES.rotation,
        element: <PreserveLocationRedirect to={SIMULATION_ROUTES.rotation} />,
      },
      { path: APP_ROUTES.calibration, element: lazyRoute(<CalibrationPage />) },
      { path: LEGACY_SETTINGS_ROUTE, element: <PreserveLocationRedirect to={APP_ROUTES.calibration} /> },
      { path: APP_ROUTES.guides, element: lazyRoute(<GuidesPage />) },
      { path: APP_ROUTES.docs, element: lazyRoute(<DocsPage />) },
      { path: APP_ROUTES.changelog, element: lazyRoute(<ChngPage />) },
      { path: LEGACY_WHATS_NEW_ROUTE, element: <WhatsNewRedirect /> },
      { path: APP_ROUTES.privacy, element: lazyRoute(<PrvcPlcyPage />) },
      { path: APP_ROUTES.terms, element: lazyRoute(<TrmsOfSrvcPa />) },
      { path: '*', element: lazyRoute(<NotFoundPage />) },
    ],
  },
]
