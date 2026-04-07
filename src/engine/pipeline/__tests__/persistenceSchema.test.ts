import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ENEMY_ID } from '@/domain/entities/enemy'
import { persistedAppStateSchema } from '@/domain/state/schema'
import {
  DEFAULT_RESONATOR_ID,
  createDefaultAppState,
  createOptimizerContextFromRuntime,
  createDefaultResonatorProfile,
  initializePersistedAppState,
} from '@/domain/state/defaults'
import { createInventoryEchoEntry } from '@/domain/entities/inventoryStorage'
import { getResonatorById } from '@/domain/services/catalogService'
import {
  APP_STORAGE_BACKUP_KEY,
  APP_STORAGE_KEY,
  APP_STORAGE_INVENTORY_BUILDS_KEY,
  APP_STORAGE_INVENTORY_ECHOES_KEY,
  APP_STORAGE_INVENTORY_ROTATIONS_KEY,
  APP_STORAGE_OPTIMIZER_CONTEXT_KEY,
  APP_STORAGE_SESSION_KEY,
  APP_STORAGE_PROFILES_KEY,
  APP_STORAGE_SUGGESTIONS_KEY,
  APP_STORAGE_UI_APPEARANCE_KEY,
  APP_STORAGE_UI_LAYOUT_KEY,
  APP_STORAGE_UI_SAVED_ROTATION_PREFERENCES_KEY,
  LEGACY_APP_STORAGE_KEY,
  LEGACY_APP_STORAGE_RECOVERY_PREFIX,
  loadPersistedAppState,
  parsePersistedAppStateJson,
  savePersistedAppState,
} from '@/infra/persistence/storage'

