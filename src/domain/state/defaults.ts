/*
  Author: Runor Ewhro
  Description: Provides default state factories and initialization helpers for
               resonators, teams, optimizer context, and persisted app state.
*/

import type {
  LeftPaneView,
  PersistedState,
  ThemeMode,
  ThemePref,
  EnemyProfile,
  CalcState,
  UiState,
} from '@/domain/entities/appState'
import { DEF_UI_PREFS } from '@/domain/entities/preferences'
import type {
  InvEchoEnt,
  InventoryEntry,
  InvRotEnt,
} from '@/domain/entities/inventoryStorage'
import type { OptContext, OptSets } from '@/domain/entities/optimizer'
import {
  cloneSntSet,
  DEF_SET_COND,
} from '@/domain/entities/sonataSetConditionals'
import type {
  RandGnrtSets,
  SuggestState,
  SuggSets,
  WeaponPlanSet,
} from '@/domain/entities/suggestions'
import {
  BG_THEMES,
  DARK_THEMES,
  LIGHT_THEMES,
} from '@/domain/entities/themes'
import { mkDefPckrFre } from '@/domain/state/pickerFrequency'
import {
  DEF_BODY_FONT,
  getPrstBodyF,
} from '@/modules/settings/model/typography'
import { DEF_BG_KEY } from '@/modules/settings/model/backgroundTheme'
import { getSystTheme } from '@/shared/lib/systemTheme'
import { DEF_ENEMY_PROF } from '@/domain/entities/enemy'
import type {
  ResRuntime,
  ResSeed,
  SkillLevels,
  TraceNodeBuffs,
  CombatState,
  RotationState,
  TeamSlots,
  TeamMemRt,
  TeamMemRtVie,
  WeaponState,
} from '@/domain/entities/runtime'
import type {
  ResProf,
  SlotLocalState,
  SlotRatingState,
} from '@/domain/entities/profile'

export type PersistedUnknown = Omit<PersistedState, 'version' | 'ui'> & {
  version: number
  ui: Omit<UiState, 'themePreference' | 'historyMax' | 'itemFreq' | 'preferences' | 'suggsViewMode'> & {
    themePreference?: UiState['themePreference']
    historyMax?: UiState['historyMax']
    itemFreq?: UiState['itemFreq']
    preferences?: UiState['preferences']
    suggsViewMode?: UiState['suggsViewMode']
  }
}
import type {
  ManualBuffs,
  MnlMod,
  QuickBuffs,
} from '@/domain/entities/manualBuffs'
import { NONE_WPN_ID } from '@/domain/entities/runtime'
import type { AttributeKey, BaseStatBuff, ModBuff } from '@/domain/entities/stats'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService'
import { writeRtPath } from '@/domain/gameData/runtimePath'
import { mkMaxTrcNode } from '@/domain/state/traceNodes'
import { listResRttn, listStatesFor } from '@/domain/services/gameDataService'
import {
  cloneEnemyPr,
  cloneBuffs,
  cloneResRtSt,
  cloneRotation,
} from '@/domain/state/runtimeCloning'
import { APP_STATE_VER } from '@/domain/state/schema'
import {
  allOptSetIds,
  normOptSets,
} from '@/engine/optimizer/config/allowedSets'

export const DEF_RES_ID = '1506'
export const MAX_RES_LVL = 90
export const MAX_SKILL_LEVEL = 10
export const MAX_WPN_LVL = 90

// default saved rotation preferences
export function mkDefSvdRotP(): UiState['savedRotationPreferences'] {
  return {
    sortBy: 'date',
    sortOrder: 'desc',
    filterMode: 'all',
    autoSearchActiveResonator: false,
  }
}

