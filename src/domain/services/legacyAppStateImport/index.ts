/*
  Author: Runor Ewhro
  Description: Orchestrates legacy app-state import by normalizing older saved
               data into the current persistence schema.
*/

import type { PersistedState, UiState } from '@/domain/entities/appState'
import type { InventoryEntry, InvEchoEnt } from '@/domain/entities/inventoryStorage'
import type { ManualBuffs, MnlMod } from '@/domain/entities/manualBuffs'
import type { ResProf } from '@/domain/entities/profile'
import type { TeamMemRt, TeamSlots, TraceNodeBuffs, WeaponState } from '@/domain/entities/runtime'
import type { AttributeKey, SkillTypeKey } from '@/domain/entities/stats'
import { makeAppState, makeResProfile, makeSuggest, makeCustomBuff, makeEnemy, makeTeamMember, makeTraceNode, normProfTeam } from '@/domain/state/defaults'
import { initAppState } from '@/domain/state/defaults'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { cnvrLegEchoL } from './echoes'
import {
  clampNumber,
  crcBln,
  coerceNumber,
  coerceString,
  xtrcLegAppBc,
  isRecord,
  prsLegAppBck,
  pushIssue,
  toStableId,
  type JsonRecord,
  type LegAppSttMpr,
  type LegMprtSs,
  type LegMprtRprt,
} from './shared'

const LEGACY_LEFT: Record<string, UiState['leftPaneView']> = {
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

const ATTR_KEYS: AttributeKey[] = [
  'aero',
  'glacio',
  'spectro',
  'fusion',
  'electro',
  'havoc',
  'physical',
]

const OLD_SKILL_BUFF: Record<string, SkillTypeKey> = {
  basicAtk: 'basicAtk',
  heavyAtk: 'heavyAtk',
  resonanceSkill: 'resonanceSkill',
  resonanceLiberation: 'resonanceLiberation',
}

function resLegUi(
  controls: JsonRecord,
  baseUi: UiState,
): UiState {
  // legacy controls used older key names, so each value is coerced and then
  // folded into the initialized ui object instead of trusted as a full shape.
  const nextTheme = coerceString(controls['user-theme'])
  const nextLeftPane = coerceString(controls.leftPaneView)
  const sortKey = coerceString(controls.sortKey)
  const sortOrder = coerceString(controls.sortOrder)
  const showOpt = crcBln(controls.showOptimizer) ?? false
  const showCharVrvw = crcBln(controls.showCharacterOverview) ?? false

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
    blurMode: coerceString(controls['user-blur-mode']) === 'off' ? false : baseUi.blurMode,
    leftPaneView: (nextLeftPane && LEGACY_LEFT[nextLeftPane]) || baseUi.leftPaneView,
    mainMode: showCharVrvw ? 'overview' : showOpt ? 'optimizer' : 'default',
    showSubHits: crcBln(controls.showSubHits) ?? baseUi.showSubHits,
    savedRotationPreferences: {
      ...baseUi.savedRotationPreferences,
      sortBy: sortKey === 'name' ? 'name' : sortKey === 'dmg' ? 'avg' : baseUi.savedRotationPreferences.sortBy,
      sortOrder: sortOrder === 'asc' ? 'asc' : sortOrder === 'desc' ? 'desc' : baseUi.savedRotationPreferences.sortOrder,
    },
  }
}

function mapLegTrcNds(raw: JsonRecord): TraceNodeBuffs {
  const traceNodes = makeTraceNode()
  traceNodes.atk.percent = coerceNumber(raw.atkPercent) ?? 0
  traceNodes.hp.percent = coerceNumber(raw.hpPercent) ?? 0
  traceNodes.def.percent = coerceNumber(raw.defPercent) ?? 0
  traceNodes.critRate = coerceNumber(raw.critRate) ?? 0
  traceNodes.critDmg = coerceNumber(raw.critDmg) ?? 0
  traceNodes.healingBonus = coerceNumber(raw.healingBonus) ?? 0

  // older saves may store elemental bonuses either on the root object or in a
  // nested bucket; adding both paths preserves builds made before the split.
  const lmntBnss = isRecord(raw.elementalBonuses) ? raw.elementalBonuses : {}
  for (const key of ATTR_KEYS) {
    if (key === 'physical') {
      continue
    }

    const direct = coerceNumber(raw[key]) ?? 0
    const bucket = coerceNumber(lmntBnss[key]) ?? 0
    traceNodes.attribute[key].dmgBonus = direct + bucket
  }

  if (isRecord(raw.activeNodes)) {
    traceNodes.activeNodes = Object.fromEntries(
      Object.entries(raw.activeNodes)
        .map(([key, value]) => [key, crcBln(value)])
        .filter((entry): entry is [string, boolean] => entry[1] != null),
    )
  }

  return traceNodes
}

