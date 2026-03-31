import type { PersistedAppState, UiState } from '@/domain/entities/appState'
import type { InventoryBuildEntry, InventoryEchoEntry } from '@/domain/entities/inventoryStorage'
import type { ManualBuffs, ManualModifier } from '@/domain/entities/manualBuffs'
import type { ResonatorProfile } from '@/domain/entities/profile'
import type { TeamMemberRuntime, TeamSlots, TraceNodeBuffs, WeaponBuildState } from '@/domain/entities/runtime'
import type { AttributeKey, SkillTypeKey } from '@/domain/entities/stats'
import { createDefaultAppState, createDefaultResonatorProfile, createDefaultResonatorSuggestionsState, makeDefaultCustomBuffs, makeDefaultEnemyProfile, makeDefaultTeamMemberRuntime, makeDefaultTraceNodeBuffs, normalizeProfileTeam } from '@/domain/state/defaults'
import { initializePersistedAppState } from '@/domain/state/defaults'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { convertLegacyEchoList } from './echoes'
import {
  clampNumber,
  coerceBoolean,
  coerceNumber,
  coerceString,
  extractLegacyAppBackupPayload,
  isRecord,
  parseLegacyAppBackupJson,
  pushIssue,
  toStableId,
  type JsonRecord,
  type LegacyAppStateImportResult,
  type LegacyImportIssue,
  type LegacyImportReport,
} from './shared'

const LEGACY_TO_CURRENT_LEFT_PANE: Record<string, UiState['leftPaneView']> = {
  characters: 'resonators',
  resonators: 'resonators',
  buffs: 'buffs',
  echoes: 'echoes',
  enemy: 'enemy',
  enemies: 'enemy',
  weapon: 'weapon',
  teams: 'teams',
  rotations: 'rotations',
  suggestions: 'suggestions',
}

const ATTRIBUTE_KEYS: AttributeKey[] = [
  'aero',
  'glacio',
  'spectro',
  'fusion',
  'electro',
  'havoc',
  'physical',
]

const LEGACY_SKILL_BUFF_FIELDS: Record<string, SkillTypeKey> = {
  basicAtk: 'basicAtk',
  heavyAtk: 'heavyAtk',
  resonanceSkill: 'resonanceSkill',
  resonanceLiberation: 'resonanceLiberation',
}

function resolveLegacyUi(
  controls: JsonRecord,
  baseUi: UiState,
): UiState {
  const nextTheme = coerceString(controls['user-theme'])
  const nextLeftPane = coerceString(controls.leftPaneView)
  const sortKey = coerceString(controls.sortKey)
  const sortOrder = coerceString(controls.sortOrder)
  const showOptimizer = coerceBoolean(controls.showOptimizer) ?? false
  const showCharacterOverview = coerceBoolean(controls.showCharacterOverview) ?? false

  return {
    ...baseUi,
    theme:
      nextTheme === 'light' || nextTheme === 'dark' || nextTheme === 'background'
        ? nextTheme
        : baseUi.theme,
    lightVariant: coerceString(controls['user-light-variant']) as UiState['lightVariant'] ?? baseUi.lightVariant,
    darkVariant: coerceString(controls['user-dark-variant']) as UiState['darkVariant'] ?? baseUi.darkVariant,
    backgroundVariant:
      coerceString(controls['user-background-variant']) as UiState['backgroundVariant']
      ?? baseUi.backgroundVariant,
    bodyFontName: coerceString(controls.userBodyFontName) ?? baseUi.bodyFontName,
    bodyFontUrl: coerceString(controls.userBodyFontURL) ?? baseUi.bodyFontUrl,
    blurMode: coerceString(controls['user-blur-mode']) === 'off' ? 'off' : baseUi.blurMode,
    leftPaneView: (nextLeftPane && LEGACY_TO_CURRENT_LEFT_PANE[nextLeftPane]) || baseUi.leftPaneView,
    mainMode: showCharacterOverview ? 'overview' : showOptimizer ? 'optimizer' : 'default',
    showSubHits: coerceBoolean(controls.showSubHits) ?? baseUi.showSubHits,
    savedRotationPreferences: {
      ...baseUi.savedRotationPreferences,
      sortBy: sortKey === 'name' ? 'name' : sortKey === 'dmg' ? 'avg' : baseUi.savedRotationPreferences.sortBy,
      sortOrder: sortOrder === 'asc' ? 'asc' : sortOrder === 'desc' ? 'desc' : baseUi.savedRotationPreferences.sortOrder,
    },
  }
}

