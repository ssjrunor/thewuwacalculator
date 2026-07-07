/*
  Author: Runor Ewhro
  Description: Scores encoded Echo stat buffers against direct or rotation
               suggestion contexts.
*/

import { evalTarget } from '@/engine/optimizer/target/evaluate'
import type { SuggestContext } from '@/engine/suggestions/types'

export function scoreStats(
    ctx: SuggestContext,
    stats: Float32Array,
    sets: Uint8Array,
    kinds: Uint16Array,
    comboIds: Int32Array,
    mainEchoBuffs: Float32Array,
    mainIndex: number,
): number {
  if (ctx.mode === 'target') {
    return evalTarget({
      context: ctx.pckdCtx,
      stats,
      setConstLut: ctx.setConstLut,
      mainEchoBuffs,
      sets,
      kinds,
      comboIds,
      mainIndex,
    })?.damage ?? 0
  }

  let total = 0
  for (let index = 0; index < ctx.contextCount; index += 1) {
    const slice = ctx.contexts.subarray(
        index * ctx.contextStride,
        (index + 1) * ctx.contextStride,
    )

    const damage = evalTarget({
      context: slice,
      stats,
      setConstLut: ctx.setConstLut,
      mainEchoBuffs,
      sets,
      kinds,
      comboIds,
      mainIndex,
    })?.damage ?? 0

    total += damage * (ctx.contextWeight[index] ?? 1)
  }

  return total
}
