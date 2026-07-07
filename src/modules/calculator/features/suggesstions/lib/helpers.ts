/*
  Author: Runor Ewhro
  Description: contains small suggestion formatting helpers shared by random
               and deterministic suggestion runs.
*/

import type { SimResult } from '@/engine/pipeline/types.ts'
import { isOptDmgSkll } from '@/engine/optimizer/rules/eligibility.ts'
import type { OptDamageEligibilityOptions as DmgEligOpts } from '@/engine/optimizer/rules/eligibility.ts'
import { ROT_TGT_VL } from '@/modules/calculator/features/suggesstions/lib/suggestions.ts'
import type { SelectGroup, SelectOption } from '@/shared/ui/LiquidSelect.tsx'
import { ROT_SKILL_TABS, getSkillTabLabel } from '@/modules/calculator/model/skillTabs.ts'

export interface SuggTgtPtn {
  value: string
  label: string
  tab?: string
}

export const MDLEXITDURMS = 320

// collect the suggestion targets that are actually valid for the current runtime.
export function targetOpts(
  runtimeId: string,
  simulation: SimResult | null,
  options: DmgEligOpts = {},
): SuggTgtPtn[] {
  const direct = (simulation?.allSkills ?? [])
    .filter((entry) => (
      entry.resonatorId === runtimeId &&
      entry.aggregationType === 'damage' &&
      isOptDmgSkll(entry.skill, options)
    ))
    .map((entry) => ({
      value: entry.id,
      label: entry.skill.tab === 'negativeEffect'
        ? entry.skill.label
        : (entry.feature.label || entry.skill.label),
      tab: entry.skill.tab,
    }))

  if ((simulation?.rotations.personal.entries ?? []).some((entry) => (
    entry.resonatorId === runtimeId &&
    entry.aggregationType === 'damage' &&
    isOptDmgSkll(entry.skill, options)
  ))) {
    return [
      ...direct,
      { value: ROT_TGT_VL, label: 'Total Rotation DMG' },
    ]
  }

  return direct
}

// bucket the flat target list into skill-tab groups (matching the optimizer's
// grouped dropdown). targets without a tab; e.g. Total Rotation DMG, fall
// into a trailing "Rotation" group so every option still appears in the menu.
export function targetGroups(options: SuggTgtPtn[]): SelectGroup<string>[] {
  const grouped = new Map<string, SelectOption<string>[]>()
  const extras: SelectOption<string>[] = []

  for (const option of options) {
    const entry: SelectOption<string> = { value: option.value, label: option.label }
    if (option.tab) {
      const list = grouped.get(option.tab) ?? []
      list.push(entry)
      grouped.set(option.tab, list)
    } else {
      extras.push(entry)
    }
  }

  const groups = ROT_SKILL_TABS
    .map((tab) => ({ label: getSkillTabLabel(tab), options: grouped.get(tab) ?? [] }))
    .filter((group) => group.options.length > 0)

  if (extras.length > 0) {
    groups.push({ label: 'Rotation', options: extras })
  }

  return groups
}
