/*
  Author: Runor Ewhro
  Description: Provides default state factories and initialization helpers for
               resonators, teams, optimizer context, and persisted app state.
*/

import type {
  LeftPaneView,
  PersistedAppState,
  ThemeMode,
  ThemePreference,
  EnemyProfile,
  CalculatorState,
  UiState,
} from '@/domain/entities/appState'
import type {
  InventoryEchoEntry,
  InventoryBuildEntry,
  InventoryRotationEntry,
} from '@/domain/entities/inventoryStorage'
import type { OptimizerContextState, OptimizerSettings } from '@/domain/entities/optimizer'
import {
  cloneCompactSonataSetConditionals,
  DEFAULT_SONATA_SET_CONDITIONALS,
} from '@/domain/entities/sonataSetConditionals'
import { SONATA_SETS } from '@/data/gameData/catalog/sonataSets'
import type {
  RandomGeneratorSettings,
  ResonatorSuggestionsState,
  SuggestionSettings,
} from '@/domain/entities/suggestions'
import {
  BACKGROUND_THEME_VARIANTS,
  DARK_THEME_VARIANTS,
  LIGHT_THEME_VARIANTS,
} from '@/domain/entities/themes'
import {
  DEFAULT_BODY_FONT_NAME,
  getPresetBodyFontLink,
} from '@/modules/settings/model/typography'
import { DEFAULT_BACKGROUND_WALLPAPER_KEY } from '@/modules/settings/model/backgroundTheme'
import { getSystemThemeMode } from '@/shared/lib/systemTheme'
import { DEFAULT_ENEMY_PROFILE } from '@/domain/entities/enemy'
import type {
  ResonatorRuntimeState,
  ResonatorSeed,
  SkillLevels,
  TraceNodeBuffs,
  CombatState,
  RotationState,
  TeamSlots,
  TeamMemberRuntime,
  TeamMemberRuntimeView,
  WeaponBuildState,
} from '@/domain/entities/runtime'
import type {
  ResonatorProfile,
  SlotLocalState,
  SlotRoutingState,
} from '@/domain/entities/profile'

export type PersistedAppStateInput = Omit<PersistedAppState, 'version' | 'ui'> & {
  version: number
  ui: Omit<UiState, 'themePreference'> & {
    themePreference?: UiState['themePreference']
  }
}
import type { CombatSession } from '@/domain/entities/session'
import type {
  ManualBuffs,
  ManualModifier,
  ManualQuickBuffs,
} from '@/domain/entities/manualBuffs'
import { UNSET_WEAPON_ID } from '@/domain/entities/runtime'
import type { AttributeKey, BaseStatBuff, ModBuff } from '@/domain/entities/stats'
import { listWeaponsByType } from '@/domain/services/weaponCatalogService'
import { writeRuntimePath } from '@/domain/gameData/runtimePath'
import { makeMaxTraceNodeBuffs } from '@/domain/state/traceNodes'
import { listResonatorRotations, listStatesForSource } from '@/domain/services/gameDataService'
import {
  cloneEnemyProfile,
  cloneManualBuffs,
  cloneResonatorRuntimeState,
  cloneRotationState,
  cloneTeamMemberRuntimes,
} from '@/domain/state/runtimeCloning'
import { PERSISTED_APP_STATE_VERSION } from '@/domain/state/schema'

export const DEFAULT_RESONATOR_ID = '1506'
export const MAX_RESONATOR_LEVEL = 90
export const MAX_SKILL_LEVEL = 10
export const MAX_WEAPON_LEVEL = 90

// default saved rotation preferences
export function createDefaultSavedRotationPreferences(): UiState['savedRotationPreferences'] {
  return {
    sortBy: 'date',
    sortOrder: 'desc',
    filterMode: 'all',
    autoSearchActiveResonator: false,
  }
}

// shared attribute keys
const attributeKeys: AttributeKey[] = [
  'aero',
  'glacio',
  'spectro',
  'fusion',
  'electro',
  'havoc',
  'physical',
]

// create a zeroed base stat buff
export function makeBaseBuff(): BaseStatBuff {
  return { percent: 0, flat: 0 }
}