function mapLegacyTraceNodes(raw: JsonRecord): TraceNodeBuffs {
  const traceNodes = makeDefaultTraceNodeBuffs()
  traceNodes.atk.percent = coerceNumber(raw.atkPercent) ?? 0
  traceNodes.hp.percent = coerceNumber(raw.hpPercent) ?? 0
  traceNodes.def.percent = coerceNumber(raw.defPercent) ?? 0
  traceNodes.critRate = coerceNumber(raw.critRate) ?? 0
  traceNodes.critDmg = coerceNumber(raw.critDmg) ?? 0
  traceNodes.healingBonus = coerceNumber(raw.healingBonus) ?? 0

  const elementalBonuses = isRecord(raw.elementalBonuses) ? raw.elementalBonuses : {}
  for (const key of ATTRIBUTE_KEYS) {
    if (key === 'physical') {
      continue
    }

    const direct = coerceNumber(raw[key]) ?? 0
    const bucket = coerceNumber(elementalBonuses[key]) ?? 0
    traceNodes.attribute[key].dmgBonus = direct + bucket
  }

  if (isRecord(raw.activeNodes)) {
    traceNodes.activeNodes = Object.fromEntries(
      Object.entries(raw.activeNodes)
        .map(([key, value]) => [key, coerceBoolean(value)])
        .filter((entry): entry is [string, boolean] => entry[1] != null),
    )
  }

  return traceNodes
}

function mapLegacyCustomBuffs(raw: JsonRecord): ManualBuffs {
  const manualBuffs = makeDefaultCustomBuffs()

  manualBuffs.quick.atk.flat = coerceNumber(raw.atkFlat) ?? 0
  manualBuffs.quick.atk.percent = coerceNumber(raw.atkPercent) ?? 0
  manualBuffs.quick.hp.flat = coerceNumber(raw.hpFlat) ?? 0
  manualBuffs.quick.hp.percent = coerceNumber(raw.hpPercent) ?? 0
  manualBuffs.quick.def.flat = coerceNumber(raw.defFlat) ?? 0
  manualBuffs.quick.def.percent = coerceNumber(raw.defPercent) ?? 0
  manualBuffs.quick.critRate = coerceNumber(raw.critRate) ?? 0
  manualBuffs.quick.critDmg = coerceNumber(raw.critDmg) ?? 0
  manualBuffs.quick.energyRegen = coerceNumber(raw.energyRegen) ?? 0
  manualBuffs.quick.healingBonus = coerceNumber(raw.healingBonus) ?? 0

  const modifiers: ManualModifier[] = []

  for (const [field, skillType] of Object.entries(LEGACY_SKILL_BUFF_FIELDS)) {
    const value = coerceNumber(raw[field])
    if (!value) {
      continue
    }

    modifiers.push({
      id: `legacy:skill:${field}`,
      enabled: true,
      scope: 'skillType',
      skillType,
      mod: 'dmgBonus',
      value,
    } as ManualModifier)
  }

  for (const attribute of ATTRIBUTE_KEYS) {
    if (attribute === 'physical') {
      continue
    }

    const value = coerceNumber(raw[attribute])
    if (!value) {
      continue
    }

    modifiers.push({
      id: `legacy:attr:${attribute}`,
      enabled: true,
      scope: 'attribute',
      attribute,
      mod: 'dmgBonus',
      value,
    } as ManualModifier)
  }

  manualBuffs.modifiers = modifiers
  return manualBuffs
}