function mapLegCustBf(raw: JsonRecord): ManualBuffs {
  const manualBuffs = makeCustomBuff()

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

  // skill and attribute bonuses become regular manual modifiers so imported
  // buffs participate in the same resolver path as newly-authored buffs.
  const modifiers: MnlMod[] = []

  for (const [field, skillType] of Object.entries(OLD_SKILL_BUFF)) {
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
    } as MnlMod)
  }

  for (const attribute of ATTR_KEYS) {
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
    } as MnlMod)
  }

  manualBuffs.modifiers = modifiers
  return manualBuffs
}

function mapLegWpnMk(raw: JsonRecord, fallback: WeaponState): WeaponState {
  const weaponId = coerceString(raw.weaponId)
  return {
    id: weaponId ?? fallback.id,
    level: clampNumber(Math.round(coerceNumber(raw.weaponLevel) ?? fallback.level), 1, 90),
    rank: clampNumber(Math.round(coerceNumber(raw.weaponRank) ?? fallback.rank), 1, 5),
    baseAtk: coerceNumber(raw.weaponBaseAtk) ?? fallback.baseAtk,
  }
}

function resLegTeam(
  resonatorId: string,
  state: JsonRecord,
  charInfo: JsonRecord,
): TeamSlots {
  // prefer the per-profile team when present; the global team only describes
  // the active legacy profile and would leak members into unrelated imports.
  const rawTeam = Array.isArray(state.Team)
    ? state.Team
    : Array.isArray(charInfo.team) && coerceString(charInfo.activeCharacterId) === resonatorId
      ? charInfo.team
      : [resonatorId, null, null]

  const team: TeamSlots = [resonatorId, null, null]
  team[1] = coerceString(rawTeam[1])
  team[2] = coerceString(rawTeam[2])
  return normProfTeam(resonatorId, team)
}

function makeDefaultMate(teammateId: string): TeamMemRt | null {
  const seed = getResSeedBy(teammateId)
  if (!seed) {
    return null
  }

  return {
    ...makeTeamMember(seed),
    id: teammateId,
  }
}

