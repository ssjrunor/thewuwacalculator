/*
  Author: Runor Ewhro
  Description: Resolves rotation skill labels, colors, icons, and support ownership metadata.
*/

/* Shared first-class display identity for calculated skills. */

import type { AttributeKey, SkillAggType } from '@/domain/entities/stats.ts'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay.ts'

export interface SupportSkillStyle {
  label: string
  color: string
}

interface SkillDisplayIdentity {
  aggregationType: SkillAggType
  element?: AttributeKey
}

const SUPPORT_SKILL_STYLES: Record<Exclude<SkillAggType, 'damage'>, SupportSkillStyle> = {
  healing: {
    label: 'Healing',
    color: 'var(--calc-support-healing-color)',
  },
  shield: {
    label: 'Shield',
    color: 'var(--calc-support-shield-color)',
  },
}

export function supportSkillStyle(aggregationType?: SkillAggType): SupportSkillStyle | null {
  return aggregationType && aggregationType !== 'damage'
    ? SUPPORT_SKILL_STYLES[aggregationType]
    : null
}

export function skillDisplayColor(
  skill: SkillDisplayIdentity,
  fallback: AttributeKey = 'physical',
): string {
  return supportSkillStyle(skill.aggregationType)?.color
    ?? ATTR_COLORS[skill.element ?? fallback]
    ?? ATTR_COLORS.physical
}
