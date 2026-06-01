/*
  Author: Runor Ewhro
  Description: Computes suggestion damage for main-stat recipe variants
               by applying recipe changes to equipped echoes and evaluating
               the resulting loadout.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import type { SuggestContext } from '@/engine/suggestions/types'
import { evalSuggChsW } from '@/engine/suggestions/shared'
import type { MainStatRecipe } from '@/engine/suggestions/mainStat-suggestion/utils'
import { applyMainSta } from '@/engine/suggestions/mainStat-suggestion/utils'

// evaluate damage after applying main-stat recipes to the current echo loadout
export function cmptMainStat(
    ctx: SuggestContext,
    recipes: MainStatRecipe[],
    qppdChs: Array<EchoInstance | null>,
    mainEchoBuffs: Float32Array,
): number {
  return evalSuggChsW(
      ctx,
      applyMainSta(recipes, qppdChs),
      mainEchoBuffs,
  )
}

// rotation main-stat damage currently follows the same evaluation path
export function cmptRotMainS(
    ctx: SuggestContext,
    recipes: MainStatRecipe[],
    qppdChs: Array<EchoInstance | null>,
    mainEchoBuffs: Float32Array,
): number {
  return cmptMainStat(ctx, recipes, qppdChs, mainEchoBuffs)
}