function mapLegacyWeaponBuild(raw: JsonRecord, fallback: WeaponBuildState): WeaponBuildState {
  const weaponId = coerceString(raw.weaponId)
  return {
    id: weaponId ?? fallback.id,
    level: clampNumber(Math.round(coerceNumber(raw.weaponLevel) ?? fallback.level), 1, 90),
    rank: clampNumber(Math.round(coerceNumber(raw.weaponRank) ?? fallback.rank), 1, 5),
    baseAtk: coerceNumber(raw.weaponBaseAtk) ?? fallback.baseAtk,
  }
}

function resolveLegacyTeam(
  resonatorId: string,
  state: JsonRecord,
  charInfo: JsonRecord,
): TeamSlots {
  const rawTeam = Array.isArray(state.Team)
    ? state.Team
    : Array.isArray(charInfo.team) && coerceString(charInfo.activeCharacterId) === resonatorId
      ? charInfo.team
      : [resonatorId, null, null]

  const team: TeamSlots = [resonatorId, null, null]
  team[1] = coerceString(rawTeam[1])
  team[2] = coerceString(rawTeam[2])
  return normalizeProfileTeam(resonatorId, team)
}

function buildDefaultTeamMemberRuntimeForSelection(teammateId: string): TeamMemberRuntime | null {
  const seed = getResonatorSeedById(teammateId)
  if (!seed) {
    return null
  }

  return {
    ...makeDefaultTeamMemberRuntime(seed),
    id: teammateId,
  }
}

function buildLegacyEnemyProfile(charInfo: JsonRecord) {
  const enemy = makeDefaultEnemyProfile()
  const level = clampNumber(Math.round(coerceNumber(charInfo.enemyLevel) ?? enemy.level), 1, 150)
  const resistance = coerceNumber(charInfo.enemyRes)

  return {
    ...enemy,
    level,
    source: 'custom' as const,
    res: resistance == null
      ? enemy.res
      : {
        0: resistance,
        1: resistance,
        2: resistance,
        3: resistance,
        4: resistance,
        5: resistance,
        6: resistance,
      },
  }
}

function buildLegacyInventoryEchoes(
  stores: JsonRecord,
  issues: LegacyImportIssue[],
): InventoryEchoEntry[] {
  const echoes = convertLegacyEchoList(
    Array.isArray(stores.echoBag) ? stores.echoBag : [],
    {
      issues,
      issueScope: 'inventory',
      subject: 'echoBag',
    },
  )

  return echoes.map((echo, index) => {
    const now = Date.now() + index
    return {
      id: toStableId('legacy-echo', echo.uid, index),
      echo,
      createdAt: now,
      updatedAt: now,
    }
  })
}

function buildLegacyInventoryBuilds(
  stores: JsonRecord,
  statesById: Record<string, JsonRecord>,
  issues: LegacyImportIssue[],
): InventoryBuildEntry[] {
  const presets = Array.isArray(stores.echoPresets) ? stores.echoPresets : []

  return presets.flatMap((preset, index) => {
    if (!isRecord(preset)) {
      pushIssue(issues, {
        scope: 'inventory',
        subject: `echoPreset:${index + 1}`,
        reason: 'Preset is not an object.',
      })
      return []
    }

    const resonatorId = coerceString(preset.charId)
    if (!resonatorId) {
      pushIssue(issues, {
        scope: 'inventory',
        subject: `echoPreset:${index + 1}`,
        reason: 'Preset is missing a resonator id.',
      })
      return []
    }

    const seed = getResonatorSeedById(resonatorId)
    if (!seed) {
      pushIssue(issues, {
        scope: 'inventory',
        subject: `echoPreset:${resonatorId}`,
        reason: 'Preset resonator no longer exists in the current catalog.',
      })
      return []
    }

    const baseProfile = createDefaultResonatorProfile(seed)
    const state = statesById[resonatorId]
    const weaponState = isRecord(state?.CombatState) ? state.CombatState : {}

    return [{
      id: coerceString(preset.id) ?? `legacy-build:${index}`,
      name: coerceString(preset.name) ?? `${seed.name} Legacy Build`,
      resonatorId,
      resonatorName: coerceString(preset.charName) ?? seed.name,
      build: {
        weapon: mapLegacyWeaponBuild(weaponState, baseProfile.runtime.build.weapon),
        echoes: convertLegacyEchoList(
          Array.isArray(preset.echoes) ? preset.echoes : [],
          {
            slotAware: true,
            issues,
            issueScope: 'inventory',
            subject: `echoPreset:${resonatorId}`,
          },
        ),
      },
      createdAt: Math.round(coerceNumber(preset.createdAt) ?? Date.now() + index),
      updatedAt: Math.round(coerceNumber(preset.updatedAt) ?? Date.now() + index),
    }]
  })
}

