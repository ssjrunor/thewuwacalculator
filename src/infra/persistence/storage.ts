/*
  Author: Runor Ewhro
  Description: Handles persisted app-state loading, migration, validation,
               granular domain writes, and recovery cleanup.
*/

import type { PersistedAppState } from '@/domain/entities/appState'
import { createDefaultAppState, initializePersistedAppState } from '@/domain/state/defaults'
import {
  LEGACY_PERSISTED_APP_STATE_VERSION,
  PERSISTED_APP_STATE_VERSION,
  legacyPersistedAppStateSchema,
  persistedAppStateSchema,
  persistedInventoryBuildsSliceSchema,
  persistedInventoryEchoesSliceSchema,
  persistedInventoryRotationsSliceSchema,
  persistedOptimizerContextSliceSchema,
  persistedProfilesSliceSchema,
  persistedSessionSliceSchema,
  persistedSuggestionsSliceSchema,
  persistedUiAppearanceSliceSchema,
  persistedUiLayoutSliceSchema,
  persistedUiSavedRotationPreferencesSliceSchema,
} from '@/domain/state/schema'

export const APP_STORAGE_KEY = `wwcalc.app.v${PERSISTED_APP_STATE_VERSION}`
export const APP_STORAGE_UI_APPEARANCE_KEY = `${APP_STORAGE_KEY}.ui.appearance`
export const APP_STORAGE_UI_LAYOUT_KEY = `${APP_STORAGE_KEY}.ui.layout`
export const APP_STORAGE_UI_SAVED_ROTATION_PREFERENCES_KEY = `${APP_STORAGE_KEY}.ui.saved-rotation-preferences`
export const APP_STORAGE_SESSION_KEY = `${APP_STORAGE_KEY}.session`
export const APP_STORAGE_PROFILES_KEY = `${APP_STORAGE_KEY}.profiles`
export const APP_STORAGE_OPTIMIZER_CONTEXT_KEY = `${APP_STORAGE_KEY}.optimizer-context`
export const APP_STORAGE_SUGGESTIONS_KEY = `${APP_STORAGE_KEY}.suggestions`
export const APP_STORAGE_INVENTORY_ECHOES_KEY = `${APP_STORAGE_KEY}.inventory.echoes`
export const APP_STORAGE_INVENTORY_BUILDS_KEY = `${APP_STORAGE_KEY}.inventory.builds`
export const APP_STORAGE_INVENTORY_ROTATIONS_KEY = `${APP_STORAGE_KEY}.inventory.rotations`
export const APP_STORAGE_RECOVERY_PREFIX = `${APP_STORAGE_KEY}.recovery`

export const APP_STORAGE_BACKUP_KEY = `wwcalc.app.v${LEGACY_PERSISTED_APP_STATE_VERSION}.backup`

export const LEGACY_APP_STORAGE_KEY = `wwcalc.app.v${LEGACY_PERSISTED_APP_STATE_VERSION}`
export const LEGACY_APP_STORAGE_RECOVERY_PREFIX = `${LEGACY_APP_STORAGE_KEY}.recovery`

export type PersistedDomainKey =
  | 'ui.appearance'
  | 'ui.layout'
  | 'ui.savedRotationPreferences'
  | 'calculator.session'
  | 'calculator.profiles'
  | 'calculator.optimizerContext'
  | 'calculator.suggestions'
  | 'calculator.inventory.echoes'
  | 'calculator.inventory.builds'
  | 'calculator.inventory.rotations'

const NON_INVENTORY_DOMAIN_KEYS: PersistedDomainKey[] = [
  'ui.appearance',
  'ui.layout',
  'ui.savedRotationPreferences',
  'calculator.session',
  'calculator.profiles',
  'calculator.optimizerContext',
  'calculator.suggestions',
]

const INVENTORY_DOMAIN_KEYS: PersistedDomainKey[] = [
  'calculator.inventory.echoes',
  'calculator.inventory.builds',
  'calculator.inventory.rotations',
]

const ALL_PERSISTED_DOMAIN_KEYS: PersistedDomainKey[] = [
  ...NON_INVENTORY_DOMAIN_KEYS,
  ...INVENTORY_DOMAIN_KEYS,
]

type PersistedStateDraft = Omit<PersistedAppState, 'version'> & { version: number }
type PersistedDomainSchema = {
  safeParse: (value: unknown) => { success: boolean; data?: unknown }
}

