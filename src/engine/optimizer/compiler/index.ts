/*
  Author: Runor Ewhro
  Description: Chooses which optimizer compilation pipeline to use
               based on whether the current optimizer settings are
               targeting a single skill or a full rotation run.
*/

import type {
  PreparedOptimizerPayload,
  OptimizerStartPayload,
} from '@/engine/optimizer/types.ts'
import { compileTargetRun } from '@/engine/optimizer/compiler/target.ts'
import { compileRotationRun } from '@/engine/optimizer/compiler/rotation.ts'

// Compile the raw optimizer start payload into the packed form that the
// execution layer expects.
//
// The decision is simple:
// - rotationMode = true -> build a rotation optimizer payload
// - rotationMode = false -> build a single-target-skill optimizer payload
export function compileOptimizerPayload(
    input: OptimizerStartPayload,
): PreparedOptimizerPayload {
  return input.settings.rotationMode
      ? compileRotationRun(input)
      : compileTargetRun(input)
}