function convertLegacyCharacterStateToProfile(
  resonatorId: string,
  legacyState: JsonRecord,
  charInfo: JsonRecord,
  issues: LegacyImportIssue[],
): { profile: ResonatorProfile | null } {
  const seed = getResonatorSeedById(resonatorId)
  if (!seed) {
    pushIssue(issues, {
      scope: 'profile',
      subject: resonatorId,
      reason: 'Resonator no longer exists in the current catalog.',
    })
    return { profile: null }
  }

  const profile = createDefaultResonatorProfile(seed)
  const skillLevels = isRecord(legacyState.SkillLevels) ? legacyState.SkillLevels : {}
  const traceNodes = isRecord(legacyState.TraceNodeBuffs)
    ? legacyState.TraceNodeBuffs
    : isRecord(legacyState.TemporaryBuffs)
      ? legacyState.TemporaryBuffs
      : {}
  const customBuffs = isRecord(legacyState.CustomBuffs) ? legacyState.CustomBuffs : {}
  const combatState = isRecord(legacyState.CombatState) ? legacyState.CombatState : {}
  const team = resolveLegacyTeam(resonatorId, legacyState, charInfo)

  profile.runtime.progression.level =
    clampNumber(Math.round(coerceNumber(legacyState.CharacterLevel) ?? profile.runtime.progression.level), 1, 90)
  profile.runtime.progression.sequence =
    clampNumber(Math.round(coerceNumber(skillLevels.sequence) ?? profile.runtime.progression.sequence), 0, 6)
  profile.runtime.progression.skillLevels = {
    normalAttack: clampNumber(Math.round(coerceNumber(skillLevels.normalAttack) ?? 1), 1, 10),
    resonanceSkill: clampNumber(Math.round(coerceNumber(skillLevels.resonanceSkill) ?? 1), 1, 10),
    forteCircuit: clampNumber(Math.round(coerceNumber(skillLevels.forteCircuit) ?? 1), 1, 10),
    resonanceLiberation: clampNumber(Math.round(coerceNumber(skillLevels.resonanceLiberation) ?? 1), 1, 10),
    introSkill: clampNumber(Math.round(coerceNumber(skillLevels.introSkill) ?? 1), 1, 10),
    tuneBreak: clampNumber(Math.round(coerceNumber(skillLevels.tuneBreak) ?? 1), 1, 10),
  }
  profile.runtime.progression.traceNodes = mapLegacyTraceNodes(traceNodes)
  profile.runtime.build.weapon = mapLegacyWeaponBuild(combatState, profile.runtime.build.weapon)
  profile.runtime.build.echoes = convertLegacyEchoList(
    Array.isArray(legacyState.equippedEchoes) ? legacyState.equippedEchoes : [],
    {
      slotAware: true,
      issues,
      issueScope: 'profile',
      subject: resonatorId,
    },
  )
  profile.runtime.local.manualBuffs = mapLegacyCustomBuffs(customBuffs)
  profile.runtime.team = team
  profile.runtime.teamRuntimes = [
    team[1] ? buildDefaultTeamMemberRuntimeForSelection(team[1]) : null,
    team[2] ? buildDefaultTeamMemberRuntimeForSelection(team[2]) : null,
  ]
  return { profile }
}

