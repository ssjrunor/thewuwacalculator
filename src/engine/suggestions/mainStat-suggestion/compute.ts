/*
  Author: Runor Ewhro
  Description: Computes suggestion damage for main-stat recipe variants
               by applying recipe changes to equipped echoes and evaluating
               the resulting loadout.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import type { SuggestionEvaluationContext } from '@/engine/suggestions/types'
import { evaluateSuggestionEchoesWithBuffs } from '@/engine/suggestions/shared'
import type { MainStatRecipe } from '@/engine/suggestions/mainStat-suggestion/utils'
import { applyMainStatRecipesToEchoes } from '@/engine/suggestions/mainStat-suggestion/utils'

// evaluate damage after applying main-stat recipes to the current echo loadout
export function computeMainStatDamage(
    ctx: SuggestionEvaluationContext,
    recipes: MainStatRecipe[],
    equippedEchoes: Array<EchoInstance | null>,
    mainEchoBuffs: Float32Array,
): number {
  return evaluateSuggestionEchoesWithBuffs(
      ctx,
      applyMainStatRecipesToEchoes(recipes, equippedEchoes),
      mainEchoBuffs,
  )
}

// rotation main-stat damage currently follows the same evaluation path
export function computeRotationMainStatDamage(
    ctx: SuggestionEvaluationContext,
    recipes: MainStatRecipe[],
    equippedEchoes: Array<EchoInstance | null>,
    mainEchoBuffs: Float32Array,
): number {
  return computeMainStatDamage(ctx, recipes, equippedEchoes, mainEchoBuffs)
}
