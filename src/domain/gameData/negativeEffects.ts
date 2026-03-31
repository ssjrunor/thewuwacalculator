/*
  Author: Runor Ewhro
  Description: Provides helpers for mapping negative effect skill archetypes
               to combat state keys and elemental attributes.
*/

import type { CombatState } from '@/domain/entities/runtime'
import type { SkillDefinition } from '@/domain/entities/stats'

export type NegativeEffectCombatKey = keyof Pick<
    CombatState,
    'spectroFrazzle' | 'aeroErosion' | 'fusionBurst' | 'electroFlare'
>

// map a negative effect archetype to its combat state key
export function getNegativeEffectCombatKey(
    archetype?: SkillDefinition['archetype'],
): NegativeEffectCombatKey | null {
  switch (archetype) {
    case 'spectroFrazzle':
    case 'aeroErosion':
    case 'fusionBurst':
    case 'electroFlare':
      return archetype
    default:
      return null
  }
}

// map a negative effect archetype to its elemental attribute
export function getNegativeEffectAttribute(
    archetype?: SkillDefinition['archetype'],
): 'spectro' | 'aero' | 'fusion' | 'electro' | null {
  switch (archetype) {
    case 'spectroFrazzle':
      return 'spectro'
    case 'aeroErosion':
      return 'aero'
    case 'fusionBurst':
      return 'fusion'
    case 'electroFlare':
      return 'electro'
    default:
      return null
  }
}