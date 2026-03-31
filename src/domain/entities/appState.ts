/*
  Author: Runor Ewhro
  Description: Defines shared application state types and constants for ui,
               enemy data, calculator state, and persisted app storage.
*/

import type { ResonatorProfile } from './profile'
import type { CombatSession } from './session'
import type { InventoryEchoEntry, InventoryBuildEntry, InventoryRotationEntry } from './inventoryStorage'
import type { OptimizerContextState } from './optimizer'
import type { ResonatorSuggestionsState } from './suggestions'
import type {
  BlurMode,
  BackgroundThemeVariant,
  DarkThemeVariant,
  LightThemeVariant,
} from './themes'
import type { AttributeKey } from './stats'

export type ThemeMode = 'light' | 'dark' | 'background'
export type ThemePreference = 'system' | ThemeMode

// shared unset enemy id
export const UNSET_ENEMY_ID = '0'

export type EnemyResistanceIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type EnemyResistanceTable = Record<EnemyResistanceIndex, number>

// map elemental attributes to enemy resistance slots
export const ATTRIBUTE_TO_ENEMY_RES_INDEX: Record<AttributeKey, EnemyResistanceIndex> = {
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
  res: EnemyResistanceTable
  source?: 'catalog' | 'custom'
  status?: {
    tuneStrain: number
  }
}

// check whether the enemy profile is the unset placeholder
export function isUnsetEnemyProfile(enemy: Pick<EnemyProfile, 'id'>): boolean {
  return enemy.id === UNSET_ENEMY_ID
}

export interface UiState {
  theme: ThemeMode
  themePreference: ThemePreference
  lightVariant: LightThemeVariant
  darkVariant: DarkThemeVariant
  backgroundVariant: BackgroundThemeVariant
  backgroundImageKey: string
  backgroundTextMode: 'light' | 'dark'
  bodyFontName: string
  bodyFontUrl: string
  blurMode: BlurMode
  entranceAnimations: 'on' | 'off'
  leftPaneView: LeftPaneView
  mainMode: 'default' | 'optimizer' | 'overview'
  showSubHits: boolean
  optimizerCpuHintSeen: boolean
  savedRotationPreferences: {
    sortBy: 'date' | 'name' | 'avg'
    sortOrder: 'asc' | 'desc'
    filterMode: 'all' | 'personal' | 'team'
    autoSearchActiveResonator: boolean
  }
}

export interface CalculatorState {
  runtimeRevision: number
  profiles: Record<string, ResonatorProfile>
  session: CombatSession
  inventoryEchoes: InventoryEchoEntry[]
  inventoryBuilds: InventoryBuildEntry[]
  inventoryRotations: InventoryRotationEntry[]
  optimizerContext: OptimizerContextState | null
  suggestionsByResonatorId: Record<string, ResonatorSuggestionsState>
}

export interface PersistedAppState {
  version: 22
  ui: UiState
  calculator: CalculatorState
}