// create a zeroed modifier buff
export function makeModBuff(): ModBuff {
  return {
    resShred: 0,
    dmgBonus: 0,
    amplify: 0,
    defIgnore: 0,
    defShred: 0,
    dmgVuln: 0,
    critRate: 0,
    critDmg: 0,
  }
}

// create level 1 default skill levels
export function makeDefaultSkillLevels(): SkillLevels {
  return {
    normalAttack: 1,
    resonanceSkill: 1,
    forteCircuit: 1,
    resonanceLiberation: 1,
    introSkill: 1,
    tuneBreak: 1,
  }
}

// create maxed skill levels
export function makeMaxSkillLevels(): SkillLevels {
  return {
    normalAttack: MAX_SKILL_LEVEL,
    resonanceSkill: MAX_SKILL_LEVEL,
    forteCircuit: MAX_SKILL_LEVEL,
    resonanceLiberation: MAX_SKILL_LEVEL,
    introSkill: MAX_SKILL_LEVEL,
    tuneBreak: MAX_SKILL_LEVEL,
  }
}

// create default trace node buff storage
export function makeDefaultTraceNodeBuffs(): TraceNodeBuffs {
  return {
    atk: makeBaseBuff(),
    hp: makeBaseBuff(),
    def: makeBaseBuff(),
    attribute: Object.fromEntries(attributeKeys.map((key) => [key, makeModBuff()])) as Record<
        AttributeKey,
        ModBuff
    >,
    critRate: 0,
    critDmg: 0,
    healingBonus: 0,
    activeNodes: {},
  }
}

// create default quick manual buffs
export function makeDefaultManualQuickBuffs(): ManualQuickBuffs {
  return {
    atk: { flat: 0, percent: 0 },
    hp: { flat: 0, percent: 0 },
    def: { flat: 0, percent: 0 },
    critRate: 0,
    critDmg: 0,
    energyRegen: 0,
    healingBonus: 0,
  }
}

// create a default manual modifier for a given scope
export function makeDefaultManualModifier(
    id: string,
    scope: ManualModifier['scope'] = 'topStat',
): ManualModifier {
  switch (scope) {
    case 'baseStat':
      return {
        id,
        enabled: true,
        scope,
        stat: 'atk',
        field: 'percent',
        value: 0,
      }
    case 'attribute':
      return {
        id,
        enabled: true,
        scope,
        attribute: 'all',
        mod: 'dmgBonus',
        value: 0,
      }
    case 'skillType':
      return {
        id,
        enabled: true,
        scope,
        skillType: 'all',
        mod: 'dmgBonus',
        value: 0,
      }
    case 'skill':
      return {
        id,
        enabled: true,
        scope,
        matchMode: 'skillId',
        skillId: '',
        mod: 'dmgBonus',
        value: 0,
      }
    case 'topStat':
    default:
      return {
        id,
        enabled: true,
        scope: 'topStat',
        stat: 'dmgBonus',
        value: 0,
      }
  }
}

// create default custom buffs state
export function makeDefaultCustomBuffs(): ManualBuffs {
  return {
    quick: makeDefaultManualQuickBuffs(),
    modifiers: [],
  }
}

// create default combat state
export function makeDefaultCombatState(): CombatState {
  return {
    spectroFrazzle: 0,
    aeroErosion: 0,
    fusionBurst: 0,
    havocBane: 0,
    glacioChafe: 0,
    electroFlare: 0,
    electroRage: 0,
  }
}

// create default optimizer settings
export function createDefaultOptimizerSettings(): OptimizerSettings {
  const allSetIds = SONATA_SETS.map((set) => set.id)

  return {
    targetSkillId: null,
    targetMode: 'skill',
    targetComboSourceId: null,
    rotationMode: false,
    resultsLimit: 128,
    keepPercent: 0,
    lowMemoryMode: false,
    enableGpu: true,
    lockedMainEchoId: null,
    allowedSets: {
      3: [...allSetIds],
      5: [...allSetIds],
    },
    mainStatFilter: [],
    selectedBonus: null,
    statConstraints: {},
  }
}

