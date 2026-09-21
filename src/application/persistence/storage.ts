/*
  Author: Runor Ewhro
  Description: Handles persisted app-state loading, validation, granular
               domain writes, and recovery cleanup.
*/

import type { HydratedAppState, PersistedState } from '@/domain/entities/appState'
import type { PersistedUnknown } from '@/engine/runtime/defaults'
import { makeAppState, initAppState } from '@/engine/runtime/defaults'
import { compressToUTF16, decompressFromUTF16 } from 'lz-string'
import {
  APP_STATE_VER,
  persistedSchema,
  prssInvBldsS,
  prssInvChsSl,
  prssInvRttnS,
  prssInvScenariosSl,
  prssOptSettingsSl,
  prssCmbtWrkspSlcS,
  prssSuggsSlc,
  prssUiPprnSl,
  prssUiLytSlc,
  prssUiSvdRoh,
} from '@/engine/runtime/schema'

export const APP_STORAGE_KEY = `wwcalc.app.v${APP_STATE_VER}`
export const APPSTOREUIPP = `${APP_STORAGE_KEY}.ui.appearance`
export const APPSTOREUILY = `${APP_STORAGE_KEY}.ui.layout`
export const APPSTOREUISV = `${APP_STORAGE_KEY}.ui.saved-rotation-preferences`
export const APPSTORECMBT = `${APP_STORAGE_KEY}.combat.workspace`
/** Retired v25 key retained only for cleanup and migration assertions. */
export const APPSTOREPRFL = `${APP_STORAGE_KEY}.profiles`
export const APPSTOREOPTS = `${APP_STORAGE_KEY}.optimizer-settings`
export const SUGG_STORE_KEY = `${APP_STORAGE_KEY}.suggestions`
export const APPSTOREINVC = `${APP_STORAGE_KEY}.inventory.echoes`
export const APPSTOREINVB = `${APP_STORAGE_KEY}.inventory.builds`
export const APPSTOREINVR = `${APP_STORAGE_KEY}.inventory.rotations`
export const APPSTOREINVS = `${APP_STORAGE_KEY}.inventory.scenarios`
export const APPSTORERCVR = `${APP_STORAGE_KEY}.recovery`
const RETIRED_SESSION_STORE_KEY = `${APP_STORAGE_KEY}.session`
const LEGACY_STORAGE_VERSIONS = [26, 25, 24, 23, 22] as const
const COMPRESSED_ROTATIONS_PREFIX = 'wwcalc-lz1:'

export type PersistKey =
  | 'ui.appearance'
  | 'ui.layout'
  | 'ui.savedRotationPreferences'
  | 'combat.workspace'
  | 'simulation.optimizerSettings'
  | 'simulation.suggestions'
  | 'library.echoes'
  | 'library.builds'
  | 'library.rotations'
  | 'library.scenarios'

const NONINVDMNKEY: PersistKey[] = [
  'ui.appearance',
  'ui.layout',
  'ui.savedRotationPreferences',
  'combat.workspace',
  'simulation.optimizerSettings',
  'simulation.suggestions',
]

const INV_DOMAIN_KEYS: PersistKey[] = [
  'library.echoes',
  'library.builds',
  'library.rotations',
  'library.scenarios',
]

export const ALL_DOMAIN_KEYS: PersistKey[] = [
  ...NONINVDMNKEY,
  ...INV_DOMAIN_KEYS,
]

type PersistDraft = PersistedUnknown
type PrssDmnSchm = {
  safeParse: (value: unknown) =>
    | { success: true; data: unknown }
    | { success: false; error?: unknown }
}

interface PersistSpec<TSlice> {
  label: string
  storageKey: string
  schema: PrssDmnSchm
  build: (state: PersistedState) => TSlice
  apply: (state: PersistDraft, slice: TSlice) => void
}

const pndnPrssDmns = new Set<PersistKey>()
const pndnPrssDmnL = new Set<() => void>()

function makeAppearance(state: PersistedState) {
  return {
    version: state.version,
    ui: {
      theme: state.ui.theme,
      themePreference: state.ui.themePreference,
      lightVariant: state.ui.lightVariant,
      darkVariant: state.ui.darkVariant,
      backgroundVariant: state.ui.backgroundVariant,
      backgroundImageKey: state.ui.backgroundImageKey,
      backgroundTextMode: state.ui.backgroundTextMode,
      bodyFontName: state.ui.bodyFontName,
      bodyFontUrl: state.ui.bodyFontUrl,
      blurMode: state.ui.blurMode,
      entranceAnimations: state.ui.entranceAnimations,
    },
  }
}

