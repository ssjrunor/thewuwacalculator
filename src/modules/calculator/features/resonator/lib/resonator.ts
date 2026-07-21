/*
  Author: Runor Ewhro
  Description: shared resonator view helpers, menu metadata, filter options,
               skill-tab utilities, and combined seed/detail lookup helpers.
*/

import type {
  CSSProperties as CssProps,
} from 'react'
import type {
  Resonator,
  ResDtls,
  ResMenuEnt,
  ResSkllPnl,
  SkillTabKey,
  ResStateControl,
} from '@/domain/entities/resonator.ts'
import type { ResSeed } from '@/domain/entities/runtime.ts'
import type { AttributeKey } from '@/domain/entities/stats.ts'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore.ts'
import { getResSeedBy, listResSds } from '@/domain/services/resonatorSeedService.ts'
import {
  WPNTYPEPTNS,
  WPNTYPETOKEY as DSPLWPNTYPET,
} from '@/modules/calculator/model/display.ts'

// slider tabs exclude outro because it does not use the same slider flow
export type ResSldrSkllT = Exclude<SkillTabKey, 'outroSkill'>

// full ui-facing resonator view = seed data + detailed data
export type ResView = ResSeed & ResDtls

const DEFSPRTFACEX = 40
const DEFSPRTFACEY = 23
const DEFSPRTFACES = 1

// re-export core resonator domain types for convenience
export type {
  Resonator,
  SkillTabKey as ResonatorSkillTabKey,
  ResStateControl as ResonatorStateControl,
}

// convert numeric weapon type ids used by menu entries into filter keys
export const WPNTYPETOKEY: Record<ResMenuEnt['weaponType'], string> = DSPLWPNTYPET

// ordered weapon filter options for the resonator picker ui
export const WEAPON_FILTERS: Array<{ key: string; label: string }> = WPNTYPEPTNS

// ordered attribute filters used by the resonator menu/filter ui
export const ATTR_FILTERS: AttributeKey[] = [
  'aero',
  'electro',
  'fusion',
  'glacio',
  'havoc',
  'spectro',
]

// tabs that can appear in the skill-level slider area
export const SKILL_SLIDER: ResSldrSkllT[] = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'tuneBreak',
]

function normSprtFace(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.max(0, Math.min(100, Number(value)))
}

function normSpriteFace(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFSPRTFACES
  }

  return Math.max(0.1, Math.min(4, Number(value)))
}

export function spriteVars(
    resonator: Pick<ResSeed, 'spriteFaceX' | 'spriteFaceY' | 'spriteFaceScale'> | null | undefined,
    options: { fllbFaceX?: number, fllbFaceY?: number } = {},
): CssProps {
  const faceX = normSprtFace(resonator?.spriteFaceX, options.fllbFaceX ?? DEFSPRTFACEX)
  const faceY = normSprtFace(resonator?.spriteFaceY, options.fllbFaceY ?? DEFSPRTFACEY)
  const scale = normSpriteFace(resonator?.spriteFaceScale)

  return {
    '--resonator-sprite-face-x': `${faceX}%`,
    '--resonator-sprite-face-y': `${faceY}%`,
    '--resonator-sprite-face-scale': String(scale),
  } as CssProps
}

// canonical ordering for the main resonator skill tabs
const mainSkllTabs: SkillTabKey[] = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'outroSkill',
  'tuneBreak',
]

// trace node text -> icon key mapping for ui rendering
export const TRCNODEICONM: Record<string, string> = {
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
function toMenuEntry(resonator: ResSeed): ResMenuEnt {
  return {
    id: resonator.id,
    displayName: resonator.name,
    profile: resonator.profile ?? '',
    sprite: resonator.sprite ?? resonator.profile ?? '',
    rarity: resonator.rarity ?? 4,
    attribute: resonator.attribute,
    weaponType: resonator.weaponType,
    tags: resonator.tags,
  }
}

// eager menu list built from all registered resonator seeds
export const RES_MENU: ResMenuEnt[] = listResSds().map(toMenuEntry)

// detect whether a skill panel actually has multiple values for at least one multiplier
// used to decide if a level slider makes sense for that tab
function hasSldbSkllV(panel: ResSkllPnl | undefined): boolean {
  return Boolean(panel?.multipliers.some((multiplier) => multiplier.values.length > 1))
}

// build the set of visible slider tabs for a resonator detail record
// tune break is only shown when it has real slidable values
export function visibleTabs(details: ResDtls | null): ResSldrSkllT[] {
  return SKILL_SLIDER.filter((tab) => {
    if (tab !== 'tuneBreak') {
      return true
    }

    return hasSldbSkllV(details?.skillsByTab.tuneBreak)
  })
}

// fetch detailed resonator data and attach only the tabs that actually exist
export function getResDtls(resonatorId: string): ResDtls | null {
  const details = getResDtlsBy()[resonatorId]
  if (!details) {
    return null
  }

  return {
    ...details,
    skillTabs: mainSkllTabs.filter((tab) => Boolean(details.skillsByTab[tab])),
  }
}

// fetch the combined resonator view used by higher-level ui
// returns null if either seed data or detail data is missing
export function getResonator(resonatorId: string): ResView | null {
  const seed = getResSeedBy(resonatorId)
  const details = getResDtlsBy()[resonatorId]

  if (!seed || !details) {
    return null
  }

  return {
    ...seed,
    ...details,
  }
}