// create default suggestion settings
export function createDefaultSuggestionSettings(): SuggestionSettings {
  return {
    targetFeatureId: null,
    rotationMode: false,
  }
}

// create default random generator settings
export function createDefaultRandomGeneratorSettings(): RandomGeneratorSettings {
  return {
    bias: 0.5,
    rollQuality: 0.3,
    targetEnergyRegen: 0,
    setPreferences: [],
    mainEchoId: null,
  }
}

// create default per-resonator suggestions state
export function createDefaultResonatorSuggestionsState(): ResonatorSuggestionsState {
  return {
    settings: createDefaultSuggestionSettings(),
    random: createDefaultRandomGeneratorSettings(),
  }
}

// clone optimizer settings with defaults applied
export function cloneOptimizerSettings(
    settings?: Partial<OptimizerSettings> | null,
): OptimizerSettings {
  const defaults = createDefaultOptimizerSettings()

  return {
    ...defaults,
    ...(settings ?? {}),
    allowedSets: {
      3: [...(settings?.allowedSets?.[3] ?? defaults.allowedSets[3])],
      5: [...(settings?.allowedSets?.[5] ?? defaults.allowedSets[5])],
    },
    mainStatFilter: [...(settings?.mainStatFilter ?? defaults.mainStatFilter)],
    statConstraints: structuredClone(settings?.statConstraints ?? defaults.statConstraints),
  }
}

// create a default weapon build state
export function makeDefaultWeaponBuildState(weaponType?: number): WeaponBuildState {
  if (weaponType !== undefined) {
    const weapons = listWeaponsByType(weaponType)
    if (weapons.length > 0) {
      const first = weapons[0]
      const stats = first.statsByLevel[1]

      return {
        id: first.id,
        level: 1,
        rank: 1,
        baseAtk: stats ? stats.atk : first.baseAtk,
      }
    }
  }

  return {
    id: UNSET_WEAPON_ID,
    level: 1,
    rank: 1,
    baseAtk: 0,
  }
}

// create a maxed weapon build state
export function makeMaxWeaponBuildState(
    id: string | null = UNSET_WEAPON_ID,
    rank = 1,
    baseAtk = 0,
): WeaponBuildState {
  return {
    id,
    level: MAX_WEAPON_LEVEL,
    rank,
    baseAtk,
  }
}

// create default team slots with the active resonator in slot 0
export function makeDefaultTeamSlots(seed: ResonatorSeed): TeamSlots {
  return [seed.id, null, null]
}

// create default local slot state
export function makeDefaultSlotLocalState(): SlotLocalState {
  return {
    controls: {},
    manualBuffs: makeDefaultCustomBuffs(),
    combat: makeDefaultCombatState(),
    setConditionals: cloneCompactSonataSetConditionals(DEFAULT_SONATA_SET_CONDITIONALS),
  }
}

// create default slot routing state
export function makeDefaultSlotRoutingState(): SlotRoutingState {
  return {
    selectedTargetsByOwnerKey: {},
  }
}

// clone the default enemy profile
export function makeDefaultEnemyProfile(): EnemyProfile {
  return cloneEnemyProfile(DEFAULT_ENEMY_PROFILE)
}

// resolve seed state definitions from the seed or catalog
function getSeedStates(seed: ResonatorSeed) {
  if (seed.states?.length) {
    return seed.states
  }

  return listStatesForSource('resonator', seed.id)
}

// create the default rotation state for a resonator
export function makeDefaultRotation(seed: ResonatorSeed): RotationState {
  const defaultRotation = seed.rotations?.[0] ?? listResonatorRotations(seed.id)[0]

  return {
    view: 'personal',
    personalItems: cloneRotationState({
      view: 'personal',
      personalItems: defaultRotation?.items ?? [],
      teamItems: [],
    }).personalItems,
    teamItems: [],
  }
}

