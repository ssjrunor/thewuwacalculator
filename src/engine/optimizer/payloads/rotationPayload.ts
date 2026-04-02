/*
  Author: Runor Ewhro
  Description: exposes the packed rotation-search payload used by optimizer
               workers and runner paths.
*/

import type {
  PackedRotationExecutionPayload,
  PreparedRotationRun,
} from '@/engine/optimizer/types.ts'

// convert a prepared rotation run into the execution payload consumed by
// rotation search workers. right now the prepared structure already matches
// the packed execution shape, so this is just a passthrough.
export function createPackedRotationExecution(
    prepared: PreparedRotationRun,
): PackedRotationExecutionPayload {
  return prepared
}

// return a share-safe rotation execution payload.
// currently this is also a passthrough because the payload is already in the
// final structure expected by downstream code. this function is kept so the
// call site stays consistent with other execution modes and can later be
// extended if explicit buffer sharing/copying becomes necessary.
export function sharePackedRotationExecution(
    payload: PackedRotationExecutionPayload,
): PackedRotationExecutionPayload {
  return payload
}