function mkLegEnemyPr(charInfo: JsonRecord) {
  const enemy = makeEnemy()
  const level = clampNumber(Math.round(coerceNumber(charInfo.enemyLevel) ?? enemy.level), 1, 150)
  const resistance = coerceNumber(charInfo.enemyRes)

  // legacy enemy resistance was one scalar, so mirror it into every attribute
  // slot expected by the current enemy profile contract.
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

function mkLegInvChs(
  stores: JsonRecord,
  issues: LegMprtSs[],
): InvEchoEnt[] {
  // bag imports are not slot-aware because saved inventory echoes are loose
  // items; slot validation is only applied when importing equipped loadouts.
  const echoes = cnvrLegEchoL(
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

function mkLegInvBlds(
  stores: JsonRecord,
  statesById: Record<string, JsonRecord>,
  issues: LegMprtSs[],
): InventoryEntry[] {
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

    const seed = getResSeedBy(resonatorId)
    if (!seed) {
      pushIssue(issues, {
        scope: 'inventory',
        subject: `echoPreset:${resonatorId}`,
        reason: 'Preset resonator no longer exists in the current catalog.',
      })
      return []
    }

    // rebuild the missing weapon defaults from the current catalog so old echo
    // presets can omit fields that did not exist when the backup was created.
    const baseProfile = makeResProfile(seed)
    const state = statesById[resonatorId]
    const weaponState = isRecord(state?.CombatState) ? state.CombatState : {}

    return [{
      id: coerceString(preset.id) ?? `legacy-build:${index}`,
      name: coerceString(preset.name) ?? `${seed.name} Legacy Build`,
      resonatorId,
      resonatorName: coerceString(preset.charName) ?? seed.name,
      build: {
        weapon: mapLegWpnMk(weaponState, baseProfile.runtime.build.weapon),
        echoes: cnvrLegEchoL(
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

function cnvrLegCharS(
  resonatorId: string,
  legacyState: JsonRecord,
  charInfo: JsonRecord,
  issues: LegMprtSs[],
): { profile: ResProf | null } {
  const seed = getResSeedBy(resonatorId)
  if (!seed) {
    pushIssue(issues, {
      scope: 'profile',
      subject: resonatorId,
      reason: 'Resonator no longer exists in the current catalog.',
    })
    return { profile: null }
  }

  const profile = makeResProfile(seed)
  const skillLevels = isRecord(legacyState.SkillLevels) ? legacyState.SkillLevels : {}
  // temporary buffs held trace-node-like values in older saves; accepting that
  // fallback recovers data from backups made during the transition.
  const traceNodes = isRecord(legacyState.TraceNodeBuffs)
    ? legacyState.TraceNodeBuffs
    : isRecord(legacyState.TemporaryBuffs)
      ? legacyState.TemporaryBuffs
      : {}
  const customBuffs = isRecord(legacyState.CustomBuffs) ? legacyState.CustomBuffs : {}
  const combatState = isRecord(legacyState.CombatState) ? legacyState.CombatState : {}
  const team = resLegTeam(resonatorId, legacyState, charInfo)

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
  profile.runtime.progression.traceNodes = mapLegTrcNds(traceNodes)
  profile.runtime.build.weapon = mapLegWpnMk(combatState, profile.runtime.build.weapon)
  profile.runtime.build.echoes = cnvrLegEchoL(
    Array.isArray(legacyState.equippedEchoes) ? legacyState.equippedEchoes : [],
    {
      slotAware: true,
      issues,
      issueScope: 'profile',
      subject: resonatorId,
    },
  )
  profile.runtime.local.manualBuffs = mapLegCustBf(customBuffs)
  profile.runtime.team = team
  profile.runtime.teamRuntimes = [
    team[1] ? makeDefaultMate(team[1]) : null,
    team[2] ? makeDefaultMate(team[2]) : null,
  ]
  return { profile }
}

function xtrcLegProfS(charInfo: JsonRecord, issues: LegMprtSs[]): Record<string, JsonRecord> {
  const rawStates = isRecord(charInfo.characterRuntimeStates) ? charInfo.characterRuntimeStates : {}
  const result: Record<string, JsonRecord> = {}

  for (const [rawKey, value] of Object.entries(rawStates)) {
    if (!isRecord(value)) {
      continue
    }

    // some backups keyed the map by resonator id while others stored it inside
    // the value; use either source but reject the accidental "undefined" key.
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

export function mprtLegAppSt(
  parsed: unknown,
  options: { baseState?: PersistedState } = {},
): LegAppSttMpr {
  const backup = xtrcLegAppBc(parsed)
  const baseState = initAppState(options.baseState ?? makeAppState())
  const issues: LegMprtSs[] = []
  const statesById = xtrcLegProfS(backup.charInfo, issues)

  const profiles: Record<string, ResProf> = {}
  const suggsByResId: Record<string, ReturnType<typeof makeSuggest>> = {}
  const mprtProfIds: string[] = []
  const skppProfIds: string[] = []

  // import profiles first so session, suggestions, and inventory builds can
  // reference only ids that survived current-catalog validation.
  for (const [resonatorId, legacyState] of Object.entries(statesById)) {
    const converted = cnvrLegCharS(
      resonatorId,
      legacyState,
      backup.charInfo,
      issues,
    )

    if (!converted.profile) {
      skppProfIds.push(resonatorId)
      continue
    }

    mprtProfIds.push(resonatorId)
    profiles[resonatorId] = converted.profile
    suggsByResId[resonatorId] = makeSuggest()
  }

  const rqstActId = coerceString(backup.charInfo.activeCharacterId)
  const actResId =
    (rqstActId && profiles[rqstActId] ? rqstActId : null)
    ?? mprtProfIds[0]
    ?? baseState.calculator.session.activeResonatorId

  // initialize again after composing the snapshot so any missing new domains
  // are filled from current defaults without preserving stale optimizer state.
  const snapshot = initAppState({
    ...baseState,
    ui: resLegUi(backup.controls, baseState.ui),
    calculator: {
      runtimeRevision: 0,
      profiles,
      session: {
        activeResonatorId: actResId,
        enemyProfile: mkLegEnemyPr(backup.charInfo),
      },
      inventoryEchoes: mkLegInvChs(backup.stores, issues),
      inventoryBuilds: mkLegInvBlds(backup.stores, statesById, issues),
      inventoryRotations: [],
      optimizerContext: null,
      weaponSuggests: baseState.calculator.weaponSuggests,
      suggestionsByResonatorId: suggsByResId,
    },
  })

  const report: LegMprtRprt = {
    importedProfileIds: mprtProfIds,
    skippedProfileIds: skppProfIds,
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

export function importLegacyApp(
  raw: string,
  options: { baseState?: PersistedState } = {},
): LegAppSttMpr {
  const backup = prsLegAppBck(raw)
  return mprtLegAppSt(backup, options)
}
