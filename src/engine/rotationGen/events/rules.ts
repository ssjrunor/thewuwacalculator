/*
  Author: Runor Ewhro
  description: defines status cadence and Off-Tune lockout limits for event replay.
*/

import type { RuntimeValue } from '../types.ts'
import { NEG_EFFECT_CATS } from '../../gameData/negativeEffects.ts'

// status counter limits and cadence affect emitted events. damage values live in the catalog.
export const SPECTRO_FRAZZLE: RuntimeValue = Object.freeze({
  maxStacks: NEG_EFFECT_CATS.spectroFrazzle.defaultMax,
  tickFrames: 180,
})

export const OFF_TUNE_LOCKOUT_FRAMES = 180
