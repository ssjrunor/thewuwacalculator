/*
  Author: Runor Ewhro
  Description: Applies set-plan assignments onto the current echo loadout
               and evaluates the resulting damage for direct or rotation
               suggestion contexts.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import type { SuggestionEvaluationContext } from '@/engine/suggestions/types'
import { evaluateSuggestionEchoesWithBuffs } from '@/engine/suggestions/shared'
import type { SetPlanEntry } from '@/engine/suggestions/types'

// apply a set-plan onto the provided echoes in slot order for evaluation
function applySetPlanForEvaluation(
    setPlan: SetPlanEntry[],
    echoes: Array<EchoInstance | null>,
): Array<EchoInstance | null> {
  // no set changes means the original loadout can be used as-is
  if (setPlan.length === 0) {
    return echoes
  }

  // expand the compact set plan into a flat per-slot assignment list
  const assignments: number[] = []
  for (const entry of setPlan) {
    for (let i = 0; i < entry.pieces; i += 1) {
      assignments.push(entry.setId)
    }
  }

  let assignIndex = 0

  // walk the current echoes and overwrite set ids in order
  return echoes.map((echo) => {
    if (!echo) {
      return null
    }

    // if the plan runs out, preserve the remaining echoes unchanged
    if (assignIndex >= assignments.length) {
      return { ...echo }
    }

    return {
      ...echo,
      set: assignments[assignIndex++],
    }
  })
}

// compute damage for one set-plan configuration
export function computeSetPlanDamage(
    ctx: SuggestionEvaluationContext,
    setPlan: SetPlanEntry[],
    equippedEchoes: Array<EchoInstance | null>,
    mainEchoBuffs: Float32Array,
): { avgDamage: number; baseDamage: number } {
  // materialize the candidate set assignment first
  const echoes = applySetPlanForEvaluation(setPlan, equippedEchoes)

  // evaluate the modified loadout using the shared fast path
  const avgDamage = evaluateSuggestionEchoesWithBuffs(ctx, echoes, mainEchoBuffs)

  // baseDamage currently mirrors avgDamage for this suggestion path
  return {
    avgDamage,
    baseDamage: avgDamage,
  }
}

// compute set-plan damage with additional rotation metadata
export function computeRotationSetPlanDamage(
    ctx: SuggestionEvaluationContext,
    setPlan: SetPlanEntry[],
    equippedEchoes: Array<EchoInstance | null>,
    mainEchoBuffs: Float32Array,
): { avgDamage: number; baseDamage: number; isRotation: boolean; contextCount: number } {
  const result = computeSetPlanDamage(ctx, setPlan, equippedEchoes, mainEchoBuffs)

  return {
    ...result,
    isRotation: true,
    contextCount: ctx.mode === 'rotation' ? ctx.contextCount : 1,
  }
}
