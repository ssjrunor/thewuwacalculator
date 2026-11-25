/*
  Author: Runor Ewhro
  description: caches route-module promises and resolved components, preloads
               page dependencies, and retries rejected chunk requests.
*/

import { APP_ROUTES, resolveLegacyRoute, surfaceAt } from '@/shared/lib/appRoutes'
import { createRouteChunk } from '@/shared/navigation/routeChunk'
import { prefersMobileUi } from '@/shared/responsive/mobileUi'
import { configureNavigationPreloader } from '@/shared/navigation/navigationPreload'
import {SIMULATION_SURFACE_CHUNKS} from "@/modules/simulation/api/chunks.ts";
import { useAppStore } from '@/application/state'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'

export { createRouteChunk } from '@/shared/navigation/routeChunk'
export const simulationChunk = createRouteChunk(async () => {
  const { initGameData, getGameDataMode } = await import('@/data/gameData')
  const team = selectedCombatScenario(useAppStore.getState().combat).team.members
  await initGameData({ mode: getGameDataMode(), resonatorIds: team.map((member) => member.resonatorId) })
  return (await import('@/modules/simulation/api/page')).SimulationPage
})
export const calibrationChunk = createRouteChunk(async () => (
  (await import('@/modules/calibration/pages/CalibrationPage')).CalibrationPage
))
export const leaderboardChunk = createRouteChunk(async () => {
  // the page's code is fetched while the game data loads; nothing in it reads game data before it renders.
  const page = import('@/modules/leaderboard/views/ScopePage')
  const { initGameData, getGameDataMode } = await import('@/data/gameData')
  await initGameData({ mode: getGameDataMode(), resonatorIds: [] })
  return (await page).ScopePage
})
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
export const mobileHomeChunk = createRouteChunk(async () => (
  (await import('@/modules/home/pages/MobileHomePage')).MobileHomePage
))

interface Warmable {
  warm: () => Promise<void>
  isWarm: () => boolean
}

// every surface mounts the simulation page, then its own pane
const PAGE_CHUNKS: Array<[string, Warmable[]]> = [
  [APP_ROUTES.calibration, [calibrationChunk]],
  [APP_ROUTES.leaderboard, [leaderboardChunk]],
  [APP_ROUTES.guides, [guidesChunk]],
  [APP_ROUTES.docs, [docsChunk]],
  [APP_ROUTES.changelog, [changelogChunk]],
  [APP_ROUTES.privacy, [privacyChunk]],
  [APP_ROUTES.terms, [termsChunk]],
  [APP_ROUTES.home, [homeChunk]],
]

function chunksFor(pathname: string): Warmable[] {
  const canonical = resolveLegacyRoute(pathname) ?? pathname
  if (canonical === APP_ROUTES.home && prefersMobileUi()) return [mobileHomeChunk]
  const surface = surfaceAt(canonical)
  if (surface) return [simulationChunk, ...SIMULATION_SURFACE_CHUNKS[surface]]

  const entry = PAGE_CHUNKS.find(([route]) => (
    canonical === route || canonical.startsWith(`${route}/`)
  ))

  return entry ? entry[1] : [notFoundChunk]
}

// repeated preload requests reuse resolved modules and in-flight promises.
export function warmPath(pathname: string): Promise<void> {
  return Promise.all(chunksFor(pathname).map((page) => page.warm())).then(() => undefined)
}

export function isPathWarm(pathname: string): boolean {
  return chunksFor(pathname).every((page) => page.isWarm())
}

configureNavigationPreloader({ warmPath, isPathWarm })
