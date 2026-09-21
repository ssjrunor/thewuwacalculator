/*
  Author: Runor Ewhro
  Description: Owns lazy Simulation surface bodies and their preload contract.
*/

import { createRouteChunk } from '@/shared/navigation/routeChunk'
import type { SimulationSurface } from '@/shared/lib/appRoutes'

export const optimizerPane = createRouteChunk<{ variant?: 'embedded' | 'legacy' }>(async () => (
  (await import('@/modules/simulation/surfaces/optimizer/Optimizer.tsx')).Optimizer
))

export const buildWorkspacePane = createRouteChunk(async () => (
  (await import('@/modules/simulation/workspace/BuildWorkspaceSurface')).BuildWorkspaceSurface
))

export const suggestionsPane = createRouteChunk(async () => (
  (await import('@/modules/simulation/surfaces/suggestions/climb/SuggestionsLab.tsx')).SuggestionsLab
))

export const legacyCalculatorPane = createRouteChunk<{ isCllpMode: boolean }>(async () => (
  (await import('@/modules/simulation/surfaces/legacy/calculator/LegacyCalculator.tsx')).LegacyCalculator
))

export const legacyOptimizerPane = createRouteChunk(async () => (
  (await import('@/modules/simulation/surfaces/legacy/optimizer/LegacyOptimizerPage.tsx')).LegacyOptimizerPage
))

export const rotationPane = createRouteChunk(async () => (
  (await import('@/modules/simulation/surfaces/rotation/program-editor/Page.tsx')).ProgramEditor
))

export interface WarmableSurfaceChunk {
  warm: () => Promise<void>
  isWarm: () => boolean
}

export const SIMULATION_SURFACE_CHUNKS: Record<SimulationSurface, WarmableSurfaceChunk[]> = {
  modulation: [buildWorkspacePane],
  optimizer: [buildWorkspacePane, optimizerPane],
  showcase: [buildWorkspacePane],
  suggestions: [buildWorkspacePane, suggestionsPane],
  rotation: [rotationPane],
  'legacy-calculator': [legacyCalculatorPane],
  'legacy-optimizer': [legacyOptimizerPane],
}
