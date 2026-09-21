/*
  Author: Runor Ewhro
  Description: Carries the simulation surface on its route's handle, so the page
               and the chrome read the surface the router matched instead of
               parsing the address again.
*/

import { useMatches } from 'react-router-dom'
import { SIMULATION_SURFACES } from '@/shared/lib/appRoutes'
import type { SimulationSurface } from '@/shared/lib/appRoutes'

export interface SimulationSurfaceHandle {
  surface: SimulationSurface
}

function isSurfaceHandle(handle: unknown): handle is SimulationSurfaceHandle {
  return typeof handle === 'object' && handle !== null
    && (handle as SimulationSurfaceHandle).surface in SIMULATION_SURFACES
}

export function useSimulationSurface(): SimulationSurface | null {
  const handle = useMatches().map((match) => match.handle).find(isSurfaceHandle)
  return handle?.surface ?? null
}
