/*
  Author: Runor Ewhro
  Description: Exposes the top-level suggestions runners for main stat,
               set plan, and random echo generation workflows.
*/

import type {
  MainStatSuggestionEntry,
  PreparedMainStatSuggestionsInput,
  PreparedRandomSuggestionsInput,
  PreparedSetPlanSuggestionsInput,
  RandomSuggestionEntry,
  SetPlanSuggestionEntry,
} from '@/engine/suggestions/types'
import { runPreparedMainStatSuggestor } from '@/engine/suggestions/mainStat-suggestion/suggestMainStat'
import { runPreparedSetSuggestor } from '@/engine/suggestions/setPlan-suggestion/suggestSetPlan'
import { runPreparedEchoGenerator } from '@/engine/suggestions/randomEchoes/compute'

// run the main-stat suggestion pipeline and return ranked entries
export function runMainStatSuggestions(
    input: PreparedMainStatSuggestionsInput,
): MainStatSuggestionEntry[] {
  return runPreparedMainStatSuggestor(input)
}

// run the set-plan suggestion pipeline and return only the result list
export function runSetPlanSuggestions(
    input: PreparedSetPlanSuggestionsInput,
): SetPlanSuggestionEntry[] {
  return runPreparedSetSuggestor(input).results
}

// run the random echo generator
export function runRandomGenerator(
    input: PreparedRandomSuggestionsInput,
): Promise<RandomSuggestionEntry[]> {
  return runPreparedEchoGenerator(input)
}
