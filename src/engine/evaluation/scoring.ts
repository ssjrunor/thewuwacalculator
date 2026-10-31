/*
  Author: Runor Ewhro
  description: scores encoded echo stat buffers against direct or rotation
               suggestion contexts.
*/

import { evalTarget, prepareTargetScoring } from '@/engine/search/score/evaluate'
import type { OptResultStats } from '@/engine/search/score/core.ts'
import type { SuggestContext } from '@/engine/suggestions/types'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { scoreEncodedRotationTeammateDelta } from '@/engine/rotation/damagePlan.ts'
import { ECHO_STAT_STRIDE } from '@/engine/search/layout/constants.ts'
import { evaluationRotationDetails } from './rotationScoring'

export interface EvaluationScorer {
  (stats: Float32Array): number
  prepareFirstLane(fixedStats: Float32Array): (stats: Float32Array) => number
}

export interface EncodedEvaluationBuild {
  stats: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  comboIds: Int32Array
  mainEchoBuffs: Float32Array
  mainIndex: number
  echoes?: readonly EchoInstance[]
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

// resolve a representative combat snapshot for evaluation stat columns.
// rotation columns show sheet crit; damage still uses each attack's bonuses.
export function resolveEvaluationStats(
    ctx: SuggestContext,
    build: EncodedEvaluationBuild,
): OptResultStats | null {
  if (ctx.mode === 'rotation' && ctx.candidatePlan && build.echoes) {
    return evaluationRotationDetails(ctx, { ...build, echoes: build.echoes }, build.stats).stats
  }
  const context = ctx.mode === 'target' ? ctx.pckdCtx : ctx.displayContext
  if (!context) return null
  return evaluateContext(context, ctx, build)?.stats ?? null
}

// search frames share an immutable suggestion context. weak keys release its
// compiled scorer with the search, without retaining completed reports/teams.
const scoringByContext = new WeakMap<SuggestContext, ReturnType<typeof prepareTargetScoring>>()

// evaluation's bounded proposal search has its own compact scorer. it does
// not compile rotation programs, replay teammates, or interpret interval IR.
export function prepareEvaluationSearchScorer(
    ctx: SuggestContext,
    build: Omit<EncodedEvaluationBuild, 'stats'> & { echoes?: readonly EchoInstance[] },
): EvaluationScorer {
  let prepare = scoringByContext.get(ctx)
  if (!prepare) {
    const contexts = ctx.mode === 'target'
      ? [ctx.pckdCtx]
      : Array.from({ length: ctx.contextCount }, (_, index) => ctx.contexts.subarray(
        index * ctx.contextStride, (index + 1) * ctx.contextStride,
      ))
    prepare = prepareTargetScoring(
      contexts,
      ctx.setConstLut,
      ctx.mode === 'rotation' ? ctx.contextWeight : undefined,
      ctx.mode === 'rotation' ? ctx.fixedTeamDamage : 0,
    )
    scoringByContext.set(ctx, prepare)
  }
  return prepare(build)
}

export function prepareEvaluationScorer(
    ctx: SuggestContext,
    build: Omit<EncodedEvaluationBuild, 'stats'>,
): EvaluationScorer {
  if (ctx.mode === 'rotation' && ctx.candidatePlan && build.echoes) {
    const score: EvaluationScorer = stats => evaluationRotationDetails(ctx, { ...build, echoes: build.echoes! }, stats).total
    score.prepareFirstLane = fixed => {
      const full = fixed.slice()
      return stats => {
        if (stats.length >= full.length) return score(stats)
        full.set(stats.subarray(0, ECHO_STAT_STRIDE)); return score(full)
      }
    }
    return score
  }
  const scorer = prepareEvaluationSearchScorer(ctx, build)
  if (ctx.mode !== 'rotation' || !build.echoes) return scorer
  const delta = (stats: Float32Array) => scoreEncodedRotationTeammateDelta(
    ctx.teamDamagePlan, build.echoes!, stats, build.sets, build.comboIds, build.mainIndex,
  )
  const score = (stats: Float32Array) => scorer(stats) + delta(stats)
  score.prepareFirstLane = (fixedStats: Float32Array) => {
    const base = scorer.prepareFirstLane(fixedStats)
    const full = fixedStats.slice()
    return (stats: Float32Array) => {
      if (stats.length < full.length) {
        full.set(stats.subarray(0, ECHO_STAT_STRIDE), 0)
        return base(stats) + delta(full)
      }
      return base(stats) + delta(stats)
    }
  }
  return score
}

export function scoreStats(
    ctx: SuggestContext,
    stats: Float32Array,
    sets: Uint8Array,
    kinds: Uint16Array,
    comboIds: Int32Array,
    mainEchoBuffs: Float32Array,
    mainIndex: number,
    echoes?: readonly EchoInstance[],
): number {
  if (ctx.mode === 'rotation' && ctx.candidatePlan && echoes) {
    return evaluationRotationDetails(ctx, { echoes, sets, kinds, comboIds, mainIndex }, stats).total
  }
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

  let total = ctx.fixedTeamDamage
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

  return total + (echoes
    ? scoreEncodedRotationTeammateDelta(ctx.teamDamagePlan, echoes, stats, sets, comboIds, mainIndex)
    : 0)
}
