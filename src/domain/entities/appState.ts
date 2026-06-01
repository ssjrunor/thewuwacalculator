/*
  Author: Runor Ewhro
  Description: Defines shared application state types and constants for ui,
               enemy data, calculator state, and persisted app storage.
*/

import type { ResProf } from './profile'
import type { CombatSession } from './session'
import type { InvEchoEnt, InventoryEntry, InvRotEnt } from './inventoryStorage'
import type { OptContext } from './optimizer'
import type { SuggestState, SuggsViewMod, WeaponPlanSet } from './suggestions'
import type {
  BlurMode,
  BgThemeVar,
  DarkThemeVar,
  LightThemeVar,
} from './themes'
import type { AttributeKey } from './stats'
import type { UiPrefs } from './preferences'

export type ThemeMode = 'light' | 'dark' | 'background'
export type ThemePref = 'system' | ThemeMode
export const HIST_MAX_OPTS = [5, 10, 25, 50, 75, 100] as const
export type HistoryMax = typeof HIST_MAX_OPTS[number]
export const PICK_FREQ_MAX = 3 as const
export const PICK_FREQ_WEPS = [
  'broadblade',
  'sword',
  'pistols',
  'gauntlets',
  'rectifier',
] as const
export type PickFreqWeapon = typeof PICK_FREQ_WEPS[number]
export const PICK_FREQ_TEAM = ['active', 'teammate1', 'teammate2'] as const
export type PckrFreqTeam = typeof PICK_FREQ_TEAM[number]

export interface PckrFreqBktS {
  ids: string[]
  counts: Record<string, number>
}

export interface PckrFreqStt {
  resonator: PckrFreqBktS
  echo: PckrFreqBktS
  enemy: PckrFreqBktS
  weaponByType: Record<PickFreqWeapon, PckrFreqBktS>
  resonatorByTeamSlot: Record<PckrFreqTeam, PckrFreqBktS>
}

export type PckrFreqUpd =
  | {
    bucket: 'resonator' | 'echo' | 'enemy'
    ids: string[]
  }
  | {
    bucket: 'weapon'
    weaponType: PickFreqWeapon
    ids: string[]
  }
  | {
    bucket: 'teamResonator'
    slot: PckrFreqTeam
    ids: string[]
  }

// shared unset enemy id
export const NONE_ENEMY_ID = '0'

export type EnemyResistN = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type EnemyResistT = Record<EnemyResistN, number>

// map elemental attributes to enemy resistance slots
export const ATTR_ENEMY_RES: Record<AttributeKey, EnemyResistN> = {
  physical: 0,
  glacio: 1,
  fusion: 2,
  electro: 3,
  aero: 4,
  spectro: 5,
  havoc: 6,
}

// available left pane tabs in the calculator ui
export type LeftPaneView =
    | 'resonators'
    | 'buffs'
    | 'echoes'
    | 'enemy'
    | 'weapon'
    | 'teams'
    | 'rotations'
    | 'suggestions'

export interface EnemyProfile {
  id: string
  level: number
  class: number
  toa: boolean
  res: EnemyResistT
  source?: 'catalog' | 'custom'
  status?: EnemyStatus
}

// enemy combat-state values set in the enemy pane. tuneStrain is always present; additional
// keys are per-enemy debuff states (toggles/stacks/selects) declared by enemy source data and
// read by effects via the `enemy.status.<field>` path.
export type EnemyStateValue = number | boolean | string

export interface EnemyStatus {
  tuneStrain: number
  [field: string]: EnemyStateValue
}

// check whether the enemy profile is the unset placeholder
export function isNoEnemy(enemy: Pick<EnemyProfile, 'id'>): boolean {
  return enemy.id === NONE_ENEMY_ID
}

export interface UiState {
  theme: ThemeMode
  themePreference: ThemePref
  lightVariant: LightThemeVar
  darkVariant: DarkThemeVar
  backgroundVariant: BgThemeVar
  backgroundImageKey: string
  backgroundTextMode: 'light' | 'dark'
  bodyFontName: string
  bodyFontUrl: string
  blurMode: BlurMode
  entranceAnimations: boolean
  preferences: UiPrefs
  leftPaneView: LeftPaneView
  suggsViewMode: SuggsViewMod
  mainMode: 'default' | 'optimizer' | 'overview'
  showSubHits: boolean
  compactInv: boolean
  seeEquipped: boolean
  haveHistory: boolean
  historyMax: HistoryMax
  itemFreq: PckrFreqStt
  optimizerCpuHintSeen: boolean
  optimizerUseSprite: boolean
  savedRotationPreferences: {
    sortBy: 'date' | 'name' | 'avg' | 'dps'
    sortOrder: 'asc' | 'desc'
    filterMode: 'all' | 'personal' | 'team'
    autoSearchActiveResonator: boolean
  }
}

export interface CalcState {
  runtimeRevision: number
  profiles: Record<string, ResProf>
  session: CombatSession
  inventoryEchoes: InvEchoEnt[]
  inventoryBuilds: InventoryEntry[]
  inventoryRotations: InvRotEnt[]
  optimizerContext: OptContext | null
  weaponSuggests: WeaponPlanSet
  suggestionsByResonatorId: Record<string, SuggestState>
}

export interface PersistedState {
  version: 22
  ui: UiState
  calculator: CalcState
}
