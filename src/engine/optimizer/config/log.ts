/*
  Author: Runor Ewhro
  Description: Thin logging helpers for the optimizer pipeline. All output
               is gated behind OPTIMIZER_LOGGING so it can be silenced in
               one place without touching the call sites.
*/

import { OPTIMIZER_LOGGING } from '@/engine/optimizer/config/constants.ts'

export function logOptimizer(message: string, data?: Record<string, unknown>): void {
  if (!OPTIMIZER_LOGGING) {
    return
  }

  if (data !== undefined) {
    console.log(message, data)
  } else {
    console.log(message)
  }
}

export function warnOptimizer(message: string, data?: Record<string, unknown>): void {
  if (!OPTIMIZER_LOGGING) {
    return
  }

  if (data !== undefined) {
    console.warn(message, data)
  } else {
    console.warn(message)
  }
}

export function errorOptimizer(message: string, data?: Record<string, unknown>): void {
  if (!OPTIMIZER_LOGGING) {
    return
  }

  if (data !== undefined) {
    console.error(message, data)
  } else {
    console.error(message)
  }
}