// create a default persisted resonator profile
export function createDefaultResonatorProfile(seed: ResonatorSeed): ResonatorProfile {
  return {
    resonatorId: seed.id,
    runtime: {
      progression: {
        level: 1,
        sequence: 0,
        skillLevels: makeDefaultSkillLevels(),
        traceNodes: makeDefaultTraceNodeBuffs(),
      },
      build: {
        weapon: makeDefaultWeaponBuildState(seed.weaponType),
        echoes: [null, null, null, null, null],
      },
      local: applySeedStateDefaultsToLocalState(seed, makeDefaultSlotLocalState()),
      routing: makeDefaultSlotRoutingState(),
      team: makeDefaultTeamSlots(seed),
      rotation: makeDefaultRotation(seed),
      teamRuntimes: [null, null],
    },
  }
}

// create a default combat session
export function createDefaultCombatSession(seed: ResonatorSeed): CombatSession {
  return {
    activeResonatorId: seed.id,
    enemyProfile: makeDefaultEnemyProfile(),
  }
}

// apply state defaults directly to a resonator runtime
function applyStateDefaults(seed: ResonatorSeed, runtime: ResonatorRuntimeState): ResonatorRuntimeState {
  return getSeedStates(seed).reduce((nextRuntime, state) => {
    if (state.defaultValue === undefined) {
      return nextRuntime
    }

    return writeRuntimePath(nextRuntime, state.path, state.defaultValue)
  }, runtime)
}

// apply seed state defaults to local slot state only
export function applySeedStateDefaultsToLocalState(
    seed: ResonatorSeed,
    localState: SlotLocalState,
): SlotLocalState {
  const nextLocalState: SlotLocalState = {
    controls: { ...localState.controls },
    manualBuffs: cloneManualBuffs(localState.manualBuffs),
    combat: { ...localState.combat },
    setConditionals: cloneCompactSonataSetConditionals(localState.setConditionals),
  }

  for (const state of getSeedStates(seed)) {
    if (state.defaultValue === undefined) {
      continue
    }

    if (state.path.startsWith('runtime.state.controls.')) {
      const controlKey = state.path.replace(/^runtime\.state\.controls\./, '')
      nextLocalState.controls[controlKey] = state.defaultValue
    }
  }

  return nextLocalState
}

// clone slot routing state
export function cloneSlotRoutingState(routing?: SlotRoutingState): SlotRoutingState {
  return {
    selectedTargetsByOwnerKey: {
      ...(routing?.selectedTargetsByOwnerKey ?? {}),
    },
  }
}

// normalize a profile team so the active resonator stays in slot 0 and duplicates are removed
export function normalizeProfileTeam(
    activeResonatorId: string,
    team: TeamSlots,
): TeamSlots {
  const nextTeam1Id = team[1] && team[1] !== activeResonatorId ? team[1] : null
  const nextTeam2Candidate = team[2] && team[2] !== activeResonatorId ? team[2] : null
  const nextTeam2Id = nextTeam2Candidate && nextTeam2Candidate !== nextTeam1Id ? nextTeam2Candidate : null

  return [activeResonatorId, nextTeam1Id, nextTeam2Id]
}

// apply seed state defaults to a team member runtime view
function applyTeamMemberStateDefaults(seed: ResonatorSeed, runtime: TeamMemberRuntimeView): TeamMemberRuntimeView {
  return getSeedStates(seed).reduce((nextRuntime, state) => {
    if (state.defaultValue === undefined) {
      return nextRuntime
    }

    return writeRuntimePath(
        nextRuntime as unknown as ResonatorRuntimeState,
        state.path,
        state.defaultValue,
    ) as unknown as TeamMemberRuntimeView
  }, runtime)
}

// create a default live resonator runtime
export function createDefaultResonatorRuntime(seed: ResonatorSeed): ResonatorRuntimeState {
  const baseRuntime: ResonatorRuntimeState = {
    id: seed.id,
    base: {
      level: 1,
      sequence: 0,
      skillLevels: makeDefaultSkillLevels(),
      traceNodes: makeDefaultTraceNodeBuffs(),
    },
    build: {
      weapon: makeDefaultWeaponBuildState(seed.weaponType),
      echoes: [null, null, null, null, null],
      team: makeDefaultTeamSlots(seed),
    },
    state: {
      controls: {},
      manualBuffs: makeDefaultCustomBuffs(),
      combat: makeDefaultCombatState(),
    },
    rotation: makeDefaultRotation(seed),
    teamRuntimes: [null, null],
  }

  return applyStateDefaults(seed, baseRuntime)
}

