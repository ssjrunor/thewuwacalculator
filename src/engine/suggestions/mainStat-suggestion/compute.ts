/*
  Author: Runor Ewhro
  Description: Computes suggestion damage for main-stat recipe variants
               by applying recipe changes to equipped echoes and evaluating
               the resulting loadout.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import type { SuggestContext } from '@/engine/suggestions/types'
import { evalSuggChs, evalSuggChsW, mkSuggMainEc } from '@/engine/suggestions/shared'
import { MAIN_BUFF_LEN } from '@/engine/optimizer/config/constants'
import type { MainStatRecipe } from '@/engine/suggestions/mainStat-suggestion/utils'
import { applyMainSta } from '@/engine/suggestions/mainStat-suggestion/utils'

// evaluate damage after applying main-stat recipes to the current echo loadout
export function cmptMainStat(
    ctx: SuggestContext,
    recipes: MainStatRecipe[],
    qppdChs: Array<EchoInstance | null>,
): number {
  const echoes = applyMainSta(recipes, qppdChs)
  return evalSuggChs(ctx, echoes)
}

// rotation main-stat damage currently follows the same evaluation path
export function cmptRotMainS(
    ctx: SuggestContext,
    recipes: MainStatRecipe[],
    qppdChs: Array<EchoInstance | null>,
): number {
  return cmptMainStat(ctx, recipes, qppdChs)
}

/* Only the selected main Echo's bonus row is read by the packed evaluator.
   Its isolated effect scope is fixed for this search, so reuse rows for the
   same Echo body and stats instead of rebuilding every Echo's effects at DFS. */
export function makeMainStatScorer(ctx: SuggestContext, equipped: Array<EchoInstance | null>) {
  const mainRows = new Map<string, Float32Array>()
  return (recipes: MainStatRecipe[]): number => {
    const echoes = applyMainSta(recipes, equipped)
    const concrete = echoes.filter((echo): echo is EchoInstance => echo != null)
    const mainIndex = Math.max(0, concrete.findIndex((echo) => echo.mainEcho))
    const main = concrete[mainIndex]
    if (!main) return 0
    const signature = JSON.stringify([main.id, main.set, main.mainStats, main.substats])
    let row = mainRows.get(signature)
    if (!row) {
      row = mkSuggMainEc(ctx, [main])
      mainRows.set(signature, row)
    }
    const buffs = new Float32Array(concrete.length * MAIN_BUFF_LEN)
    buffs.set(row, mainIndex * MAIN_BUFF_LEN)
    return evalSuggChsW(ctx, echoes, buffs)
  }
}
