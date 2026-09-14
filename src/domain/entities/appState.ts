/*
  Author: Runor Ewhro
  Description: Defines app state data contracts and state invariants.
*/

import type { ResProf } from './profile'
import type { SavedArtifactLibrary } from './inventoryStorage'
import type { OptSets } from './optimizer'
import type { SuggestState, SuggsViewMod, WeaponPlanSet } from './suggestions'
import type {
  BlurMode,
  BgThemeVar,
  DarkThemeVar,
  LightThemeVar,
} from './themes'
import type { AttributeKey } from './stats'
import type { UiPrefs } from './preferences'
import type { RotationEditorPreferences } from './rotationEditorPreferences'
import type { ScenarioWorkspace } from './scenarioLibrary'
import type { ResonatorId } from './runtime'

export type ThemeMode = 'light' | 'dark' | 'background'
export type ThemePref = 'system' | ThemeMode
export const HIST_MAX_OPTS = [5, 10, 25, 50, 75, 100] as const
export type HistoryMax = typeof HIST_MAX_OPTS[number]
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

export interface PckrFreqItmS {
  id: string
  count: number
  firstUsedAt: string | null
  lastUsedAt: string | null
  previousUsedAt: string | null
  firstUseSeq: number
  lastUseSeq: number
  usesByDay: Record<string, number>
  firstActiveResonatorId: string | null
  lastActiveResonatorId: string | null
  previousActiveResonatorId: string | null
  usesByActiveResonator: Record<string, number>
}

export interface PckrFreqBktS {
  version: 2
  totalUses: number
  firstUsedAt: string | null
  lastUsedAt: string | null
  order: string[]
  items: Record<string, PckrFreqItmS>
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
    activeResonatorId?: string | null
  }
  | {
    bucket: 'weapon'
    weaponType: PickFreqWeapon
    ids: string[]
    activeResonatorId?: string | null
  }
  | {
    bucket: 'teamResonator'
    slot: PckrFreqTeam
    ids: string[]
    activeResonatorId?: string | null
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

// available left pane tabs in the legacy workspace UI
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
  showSubHits: boolean
  compactInv: boolean
  seeEquipped: boolean
  haveHistory: boolean
  historyMax: HistoryMax
  itemFreq: PckrFreqStt
  optimizerCpuHintSeen: boolean
  optimizerUseSprite: boolean
  compressedExports: boolean
  groupInv: boolean
  rotationEditorPreferences: RotationEditorPreferences
  savedRotationPreferences: {
    sortBy: 'date' | 'name' | 'avg' | 'dps'
    sortOrder: 'asc' | 'desc'
    contributionFilter: 'unset' | 'solo' | 'duo' | 'trio'
    autoSearchActiveResonator: boolean
    showLiveRotation: boolean
    scaleToSelected: boolean
  }
}

export interface SimulationState {
  /** Resonator whose derived build choices the current optimizer settings belong to. */
  optimizerSettingsResonatorId: ResonatorId | null
  optimizerSettings: OptSets
  weaponSuggests: WeaponPlanSet
  suggestionsByResonatorId: Record<string, SuggestState>
}

export type LegacyProfileMap = Record<string, ResProf>

export interface PersistedState {
  version: 28
  ui: UiState
  /** Canonical live combat ownership, independent of Simulation tooling. */
  combat: ScenarioWorkspace
  /** User-authored snapshots, independent from any Simulation surface. */
  library: SavedArtifactLibrary
  simulation: SimulationState
}

export type HydratedAppState = PersistedState