function makeLayout(state: PersistedState) {
  return {
    version: state.version,
    ui: {
      preferences: state.ui.preferences,
      leftPaneView: state.ui.leftPaneView,
      suggsViewMode: state.ui.suggsViewMode,
      showSubHits: state.ui.showSubHits,
      compactInv: state.ui.compactInv,
      seeEquipped: state.ui.seeEquipped,
      haveHistory: state.ui.haveHistory,
      historyMax: state.ui.historyMax,
      itemFreq: state.ui.itemFreq,
      optimizerCpuHintSeen: state.ui.optimizerCpuHintSeen,
      rotationEditorPreferences: state.ui.rotationEditorPreferences,
    },
  }
}

function makeRotPrefs(state: PersistedState) {
  return {
    version: state.version,
    ui: {
      savedRotationPreferences: state.ui.savedRotationPreferences,
    },
  }
}

function makeCombatWorkspace(state: PersistedState) {
  return {
    version: state.version,
    combat: state.combat,
  }
}

function makeOptSettingsSlice(state: PersistedState) {
  return {
    version: state.version,
    simulation: {
      optimizerSettingsResonatorId: state.simulation.optimizerSettingsResonatorId,
      optimizerSettings: state.simulation.optimizerSettings,
    },
  }
}

function makeSuggestSlice(state: PersistedState) {
  return {
    version: state.version,
    simulation: {
      weaponSuggests: state.simulation.weaponSuggests,
      suggestionsByResonatorId: state.simulation.suggestionsByResonatorId,
    },
  }
}

function makeInvEchoes(state: PersistedState) {
  return {
    version: state.version,
    library: {
      echoes: state.library.echoes,
    },
  }
}

function makeInvBuilds(state: PersistedState) {
  return {
    version: state.version,
    library: {
      builds: state.library.builds,
    },
  }
}

function makeInvRotSlice(state: PersistedState) {
  return {
    version: state.version,
    library: {
      rotations: state.library.rotations,
    },
  }
}

function makeInvScenarioSlice(state: PersistedState) {
  return {
    version: state.version,
    library: {
      scenarios: state.library.scenarios,
    },
  }
}

function encodePersistedDomain(key: PersistKey, value: unknown): string {
  const json = JSON.stringify(value)
  return key === 'library.rotations'
    ? `${COMPRESSED_ROTATIONS_PREFIX}${compressToUTF16(json)}`
    : json
}

function decodePersistedDomain(key: PersistKey, raw: string): string {
  if (key !== 'library.rotations' || !raw.startsWith(COMPRESSED_ROTATIONS_PREFIX)) {
    return raw
  }

  const json = decompressFromUTF16(raw.slice(COMPRESSED_ROTATIONS_PREFIX.length))
  if (json == null) throw new Error('Compressed inventory rotations are invalid.')
  return json
}

type PersistSpecMap = {
  'ui.appearance': PersistSpec<ReturnType<typeof makeAppearance>>
  'ui.layout': PersistSpec<ReturnType<typeof makeLayout>>
  'ui.savedRotationPreferences': PersistSpec<ReturnType<typeof makeRotPrefs>>
  'combat.workspace': PersistSpec<ReturnType<typeof makeCombatWorkspace>>
  'simulation.optimizerSettings': PersistSpec<ReturnType<typeof makeOptSettingsSlice>>
  'simulation.suggestions': PersistSpec<ReturnType<typeof makeSuggestSlice>>
  'library.echoes': PersistSpec<ReturnType<typeof makeInvEchoes>>
  'library.builds': PersistSpec<ReturnType<typeof makeInvBuilds>>
  'library.rotations': PersistSpec<ReturnType<typeof makeInvRotSlice>>
  'library.scenarios': PersistSpec<ReturnType<typeof makeInvScenarioSlice>>
}

type PrssDmnSlc<K extends PersistKey> =
  PersistSpecMap[K] extends PersistSpec<infer TSlice> ? TSlice : never

