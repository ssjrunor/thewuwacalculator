/*
  Author: Runor Ewhro
  Description: Exposes the durable suggestion runners for main-stat,
               set-plan, and weapon workflows.
*/

import type {
  MainStatSugg,
  MainStatPrep,
  PrepSetPlanS,
  PrepWeaponPlan,
  SetPlanSuggest,
  WeaponEntry,
} from '@/engine/suggestions/types'
import { runPrepMainS } from '@/engine/suggestions/mainStat-suggestion/suggestMainStat'
import { runPrepSetSg } from '@/engine/suggestions/setPlan-suggestion/suggestSetPlan'
import { runPrepWpn } from '@/engine/suggestions/weapon-suggestion/compute'

export function runMainStats(
    input: MainStatPrep,
): MainStatSugg[] {
  return runPrepMainS(input)
}

export function runSetPlanqc(
    input: PrepSetPlanS,
): SetPlanSuggest[] {
  return runPrepSetSg(input).results
}

export function runWpnSuggs(
    input: PrepWeaponPlan,
): WeaponEntry[] {
  return runPrepWpn(input)
}
