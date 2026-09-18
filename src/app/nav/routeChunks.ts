/*
  Author: Runor Ewhro
  Description: Caches route-module promises and resolved components, preloads
               page dependencies, and retries rejected chunk requests.
*/

import { createElement } from 'react'
import type { ComponentType } from 'react'
import {
  APP_ROUTES,
  LEGACY_PROGRESSION_ALIAS,
  LEGACY_SIMULATION_ROUTES,
  SIMULATION_ROUTES,
  resolveLegacyRoute,
} from '@/shared/lib/appRoutes'

export interface RouteChunk<P> {
  // renders the page, suspending only while the module is still cold
  Mount: ComponentType<P>
  warm: () => Promise<void>
  isWarm: () => boolean
}

export function createRouteChunk<P extends object>(load: () => Promise<ComponentType<P>>): RouteChunk<P> {
  let loaded: ComponentType<P> | null = null
  let pending: Promise<void> | null = null

  const warm = () => {
    if (loaded) return Promise.resolve()
    pending ??= load()
      .then((component) => {
        loaded = component
      })
      .catch((error: unknown) => {
        // A deployment can invalidate a requested chunk between page load and
        // navigation. Do not pin that rejection for the rest of the session;
        // the next intent gets a fresh request.
        pending = null
        throw error
      })
    return pending
  }

  function Mount(props: P) {
    if (!loaded) {
      // cold: hand the promise to the nearest boundary, the same way lazy does
      throw warm()
    }

    return createElement(loaded, props)
  }

  return { Mount, warm, isWarm: () => loaded !== null }
}

export const simulationChunk = createRouteChunk(async () => (
  (await import('@/modules/simulation/pages/SimulationPage')).SimulationPage
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

// Simulation tools share one page module and differ by the body it mounts, so
// warming a surface route means warming the pane as well as the page
export const optimizerPane = createRouteChunk<{ variant?: 'embedded' | 'legacy' }>(async () => (
  (await import('@/modules/simulation/features/optimizer/Optimizer.tsx')).Optimizer
))
// Modulation, Optimizer, and Showcase reuse the workspace module; Optimizer
// additionally requires its independently loaded search module.
export const buildWorkspacePane = createRouteChunk(async () => (
  (await import('@/modules/simulation/workspace/BuildWorkspaceSurface')).BuildWorkspaceSurface
))
// Suggestions requires both the shared workspace and its search module.
export const suggestionsPane = createRouteChunk(async () => (
  (await import('@/modules/simulation/features/suggestions/climb/SuggestionsLab.tsx')).SuggestionsLab
))
export const legacyCalculatorPane = createRouteChunk<{ isCllpMode: boolean }>(async () => (
  (await import('@/modules/simulation/legacy/calculator/LegacyCalculator.tsx')).LegacyCalculator
))
export const legacyOptimizerPane = createRouteChunk(async () => (
  (await import('@/modules/simulation/legacy/optimizer/LegacyOptimizerPage.tsx')).LegacyOptimizerPage
))
export const rotationPane = createRouteChunk(async () => (
  (await import('@/modules/simulation/features/rotation/program-editor/Page.tsx')).ProgramEditor
))

interface Warmable {
  warm: () => Promise<void>
  isWarm: () => boolean
}

const PAGE_CHUNKS: Array<[string, Warmable[]]> = [
  [SIMULATION_ROUTES.modulation, [simulationChunk, buildWorkspacePane]],
  [SIMULATION_ROUTES.optimizer, [simulationChunk, buildWorkspacePane, optimizerPane]],
  [SIMULATION_ROUTES.showcase, [simulationChunk, buildWorkspacePane]],
  [SIMULATION_ROUTES.suggestions, [simulationChunk, buildWorkspacePane, suggestionsPane]],
  [SIMULATION_ROUTES.rotation, [simulationChunk, rotationPane]],
  [LEGACY_SIMULATION_ROUTES.calculator, [simulationChunk, legacyCalculatorPane]],
  [LEGACY_SIMULATION_ROUTES.optimizer, [simulationChunk, legacyOptimizerPane]],
  [LEGACY_PROGRESSION_ALIAS, [simulationChunk, buildWorkspacePane]],
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

// Preload navigation targets during idle time, with Simulation routes first.
export function warmReachable(): void {
  const surfaces = [simulationChunk, buildWorkspacePane, optimizerPane, suggestionsPane, rotationPane]
  const references = [docsChunk, guidesChunk, changelogChunk, calibrationChunk, privacyChunk, termsChunk]

  const warmAll = (pages: Warmable[]) => Promise.all(
    pages.map((page) => page.warm().catch(() => undefined)),
  )

  void warmAll(surfaces).then(() => warmAll(references))
}
