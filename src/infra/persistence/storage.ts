/*
  Author: Runor Ewhro
  Description: Handles persisted app-state loading, migration, validation,
               slice-based storage, and recovery cleanup.
*/

import type { PersistedAppState } from '@/domain/entities/appState'
import type { PersistedSliceKey } from '@/domain/state/serialization'
import { createDefaultAppState, initializePersistedAppState } from '@/domain/state/defaults'
import {
  LEGACY_PERSISTED_APP_STATE_VERSION,
  PERSISTED_APP_STATE_VERSION,
  legacyPersistedAppStateSchema,
  persistedAppStateSchema,
  persistedInventorySliceSchema,
  persistedProfilesSliceSchema,
  persistedSessionSliceSchema,
} from '@/domain/state/schema'

export const APP_STORAGE_KEY = `wwcalc.app.v${PERSISTED_APP_STATE_VERSION}`
export const APP_STORAGE_SESSION_KEY = `${APP_STORAGE_KEY}.session`
export const APP_STORAGE_PROFILES_KEY = `${APP_STORAGE_KEY}.profiles`
export const APP_STORAGE_INVENTORY_KEY = `${APP_STORAGE_KEY}.inventory`
export const APP_STORAGE_RECOVERY_PREFIX = `${APP_STORAGE_KEY}.recovery`

export const APP_STORAGE_BACKUP_KEY = `wwcalc.app.v${LEGACY_PERSISTED_APP_STATE_VERSION}.backup`

export const LEGACY_APP_STORAGE_KEY = `wwcalc.app.v${LEGACY_PERSISTED_APP_STATE_VERSION}`
export const LEGACY_APP_STORAGE_RECOVERY_PREFIX = `${LEGACY_APP_STORAGE_KEY}.recovery`
const ALL_CURRENT_STORAGE_KEYS = [
  APP_STORAGE_SESSION_KEY,
  APP_STORAGE_PROFILES_KEY,
  APP_STORAGE_INVENTORY_KEY,
] as const

type PersistedSessionSlice = ReturnType<typeof buildPersistedSessionSlice>
type PersistedProfilesSlice = ReturnType<typeof buildPersistedProfilesSlice>
type PersistedInventorySlice = ReturnType<typeof buildPersistedInventorySlice>

function buildPersistedSessionSlice(state: PersistedAppState) {
  return {
    version: state.version,
    ui: state.ui,
    calculator: {
      session: state.calculator.session,
    },
  }
}

function buildPersistedProfilesSlice(state: PersistedAppState) {
  return {
    version: state.version,
    calculator: {
      runtimeRevision: state.calculator.runtimeRevision,
      profiles: state.calculator.profiles,
      optimizerContext: state.calculator.optimizerContext,
      suggestionsByResonatorId: state.calculator.suggestionsByResonatorId,
    },
  }
}

