/*
  Author: Runor Ewhro
  Description: Provides default state factories and initialization helpers for
               resonators, teams, optimizer settings, and persisted app state.
*/

import {
  NONE_ENEMY_ID,
  type HydratedAppState,
  type LeftPaneView,
  type PersistedState,
  type LegacyProfileMap,
  type ThemeMode,
  type ThemePref,
  type EnemyProfile,
  type SimulationState,
  type UiState,
} from '@/domain/entities/appState'
import { DEF_UI_PREFS } from '@/domain/entities/preferences'
import type {
  SavedEcho,
  SavedBuild,
  SavedRotation,
  SavedScenario,
  SavedArtifactLibrary,
} from '@/domain/entities/inventoryStorage'
import {
  cloneRotationNodes,
  dedupeEchoUids,
  getEchoSignature,
  normalizeDuration,
  normalizeRotNote,
} from '@/domain/entities/inventoryStorage'
import type { OptSets } from '@/domain/entities/optimizer'
import type { CombatSession } from '@/domain/entities/session'
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
import { mkDefPckrFre, normalizePckrFreqState } from '@/engine/runtime/pickerFrequency'
import {
  DEF_BG_KEY,
  DEFAULT_BODY_FONT,
  getPresetFontUrl,
} from '@/domain/entities/appearance'
import { DEF_ENEMY_ID, DEF_ENEMY_PROF } from '@/domain/entities/enemy'
import type {
  ResRuntime,
  ResSeed,
  SkillLevels,
  TraceNodeBuffs,
  CombatState,
  RotationState,
  TeamSlots,
  TeamMemRt,
  TeamMemWpnVi,
  TeamMemRtVie,
  WeaponState,
  EchoInstance,
} from '@/domain/entities/runtime'
import type {
  ResProf,
  SlotLocalState,
  SlotRatingState,
} from '@/domain/entities/profile'
import {
  combatScenarioId,
  contextScenarioMember,
  makeScenarioTeam,
  teamMemberId,
  type CombatScenario,
  type EnvironmentManualEffect,
  type ScenarioTargetRouting,
  type ScenarioTeamMember,
  type TeamMemberId,
} from '@/domain/entities/combatScenario'
import {
  cloneOptInventorySelection,
  makeOptInventorySelection,
} from '@/domain/entities/profile'
import {
  makeCombatEnvironment,
  makeMemberManualEffect,
} from '@/engine/runtime/scenarioEnvironment'
import {
  scenarioIdForContextResonator,
  type ScenarioWorkspace,
} from '@/domain/entities/scenarioLibrary'

type LegacyCombatWorkspace = {
  currentScenario?: CombatScenario
}

type LegacyScenarioDocument = {
  id?: string
  name?: string
  createdAt?: number
  updatedAt?: number
  scenario: CombatScenario
}

type UnknownCombatWorkspace = Partial<ScenarioWorkspace> & {
  scenario?: CombatScenario
  documentsById?: Record<string, LegacyScenarioDocument>
}

type LegacyCalculatorState = Partial<SimulationState> & {
  runtimeRevision?: number
  profiles?: LegacyProfileMap
  inventoryEchoes?: SavedEcho[]
  inventoryBuilds?: SavedBuild[]
  inventoryRotations?: SavedRotation[]
  session?: CombatSession
  workspace?: LegacyCombatWorkspace
  optimizerContext?: {
    resonatorId?: string | null
    settings?: Partial<OptSets> | null
  } | null
}

export type PersistedUnknown = Omit<PersistedState, 'version' | 'ui' | 'simulation' | 'combat' | 'library'> & {
  version: number
  combat?: UnknownCombatWorkspace
  library?: Partial<SavedArtifactLibrary>
  simulation: LegacyCalculatorState
  ui: Omit<
    UiState,
    | 'themePreference'
    | 'historyMax'
    | 'itemFreq'
    | 'preferences'
    | 'suggsViewMode'
    | 'rotationEditorPreferences'
  > & {
    themePreference?: UiState['themePreference']
    historyMax?: UiState['historyMax']
    itemFreq?: UiState['itemFreq']
    preferences?: UiState['preferences']
    suggsViewMode?: UiState['suggsViewMode']
    rotationEditorPreferences?: UiState['rotationEditorPreferences']
  }
}
import type {
  ManualBuffs,
  MnlMod,
  QuickBuffs,
} from '@/domain/entities/manualBuffs'
import { NONE_WPN_ID } from '@/domain/entities/runtime'
import type { AttributeKey, BaseStatBuff, ModBuff } from '@/domain/entities/stats'
import { getResSeedBy, listResSds } from '@/data/catalog/resonatorSeedService'
import { getWpnById, listWpnsByTy } from '@/data/catalog/weaponCatalogService'
import type { RotationNode } from '@/domain/gameData/contracts'
import { migrateLegacyRotationItems } from '@/domain/gameData/loopPasses.ts'
import {
  normalizeFeatureAttachments,
  stripFeatureAttachments,
} from '@/domain/gameData/rotationAttached'
import { writeRtPath } from '@/domain/gameData/runtimePath'
import { normResRtCnt } from '@/engine/gameData/controlOptions'
import { normNegFfctC } from '@/engine/gameData/negativeEffects'
import { maxResRt } from '@/engine/gameData/resonatorMax'
import { initWpnStts, maxWpnRt } from '@/engine/runtime/sourceStateInit'
import { mkMaxTrcNode } from '@/engine/runtime/traceNodes'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import { getGameData, getKnownFeatureIds } from '@/data/gameData'
import { listResRttn, listStatesFor } from '@/data/catalog/gameDataService'
import { makeSourceKey } from '@/data/gameData/registry'
import { splitScopedTargetOwnerKey } from '@/domain/gameData/targetRouting'
import {
  cloneEnemyPr,
  cloneBuffs,
  cloneRotation,
  cloneSkllLvl,
  cloneTrcNode,
  cloneWpnMkSt,
} from '@/engine/runtime/runtimeCloning'
import {
  catTmWpnAtk,
  catWpnAtk,
} from '@/engine/runtime/weaponState'
import { APP_STATE_VER } from '@/domain/entities/appStateVersion'
import { makeDefaultRotationEditorPreferences } from '@/domain/entities/rotationEditorPreferences'
import {
  repairEchoLoadoutForCatalog,
  repairSavedEchoForCatalog,
} from '@/engine/runtime/echoCatalogRepair'
import {
  allOptSetIds,
  normOptSets,
} from '@/engine/optimizer/config/allowedSets'

