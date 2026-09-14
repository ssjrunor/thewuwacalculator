/*
  Author: Runor Ewhro
  Description: Defines rotation editor preferences data contracts and state invariants.
*/

export const ROTATION_EDITOR_STAT_KEYS = [
  'normal',
  'crit',
  'skillType',
  'talentNode',
  'attribute',
  'atk',
  'hp',
  'def',
  'critRate',
  'critDmg',
  'bonus',
  'amplify',
  'multiplier',
  'energyRegen',
  'defIgnore',
  'defShred',
  'resistance',
  'dmgVuln',
  'tuneBreakBoost',
  'finalDmg',
  'flatDmg',
] as const
export type RotationEditorStatKey = (typeof ROTATION_EDITOR_STAT_KEYS)[number]

export const ROTATION_EDITOR_REGISTER_GROUPS = [
  'identity',
  'output',
  'skill',
  'resonator',
  'modifiers',
  'enemy',
] as const
export type RotationEditorRegisterGroup = (typeof ROTATION_EDITOR_REGISTER_GROUPS)[number]

export const ROTATION_EDITOR_DAMAGE_DECIMALS = [0, 1, 2, 3, 4] as const
export type RotationEditorDamageDecimals = (typeof ROTATION_EDITOR_DAMAGE_DECIMALS)[number]
export type RotationEditorPercentDisplay = 'percent' | 'factor'
export type RotationDamageBasis = 'avg' | 'full'

export const DEFAULT_ROTATION_EDITOR_STAT_KEYS: readonly RotationEditorStatKey[] = [
  'normal',
  'crit',
  'skillType',
  'talentNode',
  'multiplier',
  'atk',
  'hp',
  'def',
  'critRate',
  'critDmg',
  'bonus',
  'amplify',
]

export interface RotationEditorPreferences {
  view: 'tree' | 'flat'
  ghostRepeats: boolean
  showPriors: boolean
  statKeys: RotationEditorStatKey[]
  groupOrder: RotationEditorRegisterGroup[]
  dockPane: boolean
  damageBasis: RotationDamageBasis
  decimals: RotationEditorDamageDecimals
  percentDisplay: RotationEditorPercentDisplay
  /** which surface the page shows: the rotation itself, or the saved list */
  savedView: 'off' | 'list' | 'groups'
}

export function makeDefaultRotationEditorPreferences(): RotationEditorPreferences {
  return {
    view: 'tree',
    ghostRepeats: true,
    showPriors: false,
    statKeys: [...DEFAULT_ROTATION_EDITOR_STAT_KEYS],
    groupOrder: [...ROTATION_EDITOR_REGISTER_GROUPS],
    dockPane: false,
    damageBasis: 'avg',
    decimals: 2,
    percentDisplay: 'percent',
    savedView: 'off',
  }
}
