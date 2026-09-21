/*
  Author: Runor Ewhro
  Description: Protects the simulation layout: every surface resolves through
               one shared route, so moving between them never remounts the page.
*/

import { matchRoutes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { rootRoutes } from '@/app/router/routeTable'
import { SIMULATION_SURFACE_IDS, SIMULATION_SURFACES } from '@/shared/lib/appRoutes'

function matched(pathname: string) {
  return matchRoutes(rootRoutes, pathname) ?? []
}

describe('simulation route layout', () => {
  it('matches every surface, trailing slash included, to its handle', () => {
    for (const surface of SIMULATION_SURFACE_IDS) {
      const path = SIMULATION_SURFACES[surface].path
      for (const pathname of [path, `${path}/`]) {
        expect(matched(pathname).at(-1)?.route.handle).toEqual({ surface })
      }
    }
  })

  it('holds every surface under one layout route', () => {
    const layouts = new Set(SIMULATION_SURFACE_IDS.map((surface) => (
      matched(SIMULATION_SURFACES[surface].path).at(-2)?.route
    )))
    expect(layouts.size).toBe(1)
  })

  it('leaves unknown single segments to the not-found route', () => {
    expect(matched('/not-a-surface').at(-1)?.route.path).toBe('*')
  })
})