const DOMAIN_SPECS: PersistSpecMap = {
  'ui.appearance': {
    label: 'ui appearance',
    storageKey: APPSTOREUIPP,
    schema: prssUiPprnSl,
    build: makeAppearance,
    apply: (state, slice) => {
      state.ui = {
        ...state.ui,
        ...slice.ui,
      }
    },
  },
  'ui.layout': {
    label: 'ui layout',
    storageKey: APPSTOREUILY,
    schema: prssUiLytSlc,
    build: makeLayout,
    apply: (state, slice) => {
      state.ui = {
        ...state.ui,
        ...slice.ui,
      }
    },
  },
  'ui.savedRotationPreferences': {
    label: 'ui saved rotation preferences',
    storageKey: APPSTOREUISV,
    schema: prssUiSvdRoh,
    build: makeRotPrefs,
    apply: (state, slice) => {
      state.ui = {
        ...state.ui,
        ...slice.ui,
      }
    },
  },
  'combat.workspace': {
    label: 'combat workspace',
    storageKey: APPSTORECMBT,
    schema: prssCmbtWrkspSlcS,
    build: makeCombatWorkspace,
    apply: (state, slice) => {
      state.combat = slice.combat
    },
  },
  'simulation.optimizerSettings': {
    label: 'optimizer settings',
    storageKey: APPSTOREOPTS,
    schema: prssOptSettingsSl,
    build: makeOptSettingsSlice,
    apply: (state, slice) => {
      state.simulation = {
        ...state.simulation,
        optimizerSettingsResonatorId: slice.simulation.optimizerSettingsResonatorId,
        optimizerSettings: slice.simulation.optimizerSettings,
      }
    },
  },
  'simulation.suggestions': {
    label: 'suggestions',
    storageKey: SUGG_STORE_KEY,
    schema: prssSuggsSlc,
    build: makeSuggestSlice,
    apply: (state, slice) => {
      state.simulation = {
        ...state.simulation,
        weaponSuggests: slice.simulation.weaponSuggests,
        suggestionsByResonatorId: slice.simulation.suggestionsByResonatorId,
      }
    },
  },
  'library.echoes': {
    label: 'inventory echoes',
    storageKey: APPSTOREINVC,
    schema: prssInvChsSl,
    build: makeInvEchoes,
    apply: (state, slice) => {
      state.library = {
        ...state.library,
        echoes: slice.library.echoes,
      }
    },
  },
  'library.builds': {
    label: 'inventory builds',
    storageKey: APPSTOREINVB,
    schema: prssInvBldsS,
    build: makeInvBuilds,
    apply: (state, slice) => {
      state.library = {
        ...state.library,
        builds: slice.library.builds,
      }
    },
  },
  'library.rotations': {
    label: 'inventory rotations',
    storageKey: APPSTOREINVR,
    schema: prssInvRttnS,
    build: makeInvRotSlice,
    apply: (state, slice) => {
      state.library = {
        ...state.library,
        rotations: slice.library.rotations,
      }
    },
  },
  'library.scenarios': {
    label: 'saved scenarios',
    storageKey: APPSTOREINVS,
    schema: prssInvScenariosSl,
    build: makeInvScenarioSlice,
    apply: (state, slice) => {
      state.library = {
        ...state.library,
        scenarios: slice.library.scenarios,
      }
    },
  },
}

function getPrssDmnKe(includeInventory: boolean): PersistKey[] {
  return includeInventory
    ? ALL_DOMAIN_KEYS
    : NONINVDMNKEY
}

function hasCurStoreE(): boolean {
  return ALL_DOMAIN_KEYS.some((key) => localStorage.getItem(DOMAIN_SPECS[key].storageKey) != null)
}

function readMnlthPrssS(): HydratedAppState | null {
  const raw = localStorage.getItem(APP_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const snapshot = parsePersisted(raw)
    saveAppState(snapshot)
    localStorage.removeItem(APP_STORAGE_KEY)
    return snapshot
  } catch (error) {
    console.warn('[storage] failed to migrate monolithic app snapshot', error)
    try {
      qrntStoreKey(APP_STORAGE_KEY, raw)
    } catch (rcvrRrr) {
      console.warn('[storage] failed to quarantine invalid monolithic app snapshot', rcvrRrr)
    }
    return null
  }
}