// create a default team member runtime view
export function createDefaultTeamMemberRuntimeView(seed: ResonatorSeed): TeamMemberRuntimeView {
  const baseRuntime: TeamMemberRuntimeView = {
    id: seed.id,
    base: {
      sequence: 0,
    },
    build: {
      weapon: (({ id, rank, baseAtk }) => ({ id, rank, baseAtk }))(makeDefaultWeaponBuildState(seed.weaponType)),
      echoes: [null, null, null, null, null],
    },
    state: {
      controls: {},
      manualBuffs: makeDefaultCustomBuffs(),
      combat: makeDefaultCombatState(),
    },
  }

  return applyTeamMemberStateDefaults(seed, baseRuntime)
}

// create a maxed default team member runtime
export function makeDefaultTeamMemberRuntime(seed: ResonatorSeed): TeamMemberRuntime {
  const weapon = makeDefaultWeaponBuildState(seed.weaponType)

  return {
    id: seed.id,
    base: {
      level: MAX_RESONATOR_LEVEL,
      sequence: 0,
      skillLevels: makeMaxSkillLevels(),
      traceNodes: makeMaxTraceNodeBuffs(seed),
    },
    build: {
      weapon: { ...weapon, level: MAX_WEAPON_LEVEL },
      echoes: [null, null, null, null, null],
    },
    manualBuffs: makeDefaultCustomBuffs(),
  }
}

// expand a lightweight team member runtime view into a full resonator runtime
export function materializeTeamMemberRuntimeView(
    seed: ResonatorSeed,
    teamMember: TeamMemberRuntimeView,
    team: TeamSlots,
): ResonatorRuntimeState {
  return {
    id: teamMember.id,
    base: {
      level: MAX_RESONATOR_LEVEL,
      sequence: teamMember.base.sequence,
      skillLevels: makeMaxSkillLevels(),
      traceNodes: makeMaxTraceNodeBuffs(seed),
    },
    build: {
      weapon: makeMaxWeaponBuildState(
          teamMember.build.weapon.id,
          teamMember.build.weapon.rank,
          teamMember.build.weapon.baseAtk,
      ),
      echoes: teamMember.build.echoes,
      team,
    },
    state: {
      controls: { ...teamMember.state.controls },
      manualBuffs: cloneManualBuffs(teamMember.state.manualBuffs),
      combat: { ...teamMember.state.combat },
    },
    rotation: makeDefaultRotation(seed),
    teamRuntimes: [null, null],
  }
}

// create an optimizer context from a runtime snapshot
export function createOptimizerContextFromRuntime(
    runtime: ResonatorRuntimeState,
    settings?: Partial<OptimizerSettings> | null,
): OptimizerContextState {
  return {
    resonatorId: runtime.id,
    runtime: cloneResonatorRuntimeState(runtime),
    settings: cloneOptimizerSettings(settings),
  }
}

// clone an optimizer context safely
export function cloneOptimizerContextState(
    context?: OptimizerContextState | null,
): OptimizerContextState | null {
  if (!context) {
    return null
  }

  return {
    resonatorId: context.resonatorId,
    runtime: cloneResonatorRuntimeState(context.runtime),
    settings: cloneOptimizerSettings(context.settings),
  }
}

