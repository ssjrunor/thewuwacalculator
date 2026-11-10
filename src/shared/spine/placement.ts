/*
  Author: Runor Ewhro
  description: resolves per-resonator spine placement overrides with a stable
               evaluation fallback.
*/

import type { SpinePlacement } from './SpinePortrait'

const DEFAULT_EVALUATION_SPINE_PLACEMENT: SpinePlacement = {
  x: 2017.173,
  y: 1512.373,
  scale: 3,
}

const defaults = DEFAULT_EVALUATION_SPINE_PLACEMENT

const EVALUATION_SPINE_PLACEMENTS: Record<string, SpinePlacement> = {
  '1412': { x: 1907.173, y: defaults.y, scale: defaults.scale },
  '1411': { x: 1907.173, y: defaults.y, scale: defaults.scale },
  '1505': { x: 1907.173, y: defaults.y - 100, scale: defaults.scale },
  '1208': { x: 1957.173, y: defaults.y, scale: defaults.scale },
  '1506': { x: 1957.173, y: defaults.y + 88, scale: defaults.scale },
  '1509': { x: 1957.173, y: defaults.y, scale: defaults.scale },
  '1107': { x: 2087.173, y: defaults.y - 110, scale: defaults.scale },
  '1108': { x: 2087.173, y: defaults.y + 148, scale: defaults.scale },
  '1207': { x: defaults.x, y: defaults.y + 148, scale: defaults.scale },
  '1510': { x: 2017.173, y: defaults.y + 150, scale: defaults.scale },
  '1312': { x: defaults.x, y: defaults.y - 250, scale: defaults.scale },
  '1308': { x: defaults.x, y: defaults.y + 350, scale: defaults.scale },
  '1512': { x: defaults.x + 250, y: defaults.y + 50, scale: defaults.scale },
}

export function getEvaluationSpinePlacement(resId: string | null): SpinePlacement {
  return (resId && EVALUATION_SPINE_PLACEMENTS[resId]) || DEFAULT_EVALUATION_SPINE_PLACEMENT
}