function readLegacyStateVersion(
  version: typeof LEGACY_STORAGE_VERSIONS[number],
): HydratedAppState | null {
  const legacyStorageKey = `wwcalc.app.v${version}`
  const monolith = localStorage.getItem(legacyStorageKey)
  if (monolith) {
    try {
      const snapshot = parsePersisted(monolith)
      saveAppState(snapshot)
      localStorage.removeItem(legacyStorageKey)
      return snapshot
    } catch (error) {
      console.warn(`[storage] failed to migrate v${version} app snapshot`, error)
    }
  }

  const legacySuffixes = [
    'ui.appearance',
    'ui.layout',
    'ui.saved-rotation-preferences',
    'session',
    ...(version === 26 || version === 25 || version === 24
      ? ['combat.workspace']
      : version === 23
        ? ['workspace']
        : []),
    'profiles',
    'optimizer-context',
    'suggestions',
    'inventory.echoes',
    'inventory.builds',
    'inventory.rotations',
    ...(version === 26 ? ['inventory.scenarios'] : []),
  ]
  const defaults = makeAppState()
  const draft = structuredClone(defaults) as unknown as Record<string, unknown>
  const draftUi = draft.ui as Record<string, unknown>
  const draftCalculator = draft.simulation as Record<string, unknown>
  // Let the legacy optimizer-context slice supply its settings. Leaving the
  // v27 default here would make migration mistake it for explicitly stored data.
  delete draftCalculator.optimizerSettings
  delete draft.combat
  delete draft.library
  draft.version = version
  let found = false

  for (const suffix of legacySuffixes) {
    const raw = localStorage.getItem(`${legacyStorageKey}.${suffix}`)
    if (!raw) continue
    try {
      const slice = JSON.parse(raw) as {
        ui?: Record<string, unknown>
        combat?: Record<string, unknown>
        calculator?: Record<string, unknown>
        simulation?: Record<string, unknown>
        library?: Record<string, unknown>
      }
      if (slice.ui) Object.assign(draftUi, slice.ui)
      if (slice.combat) draft.combat = slice.combat
      if (slice.simulation ?? slice.calculator) {
        Object.assign(draftCalculator, slice.simulation ?? slice.calculator)
      }
      if (slice.library) {
        const draftLibrary = draft.library && typeof draft.library === 'object'
          ? draft.library as Record<string, unknown>
          : { echoes: [], builds: [], rotations: [], scenarios: [] }
        Object.assign(draftLibrary, slice.library)
        draft.library = draftLibrary
      }
      found = true
    } catch (error) {
      console.warn(`[storage] failed to read legacy v${version} ${suffix}`, error)
    }
  }

  if (!found) return null
  const current = persistedSchema.safeParse(draft)
  if (!current.success) {
    console.warn(`[storage] failed to validate assembled v${version} app state`, current.error)
    return null
  }

  const snapshot = initAppState(current.data as unknown as PersistedState)
  saveAppState(snapshot)
  for (const suffix of legacySuffixes) {
    localStorage.removeItem(`${legacyStorageKey}.${suffix}`)
  }
  return snapshot
}

function readLegacyState(): HydratedAppState | null {
  for (const version of LEGACY_STORAGE_VERSIONS) {
    const migrated = readLegacyStateVersion(version)
    if (migrated) return migrated
  }
  return null
}

function qrntStoreKey(key: string, raw: string): void {
  localStorage.setItem(`${APPSTORERCVR}.${Date.now()}.${key}`, raw)
  localStorage.removeItem(key)
}

