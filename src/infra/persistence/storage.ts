/*
  Author: Runor Ewhro
  Description: Handles persisted app-state loading, validation, granular
               domain writes, and recovery cleanup.
*/

import type { PersistedState } from '@/domain/entities/appState'
import type { PersistedUnknown } from '@/domain/state/defaults'
import { makeAppState, initAppState } from '@/domain/state/defaults'
import {
  APP_STATE_VER,
  persistedSchema,
  prssInvBldsS,
  prssInvChsSl,
  prssInvRttnS,
  prssOptCtxSl,
  prssPrflSlcS,
  prssSssnSlcS,
  prssSuggsSlc,
  prssUiPprnSl,
  prssUiLytSlc,
  prssUiSvdRoh,
} from '@/domain/state/schema'

export const APP_STORAGE_KEY = `wwcalc.app.v${APP_STATE_VER}`
export const APPSTOREUIPP = `${APP_STORAGE_KEY}.ui.appearance`
export const APPSTOREUILY = `${APP_STORAGE_KEY}.ui.layout`
export const APPSTOREUISV = `${APP_STORAGE_KEY}.ui.saved-rotation-preferences`
export const APPSTORESSSN = `${APP_STORAGE_KEY}.session`
export const APPSTOREPRFL = `${APP_STORAGE_KEY}.profiles`
export const APPSTOREOPTC = `${APP_STORAGE_KEY}.optimizer-context`
export const SUGG_STORE_KEY = `${APP_STORAGE_KEY}.suggestions`
export const APPSTOREINVC = `${APP_STORAGE_KEY}.inventory.echoes`
export const APPSTOREINVB = `${APP_STORAGE_KEY}.inventory.builds`
export const APPSTOREINVR = `${APP_STORAGE_KEY}.inventory.rotations`
export const APPSTORERCVR = `${APP_STORAGE_KEY}.recovery`

export type PersistKey =
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

const NONINVDMNKEY: PersistKey[] = [
  'ui.appearance',
  'ui.layout',
  'ui.savedRotationPreferences',
  'calculator.session',
  'calculator.profiles',
  'calculator.optimizerContext',
  'calculator.suggestions',
]