interface PersistedDomainSpec<TSlice> {
  label: string
  storageKey: string
  schema: PersistedDomainSchema
  build: (state: PersistedAppState) => TSlice
  apply: (state: PersistedStateDraft, slice: TSlice) => void
}

const pendingPersistedDomains = new Set<PersistedDomainKey>()
const pendingPersistedDomainListeners = new Set<() => void>()

function buildUiAppearanceSlice(state: PersistedAppState) {
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

function buildUiLayoutSlice(state: PersistedAppState) {
  return {
    version: state.version,
    ui: {
      leftPaneView: state.ui.leftPaneView,
      mainMode: state.ui.mainMode,
      showSubHits: state.ui.showSubHits,
      optimizerCpuHintSeen: state.ui.optimizerCpuHintSeen,
    },
  }
}

function buildUiSavedRotationPreferencesSlice(state: PersistedAppState) {
  return {
    version: state.version,
    ui: {
      savedRotationPreferences: state.ui.savedRotationPreferences,
    },
  }
}

function buildSessionSlice(state: PersistedAppState) {
  return {
    version: state.version,
    calculator: {
      session: state.calculator.session,
    },
  }
}

function buildProfilesSlice(state: PersistedAppState) {
  return {
    version: state.version,
    calculator: {
      runtimeRevision: state.calculator.runtimeRevision,
      profiles: state.calculator.profiles,
    },
  }
}

function buildOptimizerContextSlice(state: PersistedAppState) {
  return {
    version: state.version,
    calculator: {
      optimizerContext: state.calculator.optimizerContext,
    },
  }
}

function buildSuggestionsSlice(state: PersistedAppState) {
  return {
    version: state.version,
    calculator: {
      suggestionsByResonatorId: state.calculator.suggestionsByResonatorId,
    },
  }
}

function buildInventoryEchoesSlice(state: PersistedAppState) {
  return {
    version: state.version,
    calculator: {
      inventoryEchoes: state.calculator.inventoryEchoes,
    },
  }
}

function buildInventoryBuildsSlice(state: PersistedAppState) {
  return {
    version: state.version,
    calculator: {
      inventoryBuilds: state.calculator.inventoryBuilds,
    },
  }
}

function buildInventoryRotationsSlice(state: PersistedAppState) {
  return {
    version: state.version,
    calculator: {
      inventoryRotations: state.calculator.inventoryRotations,
    },
  }
}

type PersistedDomainSpecMap = {
  'ui.appearance': PersistedDomainSpec<ReturnType<typeof buildUiAppearanceSlice>>
  'ui.layout': PersistedDomainSpec<ReturnType<typeof buildUiLayoutSlice>>
  'ui.savedRotationPreferences': PersistedDomainSpec<ReturnType<typeof buildUiSavedRotationPreferencesSlice>>
  'calculator.session': PersistedDomainSpec<ReturnType<typeof buildSessionSlice>>
  'calculator.profiles': PersistedDomainSpec<ReturnType<typeof buildProfilesSlice>>
  'calculator.optimizerContext': PersistedDomainSpec<ReturnType<typeof buildOptimizerContextSlice>>
  'calculator.suggestions': PersistedDomainSpec<ReturnType<typeof buildSuggestionsSlice>>
  'calculator.inventory.echoes': PersistedDomainSpec<ReturnType<typeof buildInventoryEchoesSlice>>
  'calculator.inventory.builds': PersistedDomainSpec<ReturnType<typeof buildInventoryBuildsSlice>>
  'calculator.inventory.rotations': PersistedDomainSpec<ReturnType<typeof buildInventoryRotationsSlice>>
}

type PersistedDomainSlice<K extends PersistedDomainKey> =
  PersistedDomainSpecMap[K] extends PersistedDomainSpec<infer TSlice> ? TSlice : never

const PERSISTED_DOMAIN_SPECS: PersistedDomainSpecMap = {
  'ui.appearance': {
    label: 'ui appearance',
    storageKey: APP_STORAGE_UI_APPEARANCE_KEY,
    schema: persistedUiAppearanceSliceSchema,
    build: buildUiAppearanceSlice,
    apply: (state, slice) => {
      state.ui = {
        ...state.ui,
        ...slice.ui,
      }
    },
  },
  'ui.layout': {
    label: 'ui layout',
    storageKey: APP_STORAGE_UI_LAYOUT_KEY,
    schema: persistedUiLayoutSliceSchema,
    build: buildUiLayoutSlice,
    apply: (state, slice) => {
      state.ui = {
        ...state.ui,
        ...slice.ui,
      }
    },
  },
  'ui.savedRotationPreferences': {
    label: 'ui saved rotation preferences',
    storageKey: APP_STORAGE_UI_SAVED_ROTATION_PREFERENCES_KEY,
    schema: persistedUiSavedRotationPreferencesSliceSchema,
    build: buildUiSavedRotationPreferencesSlice,
    apply: (state, slice) => {
      state.ui = {
        ...state.ui,
        ...slice.ui,
      }
    },
  },
  'calculator.session': {
    label: 'session',
    storageKey: APP_STORAGE_SESSION_KEY,
    schema: persistedSessionSliceSchema,
    build: buildSessionSlice,
    apply: (state, slice) => {
      state.calculator = {
        ...state.calculator,
        session: slice.calculator.session,
      }
    },
  },
  'calculator.profiles': {
    label: 'profiles',
    storageKey: APP_STORAGE_PROFILES_KEY,
    schema: persistedProfilesSliceSchema,
    build: buildProfilesSlice,
    apply: (state, slice) => {
      state.calculator = {
        ...state.calculator,
        runtimeRevision: slice.calculator.runtimeRevision,
        profiles: slice.calculator.profiles,
      }
    },
  },
  'calculator.optimizerContext': {
    label: 'optimizer context',
    storageKey: APP_STORAGE_OPTIMIZER_CONTEXT_KEY,
    schema: persistedOptimizerContextSliceSchema,
    build: buildOptimizerContextSlice,
    apply: (state, slice) => {
      state.calculator = {
        ...state.calculator,
        optimizerContext: slice.calculator.optimizerContext,
      }
    },
  },
  'calculator.suggestions': {
    label: 'suggestions',
    storageKey: APP_STORAGE_SUGGESTIONS_KEY,
    schema: persistedSuggestionsSliceSchema,
    build: buildSuggestionsSlice,
    apply: (state, slice) => {
      state.calculator = {
        ...state.calculator,
        suggestionsByResonatorId: slice.calculator.suggestionsByResonatorId,
      }
    },
  },
  'calculator.inventory.echoes': {
    label: 'inventory echoes',
    storageKey: APP_STORAGE_INVENTORY_ECHOES_KEY,
    schema: persistedInventoryEchoesSliceSchema,
    build: buildInventoryEchoesSlice,
    apply: (state, slice) => {
      state.calculator = {
        ...state.calculator,
        inventoryEchoes: slice.calculator.inventoryEchoes,
      }
    },
  },
  'calculator.inventory.builds': {
    label: 'inventory builds',
    storageKey: APP_STORAGE_INVENTORY_BUILDS_KEY,
    schema: persistedInventoryBuildsSliceSchema,
    build: buildInventoryBuildsSlice,
    apply: (state, slice) => {
      state.calculator = {
        ...state.calculator,
        inventoryBuilds: slice.calculator.inventoryBuilds,
      }
    },
  },
  'calculator.inventory.rotations': {
    label: 'inventory rotations',
    storageKey: APP_STORAGE_INVENTORY_ROTATIONS_KEY,
    schema: persistedInventoryRotationsSliceSchema,
    build: buildInventoryRotationsSlice,
    apply: (state, slice) => {
      state.calculator = {
        ...state.calculator,
        inventoryRotations: slice.calculator.inventoryRotations,
      }
    },
  },
}

function getPersistedDomainKeys(includeInventory: boolean): PersistedDomainKey[] {
  return includeInventory
    ? ALL_PERSISTED_DOMAIN_KEYS
    : NON_INVENTORY_DOMAIN_KEYS
}

function hasCurrentStorageEntries(): boolean {
  return ALL_PERSISTED_DOMAIN_KEYS.some((key) => localStorage.getItem(PERSISTED_DOMAIN_SPECS[key].storageKey) != null)
}

function quarantineStorageKey(key: string, raw: string): void {
  localStorage.setItem(`${APP_STORAGE_RECOVERY_PREFIX}.${Date.now()}.${key}`, raw)
  localStorage.removeItem(key)
}

function readValidatedStorageValue<T>(
  raw: string,
  schema: PersistedDomainSchema,
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

function readPersistedDomain<K extends PersistedDomainKey>(
  key: K,
): PersistedDomainSlice<K> | null {
  const spec = PERSISTED_DOMAIN_SPECS[key]
  const raw = localStorage.getItem(spec.storageKey)
  if (!raw) {
    return null
  }

  try {
    return readValidatedStorageValue(raw, spec.schema, spec.label)
  } catch (error) {
    console.warn(`[storage] failed to parse ${spec.label}`, error)
    try {
      quarantineStorageKey(spec.storageKey, raw)
    } catch (recoveryError) {
      console.warn(`[storage] failed to quarantine invalid ${spec.label}`, recoveryError)
    }
    return null
  }
}

function createPersistedStateDraft(includeInventory: boolean): PersistedStateDraft {
  const defaults = createDefaultAppState()

  return {
    version: PERSISTED_APP_STATE_VERSION,
    ui: {
      ...defaults.ui,
    },
    calculator: {
      ...defaults.calculator,
      inventoryEchoes: includeInventory ? defaults.calculator.inventoryEchoes : [],
      inventoryBuilds: includeInventory ? defaults.calculator.inventoryBuilds : [],
      inventoryRotations: includeInventory ? defaults.calculator.inventoryRotations : [],
    },
  }
}

function normalizePersistedAppStatePayload(parsed: unknown): PersistedAppState {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Snapshot must be a JSON object.')
  }

  const current = persistedAppStateSchema.safeParse(parsed)
  if (current.success) {
    return initializePersistedAppState(current.data as unknown as PersistedAppState)
  }

  const legacy = legacyPersistedAppStateSchema.safeParse(parsed)
  if (legacy.success) {
    return initializePersistedAppState(legacy.data as unknown as PersistedAppState)
  }

  throw new Error('Snapshot validation failed.')
}

function buildStateWithoutInventory(state: PersistedAppState): PersistedAppState {
  return initializePersistedAppState({
    ...state,
    calculator: {
      ...state.calculator,
      inventoryEchoes: [],
      inventoryBuilds: [],
      inventoryRotations: [],
    },
  })
}

function clearLegacyPersistedAppState(): void {
  localStorage.removeItem(LEGACY_APP_STORAGE_KEY)
  localStorage.removeItem(APP_STORAGE_BACKUP_KEY)

  if (typeof localStorage.key !== 'function') {
    return
  }

  const keysToDelete: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(`${LEGACY_APP_STORAGE_RECOVERY_PREFIX}.`)) {
      keysToDelete.push(key)
    }
  }

  for (const key of keysToDelete) {
    localStorage.removeItem(key)
  }
}

