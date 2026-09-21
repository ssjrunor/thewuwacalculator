/*
  Author: Runor Ewhro
  Description: Defines the Home, Read, and Simulation route hierarchy plus the
               temporary development-only surfaces retained for comparison.
*/

import { matchPath } from 'react-router-dom'

export const SIMULATION_ROUTES = {
  modulation: '/modulation',
  rotation: '/rotation',
  showcase: '/showcase',
  optimizer: '/optimizer',
  suggestions: '/suggestions',
} as const

export const READ_ROUTES = {
  guides: '/guides',
  docs: '/docs',
  changelog: '/changelog',
  privacy: '/privacy',
  terms: '/terms',
} as const

export const APP_ROUTES = {
  root: '/',
  home: '/',
  calibration: '/calibration',
  ...READ_ROUTES,
} as const

// These routes exist only while the replacement surfaces are being verified.
// They are deliberately excluded from primary navigation and SEO.
export const LEGACY_SIMULATION_ROUTES = {
  calculator: '/calculator',
  optimizer: '/legacy-optimizer',
} as const

export const LEGACY_HOME_ROUTE = '/home'

// Settings became Calibration. The old address still works.
export const LEGACY_SETTINGS_ROUTE = '/settings'

// Preserve the legacy What's New route and its optional release hash on redirect.
export const LEGACY_WHATS_NEW_ROUTE = '/changelog/whatsnew'
export const WHATS_NEW_ACT = 'whatsnew'

export function whatsNewHref(entryId?: string | null): string {
  return `${APP_ROUTES.home}#${entryId ? `${WHATS_NEW_ACT}-${entryId}` : WHATS_NEW_ACT}`
}
export const LEGACY_PROGRESSION_ALIAS = '/progression'

export const LEGACY_NESTED_SIMULATION_ROUTES = {
  optimizer: '/calculator/optimizer',
  benchmark: '/calculator/benchmark',
  rotation: '/calculator/rotation',
} as const

export const APP_NAVIGATION = {
  home: { name: 'Home', to: APP_ROUTES.home },
  modulation: { name: 'Modulation', to: SIMULATION_ROUTES.modulation },
  rotation: { name: 'Rotation', to: SIMULATION_ROUTES.rotation },
  showcase: { name: 'Showcase', to: SIMULATION_ROUTES.showcase },
  optimizer: { name: 'Optimizer', to: SIMULATION_ROUTES.optimizer },
  suggestions: { name: 'Suggestions', to: SIMULATION_ROUTES.suggestions },
  calibration: { name: 'Calibration', to: APP_ROUTES.calibration },
  guides: { name: 'Guides', to: APP_ROUTES.guides },
  docs: { name: 'Docs', to: APP_ROUTES.docs },
  changelog: { name: 'Changelog', to: APP_ROUTES.changelog },
  privacy: { name: 'Privacy Policy', to: APP_ROUTES.privacy },
  terms: { name: 'Terms of Service', to: APP_ROUTES.terms },
} as const

export type SimulationRoute = keyof typeof SIMULATION_ROUTES
export type LegacySimulationRoute = keyof typeof LEGACY_SIMULATION_ROUTES

const SIMULATION_ROUTE_KEYS = Object.keys(SIMULATION_ROUTES) as SimulationRoute[]
const LEGACY_SIMULATION_PATHS = Object.values(LEGACY_SIMULATION_ROUTES)

// Every surface the simulation page can stand. The router builds its routes
// from this table and the chrome reads it back, so a surface is declared once.
// `workspace` surfaces share one Build Lab body and move between each other
// without a page transition; `roster` stands the chrome-mounted roster column.
export type SimulationPane = 'workspace' | 'rotation' | 'legacy-calculator' | 'legacy-optimizer'

interface SimulationSurfaceSpec {
  path: string
  pane: SimulationPane
  roster: boolean
}

export const SIMULATION_SURFACES = {
  modulation: { path: SIMULATION_ROUTES.modulation, pane: 'workspace', roster: true },
  optimizer: { path: SIMULATION_ROUTES.optimizer, pane: 'workspace', roster: true },
  showcase: { path: SIMULATION_ROUTES.showcase, pane: 'workspace', roster: true },
  suggestions: { path: SIMULATION_ROUTES.suggestions, pane: 'workspace', roster: true },
  rotation: { path: SIMULATION_ROUTES.rotation, pane: 'rotation', roster: true },
  'legacy-calculator': { path: LEGACY_SIMULATION_ROUTES.calculator, pane: 'legacy-calculator', roster: false },
  'legacy-optimizer': { path: LEGACY_SIMULATION_ROUTES.optimizer, pane: 'legacy-optimizer', roster: true },
} as const satisfies Record<string, SimulationSurfaceSpec>

export type SimulationSurface = keyof typeof SIMULATION_SURFACES

export type WorkspaceSurface = {
  [K in SimulationSurface]: (typeof SIMULATION_SURFACES)[K]['pane'] extends 'workspace' ? K : never
}[SimulationSurface]

export const SIMULATION_SURFACE_IDS = Object.keys(SIMULATION_SURFACES) as SimulationSurface[]

export function isWorkspaceSurface(surface: SimulationSurface | null): surface is WorkspaceSurface {
  return surface !== null && SIMULATION_SURFACES[surface].pane === 'workspace'
}

// Resolves a path the router has not rendered yet (a navigation target, a chunk
// to warm) with the router's own matching, trailing slash included.
export function surfaceAt(pathname: string): SimulationSurface | null {
  return SIMULATION_SURFACE_IDS.find((surface) => (
    matchPath({ path: SIMULATION_SURFACES[surface].path, end: true }, pathname) !== null
  )) ?? null
}

function matchesPath(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`)
}

export function isSimulationSurfaceRoute(
  pathname: string,
  surface: SimulationRoute,
): boolean {
  return matchesPath(pathname, SIMULATION_ROUTES[surface])
}

export function isLegacySimulationRoute(pathname: string): boolean {
  return [...LEGACY_SIMULATION_PATHS, ...Object.values(LEGACY_NESTED_SIMULATION_ROUTES)]
    .some((route) => matchesPath(pathname, route))
}

export function isSimulationRoute(pathname: string): boolean {
  return SIMULATION_ROUTE_KEYS.some((surface) => isSimulationSurfaceRoute(pathname, surface))
    || isLegacySimulationRoute(pathname)
    || matchesPath(pathname, LEGACY_PROGRESSION_ALIAS)
}

export function isPersistentWorkspaceRoute(pathname: string): boolean {
  return isWorkspaceSurface(surfaceAt(pathname))
}

export function resolveLegacyRoute(pathname: string): string | null {
  if (pathname === LEGACY_HOME_ROUTE) return APP_ROUTES.home
  if (pathname === LEGACY_PROGRESSION_ALIAS) return SIMULATION_ROUTES.modulation

  for (const surface of ['optimizer', 'rotation'] as const) {
    const legacy = LEGACY_NESTED_SIMULATION_ROUTES[surface]
    if (!matchesPath(pathname, legacy)) continue
    return `${SIMULATION_ROUTES[surface]}${pathname.slice(legacy.length)}`
  }

  const legacyBenchmark = LEGACY_NESTED_SIMULATION_ROUTES.benchmark
  if (matchesPath(pathname, legacyBenchmark)) {
    return `${SIMULATION_ROUTES.modulation}${pathname.slice(legacyBenchmark.length)}`
  }

  return null
}