const INV_DOMAIN_KEYS: PersistKey[] = [
  'calculator.inventory.echoes',
  'calculator.inventory.builds',
  'calculator.inventory.rotations',
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
      mainMode: state.ui.mainMode,
      showSubHits: state.ui.showSubHits,
      compactInv: state.ui.compactInv,
      seeEquipped: state.ui.seeEquipped,
      haveHistory: state.ui.haveHistory,
      historyMax: state.ui.historyMax,
      itemFreq: state.ui.itemFreq,
      optimizerCpuHintSeen: state.ui.optimizerCpuHintSeen,
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

function makeSessionSlice(state: PersistedState) {
  return {
    version: state.version,
    calculator: {
      session: state.calculator.session,
    },
  }
}

function makeProfiles(state: PersistedState) {
  return {
    version: state.version,
    calculator: {
      runtimeRevision: state.calculator.runtimeRevision,
      profiles: state.calculator.profiles,
    },
  }
}

function makeOptCtxSlice(state: PersistedState) {
  return {
    version: state.version,
    calculator: {
      optimizerContext: state.calculator.optimizerContext,
    },
  }
}

function makeSuggestSlice(state: PersistedState) {
  return {
    version: state.version,
    calculator: {
      weaponSuggests: state.calculator.weaponSuggests,
      suggestionsByResonatorId: state.calculator.suggestionsByResonatorId,
    },
  }
}

function makeInvEchoes(state: PersistedState) {
  return {
    version: state.version,
    calculator: {
      inventoryEchoes: state.calculator.inventoryEchoes,
    },
  }
}

function makeInvBuilds(state: PersistedState) {
  return {
    version: state.version,
    calculator: {
      inventoryBuilds: state.calculator.inventoryBuilds,
    },
  }
}

function makeInvRotSlice(state: PersistedState) {
  return {
    version: state.version,
    calculator: {
      inventoryRotations: state.calculator.inventoryRotations,
    },
  }
}

type PersistSpecMap = {
  'ui.appearance': PersistSpec<ReturnType<typeof makeAppearance>>
  'ui.layout': PersistSpec<ReturnType<typeof makeLayout>>
  'ui.savedRotationPreferences': PersistSpec<ReturnType<typeof makeRotPrefs>>
  'calculator.session': PersistSpec<ReturnType<typeof makeSessionSlice>>
  'calculator.profiles': PersistSpec<ReturnType<typeof makeProfiles>>
  'calculator.optimizerContext': PersistSpec<ReturnType<typeof makeOptCtxSlice>>
  'calculator.suggestions': PersistSpec<ReturnType<typeof makeSuggestSlice>>
  'calculator.inventory.echoes': PersistSpec<ReturnType<typeof makeInvEchoes>>
  'calculator.inventory.builds': PersistSpec<ReturnType<typeof makeInvBuilds>>
  'calculator.inventory.rotations': PersistSpec<ReturnType<typeof makeInvRotSlice>>
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
  'calculator.session': {
    label: 'session',
    storageKey: APPSTORESSSN,
    schema: prssSssnSlcS,
    build: makeSessionSlice,
    apply: (state, slice) => {
      state.calculator = {
        ...state.calculator,
        session: slice.calculator.session,
      }
    },
  },
  'calculator.profiles': {
    label: 'profiles',
    storageKey: APPSTOREPRFL,
    schema: prssPrflSlcS,
    build: makeProfiles,
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
    storageKey: APPSTOREOPTC,
    schema: prssOptCtxSl,
    build: makeOptCtxSlice,
    apply: (state, slice) => {
      state.calculator = {
        ...state.calculator,
        optimizerContext: slice.calculator.optimizerContext,
      }
    },
  },
  'calculator.suggestions': {
    label: 'suggestions',
    storageKey: SUGG_STORE_KEY,
    schema: prssSuggsSlc,
    build: makeSuggestSlice,
    apply: (state, slice) => {
      state.calculator = {
        ...state.calculator,
        weaponSuggests: slice.calculator.weaponSuggests,
        suggestionsByResonatorId: slice.calculator.suggestionsByResonatorId,
      }
    },
  },
  'calculator.inventory.echoes': {
    label: 'inventory echoes',
    storageKey: APPSTOREINVC,
    schema: prssInvChsSl,
    build: makeInvEchoes,
    apply: (state, slice) => {
      state.calculator = {
        ...state.calculator,
        inventoryEchoes: slice.calculator.inventoryEchoes,
      }
    },
  },
  'calculator.inventory.builds': {
    label: 'inventory builds',
    storageKey: APPSTOREINVB,
    schema: prssInvBldsS,
    build: makeInvBuilds,
    apply: (state, slice) => {
      state.calculator = {
        ...state.calculator,
        inventoryBuilds: slice.calculator.inventoryBuilds,
      }
    },
  },
  'calculator.inventory.rotations': {
    label: 'inventory rotations',
    storageKey: APPSTOREINVR,
    schema: prssInvRttnS,
    build: makeInvRotSlice,
    apply: (state, slice) => {
      state.calculator = {
        ...state.calculator,
        inventoryRotations: slice.calculator.inventoryRotations,
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

function readMnlthPrssS(): PersistedState | null {
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
    return readVldtStor(raw, spec.schema, spec.label)
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

function normPrssAppS(parsed: unknown): PersistedState {
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
): PersistedState {
  return initAppState(state)
}

function ssmbPrssAppS(includeInventory: boolean): PersistedState | null {
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
    return readMnlthPrssS()
  }

  const normalState = normalizeAppState(state)
  saveAppState(normalState, { domains: loadedDomains })
  return normalState
}

// parse persisted app state from raw json text
export function parsePersisted(raw: string): PersistedState {
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
): PersistedState | null {
  const includeInventory = options.includeInventory ?? true

  if (!hasCurStoreE()) {
    return readMnlthPrssS()
  }

  return ssmbPrssAppS(includeInventory)
}

export function loadPrssInvS(): {
  inventoryEchoes: PersistedState['calculator']['inventoryEchoes']
  inventoryBuilds: PersistedState['calculator']['inventoryBuilds']
  inventoryRotations: PersistedState['calculator']['inventoryRotations']
} {
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
    const migrated = readMnlthPrssS()
    if (migrated) {
      return {
        inventoryEchoes: migrated.calculator.inventoryEchoes,
        inventoryBuilds: migrated.calculator.inventoryBuilds,
        inventoryRotations: migrated.calculator.inventoryRotations,
      }
    }

    return {
      inventoryEchoes: [],
      inventoryBuilds: [],
      inventoryRotations: [],
    }
  }

  const normalState = normalizeAppState(state)
  saveAppState(normalState, { domains: INV_DOMAIN_KEYS })

  return {
    inventoryEchoes: normalState.calculator.inventoryEchoes,
    inventoryBuilds: normalState.calculator.inventoryBuilds,
    inventoryRotations: normalState.calculator.inventoryRotations,
  }
}

// validate and save persisted app state domains
export function saveAppState(
  state: PersistedState,
  options: { domains?: PersistKey[] } = {},
): void {
  try {
    const normalState = normalizeAppState(state as unknown as PersistedUnknown)

    const domains = new Set(options.domains ?? ALL_DOMAIN_KEYS)
    for (const key of domains) {
      const spec = DOMAIN_SPECS[key]
      const slice = spec.build(normalState)
      const result = spec.schema.safeParse(slice)
      if (!result.success) {
        console.error(`[storage] refusing to save invalid ${spec.label}`, result.error)
        continue
      }

      localStorage.setItem(spec.storageKey, JSON.stringify(result.data))
    }
  } catch (error) {
    console.warn('[storage] failed to persist app state', error)
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