function loadLegacyPersistedAppState(): PersistedAppState | null {
  try {
    const raw = localStorage.getItem(LEGACY_APP_STORAGE_KEY)
    if (!raw) {
      const backupRaw = localStorage.getItem(APP_STORAGE_BACKUP_KEY)
      return backupRaw ? normalizePersistedAppStatePayload(JSON.parse(backupRaw)) : null
    }

    return normalizePersistedAppStatePayload(JSON.parse(raw))
  } catch (error) {
    console.warn('[storage] failed to parse legacy persisted app state', error)

    try {
      const invalidRaw = localStorage.getItem(LEGACY_APP_STORAGE_KEY)
      if (invalidRaw) {
        localStorage.setItem(`${LEGACY_APP_STORAGE_RECOVERY_PREFIX}.${Date.now()}`, invalidRaw)
        localStorage.removeItem(LEGACY_APP_STORAGE_KEY)
      }

      const backupRaw = localStorage.getItem(APP_STORAGE_BACKUP_KEY)
      return backupRaw ? normalizePersistedAppStatePayload(JSON.parse(backupRaw)) : null
    } catch (recoveryError) {
      console.warn('[storage] failed to recover invalid legacy persisted app state', recoveryError)
      return null
    }
  }
}

function migrateLegacyState(includeInventory: boolean): PersistedAppState | null {
  const legacy = loadLegacyPersistedAppState()
  if (!legacy) {
    return null
  }

  savePersistedAppState(legacy)
  clearLegacyPersistedAppState()
  return includeInventory ? legacy : buildStateWithoutInventory(legacy)
}

