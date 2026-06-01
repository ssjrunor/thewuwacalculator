/*
  Author: Runor Ewhro
  Description: Chooses which optimizer compilation pipeline to use
               based on whether the current optimizer settings are
               targeting a single skill or a full rotation run.
*/

import type {
  PrepOptPay,
  OptStartPay,
} from '@/engine/optimizer/types.ts'
import { compTgtRun } from '@/engine/optimizer/compiler/target.ts'
import { compRotRun } from '@/engine/optimizer/compiler/rotation.ts'
import { compThryRot, compThryTgt } from '@/engine/optimizer/compiler/theory.ts'

// Compile the raw optimizer start payload into the packed form that the
// execution layer expects.
//
// The decision is simple:
// - rotationMode = true -> build a rotation optimizer payload
// - rotationMode = false -> build a single-target-skill optimizer payload
export function compOptPay(
    input: OptStartPay,
): PrepOptPay {
  if (input.settings.searchMode === 'theory') {
    return input.settings.rotationMode
        ? compThryRot(input)
        : compThryTgt(input)
  }

  return input.settings.rotationMode
      ? compRotRun(input)
      : compTgtRun(input)
}
