/*
  Author: Runor Ewhro
  Description: Defines the Home, Read, and Simulation route hierarchy plus the
               temporary development-only surfaces retained for comparison.
*/

export const SIMULATION_ROUTES = {
  modulation: '/modulation',
  rotation: '/rotation',
  showcase: '/showcase',
  optimizer: '/optimizer',
  suggestions: '/suggestions',
} as const

export const READ_ROUTES = {
  info: '/info',
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

// What's New is an act on the home page. Its old address still works and lands
// on the act, on the release it named if it named one.
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
  info: { name: 'Info', to: APP_ROUTES.info },
  guides: { name: 'Guides', to: APP_ROUTES.guides },
  docs: { name: 'Docs', to: APP_ROUTES.docs },
  changelog: { name: 'Changelog', to: APP_ROUTES.changelog },
  privacy: { name: 'Privacy Policy', to: APP_ROUTES.privacy },
  terms: { name: 'Terms of Service', to: APP_ROUTES.terms },
} as const

export type SimulationRoute = keyof typeof SIMULATION_ROUTES
export type LegacySimulationRoute = keyof typeof LEGACY_SIMULATION_ROUTES

const SIMULATION_ROUTE_KEYS = Object.keys(SIMULATION_ROUTES) as SimulationRoute[]
const LEGACY_SIMULATION_PATHS = new Set<string>(Object.values(LEGACY_SIMULATION_ROUTES))
const PERSISTENT_WORKSPACE_ROUTES = new Set<string>([
  SIMULATION_ROUTES.modulation,
  SIMULATION_ROUTES.optimizer,
  SIMULATION_ROUTES.showcase,
  SIMULATION_ROUTES.suggestions,
])

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
  return LEGACY_SIMULATION_PATHS.has(pathname)
    || Object.values(LEGACY_NESTED_SIMULATION_ROUTES).some((route) => matchesPath(pathname, route))
}

export function isSimulationRoute(pathname: string): boolean {
  return SIMULATION_ROUTE_KEYS.some((surface) => isSimulationSurfaceRoute(pathname, surface))
    || isLegacySimulationRoute(pathname)
    || pathname === LEGACY_PROGRESSION_ALIAS
}

export function isPersistentWorkspaceRoute(pathname: string): boolean {
  return PERSISTENT_WORKSPACE_ROUTES.has(pathname)
}

export function standsRoster(pathname: string): boolean {
  return isPersistentWorkspaceRoute(pathname)
    || isSimulationSurfaceRoute(pathname, 'rotation')
    || pathname === LEGACY_SIMULATION_ROUTES.optimizer
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