function extractLegacyProfileStates(charInfo: JsonRecord, issues: LegacyImportIssue[]): Record<string, JsonRecord> {
  const rawStates = isRecord(charInfo.characterRuntimeStates) ? charInfo.characterRuntimeStates : {}
  const result: Record<string, JsonRecord> = {}

  for (const [rawKey, value] of Object.entries(rawStates)) {
    if (!isRecord(value)) {
      continue
    }

    const resolvedId = coerceString(value.Id) ?? (rawKey !== 'undefined' ? rawKey : null)
    if (!resolvedId) {
      if (Object.keys(value).length > 0) {
        pushIssue(issues, {
          scope: 'backup',
          subject: rawKey,
          reason: 'Skipped a legacy character entry without a valid resonator id.',
        })
      }
      continue
    }

    result[resolvedId] = value
  }

  return result
}

export function importLegacyAppState(
  parsed: unknown,
  options: { baseState?: PersistedAppState } = {},
): LegacyAppStateImportResult {
  const backup = extractLegacyAppBackupPayload(parsed)
  const baseState = initializePersistedAppState(options.baseState ?? createDefaultAppState())
  const issues: LegacyImportIssue[] = []
  const statesById = extractLegacyProfileStates(backup.charInfo, issues)

  const profiles: Record<string, ResonatorProfile> = {}
  const suggestionsByResonatorId: Record<string, ReturnType<typeof createDefaultResonatorSuggestionsState>> = {}
  const importedProfileIds: string[] = []
  const skippedProfileIds: string[] = []

  for (const [resonatorId, legacyState] of Object.entries(statesById)) {
    const converted = convertLegacyCharacterStateToProfile(
      resonatorId,
      legacyState,
      backup.charInfo,
      issues,
    )

    if (!converted.profile) {
      skippedProfileIds.push(resonatorId)
      continue
    }

    importedProfileIds.push(resonatorId)
    profiles[resonatorId] = converted.profile
    suggestionsByResonatorId[resonatorId] = createDefaultResonatorSuggestionsState()
  }

  const requestedActiveId = coerceString(backup.charInfo.activeCharacterId)
  const activeResonatorId =
    (requestedActiveId && profiles[requestedActiveId] ? requestedActiveId : null)
    ?? importedProfileIds[0]
    ?? baseState.calculator.session.activeResonatorId

  const snapshot = initializePersistedAppState({
    ...baseState,
    ui: resolveLegacyUi(backup.controls, baseState.ui),
    calculator: {
      runtimeRevision: 0,
      profiles,
      session: {
        activeResonatorId,
        enemyProfile: buildLegacyEnemyProfile(backup.charInfo),
      },
      inventoryEchoes: buildLegacyInventoryEchoes(backup.stores, issues),
      inventoryBuilds: buildLegacyInventoryBuilds(backup.stores, statesById, issues),
      inventoryRotations: [],
      optimizerContext: null,
      suggestionsByResonatorId,
    },
  })

  const report: LegacyImportReport = {
    importedProfileIds,
    skippedProfileIds,
    importedInventoryEchoes: snapshot.calculator.inventoryEchoes.length,
    importedInventoryBuilds: snapshot.calculator.inventoryBuilds.length,
    importedInventoryRotations: snapshot.calculator.inventoryRotations.length,
    importedSuggestionStates: Object.keys(snapshot.calculator.suggestionsByResonatorId).length,
    issues,
  }

  return {
    snapshot,
    report,
  }
}

export function importLegacyAppStateJson(
  raw: string,
  options: { baseState?: PersistedAppState } = {},
): LegacyAppStateImportResult {
  const backup = parseLegacyAppBackupJson(raw)
  return importLegacyAppState(backup, options)
}
