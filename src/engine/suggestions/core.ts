/*
  Author: Runor Ewhro
  Description: Exposes the top-level suggestions runners for main stat,
               set plan, and random echo generation workflows.
*/

import type {
  MainStatSugg,
  MainStatPrep,
  RandomPrep,
  PrepSetPlanS,
  PrepWeaponPlan,
  RandomEntry,
  SetPlanSuggest,
  WeaponEntry,
} from '@/engine/suggestions/types'
import { runPrepMainS } from '@/engine/suggestions/mainStat-suggestion/suggestMainStat'
import { runPrepSetSg } from '@/engine/suggestions/setPlan-suggestion/suggestSetPlan'
import { runPrepEchoG } from '@/engine/suggestions/randomEchoes/compute'
import { runPrepWpn } from '@/engine/suggestions/weapon-suggestion/compute'

// run the main-stat suggestion pipeline and return ranked entries
export function runMainStats(
    input: MainStatPrep,
): MainStatSugg[] {
  return runPrepMainS(input)
}

// run the set-plan suggestion pipeline and return only the result list
export function runSetPlanqc(
    input: PrepSetPlanS,
): SetPlanSuggest[] {
  return runPrepSetSg(input).results
}

// run the random echo generator
export function runRandGnrt(
    input: RandomPrep,
): Promise<RandomEntry[]> {
  return runPrepEchoG(input)
}

export function runWpnSuggs(
    input: PrepWeaponPlan,
): WeaponEntry[] {
  return runPrepWpn(input)
}
