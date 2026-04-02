/*
  Author: Runor Ewhro
  Description: applies a supplied personal rotation item list onto a runtime
               snapshot while preserving the rest of the runtime shape.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime.ts'

export function applyPersonalRotationItems(
    runtime: ResonatorRuntimeState,
    rotationItems?: RotationNode[] | null,
): ResonatorRuntimeState {
  return {
    ...runtime,
    rotation: {
      ...runtime.rotation,

      // force the runtime into personal rotation view
      view: 'personal',

      // prefer the provided rotation items when present
      // otherwise clone the runtime's existing personal rotation list
      // structuredClone avoids sharing mutable references with the source runtime
      personalItems: rotationItems
          ? structuredClone(rotationItems)
          : structuredClone(runtime.rotation.personalItems),
    },
  }
}