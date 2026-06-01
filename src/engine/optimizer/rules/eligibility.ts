/*
  Author: Runor Ewhro
  Description: centralizes which skills and rotation rows count as optimizer
               damage targets and how their average damage is summed.
*/

import type { DamageFeature } from '@/domain/gameData/contracts.ts'
import type { SkillArch, SkillDef } from '@/domain/entities/stats.ts'

const OPT_DMG_RCHT = new Set<SkillArch>([
  'skillDamage',
  'tuneRupture',
  'hack',
  'spectroFrazzle',
  'aeroErosion',
  'fusionBurst',
  'glacioChafe',
])

export function isOptDmgSkll(
  skill: Pick<SkillDef, 'visible' | 'tab' | 'archetype'>,
): boolean {
  return (
    skill.visible !== false &&
    skill.tab !== 'echoAttacks' &&
    OPT_DMG_RCHT.has(skill.archetype)
  )
}

// keep rotation targeting bound to the active optimized resonator's own damage rows
export function isOptRotTgt(entry: DamageFeature, resonatorId: string): boolean {
  return (
    entry.aggregationType === 'damage' &&
    entry.resonatorId === resonatorId &&
    isOptDmgSkll(entry.skill)
  )
}

// sum only the optimizer-eligible damage rows for one resonator across a rotation
export function sumOptRotDmg(
  entries: readonly DamageFeature[],
  resonatorId: string,
): number {
  return entries.reduce((total, entry) => (
    isOptRotTgt(entry, resonatorId)
      ? total + (entry.avg * (entry.weight ?? 1))
      : total
  ), 0)
}