describe('persistedAppStateSchema', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value)
        },
        removeItem: (key: string) => {
          store.delete(key)
        },
        clear: () => {
          store.clear()
        },
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        get length() {
          return store.size
        },
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates an initialized default calculator state', () => {
    const state = createDefaultAppState()

    expect(state.calculator.session.activeResonatorId).toBe(DEFAULT_RESONATOR_ID)
    expect(state.ui.optimizerCpuHintSeen).toBe(false)
    expect(state.calculator.profiles[DEFAULT_RESONATOR_ID]).toBeUndefined()
    expect(state.calculator.session.enemyProfile.id).toBe(DEFAULT_ENEMY_ID)
    expect(state.calculator.inventoryEchoes).toEqual([])
    expect(state.calculator.inventoryBuilds).toEqual([])
    expect(state.calculator.inventoryRotations).toEqual([])
    expect(state.calculator.optimizerContext).toBeNull()
  })

  it('hydrates missing active resonator state back to the default resonator', () => {
    const state = createDefaultAppState()
    state.calculator.session.activeResonatorId = null
    state.calculator.profiles = {}

    const normalized = initializePersistedAppState(state)

    expect(normalized.calculator.session.activeResonatorId).toBe(DEFAULT_RESONATOR_ID)
    expect(normalized.calculator.profiles[DEFAULT_RESONATOR_ID]).toBeUndefined()
  })

  it('rejects persisted runtime objects containing computed fields', () => {
    const seed = getResonatorById('1412')
    if (!seed) {
      throw new Error('missing seed resonator 1412')
    }

    const state = createDefaultAppState()
    state.calculator.session.activeResonatorId = seed.id
    state.calculator.profiles[seed.id] = createDefaultResonatorProfile(seed)

    const polluted = structuredClone(state)
    const profileWithInjectedField = polluted.calculator.profiles[seed.id] as unknown as Record<
      string,
      unknown
    >
    profileWithInjectedField.finalStats = {
      atk: 9999,
    }

    const parse = persistedAppStateSchema.safeParse(polluted)
    expect(parse.success).toBe(false)
  })

  it('ignores unsupported legacy storage keys', () => {
    const state = createDefaultAppState() as unknown as Record<string, unknown>
    state.version = 20
    localStorage.setItem('wwcalc.app.v20', JSON.stringify(state))

    const loaded = loadPersistedAppState()
    expect(loaded).toBeNull()
  })

  it('parses a current snapshot export back into persisted state', () => {
    const state = createDefaultAppState()
    const parsed = parsePersistedAppStateJson(JSON.stringify(state))

    expect(parsed.version).toBe(22)
    expect(parsed.calculator.session.activeResonatorId).toBe(state.calculator.session.activeResonatorId)
    expect(parsed.calculator.inventoryEchoes).toEqual(state.calculator.inventoryEchoes)
  })

  it('writes the current persistence slices when saving persisted state', () => {
    const state = createDefaultAppState()
    savePersistedAppState(state)

    expect(localStorage.getItem(APP_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(APP_STORAGE_UI_APPEARANCE_KEY)).toBeTruthy()
    expect(localStorage.getItem(APP_STORAGE_UI_LAYOUT_KEY)).toBeTruthy()
    expect(localStorage.getItem(APP_STORAGE_UI_SAVED_ROTATION_PREFERENCES_KEY)).toBeTruthy()
    expect(localStorage.getItem(APP_STORAGE_SESSION_KEY)).toBeTruthy()
    expect(localStorage.getItem(APP_STORAGE_PROFILES_KEY)).toBeTruthy()
    expect(localStorage.getItem(APP_STORAGE_OPTIMIZER_CONTEXT_KEY)).toBeTruthy()
    expect(localStorage.getItem(APP_STORAGE_SUGGESTIONS_KEY)).toBeTruthy()
    expect(localStorage.getItem(APP_STORAGE_INVENTORY_ECHOES_KEY)).toBeTruthy()
    expect(localStorage.getItem(APP_STORAGE_INVENTORY_BUILDS_KEY)).toBeTruthy()
    expect(localStorage.getItem(APP_STORAGE_INVENTORY_ROTATIONS_KEY)).toBeTruthy()
    expect(localStorage.getItem(APP_STORAGE_BACKUP_KEY)).toBeNull()
  })

  it('can load persisted state without eagerly hydrating inventory data', () => {
    const state = createDefaultAppState()
    state.calculator.inventoryEchoes = [createInventoryEchoEntry({
      uid: 'echo:test',
      id: '310100032',
      set: 3101,
      mainEcho: true,
      mainStats: {
        primary: { key: 'atkPercent', value: 33 },
        secondary: { key: 'atkFlat', value: 150 },
      },
      substats: {
        critRate: 8.1,
      },
    })]

    savePersistedAppState(state)
    const loaded = loadPersistedAppState({ includeInventory: false })

    expect(loaded?.calculator.inventoryEchoes).toEqual([])
    expect(localStorage.getItem(APP_STORAGE_INVENTORY_ECHOES_KEY)).toBeTruthy()
  })

  it('rejects unsupported legacy snapshot versions', () => {
    const state = createDefaultAppState() as unknown as Record<string, unknown>
    state.version = 20

    expect(() => parsePersistedAppStateJson(JSON.stringify(state))).toThrow('Snapshot validation failed.')
  })

  it('hydrates current snapshots that are missing optimizerContext', () => {
    const state = createDefaultAppState() as unknown as Record<string, unknown>
    const calculator = state.calculator as Record<string, unknown>
    delete calculator.optimizerContext

    const parsed = parsePersistedAppStateJson(JSON.stringify(state))
    expect(parsed.version).toBe(22)
    expect(parsed.calculator.optimizerContext).toBeNull()
  })

  it('hydrates ui snapshots that are missing the optimizer cpu hint flag', () => {
    const state = createDefaultAppState() as unknown as Record<string, unknown>
    const ui = state.ui as Record<string, unknown>
    delete ui.optimizerCpuHintSeen

    const parsed = parsePersistedAppStateJson(JSON.stringify(state))
    expect(parsed.ui.optimizerCpuHintSeen).toBe(false)
  })

  it('re-persists normalized current storage slices after schema defaults change', () => {
    const seed = getResonatorById('1412')
    if (!seed) {
      throw new Error('missing seed resonator 1412')
    }

    const state = createDefaultAppState()
    state.calculator.profiles[seed.id] = createDefaultResonatorProfile(seed)

    const legacyProfilesSlice = {
      version: state.version,
      calculator: {
        runtimeRevision: state.calculator.runtimeRevision,
        profiles: structuredClone(state.calculator.profiles),
      },
    }

    delete (legacyProfilesSlice.calculator.profiles[seed.id].runtime.local.combat as Record<string, unknown>).glacioChafe
    delete (legacyProfilesSlice.calculator.profiles[seed.id].runtime.local.combat as Record<string, unknown>).electroFlare
    delete (legacyProfilesSlice.calculator.profiles[seed.id].runtime.local.combat as Record<string, unknown>).electroRage

    localStorage.setItem(APP_STORAGE_PROFILES_KEY, JSON.stringify(legacyProfilesSlice))

    const loaded = loadPersistedAppState()
    expect(loaded?.calculator.profiles[seed.id].runtime.local.combat.glacioChafe).toBe(0)
    expect(loaded?.calculator.profiles[seed.id].runtime.local.combat.electroFlare).toBe(0)
    expect(loaded?.calculator.profiles[seed.id].runtime.local.combat.electroRage).toBe(0)

    const rewritten = JSON.parse(localStorage.getItem(APP_STORAGE_PROFILES_KEY) ?? '{}')
    expect(rewritten.calculator.profiles[seed.id].runtime.local.combat.glacioChafe).toBe(0)
    expect(rewritten.calculator.profiles[seed.id].runtime.local.combat.electroFlare).toBe(0)
    expect(rewritten.calculator.profiles[seed.id].runtime.local.combat.electroRage).toBe(0)
  })

  it('hydrates optimizer settings that are missing combo target fields and low-memory mode', () => {
    const seed = getResonatorById('1506')
    if (!seed) {
      throw new Error('missing seed resonator 1506')
    }

    const profile = createDefaultResonatorProfile(seed)
    const state = createDefaultAppState()
    state.calculator.optimizerContext = createOptimizerContextFromRuntime({
      id: profile.resonatorId,
      base: structuredClone(profile.runtime.progression),
      build: {
        weapon: structuredClone(profile.runtime.build.weapon),
        echoes: structuredClone(profile.runtime.build.echoes),
        team: structuredClone(profile.runtime.team),
      },
      state: {
        controls: structuredClone(profile.runtime.local.controls),
        manualBuffs: structuredClone(profile.runtime.local.manualBuffs),
        combat: structuredClone(profile.runtime.local.combat),
      },
      rotation: structuredClone(profile.runtime.rotation),
      teamRuntimes: structuredClone(profile.runtime.teamRuntimes),
    }, {
      targetSkillId: null,
      rotationMode: false,
      resultsLimit: 128,
      keepPercent: 0,
      enableGpu: true,
      lockedMainEchoId: null,
      allowedSets: {
        3: [],
        5: [],
      },
      mainStatFilter: [],
      selectedBonus: null,
      statConstraints: {},
    })
    const legacySettings = structuredClone(state.calculator.optimizerContext.settings) as unknown as Record<
      string,
      unknown
    >
    delete legacySettings.targetMode
    delete legacySettings.targetComboSourceId
    delete legacySettings.lowMemoryMode
    state.calculator.optimizerContext.settings = legacySettings as never

    const parsed = parsePersistedAppStateJson(JSON.stringify(state))
    expect(parsed.calculator.optimizerContext?.settings.targetMode).toBe('skill')
    expect(parsed.calculator.optimizerContext?.settings.targetComboSourceId).toBeNull()
    expect(parsed.calculator.optimizerContext?.settings.lowMemoryMode).toBe(false)
  })

  it('quarantines invalid primary storage and falls back to the backup snapshot', () => {
    const backupState = createDefaultAppState()
    localStorage.setItem(APP_STORAGE_BACKUP_KEY, JSON.stringify(backupState))
    localStorage.setItem(LEGACY_APP_STORAGE_KEY, '{"broken":')

    const loaded = loadPersistedAppState()
    expect(loaded?.version).toBe(backupState.version)
    expect(localStorage.getItem(LEGACY_APP_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(APP_STORAGE_SESSION_KEY)).toBeTruthy()

    const recoveryKeys = Array.from(
      { length: localStorage.length },
      (_, index) => localStorage.key(index),
    ).filter((key): key is string => Boolean(key?.startsWith(`${LEGACY_APP_STORAGE_RECOVERY_PREFIX}.`)))

    expect(recoveryKeys.length).toBe(0)
  })
})
