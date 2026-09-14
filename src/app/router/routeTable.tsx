/*
  Author: Runor Ewhro
  Description: Defines Home, Read, Simulation, and temporary legacy routes.
*/

import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import type { LoaderFunctionArgs, RouteObject } from 'react-router-dom'
import { AppShell } from '@/app/AppShell'
import { RouteChrome } from '@/app/chrome/RouteChrome'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
import {
  changelogChunk,
  docsChunk,
  guidesChunk,
  homeChunk,
  infoChunk,
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
  LEGACY_SIMULATION_ROUTES,
  LEGACY_WHATS_NEW_ROUTE,
  SIMULATION_ROUTES,
  whatsNewHref,
} from '@/shared/lib/appRoutes'
import { useAppStore } from '@/domain/state/store'

const SimulationPage = simulationChunk.Mount
const CalibrationPage = calibrationChunk.Mount
const InfoPage = infoChunk.Mount
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

// the old What's New page is an act on the home page now; a release it named by
// hash opens on that release there
function WhatsNewRedirect() {
  const location = useLocation()
  const entryId = decodeURIComponent(location.hash.replace(/^#/, ''))
  return <Navigate to={whatsNewHref(entryId || null)} replace />
}

function hydrateOptimizerInventory() {
  useAppStore.getState().ensInvHydr()
  return null
}

const SHARED_WORKSPACE_SURFACES = ['modulation', 'optimizer', 'showcase', 'suggestions'] as const

function SharedWorkspaceRoute() {
  const { simulationSurface } = useParams()
  const surface = SHARED_WORKSPACE_SURFACES.find((candidate) => candidate === simulationSurface)
  return surface ? <SimulationPage surface={surface} /> : <NotFoundPage />
}

function hydrateSharedWorkspaceInventory({ params }: LoaderFunctionArgs) {
  if (params.simulationSurface === 'optimizer') hydrateOptimizerInventory()
  return null
}

export const rootRoutes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      {
        path: '/',
        element: <RouteChrome />,
        children: [
          { index: true, element: lazyRoute(<HomePage />) },
          {
            path: '/:simulationSurface',
            loader: hydrateSharedWorkspaceInventory,
            element: lazyRoute(<SharedWorkspaceRoute />),
          },
          {
            path: SIMULATION_ROUTES.rotation,
            element: lazyRoute(<SimulationPage surface="rotation" />),
          },
          {
            path: LEGACY_SIMULATION_ROUTES.calculator,
            element: lazyRoute(<SimulationPage surface="legacy-calculator" />),
          },
          {
            path: LEGACY_SIMULATION_ROUTES.optimizer,
            loader: hydrateOptimizerInventory,
            element: lazyRoute(<SimulationPage surface="legacy-optimizer" />),
          },
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
          { path: APP_ROUTES.info, element: lazyRoute(<InfoPage />) },
          { path: APP_ROUTES.guides, element: lazyRoute(<GuidesPage />) },
          { path: APP_ROUTES.docs, element: lazyRoute(<DocsPage />) },
          { path: APP_ROUTES.changelog, element: lazyRoute(<ChngPage />) },
          { path: LEGACY_WHATS_NEW_ROUTE, element: <WhatsNewRedirect /> },
          { path: APP_ROUTES.privacy, element: lazyRoute(<PrvcPlcyPage />) },
          { path: APP_ROUTES.terms, element: lazyRoute(<TrmsOfSrvcPa />) },
          { path: '*', element: lazyRoute(<NotFoundPage />) },
        ],
      },
    ],
  },
]
