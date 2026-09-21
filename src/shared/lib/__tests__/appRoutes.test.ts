/*
  Author: Runor Ewhro
  Description: Protects the Home, Read, and Simulation hierarchy together with
               the temporary compatibility and development routes.
*/

import { describe, expect, it } from 'vitest'
import {
  APP_NAVIGATION,
  APP_ROUTES,
  LEGACY_PROGRESSION_ALIAS,
  LEGACY_SIMULATION_ROUTES,
  SIMULATION_ROUTES,
  isLegacySimulationRoute,
  isPersistentWorkspaceRoute,
  isSimulationRoute,
  isSimulationSurfaceRoute,
  resolveLegacyRoute,
  surfaceAt,
} from '@/shared/lib/appRoutes'

describe('simulation route contract', () => {
  it('recognizes every canonical simulation tool', () => {
    expect(Object.values(SIMULATION_ROUTES).every(isSimulationRoute)).toBe(true)
    expect(isSimulationSurfaceRoute('/modulation', 'modulation')).toBe(true)
    expect(isSimulationSurfaceRoute('/rotation', 'rotation')).toBe(true)
    expect(isSimulationSurfaceRoute('/showcase', 'showcase')).toBe(true)
    expect(isSimulationSurfaceRoute('/optimizer', 'optimizer')).toBe(true)
  })

  it('keeps hidden development routes out of canonical surface matching', () => {
    expect(Object.values(LEGACY_SIMULATION_ROUTES).every(isLegacySimulationRoute)).toBe(true)
    expect(isSimulationSurfaceRoute('/benchmark', 'modulation')).toBe(false)
    expect(isSimulationSurfaceRoute('/calculator', 'modulation')).toBe(false)
  })

  it('maps compatibility URLs to their intended destination', () => {
    expect(resolveLegacyRoute('/home')).toBe('/')
    expect(resolveLegacyRoute(LEGACY_PROGRESSION_ALIAS)).toBe('/modulation')
    expect(resolveLegacyRoute('/calculator/optimizer')).toBe('/optimizer')
    expect(resolveLegacyRoute('/calculator/benchmark/report')).toBe('/modulation/report')
    expect(resolveLegacyRoute('/calculator/rotation')).toBe('/rotation')
    expect(resolveLegacyRoute('/calculator')).toBeNull()
  })

  it('keeps the shared workspace mounted across its three canonical tools', () => {
    expect([
      SIMULATION_ROUTES.modulation,
      SIMULATION_ROUTES.optimizer,
      SIMULATION_ROUTES.showcase,
    ].every(isPersistentWorkspaceRoute)).toBe(true)
    expect(isPersistentWorkspaceRoute(SIMULATION_ROUTES.rotation)).toBe(false)
    expect(isPersistentWorkspaceRoute(LEGACY_SIMULATION_ROUTES.calculator)).toBe(false)
  })
})

describe('application navigation contract', () => {
  it('points every authored destination at a declared route', () => {
    const declared = new Set<string>([
      ...Object.values(APP_ROUTES),
      ...Object.values(SIMULATION_ROUTES),
    ])

    expect(Object.values(APP_NAVIGATION).every(({ to }) => declared.has(to))).toBe(true)
  })

  it('resolves a surface with the router\'s own matching, trailing slash included', () => {
    expect(surfaceAt(SIMULATION_ROUTES.modulation)).toBe('modulation')
    expect(surfaceAt(`${SIMULATION_ROUTES.modulation}/`)).toBe('modulation')
    expect(surfaceAt(LEGACY_SIMULATION_ROUTES.optimizer)).toBe('legacy-optimizer')
    expect(surfaceAt(`${SIMULATION_ROUTES.modulation}/report`)).toBeNull()
    expect(surfaceAt(APP_ROUTES.guides)).toBeNull()
    expect(isPersistentWorkspaceRoute(`${SIMULATION_ROUTES.optimizer}/`)).toBe(true)
  })
})
