/*
  Author: Runor Ewhro
  Description: Scores encoded Echo stat buffers against direct or rotation
               suggestion contexts.
*/

import { evalTarget, prepareTargetScoring } from '@/engine/optimizer/target/evaluate'
import type { OptResultStats } from '@/engine/optimizer/types.ts'
import type { SuggestContext } from '@/engine/suggestions/types'

interface EncodedEvaluationBuild {
  stats: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  comboIds: Int32Array
  mainEchoBuffs: Float32Array
  mainIndex: number
}

function evaluateContext(
    context: Float32Array,
    ctx: SuggestContext,
    build: EncodedEvaluationBuild,
) {
  return evalTarget({
    context,
    stats: build.stats,
    setConstLut: ctx.setConstLut,
    mainEchoBuffs: build.mainEchoBuffs,
    sets: build.sets,
    kinds: build.kinds,
    comboIds: build.comboIds,
    mainIndex: build.mainIndex,
  })
}

// Resolve the same representative combat-stat snapshot used by optimizer
// result rows. Rotation damage still scores every weighted context below.
export function resolveEvaluationStats(
    ctx: SuggestContext,
    build: EncodedEvaluationBuild,
): OptResultStats | null {
  const context = ctx.mode === 'target' ? ctx.pckdCtx : ctx.displayContext
  if (!context) return null
  return evaluateContext(context, ctx, build)?.stats ?? null
}

// Search frames share an immutable suggestion context. Weak keys release its
// compiled scorer with the search, without retaining completed reports/teams.
const scoringByContext = new WeakMap<SuggestContext, ReturnType<typeof prepareTargetScoring>>()

export function prepareEvaluationScorer(
    ctx: SuggestContext,
    build: Omit<EncodedEvaluationBuild, 'stats'>,
): ReturnType<ReturnType<typeof prepareTargetScoring>> {
  let prepare = scoringByContext.get(ctx)
  if (!prepare) {
    const contexts = ctx.mode === 'target'
      ? [ctx.pckdCtx]
      : Array.from({ length: ctx.contextCount }, (_, index) => ctx.contexts.subarray(
        index * ctx.contextStride, (index + 1) * ctx.contextStride,
      ))
    prepare = prepareTargetScoring(contexts, ctx.setConstLut, ctx.mode === 'rotation' ? ctx.contextWeight : undefined)
    scoringByContext.set(ctx, prepare)
  }
  return prepare(build)
}

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
    return evaluateContext(ctx.pckdCtx, ctx, {
      stats,
      sets,
      kinds,
      comboIds,
      mainEchoBuffs,
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
