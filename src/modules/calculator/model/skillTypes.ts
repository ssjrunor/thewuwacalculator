/*
  Author: Runor Ewhro
  Description: shared display helpers for skill type labels, icons,
               and primary skill type selection in the calculator ui.
*/

import type { SkillTypeKey } from '@/domain/entities/stats'

// ui display metadata for known skill types
// if a type is missing here, we fall back to a formatted text desc
export const skllTypeDspl: Record<string, { icon?: string; label: string }> = {
  all: { label: 'All Skill Types' },
  basicAtk: { icon: '/assets/stat-icons/basic.png', label: 'Basic Attack' },
  heavyAtk: { icon: '/assets/stat-icons/heavy.png', label: 'Heavy Attack' },
  resonanceSkill: { icon: '/assets/stat-icons/skill.png', label: 'Resonance Skill' },
  resonanceLiberation: { icon: '/assets/stat-icons/liberation.png', label: 'Resonance Liberation' },
  introSkill: { label: 'Intro Skill' },
  outroSkill: { label: 'Outro Skill' },
  echoSkill: { icon: '/assets/stat-icons/echo.png', label: 'Echo Skill' },
  coord: { label: 'Coordinated Attack' },
  spectroFrazzle: { label: 'Spectro Frazzle' },
  aeroErosion: { label: 'Aero Erosion' },
  fusionBurst: { label: 'Fusion Burst' },
  havocBane: { label: 'Havoc Bane' },
  glacioChafe: { label: 'Glacio Chafe' },
  electroFlare: { label: 'Electro Flare' },
  healing: { icon: '/assets/stat-icons/healing.png', label: 'Healing' },
  shield: { label: 'Shield' },
  tuneRupture: { label: 'Tune Rupture' },
  hack: { label: 'Hack' },
}

// convert internal keys like "resonanceSkill" or "echo_skill"
// into a readable title-cased desc for fallback display
export function fmtSkllTypeL(skillType: string): string {
  return skillType
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase())
      .trim()
}

// when a skill has multiple types, the ui usually wants the first one
// as the main representative type/icon
export function getPrimarySkill(
    skillType?: SkillTypeKey | SkillTypeKey[] | null,
): SkillTypeKey | undefined {
  if (!skillType) {
    return undefined
  }

  return Array.isArray(skillType) ? skillType[0] : skillType
}

// resolve the display payload for a skill type input
// accepts either a single type or an array and always uses the first entry
// if nothing is provided, returns the generic "Feature" desc
export function getSkillType(
    skillType?: SkillTypeKey | SkillTypeKey[] | string | string[] | null,
): { icon?: string; label: string } {
  const prmrSkllType = Array.isArray(skillType) ? skillType[0] : skillType

  if (!prmrSkllType) {
    return { label: 'Feature' }
  }

  return skllTypeDspl[prmrSkllType] ?? { label: fmtSkllTypeL(prmrSkllType) }
}

// typed wrapper for regular skill type fields coming from skill definitions
export function getPrmrSklja(
    skillType?: SkillTypeKey | SkillTypeKey[] | null,
): { icon?: string; label: string } {
  if (!skillType) {
    return { label: 'Feature' }
  }

  return getSkillType(getPrimarySkill(skillType))
}
