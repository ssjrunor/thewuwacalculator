import type { DamageFeatureResult } from '@/domain/gameData/contracts.ts'
import type { SkillArchetype, SkillDefinition } from '@/domain/entities/stats.ts'

const OPTIMIZER_DAMAGE_ARCHETYPES = new Set<SkillArchetype>([
  'skillDamage',
  'tuneRupture',
  'spectroFrazzle',
  'aeroErosion',
  'fusionBurst',
  'glacioChafe',
])

export function isOptimizerDamageSkill(
  skill: Pick<SkillDefinition, 'visible' | 'tab' | 'archetype'>,
): boolean {
  return (
    skill.visible !== false &&
    skill.tab !== 'echoAttacks' &&
    OPTIMIZER_DAMAGE_ARCHETYPES.has(skill.archetype)
  )
}

export function isOptimizerRotationTarget(entry: DamageFeatureResult, resonatorId: string): boolean {
  return (
    entry.aggregationType === 'damage' &&
    entry.resonatorId === resonatorId &&
    isOptimizerDamageSkill(entry.skill)
  )
}

export function sumOptimizerRotationDamage(
  entries: readonly DamageFeatureResult[],
  resonatorId: string,
): number {
  return entries.reduce((total, entry) => (
    isOptimizerRotationTarget(entry, resonatorId)
      ? total + (entry.avg * (entry.weight ?? 1))
      : total
  ), 0)
}