// normalize and initialize calculator state
function buildInitializedCalculatorState(base?: CalculatorState): CalculatorState {
  const runtimeRevision = Math.max(0, Math.floor(base?.runtimeRevision ?? 0))
  const profiles = { ...(base?.profiles ?? {}) }
  const inventoryEchoes: InventoryEchoEntry[] = structuredClone(base?.inventoryEchoes ?? [])
  const inventoryBuilds: InventoryBuildEntry[] = structuredClone(base?.inventoryBuilds ?? [])
  const inventoryRotations: InventoryRotationEntry[] = structuredClone(base?.inventoryRotations ?? [])
  const optimizerContext = cloneOptimizerContextState(base?.optimizerContext ?? null)

  const suggestionsByResonatorId = Object.fromEntries(
      Object.entries(base?.suggestionsByResonatorId ?? {}).map(([resonatorId, state]) => [
        resonatorId,
        {
          settings: {
            ...createDefaultSuggestionSettings(),
            ...(state?.settings ?? {}),
          },
          random: {
            ...createDefaultRandomGeneratorSettings(),
            ...(state?.random ?? {}),
            setPreferences: structuredClone(state?.random?.setPreferences ?? []),
          },
        },
      ]),
  )

  const session = base?.session
      ? {
        activeResonatorId: base.session.activeResonatorId,
        enemyProfile: cloneEnemyProfile(base.session.enemyProfile),
      }
      : null

  const activeResonatorId = session?.activeResonatorId ?? DEFAULT_RESONATOR_ID

  // ensure team runtimes exist on the active profile
  if (activeResonatorId && profiles[activeResonatorId]) {
    const activeProfile = profiles[activeResonatorId]
    if (!activeProfile.runtime.teamRuntimes) {
      profiles[activeResonatorId] = {
        ...activeProfile,
        runtime: {
          ...activeProfile.runtime,
          teamRuntimes: cloneTeamMemberRuntimes([null, null]),
        },
      }
    }
  }

  const normalizedSession = session ?? {
    activeResonatorId,
    enemyProfile: makeDefaultEnemyProfile(),
  }

  if (!normalizedSession.activeResonatorId) {
    normalizedSession.activeResonatorId = activeResonatorId
  }

  return {
    runtimeRevision,
    profiles,
    inventoryEchoes,
    inventoryBuilds,
    inventoryRotations,
    optimizerContext,
    suggestionsByResonatorId,
    session: normalizedSession,
  }
}

// normalize a loaded persisted app state
export function initializePersistedAppState(
    state: PersistedAppStateInput,
): PersistedAppState {
  const themePreference: ThemePreference = state.ui.themePreference
    ?? (state.ui.theme === 'background' ? 'background' : 'system')

  return {
    ...state,
    version: PERSISTED_APP_STATE_VERSION,
    ui: {
      ...state.ui,
      themePreference,
      backgroundImageKey: state.ui.backgroundImageKey ?? DEFAULT_BACKGROUND_WALLPAPER_KEY,
      backgroundTextMode: state.ui.backgroundTextMode ?? 'light',
      bodyFontName: state.ui.bodyFontName ?? DEFAULT_BODY_FONT_NAME,
      bodyFontUrl: state.ui.bodyFontUrl ?? getPresetBodyFontLink(state.ui.bodyFontName ?? DEFAULT_BODY_FONT_NAME),
      optimizerCpuHintSeen: state.ui.optimizerCpuHintSeen ?? false,
      savedRotationPreferences: {
        ...createDefaultSavedRotationPreferences(),
        ...state.ui.savedRotationPreferences,
      },
    },
    calculator: buildInitializedCalculatorState(state.calculator),
  }
}

// create the full default app state
export function createDefaultAppState(
    theme: ThemeMode = getSystemThemeMode(),
    leftPaneView: LeftPaneView = 'resonators',
): PersistedAppState {
  return initializePersistedAppState({
    version: PERSISTED_APP_STATE_VERSION,
    ui: {
      theme,
      themePreference: 'background' === theme ? 'background' : 'system',
      lightVariant: LIGHT_THEME_VARIANTS[0],
      darkVariant: DARK_THEME_VARIANTS[0],
      backgroundVariant: BACKGROUND_THEME_VARIANTS[0],
      backgroundImageKey: DEFAULT_BACKGROUND_WALLPAPER_KEY,
      backgroundTextMode: 'light',
      bodyFontName: DEFAULT_BODY_FONT_NAME,
      bodyFontUrl: getPresetBodyFontLink(DEFAULT_BODY_FONT_NAME),
      blurMode: 'on',
      entranceAnimations: 'on',
      leftPaneView,
      mainMode: 'default',
      showSubHits: false,
      optimizerCpuHintSeen: false,
      savedRotationPreferences: createDefaultSavedRotationPreferences(),
    },
    calculator: buildInitializedCalculatorState(),
  })
}