function buildPersistedInventorySlice(state: PersistedAppState) {
  return {
    version: state.version,
    calculator: {
      inventoryEchoes: state.calculator.inventoryEchoes,
      inventoryBuilds: state.calculator.inventoryBuilds,
      inventoryRotations: state.calculator.inventoryRotations,
    },
  }
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

function parseValidatedStorageValue<T>(
    raw: string,
    schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
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

  return result.data
}

function quarantineStorageKey(key: string, raw: string): void {
  localStorage.setItem(`${APP_STORAGE_RECOVERY_PREFIX}.${Date.now()}.${key}`, raw)
  localStorage.removeItem(key)
}

function readValidatedSlice<T>(
    key: string,
    schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
    label: string,
): T | null {
  const raw = localStorage.getItem(key)
  if (!raw) {
    return null
  }

  try {
    return parseValidatedStorageValue(raw, schema, label)
  } catch (error) {
    console.warn(`[storage] failed to parse ${label}`, error)
    try {
      quarantineStorageKey(key, raw)
    } catch (recoveryError) {
      console.warn(`[storage] failed to quarantine invalid ${label}`, recoveryError)
    }
    return null
  }
}

function assemblePersistedAppState(
    sessionSlice: PersistedSessionSlice | null,
    profilesSlice: PersistedProfilesSlice | null,
    inventorySlice: PersistedInventorySlice | null,
    includeInventory: boolean,
): PersistedAppState {
  const defaults = createDefaultAppState()

  return initializePersistedAppState({
    version: PERSISTED_APP_STATE_VERSION,
    ui: sessionSlice?.ui ?? defaults.ui,
    calculator: {
      runtimeRevision: profilesSlice?.calculator.runtimeRevision ?? defaults.calculator.runtimeRevision,
      profiles: profilesSlice?.calculator.profiles ?? defaults.calculator.profiles,
      inventoryEchoes: includeInventory
          ? (inventorySlice?.calculator.inventoryEchoes ?? defaults.calculator.inventoryEchoes)
          : [],
      inventoryBuilds: includeInventory
          ? (inventorySlice?.calculator.inventoryBuilds ?? defaults.calculator.inventoryBuilds)
          : [],
      inventoryRotations: includeInventory
          ? (inventorySlice?.calculator.inventoryRotations ?? defaults.calculator.inventoryRotations)
          : [],
      optimizerContext: profilesSlice?.calculator.optimizerContext ?? defaults.calculator.optimizerContext,
      suggestionsByResonatorId:
          profilesSlice?.calculator.suggestionsByResonatorId ?? defaults.calculator.suggestionsByResonatorId,
      session: sessionSlice?.calculator.session ?? defaults.calculator.session,
    },
  })
}

function hasCurrentStorageEntries(): boolean {
  return ALL_CURRENT_STORAGE_KEYS.some((key) => localStorage.getItem(key) != null)
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

  const sessionSlice = (
    readValidatedSlice(APP_STORAGE_SESSION_KEY, persistedSessionSliceSchema, 'session slice')
  ) as PersistedSessionSlice | null
  const profilesSlice = (
    readValidatedSlice(APP_STORAGE_PROFILES_KEY, persistedProfilesSliceSchema, 'profiles slice')
  ) as PersistedProfilesSlice | null
  let inventorySlice: PersistedInventorySlice | null = null
  if (includeInventory) {
    inventorySlice = readValidatedSlice(
        APP_STORAGE_INVENTORY_KEY,
        persistedInventorySliceSchema,
        'inventory slice',
    ) as PersistedInventorySlice | null
  }

  if (!sessionSlice && !profilesSlice && !inventorySlice) {
    return migrateLegacyState(includeInventory)
  }

  return assemblePersistedAppState(sessionSlice, profilesSlice, inventorySlice, includeInventory)
}

export function loadPersistedInventoryState(): PersistedInventorySlice['calculator'] {
  const currentSlice = readValidatedSlice(
      APP_STORAGE_INVENTORY_KEY,
      persistedInventorySliceSchema,
      'inventory slice',
  ) as PersistedInventorySlice | null

  if (currentSlice) {
    return currentSlice.calculator
  }

  const legacy = migrateLegacyState(true)
  return {
    inventoryEchoes: legacy?.calculator.inventoryEchoes ?? [],
    inventoryBuilds: legacy?.calculator.inventoryBuilds ?? [],
    inventoryRotations: legacy?.calculator.inventoryRotations ?? [],
  }
}

// validate and save persisted app state slices
export function savePersistedAppState(
    state: PersistedAppState,
    options: { slices?: PersistedSliceKey[] } = {},
): void {
  try {
    const result = persistedAppStateSchema.safeParse(state)
    if (!result.success) {
      console.error('[storage] refusing to save invalid state')
      return
    }

    const slices = new Set(options.slices ?? ['session', 'profiles', 'inventory'])

    if (slices.has('session')) {
      localStorage.setItem(APP_STORAGE_SESSION_KEY, JSON.stringify(buildPersistedSessionSlice(state)))
    }

    if (slices.has('profiles')) {
      localStorage.setItem(APP_STORAGE_PROFILES_KEY, JSON.stringify(buildPersistedProfilesSlice(state)))
    }

    if (slices.has('inventory')) {
      localStorage.setItem(APP_STORAGE_INVENTORY_KEY, JSON.stringify(buildPersistedInventorySlice(state)))
    }
  } catch (error) {
    console.warn('[storage] failed to persist app state', error)
  }
}

// clear persisted app state entries across current and legacy formats
export function clearPersistedAppState(): void {
  for (const key of ALL_CURRENT_STORAGE_KEYS) {
    localStorage.removeItem(key)
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
