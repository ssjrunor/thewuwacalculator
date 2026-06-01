/*
  Author: Runor Ewhro
  Description: Resolves skill-data modal targets and preferred tabs from the
               current resonator or feature-selection context.
*/

import type { ResDtls, SkillTabKey } from '@/domain/entities/resonator.ts'
import type { SkillTypeKey } from '@/domain/entities/stats.ts'
import type { FeatureResult } from '@/domain/gameData/contracts.ts'
import { getPrimarySkill } from '@/modules/calculator/model/skillTypes.ts'

const SKLLTYPETOTA: Partial<Record<SkillTypeKey, SkillTabKey>> = {
  basicAtk: 'normalAttack',
  heavyAtk: 'normalAttack',
  resonanceSkill: 'resonanceSkill',
  resonanceLiberation: 'resonanceLiberation',
  introSkill: 'introSkill',
  outroSkill: 'outroSkill',
  tuneRupture: 'tuneBreak',
}

const DIRECT_TABS = new Set<SkillTabKey>([
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'outroSkill',
  'tuneBreak',
])

function hasSkillTab(
  details: Pick<ResDtls, 'skillsByTab'> | null,
  tab: SkillTabKey | null,
): tab is SkillTabKey {
  return Boolean(tab && details?.skillsByTab[tab])
}

export function skillTab(
  entry: Pick<FeatureResult, 'skill'>,
  details: Pick<ResDtls, 'skillsByTab'> | null,
): SkillTabKey | null {
  const directTab = DIRECT_TABS.has(entry.skill.tab as SkillTabKey)
    ? (entry.skill.tab as SkillTabKey)
    : null

  if (hasSkillTab(details, directTab)) {
    return directTab
  }

  if (entry.skill.tab === 'combo' && hasSkillTab(details, 'normalAttack')) {
    return 'normalAttack'
  }

  const prmrSkllType = getPrimarySkill(entry.skill.skillType)
  const mappedTab = prmrSkllType ? (SKLLTYPETOTA[prmrSkllType] ?? null) : null

  if (hasSkillTab(details, mappedTab)) {
    return mappedTab
  }

  return null
}
