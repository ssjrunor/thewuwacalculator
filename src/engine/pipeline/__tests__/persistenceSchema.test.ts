import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF_ENEMY_ID } from '@/domain/entities/enemy'
import { persistedSchema } from '@/domain/state/schema'
import {
  DEF_RES_ID,
  makeAppState,
  makeResProfile,
  initAppState,
} from '@/domain/state/defaults'
import { makeInvEcho } from '@/domain/entities/inventoryStorage'
import { getResonatorById } from '@/domain/services/catalogService'
import {
  APP_STORAGE_KEY,
  APPSTOREINVB,
  APPSTOREINVC,
  APPSTOREINVR,
  APPSTOREOPTC,
  APPSTORESSSN,
  APPSTOREPRFL,
  SUGG_STORE_KEY,
  APPSTOREUIPP,
  APPSTOREUILY,
  APPSTOREUISV,
  loadPrssAppS,
  parsePersisted,
  saveAppState,
} from '@/infra/persistence/storage'
import liveSnapshotRaw from '../../../../live-app-snapshot.json?raw'

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
    const state = makeAppState()

    expect(state.calculator.session.activeResonatorId).toBe(DEF_RES_ID)
    expect(state.ui.optimizerCpuHintSeen).toBe(false)
    expect(state.calculator.profiles[DEF_RES_ID]).toBeUndefined()
    expect(state.calculator.session.enemyProfile.id).toBe(DEF_ENEMY_ID)
    expect(state.calculator.inventoryEchoes).toEqual([])
    expect(state.calculator.inventoryBuilds).toEqual([])
    expect(state.calculator.inventoryRotations).toEqual([])
    expect(state.calculator.optimizerContext).toBeNull()
  })

  it('hydrates missing active resonator state back to the default resonator', () => {
    const state = makeAppState()
    state.calculator.session.activeResonatorId = null
    state.calculator.profiles = {}

    const initialized = initAppState(state)

    expect(initialized.calculator.session.activeResonatorId).toBe(DEF_RES_ID)
    expect(initialized.calculator.profiles[DEF_RES_ID]).toBeUndefined()
  })

  it('rejects persisted runtime objects containing computed fields', () => {
    const seed = getResonatorById('1412')
    if (!seed) {
      throw new Error('missing seed resonator 1412')
    }

    const state = makeAppState()
    state.calculator.session.activeResonatorId = seed.id
    state.calculator.profiles[seed.id] = makeResProfile(seed)

    const polluted = structuredClone(state)
    const profileWithInjectedField = polluted.calculator.profiles[seed.id] as unknown as Record<
      string,
      unknown
    >
    profileWithInjectedField.finalStats = {
      atk: 9999,
    }

    const parse = persistedSchema.safeParse(polluted)
    expect(parse.success).toBe(false)
  })

  it('ignores unsupported old storage keys', () => {
    const state = makeAppState() as unknown as Record<string, unknown>
    state.version = 20
    localStorage.setItem('wwcalc.app.v20', JSON.stringify(state))

    const loaded = loadPrssAppS()
    expect(loaded).toBeNull()
  })

  it('migrates a current monolithic snapshot into split persistence slices', () => {
    const state = makeAppState()
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state))

    const loaded = loadPrssAppS({ includeInventory: true })

    expect(loaded?.version).toBe(22)
    expect(localStorage.getItem(APP_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(APPSTOREUIPP)).toBeTruthy()
    expect(localStorage.getItem(APPSTOREPRFL)).toBeTruthy()
    expect(localStorage.getItem(APPSTOREINVC)).toBeTruthy()
  })

  it('parses a current snapshot export back into persisted state', () => {
    const state = makeAppState()
    const parsed = parsePersisted(JSON.stringify(state))

    expect(parsed.version).toBe(22)
    expect(parsed.calculator.session.activeResonatorId).toBe(state.calculator.session.activeResonatorId)
    expect(parsed.calculator.inventoryEchoes).toEqual(state.calculator.inventoryEchoes)
  })

  it('parses live string ui toggles in current snapshot exports', () => {
    const state = makeAppState()
    const exported = {
      ...state,
      ui: {
        ...state.ui,
        blurMode: 'off',
        entranceAnimations: 'off',
      },
    }

    const parsed = parsePersisted(JSON.stringify(exported))

    expect(parsed.ui.blurMode).toBe(false)
    expect(parsed.ui.entranceAnimations).toBe(false)
  })

  it('parses the current live app snapshot', () => {
    const parsed = parsePersisted(liveSnapshotRaw)

    expect(parsed.version).toBe(22)
    expect(parsed.ui.preferences).toBeTruthy()
    expect(parsed.ui.itemFreq).toBeTruthy()
    expect(parsed.calculator.weaponSuggests).toBeTruthy()
    expect(Object.keys(parsed.calculator.profiles).length).toBeGreaterThan(0)
  })

  it('writes the current persistence slices when saving persisted state', () => {
    const state = makeAppState()
    saveAppState(state)

    expect(localStorage.getItem(APP_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(APPSTOREUIPP)).toBeTruthy()
    expect(localStorage.getItem(APPSTOREUILY)).toBeTruthy()
    expect(localStorage.getItem(APPSTOREUISV)).toBeTruthy()
    expect(localStorage.getItem(APPSTORESSSN)).toBeTruthy()
    expect(localStorage.getItem(APPSTOREPRFL)).toBeTruthy()
    expect(localStorage.getItem(APPSTOREOPTC)).toBeTruthy()
    expect(localStorage.getItem(SUGG_STORE_KEY)).toBeTruthy()
    expect(localStorage.getItem(APPSTOREINVC)).toBeTruthy()
    expect(localStorage.getItem(APPSTOREINVB)).toBeTruthy()
    expect(localStorage.getItem(APPSTOREINVR)).toBeTruthy()
  })

  it('saves a requested domain even when another domain is invalid', () => {
    const state = makeAppState()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    state.calculator.inventoryRotations = [{ id: 'invalid-rotation' } as never]

    saveAppState(state, { domains: ['ui.layout'] })

    const layoutSlice = JSON.parse(localStorage.getItem(APPSTOREUILY) ?? '{}')
    expect(layoutSlice.ui.mainMode).toBe(state.ui.mainMode)
    expect(localStorage.getItem(APPSTOREINVR)).toBeNull()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('quarantines persisted profile slices containing invalid controls', () => {
    const seed = getResonatorById('1306')
    if (!seed) {
      throw new Error('missing seed resonator 1306')
    }

    const state = makeAppState()
    const profile = makeResProfile(seed)
    profile.runtime.local.controls.undefined = { bad: true } as never
    profile.runtime.local.controls['resonator:1306:crown_of_wills:stacks'] = 1
    state.calculator.profiles[seed.id] = profile

    localStorage.setItem(APPSTOREPRFL, JSON.stringify({
      version: state.version,
      calculator: {
        runtimeRevision: state.calculator.runtimeRevision,
        profiles: state.calculator.profiles,
      },
    }))

    const loaded = loadPrssAppS()

    expect(loaded?.calculator.profiles[seed.id]).toBeUndefined()
    expect(localStorage.getItem(APPSTOREPRFL)).toBeNull()
  })

  it('can load persisted state without eagerly hydrating inventory data', () => {
    const state = makeAppState()
    state.calculator.inventoryEchoes = [makeInvEcho({
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

    saveAppState(state)
    const loaded = loadPrssAppS({ includeInventory: false })

    expect(loaded?.calculator.inventoryEchoes).toEqual([])
    expect(localStorage.getItem(APPSTOREINVC)).toBeTruthy()
  })

  it('rejects unsupported snapshot versions', () => {
    const state = makeAppState() as unknown as Record<string, unknown>
    state.version = 20

    expect(() => parsePersisted(JSON.stringify(state))).toThrow('Snapshot validation failed.')
  })

  it('hydrates current snapshots that are missing optimizerContext', () => {
    const state = makeAppState() as unknown as Record<string, unknown>
    const calculator = state.calculator as Record<string, unknown>
    delete calculator.optimizerContext

    const parsed = parsePersisted(JSON.stringify(state))
    expect(parsed.version).toBe(22)
    expect(parsed.calculator.optimizerContext).toBeNull()
  })

  it('hydrates ui snapshots that are missing the optimizer cpu hint flag', () => {
    const state = makeAppState() as unknown as Record<string, unknown>
    const ui = state.ui as Record<string, unknown>
    delete ui.optimizerCpuHintSeen

    const parsed = parsePersisted(JSON.stringify(state))
    expect(parsed.ui.optimizerCpuHintSeen).toBe(false)
  })

})