import { DEF_RES_ID } from '@/data/gameData/constants'
export { DEF_RES_ID } from '@/data/gameData/constants'

export const MAX_RES_LVL = 90
export const MAX_SKILL_LEVEL = 10
export const MAX_WPN_LVL = 90

function getFallbackSeed(): ResSeed {
  const seed = getResSeedBy(DEF_RES_ID) ?? listResSds()[0]
  if (!seed) {
    throw new Error('Cannot initialize Simulation state without resonator game data.')
  }

  return seed
}

function hasSource(type: 'resonator' | 'weapon' | 'echo' | 'echoSet' | 'enemy', id: string | number | null | undefined): boolean {
  if (id == null || id === '') {
    return false
  }

  try {
    return Boolean(getGameData().sourcesByKey[makeSourceKey({ type, id: String(id) })])
  } catch {
    return false
  }
}

export function defaultSavedPrefs(): UiState['savedRotationPreferences'] {
  return {
    sortBy: 'date',
    sortOrder: 'desc',
    contributionFilter: 'unset',
    autoSearchActiveResonator: false,
    showLiveRotation: false,
    scaleToSelected: true,
  }
}

const ttrbKeys: AttributeKey[] = [
  'aero',
  'glacio',
  'spectro',
  'fusion',
  'electro',
  'havoc',
  'physical',
]

export function makeBaseBuff(): BaseStatBuff {
  return { percent: 0, flat: 0 }
}

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

export function makeCustomBuff(): ManualBuffs {
  return {
    quick: mkDefMnlQckB(),
    modifiers: [],
  }
}

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
    excludeEquipped: false,
    includeWeapons: false,
    statConstraints: {},
  }
}

export function mkDefSuggSet(): SuggSets {
  return {
    targetFeatureId: null,
    rotationMode: false,
  }
}

export function mkDefRandGnr(): RandGnrtSets {
  return {
    bias: 0.5,
    rollQuality: 0.3,
    targetEnergyRegen: 0,
    setPreferences: [],
    mainEchoId: null,
  }
}

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

export function makeSuggest(): SuggestState {
  return {
    settings: mkDefSuggSet(),
    random: mkDefRandGnr(),
  }
}

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

function normWeaponForSeed(
    seed: Pick<ResSeed, 'defaultWeaponId' | 'weaponType'>,
    weapon: Pick<WeaponState, 'id' | 'level' | 'rank'>,
): WeaponState {
  return weapon.id && getWpnById(weapon.id)
    ? catWpnAtk(weapon)
    : mkDefSeedWpnMkSt(seed)
}

function preserveWeaponForSeed(
    seed: Pick<ResSeed, 'defaultWeaponId' | 'weaponType'> | null,
    weapon: Pick<WeaponState, 'id' | 'level' | 'rank'> & Partial<Pick<WeaponState, 'baseAtk'>>,
): WeaponState {
  if (seed && weapon.id && getWpnById(weapon.id)) {
    return catWpnAtk(weapon)
  }

  return {
    id: weapon.id,
    level: weapon.level,
    rank: weapon.rank,
    baseAtk: weapon.baseAtk ?? 0,
  }
}

function preserveTeamWeaponForSeed(
    seed: Pick<ResSeed, 'defaultWeaponId' | 'weaponType'> | null,
    weapon: Pick<TeamMemWpnVi, 'id' | 'rank'> & Partial<Pick<TeamMemWpnVi, 'baseAtk'>>,
): TeamMemWpnVi {
  if (seed && weapon.id && getWpnById(weapon.id)) {
    return catTmWpnAtk(weapon, MAX_WPN_LVL)
  }

  return {
    id: weapon.id,
    rank: weapon.rank,
    baseAtk: weapon.baseAtk ?? 0,
  }
}

function isKnownCombatTarget(enemy: EnemyProfile): boolean {
  if (!enemy.id) {
    return false
  }

  // Custom targets and the unset/default placeholders are scenario-owned
  // identities, not effect-source packages.
  if (
    enemy.source === 'custom'
    || enemy.id === NONE_ENEMY_ID
    || enemy.id === DEF_ENEMY_ID
  ) {
    return true
  }

  if (hasSource('enemy', enemy.id)) {
    return true
  }

  // Most catalog enemies have no effect package, so sourcesByKey cannot be
  // used as catalog membership. Preserve numeric catalog ids and drop the
  // obviously unknown ones used by cross-catalog repair.
  return enemy.source === 'catalog' && /^\d+$/.test(enemy.id)
}

function normEnemyForCatalog(enemy: EnemyProfile | undefined): EnemyProfile {
  if (!enemy || !isKnownCombatTarget(enemy)) {
    return makeEnemy()
  }

  return cloneEnemyPr(enemy)
}

function getCatalogFeatureIds(): ReadonlySet<string> {
  try {
    return getKnownFeatureIds()
  } catch {
    return new Set()
  }
}

function normFeatureNodesForCatalog(
  nodes: RotationNode[],
  featureIds: ReadonlySet<string>,
): RotationNode[] {
  const hasFeatureId = (featureId: string): boolean => featureIds.has(featureId)
  const next: RotationNode[] = []

  for (const node of nodes) {
    if (node.type === 'feature') {
      if (!hasFeatureId(node.featureId)) {
        continue
      }
      const attachedFeatures = (node.attached?.features ?? [])
        .filter((feature) => feature.type === 'feature' && hasFeatureId(feature.featureId))
        .map(stripFeatureAttachments)
      const attachedConditions = (node.attached?.conditions ?? [])
        .filter((condition) => condition.type === 'condition')
      const sanitized = node.attached
        ? {
          ...node,
          attached: {
            conditions: attachedConditions,
            features: attachedFeatures,
          },
        }
        : node
      next.push(normalizeFeatureAttachments(sanitized))
      continue
    }

    if (node.type === 'repeat') {
      next.push({ ...node, items: normFeatureNodesForCatalog(node.items, featureIds) })
      continue
    }

    if (node.type === 'uptime') {
      next.push({
        ...node,
        items: normFeatureNodesForCatalog(node.items, featureIds),
        ...(node.setup ? { setup: normFeatureNodesForCatalog(node.setup, featureIds) } : {}),
      })
      continue
    }

    if (node.type === 'loop' && node.kind === 'start' && node.passForks) {
      next.push({
        ...node,
        passForks: Object.fromEntries(
          Object.entries(node.passForks).map(([run, body]) => [
            run,
            normFeatureNodesForCatalog(body, featureIds),
          ]),
        ),
      })
      continue
    }

    next.push(node)
  }

  return next
}

