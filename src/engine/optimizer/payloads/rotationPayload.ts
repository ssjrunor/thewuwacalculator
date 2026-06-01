/*
  Author: Runor Ewhro
  Description: exposes the packed rotation-search payload used by optimizer
               workers and runner paths.
*/

import type {
  PckdRotXctnP,
  PrepRotRun,
  PrepTheoryRot,
} from '@/engine/optimizer/types.ts'

// convert a prepared rotation or theory-rotation run into the execution
// payload consumed by rotation search workers.
export function packRotation(
    prepared: PrepRotRun | PrepTheoryRot,
): PckdRotXctnP {
  return {
    ...prepared,
    mode: 'rotation',
  }
}

// return a share-safe rotation execution payload.
// this is currently a passthrough because the payload is already in the final
// structure expected by downstream code.
export function shrPckdRotXc(
    payload: PckdRotXctnP,
): PckdRotXctnP {
  return payload
}