function assemblePersistedAppState(includeInventory: boolean): PersistedAppState | null {
  const state = createPersistedStateDraft(includeInventory)
  let hasLoadedDomain = false

  for (const key of getPersistedDomainKeys(includeInventory)) {
    const domain = readPersistedDomain(key)
    if (!domain) {
      continue
    }

    PERSISTED_DOMAIN_SPECS[key].apply(state, domain)
    hasLoadedDomain = true
  }

  return hasLoadedDomain ? initializePersistedAppState(state) : null
}

// parse persisted app state from raw json text
export function parsePersistedAppStateJson(raw: string): PersistedAppState {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Snapshot is not valid JSON.')
  }

  return normalizePersistedAppStatePayload(parsed)
}

// load persisted app state from storage, optionally omitting the inventory slice
export function loadPersistedAppState(
  options: { includeInventory?: boolean } = {},
): PersistedAppState | null {
  const includeInventory = options.includeInventory ?? true

  if (!hasCurrentStorageEntries()) {
    return migrateLegacyState(includeInventory)
  }

  return assemblePersistedAppState(includeInventory)
}

export function loadPersistedInventoryState(): {
  inventoryEchoes: PersistedAppState['calculator']['inventoryEchoes']
  inventoryBuilds: PersistedAppState['calculator']['inventoryBuilds']
  inventoryRotations: PersistedAppState['calculator']['inventoryRotations']
} {
  const legacy = !hasCurrentStorageEntries() ? migrateLegacyState(true) : null
  if (legacy) {
    return {
      inventoryEchoes: legacy.calculator.inventoryEchoes,
      inventoryBuilds: legacy.calculator.inventoryBuilds,
      inventoryRotations: legacy.calculator.inventoryRotations,
    }
  }

  const state = createPersistedStateDraft(true)
  let hasLoadedInventory = false

  for (const key of INVENTORY_DOMAIN_KEYS) {
    const domain = readPersistedDomain(key)
    if (!domain) {
      continue
    }

    PERSISTED_DOMAIN_SPECS[key].apply(state, domain)
    hasLoadedInventory = true
  }

  if (!hasLoadedInventory) {
    return {
      inventoryEchoes: [],
      inventoryBuilds: [],
      inventoryRotations: [],
    }
  }

  return {
    inventoryEchoes: state.calculator.inventoryEchoes,
    inventoryBuilds: state.calculator.inventoryBuilds,
    inventoryRotations: state.calculator.inventoryRotations,
  }
}