// shared attribute keys
const ttrbKeys: AttributeKey[] = [
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
export function mkDefSkllLvl(): SkillLevels {
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
export function mkMaxSkllLvl(): SkillLevels {
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
export function makeTraceNode(): TraceNodeBuffs {
  return {
    atk: makeBaseBuff(),
    hp: makeBaseBuff(),
    def: makeBaseBuff(),
    attribute: Object.fromEntries(ttrbKeys.map((key) => [key, makeModBuff()])) as Record<
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
export function mkDefMnlQckB(): QuickBuffs {
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
export function mkDefMnlMod(
    id: string,
    scope: MnlMod['scope'] = 'topStat',
): MnlMod {
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
    case 'negativeEffect':
      return {
        id,
        enabled: true,
        scope,
        negativeEffect: 'spectroFrazzle',
        mod: 'critRate',
        value: 0,
      }
    case 'skill':
      return {
        id,
        enabled: true,
        scope,
        matchMode: 'skillId',
        skillId: '',
        effect: 'mod',
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
export function makeCustomBuff(): ManualBuffs {
  return {
    quick: mkDefMnlQckB(),
    modifiers: [],
  }
}

// create default combat state
export function makeCombatState(): CombatState {
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
export function makeOptSets(): OptSets {
  const allSetIds = allOptSetIds()

  return {
    targetSkillId: null,
    targetMode: 'skill',
    targetComboSourceId: null,
    rotationMode: false,
    searchMode: 'inventory',
    resultsLimit: 128,
    keepPercent: 0,
    lowMemoryMode: false,
    enableGpu: true,
    lockedMainEchoId: null,
    allowedSets: {
      1: [...allSetIds[1]],
      3: [...allSetIds[3]],
      5: [...allSetIds[5]],
    },
    mainStatFilter: [],
    selectedBonus: null,
    statConstraints: {},
  }
}

// create default suggestion settings
export function mkDefSuggSet(): SuggSets {
  return {
    targetFeatureId: null,
    rotationMode: false,
  }
}

// create default random generator settings
export function mkDefRandGnr(): RandGnrtSets {
  return {
    bias: 0.5,
    rollQuality: 0.3,
    targetEnergyRegen: 0,
    setPreferences: [],
    mainEchoId: null,
  }
}

// create default weapon suggestion settings
export function mkDefWpnSug(): WeaponPlanSet {
  return {
    mode: 'both',
    target: 'max',
    ranks: {
      '5': 1,
      '4': 5,
      '3': 5,
      '2': 5,
      '1': 5,
    },
    stdRank: 1,
    visible: {
      '5': true,
      '4': true,
      '3': false,
      '2': false,
      '1': false,
    },
    states: {},
  }
}

// create default per-resonator suggestions state
export function makeSuggest(): SuggestState {
  return {
    settings: mkDefSuggSet(),
    random: mkDefRandGnr(),
  }
}

// clone optimizer settings with defaults applied
export function cloneOptSets(
    settings?: Partial<OptSets> | null,
): OptSets {
  const defaults = makeOptSets()
  const allowedSets = normOptSets({
    1: [...(settings?.allowedSets?.[1] ?? defaults.allowedSets[1])],
    3: [...(settings?.allowedSets?.[3] ?? defaults.allowedSets[3])],
    5: [...(settings?.allowedSets?.[5] ?? defaults.allowedSets[5])],
  })

  return {
    ...defaults,
    ...(settings ?? {}),
    allowedSets,
    mainStatFilter: [...(settings?.mainStatFilter ?? defaults.mainStatFilter)],
    statConstraints: structuredClone(settings?.statConstraints ?? defaults.statConstraints),
  }
}

// create a default weapon build state
export function mkDefWpnMkSt(weaponType?: number): WeaponState {
  if (weaponType !== undefined) {
    const weapons = listWpnsByTy(weaponType)
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
    id: NONE_WPN_ID,
    level: 1,
    rank: 1,
    baseAtk: 0,
  }
}

// create a maxed weapon build state
export function mkMaxWpnMkSt(
    id: string | null = NONE_WPN_ID,
    rank = 1,
    baseAtk = 0,
): WeaponState {
  return {
    id,
    level: MAX_WPN_LVL,
    rank,
    baseAtk,
  }
}

// create default team slots with the active resonator in slot 0
export function mkDefTeamSlt(seed: ResSeed): TeamSlots {
  return [seed.id, null, null]
}

// create default local slot state
export function mkDefSlotLcl(): SlotLocalState {
  return {
    controls: {},
    manualBuffs: makeCustomBuff(),
    combat: makeCombatState(),
    setConditionals: cloneSntSet(DEF_SET_COND),
  }
}

// create default slot routing state
export function mkDefSlotRtn(): SlotRatingState {
  return {
    selectedTargetsByOwnerKey: {},
  }
}

// clone the default enemy profile
export function makeEnemy(): EnemyProfile {
  return cloneEnemyPr(DEF_ENEMY_PROF)
}

// resolve seed state definitions from the seed or catalog
function getSeedStts(seed: ResSeed) {
  if (seed.states?.length) {
    return seed.states
  }

  return listStatesFor('resonator', seed.id)
}

// create the default rotation state for a resonator
export function mkDefRot(seed: ResSeed): RotationState {
  const defRot = seed.rotations?.[0] ?? listResRttn(seed.id)[0]

  return {
    view: 'personal',
    personalItems: cloneRotation({
      view: 'personal',
      personalItems: defRot?.items ?? [],
      teamItems: [],
    }).personalItems,
    teamItems: [],
  }
}

// create a default persisted resonator profile
export function makeResProfile(seed: ResSeed): ResProf {
  return {
    resonatorId: seed.id,
    runtime: {
      progression: {
        level: 1,
        sequence: 0,
        skillLevels: mkDefSkllLvl(),
        traceNodes: makeTraceNode(),
      },
      build: {
        weapon: mkDefWpnMkSt(seed.weaponType),
        echoes: [null, null, null, null, null],
      },
      local: applySeedStt(seed, mkDefSlotLcl()),
      routing: mkDefSlotRtn(),
      team: mkDefTeamSlt(seed),
      rotation: mkDefRot(seed),
      teamRuntimes: [null, null],
    },
  }
}

// apply state defaults directly to a resonator runtime
function applySttDflt(seed: ResSeed, runtime: ResRuntime): ResRuntime {
  return getSeedStts(seed).reduce((nextRuntime, state) => {
    if (state.defaultValue === undefined) {
      return nextRuntime
    }

    return writeRtPath(nextRuntime, state.path, state.defaultValue)
  }, runtime)
}

// apply seed state defaults to local slot state only
export function applySeedStt(
    seed: ResSeed,
    localState: SlotLocalState,
): SlotLocalState {
  const nextLclStt: SlotLocalState = {
    controls: { ...localState.controls },
    manualBuffs: cloneBuffs(localState.manualBuffs),
    combat: { ...localState.combat },
    setConditionals: cloneSntSet(localState.setConditionals),
  }

  for (const state of getSeedStts(seed)) {
    if (state.defaultValue === undefined) {
      continue
    }

    if (state.path.startsWith('runtime.state.controls.')) {
      const controlKey = state.path.replace(/^runtime\.state\.controls\./, '')
      nextLclStt.controls[controlKey] = state.defaultValue
    }
  }

  return nextLclStt
}

// clone slot routing state
export function cloneSlotRml(routing?: SlotRatingState): SlotRatingState {
  return {
    selectedTargetsByOwnerKey: {
      ...(routing?.selectedTargetsByOwnerKey ?? {}),
    },
  }
}

// keep the active resonator in slot 0 and remove duplicate teammates
export function normProfTeam(
    actResId: string,
    team: TeamSlots,
): TeamSlots {
  const nextTeam1Id = team[1] && team[1] !== actResId ? team[1] : null
  const nextTeam2Cand = team[2] && team[2] !== actResId ? team[2] : null
  const nextTeam2Id = nextTeam2Cand && nextTeam2Cand !== nextTeam1Id ? nextTeam2Cand : null

  return [actResId, nextTeam1Id, nextTeam2Id]
}

// apply seed state defaults to a team member runtime view
function applyTeamMem(seed: ResSeed, runtime: TeamMemRtVie): TeamMemRtVie {
  return getSeedStts(seed).reduce((nextRuntime, state) => {
    if (state.defaultValue === undefined) {
      return nextRuntime
    }

    return writeRtPath(
        nextRuntime as unknown as ResRuntime,
        state.path,
        state.defaultValue,
    ) as unknown as TeamMemRtVie
  }, runtime)
}

// create a default live resonator runtime
export function makeResRuntime(seed: ResSeed): ResRuntime {
  const baseRuntime: ResRuntime = {
    id: seed.id,
    base: {
      level: 1,
      sequence: 0,
      skillLevels: mkDefSkllLvl(),
      traceNodes: makeTraceNode(),
    },
    build: {
      weapon: mkDefWpnMkSt(seed.weaponType),
      echoes: [null, null, null, null, null],
      team: mkDefTeamSlt(seed),
    },
    state: {
      controls: {},
      manualBuffs: makeCustomBuff(),
      combat: makeCombatState(),
    },
    rotation: mkDefRot(seed),
    teamRuntimes: [null, null],
  }

  return applySttDflt(seed, baseRuntime)
}

// create a default team member runtime view
export function mkDefTeamMem(seed: ResSeed): TeamMemRtVie {
  const baseRuntime: TeamMemRtVie = {
    id: seed.id,
    base: {
      sequence: 0,
    },
    build: {
      weapon: (({ id, rank, baseAtk }) => ({ id, rank, baseAtk }))(mkDefWpnMkSt(seed.weaponType)),
      echoes: [null, null, null, null, null],
    },
    state: {
      controls: {},
      manualBuffs: makeCustomBuff(),
      combat: makeCombatState(),
    },
  }

  return applyTeamMem(seed, baseRuntime)
}

// create a maxed default team member runtime
export function makeTeamMember(seed: ResSeed): TeamMemRt {
  const weapon = mkDefWpnMkSt(seed.weaponType)

  return {
    id: seed.id,
    base: {
      sequence: 0,
    },
    build: {
      weapon: (({ id, rank, baseAtk }) => ({ id, rank, baseAtk }))(weapon),
      echoes: [null, null, null, null, null],
    },
    manualBuffs: makeCustomBuff(),
  }
}

// expand a lightweight team member runtime view into a full resonator runtime
export function matTeamMemRt(
    seed: ResSeed,
    teamMember: TeamMemRtVie,
    team: TeamSlots,
): ResRuntime {
  return {
    id: teamMember.id,
    base: {
      level: MAX_RES_LVL,
      sequence: teamMember.base.sequence,
      skillLevels: mkMaxSkllLvl(),
      traceNodes: mkMaxTrcNode(seed),
    },
    build: {
      weapon: mkMaxWpnMkSt(
          teamMember.build.weapon.id,
          teamMember.build.weapon.rank,
          teamMember.build.weapon.baseAtk,
      ),
      echoes: teamMember.build.echoes,
      team,
    },
    state: {
      controls: { ...teamMember.state.controls },
      manualBuffs: cloneBuffs(teamMember.state.manualBuffs),
      combat: { ...teamMember.state.combat },
    },
    rotation: mkDefRot(seed),
    teamRuntimes: [null, null],
  }
}

// create an optimizer context from a runtime snapshot
export function mkOptCtxFrom(
    runtime: ResRuntime,
    settings?: Partial<OptSets> | null,
): OptContext {
  return {
    resonatorId: runtime.id,
    runtime: cloneResRtSt(runtime),
    settings: cloneOptSets(settings),
  }
}

// clone an optimizer context safely
export function cloneOptCtxS(
    context?: OptContext | null,
): OptContext | null {
  if (!context) {
    return null
  }

  return {
    resonatorId: context.resonatorId,
    runtime: cloneResRtSt(context.runtime),
    settings: cloneOptSets(context.settings),
  }
}

// initialize calculator state with current defaults
function mkInitCalcSt(base?: CalcState): CalcState {
  const rtRvsn = Math.max(0, Math.floor(base?.runtimeRevision ?? 0))
  const profiles = structuredClone(base?.profiles ?? {})
  const invChs: InvEchoEnt[] = structuredClone(base?.inventoryEchoes ?? [])
  const invBlds: InventoryEntry[] = structuredClone(base?.inventoryBuilds ?? [])
  const invRttn: InvRotEnt[] = structuredClone(base?.inventoryRotations ?? [])
  const optimizer = cloneOptCtxS(base?.optimizerContext ?? null)
  const weaponSuggests: WeaponPlanSet = structuredClone(base?.weaponSuggests ?? mkDefWpnSug())

  const suggsByResId = Object.fromEntries(
      Object.entries(base?.suggestionsByResonatorId ?? {}).map(([resonatorId, state]) => [
        resonatorId,
        {
          settings: {
            ...mkDefSuggSet(),
            ...(state?.settings ?? {}),
          },
          random: {
            ...mkDefRandGnr(),
            ...(state?.random ?? {}),
            setPreferences: structuredClone(state?.random?.setPreferences ?? []),
          },
        },
      ]),
  )

  const session = base?.session
      ? {
        activeResonatorId: base.session.activeResonatorId,
        enemyProfile: cloneEnemyPr(base.session.enemyProfile),
      }
      : null

  const actResId = session?.activeResonatorId ?? DEF_RES_ID

  const nextSssn = session ?? {
    activeResonatorId: actResId,
    enemyProfile: makeEnemy(),
  }

  if (!nextSssn.activeResonatorId) {
    nextSssn.activeResonatorId = actResId
  }

  return {
    runtimeRevision: rtRvsn,
    profiles,
    inventoryEchoes: invChs,
    inventoryBuilds: invBlds,
    inventoryRotations: invRttn,
    optimizerContext: optimizer,
    weaponSuggests,
    suggestionsByResonatorId: suggsByResId,
    session: nextSssn,
  }
}

// initialize a loaded persisted app state
export function initAppState(
    state: PersistedUnknown,
): PersistedState {
  const rawUi = state.ui
  const themePref: ThemePref = state.ui.themePreference
    ?? (state.ui.theme === 'background' ? 'background' : 'system')

  return {
    ...state,
    version: APP_STATE_VER,
    ui: {
      ...rawUi,
      themePreference: themePref,
      backgroundImageKey: rawUi.backgroundImageKey ?? DEF_BG_KEY,
      backgroundTextMode: rawUi.backgroundTextMode ?? 'light',
      bodyFontName: rawUi.bodyFontName ?? DEF_BODY_FONT,
      bodyFontUrl: rawUi.bodyFontUrl ?? getPrstBodyF(rawUi.bodyFontName ?? DEF_BODY_FONT),
      optimizerCpuHintSeen: rawUi.optimizerCpuHintSeen ?? false,
      optimizerUseSprite: rawUi.optimizerUseSprite ?? true,
      preferences: rawUi.preferences ?? DEF_UI_PREFS,
      suggsViewMode: rawUi.suggsViewMode ?? 'mainStats',
      compactInv: rawUi.compactInv ?? false,
      seeEquipped: rawUi.seeEquipped ?? false,
      historyMax: rawUi.historyMax ?? 10,
      itemFreq: rawUi.itemFreq ?? mkDefPckrFre(),
      savedRotationPreferences: {
        ...mkDefSvdRotP(),
        ...rawUi.savedRotationPreferences,
      },
    },
    calculator: mkInitCalcSt(state.calculator),
  }
}

// create the full default app state
export function makeAppState(
    theme: ThemeMode = getSystTheme(),
    leftPaneView: LeftPaneView = 'resonators',
): PersistedState {
  return initAppState({
    version: APP_STATE_VER,
    ui: {
      theme,
      themePreference: 'background' === theme ? 'background' : 'system',
      lightVariant: LIGHT_THEMES[0],
      darkVariant: DARK_THEMES[0],
      backgroundVariant: BG_THEMES[0],
      backgroundImageKey: DEF_BG_KEY,
      backgroundTextMode: 'light',
      bodyFontName: DEF_BODY_FONT,
      bodyFontUrl: getPrstBodyF(DEF_BODY_FONT),
      blurMode: false,
      entranceAnimations: true,
      preferences: DEF_UI_PREFS,
      leftPaneView,
      suggsViewMode: 'mainStats',
      mainMode: 'default',
      showSubHits: false,
      compactInv: false,
      seeEquipped: true,
      haveHistory: true,
      historyMax: 10,
      itemFreq: mkDefPckrFre(),
      optimizerCpuHintSeen: false,
      optimizerUseSprite: true,
      savedRotationPreferences: mkDefSvdRotP(),
    },
    calculator: mkInitCalcSt(),
  })
}
