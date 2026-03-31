/*
  Author: Runor Ewhro
  Description: shared resonator view helpers, menu metadata, filter options,
               skill-tab utilities, and combined seed/detail lookup helpers.
*/

import type {
  Resonator,
  ResonatorDetails,
  ResonatorMenuEntry,
  ResonatorSkillPanel,
  ResonatorSkillTabKey,
  ResonatorStateControl,
} from '@/domain/entities/resonator.ts'
import type { ResonatorSeed } from '@/domain/entities/runtime'
import type { AttributeKey } from '@/domain/entities/stats'
import { getResonatorDetailsById } from '@/data/gameData/resonators/resonatorDataStore'
import { getResonatorSeedById, listResonatorSeeds } from '@/domain/services/resonatorSeedService'

// slider tabs exclude outro because it does not use the same slider flow
export type ResonatorSliderSkillTabKey = Exclude<ResonatorSkillTabKey, 'outroSkill'>

// full ui-facing resonator view = seed data + detailed data
export type ResonatorView = ResonatorSeed & ResonatorDetails

// re-export core resonator domain types for convenience
export type {
  Resonator,
  ResonatorDetails,
  ResonatorMenuEntry,
  ResonatorSkillTabKey,
  ResonatorStateControl,
}

// convert numeric weapon type ids used by menu entries into filter keys
export const WEAPON_TYPE_TO_KEY: Record<ResonatorMenuEntry['weaponType'], string> = {
  1: 'broadblade',
  2: 'sword',
  3: 'pistols',
  4: 'gauntlets',
  5: 'rectifier',
}

// ordered weapon filter options for the resonator picker ui
export const RESONATOR_FILTER_WEAPONS: Array<{ key: string; label: string }> = [
  { key: 'broadblade', label: 'Broadblade' },
  { key: 'sword', label: 'Sword' },
  { key: 'pistols', label: 'Pistols' },
  { key: 'gauntlets', label: 'Gauntlets' },
  { key: 'rectifier', label: 'Rectifier' },
]

// ordered attribute filters used by the resonator menu/filter ui
export const RESONATOR_FILTER_ATTRIBUTES: AttributeKey[] = [
  'aero',
  'electro',
  'fusion',
  'glacio',
  'havoc',
  'spectro',
]

// tabs that can appear in the skill-level slider area
export const RESONATOR_SKILL_SLIDER_TABS: ResonatorSliderSkillTabKey[] = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'tuneBreak',
]

// canonical ordering for the main resonator skill tabs
const mainSkillTabs: ResonatorSkillTabKey[] = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'outroSkill',
  'tuneBreak',
]

// trace node text -> icon key mapping for ui rendering
export const TRACE_NODE_ICON_MAP: Record<string, string> = {
  'ATK+': 'atk',
  'HP+': 'hp',
  'HP Up': 'hp',
  'DEF+': 'def',
  'Healing Bonus+': 'healing-bonus',
  'Crit. Rate+': 'crit-rate',
  'Crit. Rate Up': 'crit-rate',
  'Crit. DMG+': 'crit-dmg',
  'Aero DMG Bonus+': 'aero-bonus',
  'Glacio DMG Bonus+': 'glacio-bonus',
  'Spectro DMG Bonus+': 'spectro-bonus',
  'Fusion DMG Bonus+': 'fusion-bonus',
  'Electro DMG Bonus+': 'electro-bonus',
  'Havoc DMG Bonus+': 'havoc-bonus',
}

// turn a seed into the lighter menu-entry shape used by the selector ui
function toMenuEntry(resonator: ResonatorSeed): ResonatorMenuEntry {
  return {
    id: resonator.id,
    displayName: resonator.name,
    profile: resonator.profile ?? '',
    rarity: resonator.rarity ?? 4,
    attribute: resonator.attribute,
    weaponType: resonator.weaponType,
  }
}

// eager menu list built from all registered resonator seeds
export const RESONATOR_MENU: ResonatorMenuEntry[] = listResonatorSeeds().map(toMenuEntry)

// detect whether a skill panel actually has multiple values for at least one multiplier
// used to decide if a level slider makes sense for that tab
function hasSlidableSkillValues(panel: ResonatorSkillPanel | undefined): boolean {
  return Boolean(panel?.multipliers.some((multiplier) => multiplier.values.length > 1))
}

// build the set of visible slider tabs for a resonator detail record
// tune break is only shown when it has real slidable values
export function getVisibleResonatorSkillSliderTabs(details: ResonatorDetails | null): ResonatorSliderSkillTabKey[] {
  return RESONATOR_SKILL_SLIDER_TABS.filter((tab) => {
    if (tab !== 'tuneBreak') {
      return true
    }

    return hasSlidableSkillValues(details?.skillsByTab.tuneBreak)
  })
}

// fetch detailed resonator data and attach only the tabs that actually exist
export function getResonatorDetails(resonatorId: string): ResonatorDetails | null {
  const details = getResonatorDetailsById()[resonatorId]
  if (!details) {
    return null
  }

  return {
    ...details,
    skillTabs: mainSkillTabs.filter((tab) => Boolean(details.skillsByTab[tab])),
  }
}

// fetch the combined resonator view used by higher-level ui
// returns null if either seed data or detail data is missing
export function getResonator(resonatorId: string): ResonatorView | null {
  const seed = getResonatorSeedById(resonatorId)
  const details = getResonatorDetailsById()[resonatorId]

  if (!seed || !details) {
    return null
  }

  return {
    ...seed,
    ...details,
  }
}