// validate and save persisted app state domains
export function savePersistedAppState(
  state: PersistedAppState,
  options: { domains?: PersistedDomainKey[] } = {},
): void {
  try {
    const result = persistedAppStateSchema.safeParse(state)
    if (!result.success) {
      console.error('[storage] refusing to save invalid state')
      return
    }

    const domains = new Set(options.domains ?? ALL_PERSISTED_DOMAIN_KEYS)
    for (const key of domains) {
      const spec = PERSISTED_DOMAIN_SPECS[key]
      localStorage.setItem(spec.storageKey, JSON.stringify(spec.build(state)))
    }
  } catch (error) {
    console.warn('[storage] failed to persist app state', error)
  }
}

export function markPersistedDomainsDirty(keys: PersistedDomainKey[]): void {
  let changed = false

  for (const key of keys) {
    if (pendingPersistedDomains.has(key)) {
      continue
    }

    pendingPersistedDomains.add(key)
    changed = true
  }

  if (!changed) {
    return
  }

  for (const listener of pendingPersistedDomainListeners) {
    listener()
  }
}

export function consumeDirtyPersistedDomains(): PersistedDomainKey[] {
  const keys = [...pendingPersistedDomains]
  pendingPersistedDomains.clear()
  return keys
}

export function subscribeToDirtyPersistedDomains(listener: () => void): () => void {
  pendingPersistedDomainListeners.add(listener)
  return () => {
    pendingPersistedDomainListeners.delete(listener)
  }
}

// clear persisted app state entries across current and legacy formats
export function clearPersistedAppState(): void {
  pendingPersistedDomains.clear()

  for (const key of ALL_PERSISTED_DOMAIN_KEYS) {
    localStorage.removeItem(PERSISTED_DOMAIN_SPECS[key].storageKey)
  }

  clearLegacyPersistedAppState()

  if (typeof localStorage.key !== 'function') {
    return
  }

  const recoveryKeys: string[] = []

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(`${APP_STORAGE_RECOVERY_PREFIX}.`)) {
      recoveryKeys.push(key)
    }
  }

  for (const key of recoveryKeys) {
    localStorage.removeItem(key)
  }
}
