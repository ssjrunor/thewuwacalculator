/*
  Author: Runor Ewhro
  Description: Contains small suggestion formatting helpers shared by random
               and deterministic suggestion runs.
*/

import type { SimResult } from '@/engine/pipeline/types.ts'
import { isOptDmgSkll } from '@/engine/optimizer/rules/eligibility.ts'
import { ROT_TGT_VL } from '@/modules/calculator/features/suggesstions/lib/suggestions.ts'

export interface SuggTgtPtn {
  value: string
  label: string
}

export const MDLEXITDURMS = 320

// collect the suggestion targets that are actually valid for the current runtime.
export function targetOpts(
  runtimeId: string,
  simulation: SimResult | null,
): SuggTgtPtn[] {
  const direct = (simulation?.allSkills ?? [])
    .filter((entry) => (
      entry.resonatorId === runtimeId &&
      entry.aggregationType === 'damage' &&
      isOptDmgSkll(entry.skill)
    ))
    .map((entry) => ({
      value: entry.id,
      label: entry.skill.tab === 'negativeEffect'
        ? entry.skill.label
        : (entry.feature.label || entry.skill.label),
    }))

  if ((simulation?.rotations.personal.entries ?? []).some((entry) => (
    entry.resonatorId === runtimeId &&
    entry.aggregationType === 'damage' &&
    isOptDmgSkll(entry.skill)
  ))) {
    return [
      ...direct,
      { value: ROT_TGT_VL, label: 'Total Rotation DMG' },
    ]
  }

  return direct
}
