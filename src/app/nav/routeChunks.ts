/*
  Author: Runor Ewhro
  Description: Caches route-module promises and resolved components, preloads
               page dependencies, and retries rejected chunk requests.
*/

import { APP_ROUTES, resolveLegacyRoute, surfaceAt } from '@/shared/lib/appRoutes'
import { createRouteChunk } from '@/shared/navigation/routeChunk'
import { configureNavigationPreloader } from '@/shared/navigation/navigationPreload'
import {SIMULATION_SURFACE_CHUNKS} from "@/modules/simulation/api/chunks.ts";

export { createRouteChunk } from '@/shared/navigation/routeChunk'
export const simulationChunk = createRouteChunk(async () => (
  (await import('@/modules/simulation/api/page')).SimulationPage
))
export const calibrationChunk = createRouteChunk(async () => (
  (await import('@/modules/calibration/pages/CalibrationPage')).CalibrationPage
))
export const guidesChunk = createRouteChunk(async () => (
  (await import('@/modules/read/pages/GuidesPage')).GuidesPage
))
export const docsChunk = createRouteChunk(async () => (
  (await import('@/modules/read/pages/DocsPage')).DocsPage
))
export const changelogChunk = createRouteChunk(async () => (
  (await import('@/modules/read/pages/ChangelogPage')).ChngPage
))
export const privacyChunk = createRouteChunk(async () => (
  (await import('@/modules/read/pages/PrivacyPolicyPage')).PrvcPlcyPage
))
export const termsChunk = createRouteChunk(async () => (
  (await import('@/modules/read/pages/TermsOfServicePage')).TrmsOfSrvcPa
))
export const notFoundChunk = createRouteChunk(async () => (
  (await import('@/modules/system/pages/NotFoundPage')).NotFoundPage
))
export const homeChunk = createRouteChunk(async () => (
  (await import('@/modules/home/pages/HomePage')).HomePage
))

interface Warmable {
  warm: () => Promise<void>
  isWarm: () => boolean
}

// every surface mounts the simulation page, then its own pane
const PAGE_CHUNKS: Array<[string, Warmable[]]> = [
  [APP_ROUTES.calibration, [calibrationChunk]],
  [APP_ROUTES.guides, [guidesChunk]],
  [APP_ROUTES.docs, [docsChunk]],
  [APP_ROUTES.changelog, [changelogChunk]],
  [APP_ROUTES.privacy, [privacyChunk]],
  [APP_ROUTES.terms, [termsChunk]],
  [APP_ROUTES.home, [homeChunk]],
]

function chunksFor(pathname: string): Warmable[] {
  const canonical = resolveLegacyRoute(pathname) ?? pathname
  const surface = surfaceAt(canonical)
  if (surface) return [simulationChunk, ...SIMULATION_SURFACE_CHUNKS[surface]]

  const entry = PAGE_CHUNKS.find(([route]) => (
    canonical === route || canonical.startsWith(`${route}/`)
  ))

  return entry ? entry[1] : [notFoundChunk]
}

// Repeated preload requests reuse resolved modules and in-flight promises.
export function warmPath(pathname: string): Promise<void> {
  return Promise.all(chunksFor(pathname).map((page) => page.warm())).then(() => undefined)
}

export function isPathWarm(pathname: string): boolean {
  return chunksFor(pathname).every((page) => page.isWarm())
}

configureNavigationPreloader({ warmPath, isPathWarm })