function normRotationForCatalog(rotation: RotationState): RotationState {
  const featureIds = getCatalogFeatureIds()
  return {
    ...rotation,
    sequence: normFeatureNodesForCatalog(migrateLegacyRotationItems(rotation.sequence), featureIds),
    program: normFeatureNodesForCatalog(migrateLegacyRotationItems(rotation.program), featureIds),
  }
}

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

export function mkDefSeedWpnMkSt(seed: Pick<ResSeed, 'defaultWeaponId' | 'weaponType'>): WeaponState {
  if (seed.defaultWeaponId) {
    return catWpnAtk({
      id: seed.defaultWeaponId,
      level: 1,
      rank: 1,
    })
  }

  return mkDefWpnMkSt(seed.weaponType)
}

export function mkMaxWpnMkSt(
    id: string | null = NONE_WPN_ID,
    rank = 1,
): WeaponState {
  return catWpnAtk({
    id,
    level: MAX_WPN_LVL,
    rank,
  })
}

export function mkDefTeamSlt(seed: ResSeed): TeamSlots {
  return [seed.id, null, null]
}

export function mkDefSlotLcl(): SlotLocalState {
  return {
    controls: {},
    manualBuffs: makeCustomBuff(),
    combat: makeCombatState(),
    setConditionals: cloneSntSet(DEF_SET_COND),
    optimizerInventory: makeOptInventorySelection(),
  }
}

export function mkDefSlotRtn(): SlotRatingState {
  return {
    selectedTargetsByOwnerKey: {},
  }
}

export function makeEnemy(): EnemyProfile {
  return cloneEnemyPr(DEF_ENEMY_PROF)
}

function getSeedStts(seed: ResSeed) {
  if (seed.states?.length) {
    return seed.states
  }

  return listStatesFor('resonator', seed.id)
}

export function mkDefRot(seed: ResSeed): RotationState {
  const defRot = seed.rotations?.[0] ?? listResRttn(seed.id)[0]
  const defaultItems = defRot?.items ?? []

  return cloneRotation({
    sequence: defaultItems,
    program: defaultItems,
    lastRanAt: null,
  })
}