function readVldtStor<T>(
  raw: string,
  schema: PrssDmnSchm,
  label: string,
): T {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${label} is not valid JSON.`)
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`${label} validation failed.`)
  }

  return result.data as T
}

function readPrssDmn<K extends PersistKey>(
  key: K,
): PrssDmnSlc<K> | null {
  const spec = DOMAIN_SPECS[key]
  const raw = localStorage.getItem(spec.storageKey)
  if (!raw) {
    return null
  }

  try {
    return readVldtStor(decodePersistedDomain(key, raw), spec.schema, spec.label)
  } catch (error) {
    console.warn(`[storage] failed to parse ${spec.label}`, error)
    try {
      qrntStoreKey(spec.storageKey, raw)
    } catch (rcvrRrr) {
      console.warn(`[storage] failed to quarantine invalid ${spec.label}`, rcvrRrr)
    }
    return null
  }
}

function makePersistDraft(includeInventory: boolean): PersistDraft {
  const defaults = makeAppState()

  return {
    version: APP_STATE_VER,
    combat: defaults.combat,
    ui: {
      ...defaults.ui,
    },
    simulation: { ...defaults.simulation },
    library: includeInventory
      ? defaults.library
      : { echoes: [], builds: [], rotations: [], scenarios: [] },
  }
}

function normPrssAppS(parsed: unknown): HydratedAppState {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Snapshot must be a JSON object.')
  }

  const current = persistedSchema.safeParse(parsed)
  if (current.success) {
    return initAppState(current.data as unknown as PersistedState)
  }

  throw new Error('Snapshot validation failed.')
}

function normalizeAppState(
  state: PersistedUnknown,
): HydratedAppState {
  return initAppState(state)
}

function ssmbPrssAppS(includeInventory: boolean): HydratedAppState | null {
  const state = makePersistDraft(includeInventory)
  const loadedDomains: PersistKey[] = []
  let hasLddDmn = false

  for (const key of getPrssDmnKe(includeInventory)) {
    const domain = readPrssDmn(key)
    if (!domain) {
      continue
    }

    DOMAIN_SPECS[key].apply(state, domain)
    loadedDomains.push(key)
    hasLddDmn = true
  }

  if (!hasLddDmn) {
    return readMnlthPrssS() ?? readLegacyState()
  }

  const normalState = normalizeAppState(state)
  saveAppState(normalState, { domains: loadedDomains })
  return normalState
}

// parse persisted app state from raw json text
export function parsePersisted(raw: string): HydratedAppState {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Snapshot is not valid JSON.')
  }

  return normPrssAppS(parsed)
}

// load persisted app state from storage, optionally omitting the inventory slice
export function loadPrssAppS(
  options: { includeInventory?: boolean } = {},
): HydratedAppState | null {
  const includeInventory = options.includeInventory ?? true

  if (!hasCurStoreE()) {
    return readMnlthPrssS() ?? readLegacyState()
  }

  return ssmbPrssAppS(includeInventory)
}

export function loadPrssInvS(): PersistedState['library'] {
  const state = makePersistDraft(true)
  let hasLddInv = false

  for (const key of INV_DOMAIN_KEYS) {
    const domain = readPrssDmn(key)
    if (!domain) {
      continue
    }

    DOMAIN_SPECS[key].apply(state, domain)
    hasLddInv = true
  }

  if (!hasLddInv) {
    const migrated = readMnlthPrssS() ?? readLegacyState()
    if (migrated) {
      return migrated.library
    }

    return { echoes: [], builds: [], rotations: [], scenarios: [] }
  }

  const normalState = normalizeAppState(state)
  saveAppState(normalState, { domains: INV_DOMAIN_KEYS })

  return normalState.library
}

// validate and save persisted app state domains
export function saveAppState(
  state: PersistedState,
  options: { domains?: PersistKey[] } = {},
): void {
  // Ordinary store writes already pass canonical state. Normalizing the whole
  // application here used to clone/rebuild every scenario and inventory domain
  // even when one small domain was dirty. Keep full normalization for the
  // migration/recovery path (no explicit domains), and validate only the
  // requested slices for routine writes.
  let persistedState: PersistedState = state
  if (!options.domains) {
    try {
      persistedState = normalizeAppState(state as unknown as PersistedUnknown)
    } catch (error) {
      console.warn('[storage] failed to normalize app state for persistence', error)
      return
    }
  }

  const domains = new Set(options.domains ?? ALL_DOMAIN_KEYS)
  for (const key of domains) {
    const spec = DOMAIN_SPECS[key]
    const slice = spec.build(persistedState)
    const result = spec.schema.safeParse(slice)
    if (!result.success) {
      console.error(`[storage] refusing to save invalid ${spec.label}`, result.error)
      continue
    }

    try {
      localStorage.setItem(spec.storageKey, encodePersistedDomain(key, result.data))
    } catch (error) {
      console.warn(`[storage] failed to persist ${spec.label}`, error)
    }
  }

  try {
    localStorage.removeItem(RETIRED_SESSION_STORE_KEY)
  } catch (error) {
    console.warn('[storage] failed to remove retired session state', error)
  }
}

export function markPrssDmns(keys: PersistKey[]): void {
  let changed = false

  for (const key of keys) {
    if (pndnPrssDmns.has(key)) {
      continue
    }

    pndnPrssDmns.add(key)
    changed = true
  }

  if (!changed) {
    return
  }

  for (const listener of pndnPrssDmnL) {
    listener()
  }
}

export function consumePersist(): PersistKey[] {
  const keys = [...pndnPrssDmns]
  pndnPrssDmns.clear()
  return keys
}

export function sbscToDrtyPr(listener: () => void): () => void {
  pndnPrssDmnL.add(listener)
  return () => {
    pndnPrssDmnL.delete(listener)
  }
}

// clear persisted app state entries
export function clrPrssAppSt(): void {
  pndnPrssDmns.clear()
  localStorage.removeItem(APP_STORAGE_KEY)
  localStorage.removeItem(RETIRED_SESSION_STORE_KEY)
  localStorage.removeItem(APPSTOREPRFL)

  for (const key of ALL_DOMAIN_KEYS) {
    localStorage.removeItem(DOMAIN_SPECS[key].storageKey)
  }

  if (typeof localStorage.key !== 'function') {
    return
  }

  const recoveryKeys: string[] = []

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(`${APPSTORERCVR}.`)) {
      recoveryKeys.push(key)
    }
  }

  for (const key of recoveryKeys) {
    localStorage.removeItem(key)
  }
}