export function makeResProfile(seed: ResSeed, options: { maxed?: boolean } = {}): ResProf {
  if (options.maxed) {
    const runtime = mkMaxResRt(seed)

    return {
      resonatorId: seed.id,
      runtime: {
        progression: {
          level: runtime.base.level,
          sequence: runtime.base.sequence,
          skillLevels: cloneSkllLvl(runtime.base.skillLevels),
          traceNodes: cloneTrcNode(runtime.base.traceNodes),
        },
        build: {
          weapon: cloneWpnMkSt(runtime.build.weapon),
          echoes: [...runtime.build.echoes],
        },
        local: {
          controls: { ...runtime.state.controls },
          manualBuffs: cloneBuffs(runtime.state.manualBuffs),
          combat: { ...runtime.state.combat },
          setConditionals: cloneSntSet(DEF_SET_COND),
          optimizerInventory: makeOptInventorySelection(),
        },
        routing: mkDefSlotRtn(),
        team: runtime.build.team,
        rotation: cloneRotation(runtime.rotation),
        teamRuntimes: runtime.teamRuntimes,
      },
    }
  }

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
        weapon: mkDefSeedWpnMkSt(seed),
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

function applySttDflt(seed: ResSeed, runtime: ResRuntime): ResRuntime {
  return getSeedStts(seed).reduce((nextRuntime, state) => {
    if (state.defaultValue === undefined) {
      return nextRuntime
    }

    return writeRtPath(nextRuntime, state.path, state.defaultValue)
  }, runtime)
}

export function applySeedStt(
    seed: ResSeed,
    localState: SlotLocalState,
): SlotLocalState {
  const nextLclStt: SlotLocalState = {
    controls: { ...localState.controls },
    manualBuffs: cloneBuffs(localState.manualBuffs),
    combat: { ...localState.combat },
    setConditionals: cloneSntSet(localState.setConditionals),
    optimizerInventory: cloneOptInventorySelection(localState.optimizerInventory),
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

export function cloneSlotRml(routing?: SlotRatingState): SlotRatingState {
  return {
    selectedTargetsByOwnerKey: {
      ...(routing?.selectedTargetsByOwnerKey ?? {}),
    },
  }
}

export function normProfTeam(
    actResId: string,
    team: TeamSlots,
): TeamSlots {
  const nextTeam1Id = team[1] && team[1] !== actResId && getResSeedBy(team[1]) ? team[1] : null
  const nextTeam2Cand = team[2] && team[2] !== actResId && getResSeedBy(team[2]) ? team[2] : null
  const nextTeam2Id = nextTeam2Cand && nextTeam2Cand !== nextTeam1Id ? nextTeam2Cand : null

  return [actResId, nextTeam1Id, nextTeam2Id]
}

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
      weapon: mkDefSeedWpnMkSt(seed),
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

  return initWpnStts(applySttDflt(seed, baseRuntime), {
    maxed: false,
  })
}

export function mkMaxResRt(seed: ResSeed, targetSequence = 0): ResRuntime {
  return maxRtInit(makeResRuntime(seed), targetSequence)
}

export function maxRtInit(runtime: ResRuntime, targetSequence = 0): ResRuntime {
  return maxWpnRt(
    maxResRt(
      runtime,
      getResDtlsBy()[runtime.id],
      { targetSequence },
    ),
    { targetRank: 1 },
  )
}

export function mkDefTeamMem(seed: ResSeed): TeamMemRtVie {
  const baseRuntime: TeamMemRtVie = {
    id: seed.id,
    base: {
      sequence: 0,
    },
    build: {
      weapon: catTmWpnAtk(mkDefSeedWpnMkSt(seed), MAX_WPN_LVL),
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

export function makeTeamMember(seed: ResSeed): TeamMemRt {
  const weapon = mkDefSeedWpnMkSt(seed)

  return {
    id: seed.id,
    base: {
      sequence: 0,
    },
    build: {
      weapon: catTmWpnAtk(weapon, MAX_WPN_LVL),
      echoes: [null, null, null, null, null],
    },
    manualBuffs: makeCustomBuff(),
  }
}

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
      weapon: mkMaxWpnMkSt(teamMember.build.weapon.id, teamMember.build.weapon.rank),
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

function relinkEquippedEchoUids(
    profiles: LegacyProfileMap,
    inventoryEchoes: SavedEcho[],
): LegacyProfileMap {
  if (inventoryEchoes.length === 0) {
    return profiles
  }

  const invByUid = new Map<string, EchoInstance>()
  const invBySig = new Map<string, EchoInstance>()
  for (const entry of inventoryEchoes) {
    invByUid.set(entry.echo.uid, entry.echo)
    const sig = getEchoSignature(entry.echo)
    if (!invBySig.has(sig)) {
      invBySig.set(sig, entry.echo)
    }
  }

  let changed = false
  const nextProfiles = Object.fromEntries(
      Object.entries(profiles).map(([resonatorId, profile]) => {
        let profileChanged = false
        const nextEchoes = profile.runtime.build.echoes.map((echo) => {
          if (!echo) {
            return echo
          }

          const sig = getEchoSignature(echo)
          const currentInvEcho = invByUid.get(echo.uid)
          if (currentInvEcho && getEchoSignature(currentInvEcho) === sig) {
            return echo
          }

          const exactInvEcho = invBySig.get(sig)
          if (!exactInvEcho || exactInvEcho.uid === echo.uid) {
            return echo
          }

          profileChanged = true
          changed = true
          return { ...echo, uid: exactInvEcho.uid }
        })

        if (!profileChanged) {
          return [resonatorId, profile]
        }

        return [
          resonatorId,
          {
            ...profile,
            runtime: {
              ...profile.runtime,
              build: {
                ...profile.runtime.build,
                echoes: nextEchoes,
              },
            },
          },
        ]
      }),
  )

  return changed ? nextProfiles : profiles
}

function legacyMemberControls(
  controls: Record<string, boolean | number | string>,
  resonatorId: string,
  primary: boolean,
): Record<string, boolean | number | string> {
  if (primary) {
    const ownTeamPrefix = `team:${resonatorId}:`
    return Object.fromEntries(
      Object.entries(controls).filter(([key]) => (
        !key.startsWith('team:') || key.startsWith(ownTeamPrefix)
      )),
    )
  }

  const prefix = `team:${resonatorId}:`
  return Object.fromEntries(
    Object.entries(controls)
      .filter(([key]) => key.startsWith(prefix) && !key.startsWith(`${prefix}__mb:`))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  )
}

function profileScenarioMember(
  profile: ResProf,
  controls: Record<string, boolean | number | string>,
): ScenarioTeamMember {
  const seed = getResSeedBy(profile.resonatorId)
  return {
    id: teamMemberId(profile.resonatorId),
    resonatorId: profile.resonatorId,
    progression: {
      level: profile.runtime.progression.level,
      sequence: profile.runtime.progression.sequence,
      skillLevels: cloneSkllLvl(profile.runtime.progression.skillLevels),
      traceNodes: cloneTrcNode(profile.runtime.progression.traceNodes),
    },
    loadout: {
      weapon: seed
        ? normWeaponForSeed(seed, profile.runtime.build.weapon)
        : cloneWpnMkSt(profile.runtime.build.weapon),
      echoes: repairEchoLoadoutForCatalog(profile.runtime.build.echoes),
    },
    local: {
      controls,
      setConditionals: cloneSntSet(profile.runtime.local.setConditionals),
      optimizerInventory: cloneOptInventorySelection(profile.runtime.local.optimizerInventory),
    },
  }
}

export function makeScenarioMemberFromProfile(profile: ResProf): ScenarioTeamMember {
  return profileScenarioMember(
    profile,
    legacyMemberControls(profile.runtime.local.controls, profile.resonatorId, true),
  )
}

function compactScenarioMember(
  compact: TeamMemRt,
  activeProfile: ResProf,
): ScenarioTeamMember | null {
  const seed = getResSeedBy(compact.id)
  if (!seed) return null

  const weapon = compact.build.weapon.id && getWpnById(compact.build.weapon.id)
    ? compact.build.weapon
    : mkDefSeedWpnMkSt(seed)

  return {
    id: teamMemberId(seed.id),
    resonatorId: seed.id,
    progression: {
      level: MAX_RES_LVL,
      sequence: compact.base.sequence,
      skillLevels: mkMaxSkllLvl(),
      traceNodes: mkMaxTrcNode(seed),
    },
    loadout: {
      weapon: {
        ...catTmWpnAtk(weapon, MAX_WPN_LVL),
        level: MAX_WPN_LVL,
      },
      echoes: repairEchoLoadoutForCatalog(compact.build.echoes),
    },
    local: {
      controls: legacyMemberControls(activeProfile.runtime.local.controls, seed.id, false),
      setConditionals: cloneSntSet(DEF_SET_COND),
      optimizerInventory: makeOptInventorySelection(),
    },
  }
}

function legacyScenarioRouting(
  profile: ResProf,
  members: readonly ScenarioTeamMember[],
): ScenarioTargetRouting {
  const primary = members[0]
  const memberByResonatorId = new Map(
    members.map((member) => [member.resonatorId, member]),
  )
  const bySourceMemberId = Object.fromEntries(
    members.map((member) => [member.id, {}]),
  ) as Record<TeamMemberId, Record<string, TeamMemberId | null>>

  for (const [routeKey, targetResonatorId] of Object.entries(
    profile.runtime.routing.selectedTargetsByOwnerKey,
  )) {
    const split = splitScopedTargetOwnerKey(routeKey)
    const source = split.sourceRuntimeId
      ? memberByResonatorId.get(split.sourceRuntimeId)
      : primary
    if (!source) continue
    const target = targetResonatorId
      ? memberByResonatorId.get(targetResonatorId) ?? null
      : null
    if (targetResonatorId && !target) continue
    bySourceMemberId[source.id][split.ownerKey] = target?.id ?? null
  }

  return { bySourceMemberId }
}

export function makeScenarioFromProfiles(
  profiles: LegacyProfileMap,
  session: CombatSession | null | undefined,
  revision: number,
  activeOverride?: string | null,
): CombatScenario {
  const fallbackSeed = getFallbackSeed()
  const requestedActive = activeOverride ?? session?.activeResonatorId
  const activeId = requestedActive && profiles[requestedActive] && getResSeedBy(requestedActive)
    ? requestedActive
    : Object.keys(profiles).find((id) => Boolean(getResSeedBy(id))) ?? fallbackSeed.id
  const activeProfile = profiles[activeId]
    ?? makeResProfile(getResSeedBy(activeId) ?? fallbackSeed)
  const primary = profileScenarioMember(
    activeProfile,
    legacyMemberControls(activeProfile.runtime.local.controls, activeProfile.resonatorId, true),
  )
  const members = [
    primary,
    ...activeProfile.runtime.teamRuntimes.flatMap((compact) => {
      if (!compact || compact.id === primary.resonatorId) return []
      const member = compactScenarioMember(compact, activeProfile)
      return member ? [member] : []
    }),
  ].slice(0, 3)
  const team = makeScenarioTeam(members)
  const manualBuffsByResonatorId = new Map<string, ManualBuffs>([
    [activeProfile.resonatorId, activeProfile.runtime.local.manualBuffs],
    ...activeProfile.runtime.teamRuntimes.flatMap((compact) => compact
      ? [[compact.id, compact.manualBuffs ?? makeCustomBuff()] as const]
      : []),
  ])
  const routing = legacyScenarioRouting(activeProfile, team.members)

  return {
    id: combatScenarioId('workspace'),
    revision,
    team,
    contextMemberId: team.members[0].id,
    target: normEnemyForCatalog(session?.enemyProfile ?? makeEnemy()),
    environment: makeCombatEnvironment(
      activeProfile.runtime.local.combat,
      routing,
      team.members.map((member) => makeMemberManualEffect(
        member.id,
        manualBuffsByResonatorId.get(member.resonatorId) ?? makeCustomBuff(),
      )),
    ),
    program: cloneRotation(activeProfile.runtime.rotation),
    initialOnFieldMemberId: team.members[0].id,
  }
}

function normalizeScenario(
  scenario: CombatScenario,
  fallback: CombatScenario,
  revision: number,
): CombatScenario {
  const members = scenario.team?.members?.flatMap((member) => {
    const seed = getResSeedBy(member.resonatorId)
    if (!seed) return []
    return [{
      ...member,
      id: teamMemberId(String(member.id || member.resonatorId)),
      resonatorId: seed.id,
      progression: {
        ...member.progression,
        skillLevels: cloneSkllLvl(member.progression.skillLevels),
        traceNodes: cloneTrcNode(member.progression.traceNodes),
      },
      loadout: {
        weapon: preserveWeaponForSeed(seed, member.loadout.weapon),
        echoes: repairEchoLoadoutForCatalog(member.loadout.echoes),
      },
      local: {
        controls: { ...member.local.controls },
        setConditionals: cloneSntSet(member.local.setConditionals),
        optimizerInventory: cloneOptInventorySelection(member.local.optimizerInventory),
      },
    } satisfies ScenarioTeamMember]
  }) ?? []
  if (members.length === 0) return fallback

  const team = makeScenarioTeam(members.slice(0, 3))
  const ids = new Set(team.members.map((member) => member.id))
  const bySourceMemberId = Object.fromEntries(team.members.map((member) => {
    const routes = scenario.environment?.routing?.bySourceMemberId?.[member.id] ?? {}
    return [member.id, Object.fromEntries(
      Object.entries(routes).filter(([, target]) => target === null || ids.has(target)),
    )]
  })) as Record<TeamMemberId, Record<string, TeamMemberId | null>>

  return {
    ...scenario,
    id: combatScenarioId(String(scenario.id || 'workspace')),
    revision: Math.max(revision, Math.floor(scenario.revision ?? 0)),
    team,
    contextMemberId: ids.has(scenario.contextMemberId)
      ? scenario.contextMemberId
      : team.members[0].id,
    target: normEnemyForCatalog(scenario.target ?? fallback.target),
    environment: {
      ...fallback.environment,
      ...(scenario.environment ?? {}),
      combatState: {
        ...fallback.environment.combatState,
        ...(scenario.environment?.combatState ?? {}),
      },
      manualEffects: scenario.environment?.manualEffects?.flatMap(
        (effect): EnvironmentManualEffect[] => {
          if (effect.selector.kind !== 'members') {
            return [{
              ...effect,
              selector: structuredClone(effect.selector),
              buffs: cloneBuffs(effect.buffs),
            }]
          }
          const memberIds = effect.selector.memberIds.filter((id) => ids.has(id))
          return memberIds.length > 0
            ? [{
              ...effect,
              selector: { ...effect.selector, memberIds },
              buffs: cloneBuffs(effect.buffs),
            }]
            : []
        },
      ) ?? fallback.environment.manualEffects,
      targetModifiers: {
        ...fallback.environment.targetModifiers,
        ...(scenario.environment?.targetModifiers ?? {}),
        resistanceReduction: {
          ...fallback.environment.targetModifiers.resistanceReduction,
          ...(scenario.environment?.targetModifiers?.resistanceReduction ?? {}),
        },
      },
      routing: { bySourceMemberId },
    },
    program: normRotationForCatalog(scenario.program ?? fallback.program),
    initialOnFieldMemberId: ids.has(scenario.initialOnFieldMemberId)
      ? scenario.initialOnFieldMemberId
      : team.members[0].id,
  }
}

export function normalizeStoredCombatScenario(scenario: CombatScenario): CombatScenario {
  return normalizeScenario(scenario, scenario, scenario.revision ?? 0)
}

interface InitializedData {
  simulation: SimulationState
  library: SavedArtifactLibrary
  profiles: LegacyProfileMap
  runtimeRevision: number
}

// Legacy calculator payloads mixed workspace state with saved artifacts.
function mkInitData(
  base?: PersistedUnknown['simulation'],
  saved?: PersistedUnknown['library'],
): InitializedData {
  const runtimeRevision = Math.max(0, Math.floor(base?.runtimeRevision ?? 0))
  const baseProfiles = normProfsCat(structuredClone(base?.profiles ?? {}))
  // Equipped echoes reserve their uids before inventory duplicates are repaired,
  // preserving references from loadouts into the saved inventory.
  const invChs: SavedEcho[] = dedupeEchoUids(
    structuredClone(saved?.echoes ?? base?.inventoryEchoes ?? []).map((entry) => ({
      ...entry,
      echo: repairSavedEchoForCatalog(entry.echo),
    })),
    Object.values(baseProfiles).flatMap((profile) => profile.runtime.build.echoes),
  )
  const profiles = relinkEquippedEchoUids(baseProfiles, invChs)
  const invBlds: SavedBuild[] = normBldsCat(structuredClone(saved?.builds ?? base?.inventoryBuilds ?? []))
  const invRttn: SavedRotation[] = normRotsCat(structuredClone(saved?.rotations ?? base?.inventoryRotations ?? []))
  const invScenarios: SavedScenario[] = normScenariosCat(structuredClone(saved?.scenarios ?? []))
  const optimizerSettings = cloneOptSets(
    base?.optimizerSettings ?? base?.optimizerContext?.settings ?? null,
  )
  const optimizerSettingsResonatorId =
    base?.optimizerSettingsResonatorId
    ?? base?.optimizerContext?.resonatorId
    ?? null
  const weaponSuggests: WeaponPlanSet = structuredClone(base?.weaponSuggests ?? mkDefWpnSug())

  const suggsByResId = Object.fromEntries(
      Object.entries(base?.suggestionsByResonatorId ?? {}).map(([resonatorId, state]) => [
        resonatorId,
        structuredClone(state),
      ]),
  )

  return {
    runtimeRevision,
    profiles,
    simulation: {
      optimizerSettingsResonatorId,
      optimizerSettings,
      weaponSuggests,
      suggestionsByResonatorId: suggsByResId,
    },
    library: {
      echoes: invChs,
      builds: invBlds,
      rotations: invRttn,
      scenarios: invScenarios,
    },
  }
}

function normTmCat(teamMember: TeamMemRt): TeamMemRt {
  const seed = getResSeedBy(teamMember.id)

  return {
    ...teamMember,
    id: seed?.id ?? teamMember.id,
    build: {
      ...teamMember.build,
      weapon: preserveTeamWeaponForSeed(seed ?? null, teamMember.build.weapon),
      echoes: repairEchoLoadoutForCatalog(teamMember.build.echoes),
    },
  }
}

function xtrNsCtrls(
  controls: Record<string, boolean | number | string>,
  prefix: string,
): Record<string, boolean | number | string> {
  const scoped: Record<string, boolean | number | string> = {}

  for (const [key, value] of Object.entries(controls)) {
    if (key.startsWith(prefix)) {
      scoped[key.slice(prefix.length)] = value
    }
  }

  return scoped
}

function normTmNsCtrls(
  runtime: ResRuntime,
  controls: Record<string, boolean | number | string>,
): Record<string, boolean | number | string> {
  let nextControls = controls

  for (const teamMember of runtime.teamRuntimes) {
    if (!teamMember) {
      continue
    }

    const seed = getResSeedBy(teamMember.id)
    if (!seed) {
      continue
    }

    const prefix = `team:${teamMember.id}:`
    const teamControls = xtrNsCtrls(nextControls, prefix)
    const teamRuntime: ResRuntime = {
      id: teamMember.id,
      base: {
        level: MAX_RES_LVL,
        sequence: teamMember.base.sequence,
        skillLevels: mkMaxSkllLvl(),
        traceNodes: mkMaxTrcNode(seed),
      },
      build: {
        weapon: {
          ...catTmWpnAtk(teamMember.build.weapon, MAX_WPN_LVL),
          level: MAX_WPN_LVL,
        },
        echoes: teamMember.build.echoes,
        team: runtime.build.team,
      },
      state: {
        controls: teamControls,
        manualBuffs: cloneBuffs(teamMember.manualBuffs ?? makeCustomBuff()),
        combat: runtime.state.combat,
      },
      rotation: mkDefRot(seed),
      teamRuntimes: [null, null],
    }
    const normControls = normResRtCnt(teamRuntime)

    nextControls = { ...nextControls }
    for (const [key, value] of Object.entries(normControls)) {
      nextControls[`${prefix}${key}`] = value
    }
  }

  return nextControls
}

function normPrfLcl(
  resonatorId: string,
  profile: ResProf,
  localState: SlotLocalState,
  team: TeamSlots,
  teamRuntimes: [TeamMemRt | null, TeamMemRt | null],
): SlotLocalState {
  const seed = getResSeedBy(resonatorId) ?? getFallbackSeed()
  const runtime: ResRuntime = {
    id: resonatorId,
    base: profile.runtime.progression,
    build: {
      weapon: normWeaponForSeed(seed, profile.runtime.build.weapon),
      echoes: repairEchoLoadoutForCatalog(profile.runtime.build.echoes),
      team,
    },
    state: {
      controls: { ...localState.controls },
      manualBuffs: cloneBuffs(localState.manualBuffs),
      combat: { ...localState.combat },
    },
    rotation: profile.runtime.rotation,
    teamRuntimes,
  }
  const controls = normTmNsCtrls(runtime, normResRtCnt(runtime))
  const normRuntime = {
    ...runtime,
    state: {
      ...runtime.state,
      controls,
    },
  }

  return {
    ...localState,
    controls,
    combat: normNegFfctC(normRuntime),
    setConditionals: cloneSntSet(localState.setConditionals),
    optimizerInventory: cloneOptInventorySelection(localState.optimizerInventory),
  }
}

function normProfCat(
  resonatorId: string,
  profile: ResProf,
): ResProf {
  const seed = getResSeedBy(profile.resonatorId ?? resonatorId)
  const profileId = seed?.id ?? profile.resonatorId ?? resonatorId
  const teamRuntimes: [TeamMemRt | null, TeamMemRt | null] = [
    profile.runtime.teamRuntimes?.[0] ? normTmCat(profile.runtime.teamRuntimes[0]) : null,
    profile.runtime.teamRuntimes?.[1] ? normTmCat(profile.runtime.teamRuntimes[1]) : null,
  ]
  const team = [...profile.runtime.team] as TeamSlots

  return {
    ...profile,
    resonatorId: profileId,
    runtime: {
      ...profile.runtime,
      build: {
        ...profile.runtime.build,
        weapon: preserveWeaponForSeed(seed ?? null, profile.runtime.build.weapon),
        echoes: repairEchoLoadoutForCatalog(profile.runtime.build.echoes),
      },
      local: seed
        ? normPrfLcl(profileId, profile, profile.runtime.local, normProfTeam(profileId, profile.runtime.team), [
          teamRuntimes[0] && getResSeedBy(teamRuntimes[0].id) ? teamRuntimes[0] : null,
          teamRuntimes[1] && getResSeedBy(teamRuntimes[1].id) ? teamRuntimes[1] : null,
        ])
        : {
          ...profile.runtime.local,
          optimizerInventory: cloneOptInventorySelection(profile.runtime.local.optimizerInventory),
        },
      routing: cloneSlotRml(profile.runtime.routing),
      team,
      rotation: cloneRotation(profile.runtime.rotation),
      teamRuntimes,
    },
  }
}

function normProfsCat(profiles: LegacyProfileMap): LegacyProfileMap {
  return Object.fromEntries(
      Object.entries(profiles).map(([resonatorId, profile]) => {
        const normalized = normProfCat(resonatorId, profile)
        return [normalized.resonatorId || resonatorId, normalized]
      }),
  )
}

function catResName(
  resonatorId: string | null | undefined,
  fallback = '',
): string {
  if (!resonatorId) {
    return fallback
  }

  return getResSeedBy(resonatorId)?.name ?? (fallback || resonatorId)
}

function normBldsCat(builds: SavedBuild[]): SavedBuild[] {
  return builds.map((entry) => {
    const seed = getResSeedBy(entry.resonatorId)

    return {
      ...entry,
      resonatorName: catResName(entry.resonatorId, entry.resonatorName),
      build: {
        ...entry.build,
        weapon: preserveWeaponForSeed(seed ?? null, entry.build.weapon),
        echoes: repairEchoLoadoutForCatalog(entry.build.echoes),
      },
    }
  })
}

type LegacySavedRotation = {
  id: string
  name: string
  resonatorId?: string
  duration?: number
  note?: string
  items?: RotationNode[]
  scenario?: CombatScenario
  snapshot?: ResProf
  migration?: SavedRotation['migration']
  createdAt: number
  updatedAt: number
}

function savedRotationFallbackScenario(entry: LegacySavedRotation): CombatScenario {
  const scenarioContextId = entry.scenario?.team.members[0]?.resonatorId
  const requestedId = entry.resonatorId ?? scenarioContextId
  const seed = getResSeedBy(requestedId ?? '') ?? getFallbackSeed()
  const profile = entry.snapshot
    ? normProfCat(entry.snapshot.resonatorId, entry.snapshot)
    : makeResProfile(seed)
  return makeScenarioFromProfiles(
    { [profile.resonatorId]: profile },
    null,
    entry.scenario?.revision ?? 0,
    profile.resonatorId,
  )
}

/** Normalizes all legacy saved-rotation shapes into scenario-backed artifacts. */
function normRotsCat(rotations: LegacySavedRotation[]): SavedRotation[] {
  return rotations.map((entry) => {
    const fallback = savedRotationFallbackScenario(entry)
    const scenario = entry.scenario
      ? normalizeScenario(entry.scenario, fallback, entry.scenario.revision)
      : {
        ...fallback,
        id: combatScenarioId(`saved-rotation:${entry.id}`),
        program: {
          ...fallback.program,
          program: cloneRotationNodes(entry.items ?? []),
        },
      }

    return {
      id: entry.id,
      name: entry.name,
      duration: normalizeDuration(entry.duration),
      note: normalizeRotNote(entry.note),
      scenario: structuredClone(scenario),
      ...(entry.migration ? { migration: { ...entry.migration } } : {}),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
  })
}

function normScenariosCat(entries: SavedScenario[]): SavedScenario[] {
  return entries.map((entry) => {
    const context = entry.scenario.team.members.find(
      (member) => member.id === entry.scenario.contextMemberId,
    ) ?? entry.scenario.team.members[0]
    const seed = getResSeedBy(context.resonatorId) ?? getFallbackSeed()
    const fallback = makeScenarioFromProfiles(
      { [seed.id]: makeResProfile(seed) },
      null,
      entry.scenario.revision,
      seed.id,
    )
    return {
      ...entry,
      name: entry.name.trim() || `${seed.name} Scenario`,
      note: normalizeRotNote(entry.note),
      scenario: structuredClone(normalizeScenario(
        entry.scenario,
        fallback,
        entry.scenario.revision,
      )),
    }
  })
}

export function initAppState(
    state: PersistedUnknown,
): HydratedAppState {
  const rawUi = state.ui
  const initialized = mkInitData(state.simulation, state.library)
  const { simulation, library, profiles, runtimeRevision } = initialized
  const legacyScenario = makeScenarioFromProfiles(
    profiles,
    state.simulation.session,
    runtimeRevision,
  )
  const storedScenario = state.combat?.scenario
    ?? state.simulation.workspace?.currentScenario
  const scenario = storedScenario
    ? normalizeScenario(storedScenario, legacyScenario, runtimeRevision)
    : legacyScenario
  const storedScenarios = state.combat?.scenariosById
    ?? Object.fromEntries(Object.entries(state.combat?.documentsById ?? {}).map(
      ([id, document]) => [id, document.scenario],
    ))
  const normalizedScenarios = Object.fromEntries(Object.entries(storedScenarios).map(([id, candidate]) => {
    const scenarioId = combatScenarioId(id)
    const normalized = normalizeScenario(candidate, scenario, runtimeRevision)
    return [scenarioId, { ...normalized, id: scenarioId }]
  })) as ScenarioWorkspace['scenariosById']
  const selectedStoredId = state.combat?.selectedScenarioId
  const selectedStored = selectedStoredId ? normalizedScenarios[selectedStoredId] : null
  const selectedScenario = selectedStored ?? scenario
  const selectedId = selectedStored?.id ?? selectedScenario.id
  normalizedScenarios[selectedId] = selectedScenario

  const sourceOrder = [
    ...(state.combat?.order ?? []),
    ...Object.keys(normalizedScenarios).map(combatScenarioId),
  ].filter((id, index, values) => values.indexOf(id) === index && Boolean(normalizedScenarios[id]))
  const selectedContextId = contextScenarioMember(selectedScenario).resonatorId
  const contextIds = new Set<string>()
  const order = sourceOrder.filter((id) => {
    const candidate = normalizedScenarios[id]
    if (!candidate) return false
    const contextId = contextScenarioMember(candidate).resonatorId
    if (contextId === selectedContextId && id !== selectedId) return false
    if (contextIds.has(contextId)) return false
    contextIds.add(contextId)
    return true
  })
  if (!order.includes(selectedId)) order.unshift(selectedId)

  let combat: ScenarioWorkspace = {
    selectedScenarioId: selectedId,
    order,
    scenariosById: Object.fromEntries(order.map((id) => [id, normalizedScenarios[id]])),
  }

  for (const profile of Object.values(profiles)) {
    if (scenarioIdForContextResonator(combat, profile.resonatorId)) continue
    const id = combatScenarioId(`legacy:${profile.resonatorId}`)
    const migrated = {
      ...makeScenarioFromProfiles(
        profiles,
        { activeResonatorId: profile.resonatorId, enemyProfile: selectedScenario.target },
        runtimeRevision,
        profile.resonatorId,
      ),
      id,
    }
    combat = {
      ...combat,
      order: [...combat.order, id],
      scenariosById: { ...combat.scenariosById, [id]: migrated },
    }
  }
  const themePref: ThemePref = state.ui.themePreference
    ?? (state.ui.theme === 'background' ? 'background' : 'system')

  return {
    version: APP_STATE_VER,
    ui: {
      ...rawUi,
      themePreference: themePref,
      backgroundImageKey: rawUi.backgroundImageKey ?? DEF_BG_KEY,
      backgroundTextMode: rawUi.backgroundTextMode ?? 'light',
      bodyFontName: rawUi.bodyFontName ?? DEFAULT_BODY_FONT,
      bodyFontUrl: rawUi.bodyFontUrl ?? getPresetFontUrl(rawUi.bodyFontName ?? DEFAULT_BODY_FONT),
      optimizerCpuHintSeen: rawUi.optimizerCpuHintSeen ?? false,
      optimizerUseSprite: rawUi.optimizerUseSprite ?? true,
      compressedExports: rawUi.compressedExports ?? true,
      rotationEditorPreferences: {
        ...makeDefaultRotationEditorPreferences(),
        ...rawUi.rotationEditorPreferences,
        statKeys: rawUi.rotationEditorPreferences?.statKeys
          ? [...rawUi.rotationEditorPreferences.statKeys]
          : makeDefaultRotationEditorPreferences().statKeys,
        groupOrder: rawUi.rotationEditorPreferences?.groupOrder
          ? [...rawUi.rotationEditorPreferences.groupOrder]
          : makeDefaultRotationEditorPreferences().groupOrder,
      },
      preferences: {
        ...DEF_UI_PREFS,
        ...(rawUi.preferences ?? {}),
      },
      suggsViewMode: rawUi.suggsViewMode ?? 'mainStats',
      compactInv: rawUi.compactInv ?? false,
      groupInv: rawUi.groupInv ?? false,
      seeEquipped: rawUi.seeEquipped ?? false,
      historyMax: rawUi.historyMax ?? 10,
      itemFreq: normalizePckrFreqState(rawUi.itemFreq),
      savedRotationPreferences: {
        ...defaultSavedPrefs(),
        ...rawUi.savedRotationPreferences,
      },
    },
    combat,
    library,
    simulation: {
      ...simulation,
      // v28 snapshots predate the owner key. Their one settings object belongs
      // to the scenario that was selected when the snapshot was written.
      optimizerSettingsResonatorId:
        simulation.optimizerSettingsResonatorId ?? selectedContextId,
    },
  }
}

export function makeAppState(
    theme: ThemeMode = 'dark',
    leftPaneView: LeftPaneView = 'resonators',
): HydratedAppState {
  const seed = getFallbackSeed()
  const scenario = makeScenarioFromProfiles(
    { [seed.id]: makeResProfile(seed, { maxed: DEF_UI_PREFS.maxResOnInit }) },
    null,
    0,
    seed.id,
  )

  return initAppState({
    version: APP_STATE_VER,
    combat: {
      selectedScenarioId: scenario.id,
      order: [scenario.id],
      scenariosById: { [scenario.id]: scenario },
    },
    ui: {
      theme,
      themePreference: 'background' === theme ? 'background' : 'dark',
      lightVariant: LIGHT_THEMES[0],
      darkVariant: DARK_THEMES[0],
      backgroundVariant: BG_THEMES[0],
      backgroundImageKey: DEF_BG_KEY,
      backgroundTextMode: 'dark',
      bodyFontName: DEFAULT_BODY_FONT,
      bodyFontUrl: getPresetFontUrl(DEFAULT_BODY_FONT),
      blurMode: false,
      entranceAnimations: true,
      preferences: DEF_UI_PREFS,
      leftPaneView,
      suggsViewMode: 'mainStats',
      showSubHits: false,
      compactInv: false,
      groupInv: false,
      seeEquipped: true,
      haveHistory: true,
      historyMax: 10,
      itemFreq: mkDefPckrFre(),
      optimizerCpuHintSeen: false,
      optimizerUseSprite: true,
      compressedExports: true,
      rotationEditorPreferences: makeDefaultRotationEditorPreferences(),
      savedRotationPreferences: defaultSavedPrefs(),
    },
    simulation: {},
  })
}
