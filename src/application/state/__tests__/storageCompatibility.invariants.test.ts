/*
  Author: Runor Ewhro
  Description: Verifies legacy migration and granular v28 scenario-library persistence.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { combatScenarioId, contextScenarioMember } from '@/domain/entities/combatScenario'
import { makeSavedScenario } from '@/domain/entities/inventoryStorage'
import { makeSavedRotation } from '@/domain/entities/inventoryStorage'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { makeAppState } from '@/engine/runtime/defaults'
import { DEF_SHOWCASE_CARD_STYLE, DEF_SHOWCASE_HIDE } from '@/domain/entities/preferences'
import { projectScenarioWorkspaceProfiles } from '@/engine/runtime/scenarioRuntime'
import {
  APPSTORECMBT,
  APPSTOREINVC,
  APPSTOREINVR,
  APPSTOREINVS,
  APPSTOREOPTS,
  APPSTOREUIPP,
  loadPrssAppS,
  loadPrssInvS,
  parsePersisted,
  saveAppState,
} from '@/application/persistence/storage'

function makeMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, value) },
  } as Storage
}

describe('persisted state compatibility', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeMemoryStorage())
  })

  afterEach(() => vi.unstubAllGlobals())

  it('migrates v22 profiles and calculator inventory into canonical scenarios and the root library', () => {
    const current = makeAppState()
    const scenario = selectedCombatScenario(current.combat)
    const profiles = projectScenarioWorkspaceProfiles(current.combat)
    const legacy = {
      version: 22,
      ui: current.ui,
      simulation: {
        runtimeRevision: 7,
        profiles,
        session: {
          activeResonatorId: scenario.team.members[0].resonatorId,
          enemyProfile: scenario.target,
        },
        inventoryEchoes: [],
        inventoryBuilds: [],
        inventoryRotations: [],
        optimizerContext: {
          resonatorId: scenario.team.members[0].resonatorId,
          settings: {
            ...current.simulation.optimizerSettings,
            resultsLimit: 321,
          },
        },
        weaponSuggests: current.simulation.weaponSuggests,
        suggestionsByResonatorId: current.simulation.suggestionsByResonatorId,
      },
    }

    const migrated = parsePersisted(JSON.stringify(legacy))
    expect(migrated.version).toBe(28)
    expect(migrated.combat.order).toHaveLength(Object.keys(profiles).length)
    expect(contextScenarioMember(selectedCombatScenario(migrated.combat)).resonatorId)
      .toBe(scenario.team.members[0].resonatorId)
    expect(migrated.library).toEqual({ echoes: [], builds: [], rotations: [], scenarios: [] })
    expect(migrated.simulation).not.toHaveProperty('profiles')
    expect(migrated.simulation).not.toHaveProperty('runtimeRevision')
    expect(migrated.simulation).not.toHaveProperty('optimizerContext')
    expect(migrated.simulation.optimizerSettingsResonatorId)
      .toBe(scenario.team.members[0].resonatorId)
    expect(migrated.simulation.optimizerSettings.resultsLimit).toBe(321)
  })

  it('migrates split v26 optimizer settings without retaining the runtime copy', () => {
    const state = makeAppState()
    const scenario = selectedCombatScenario(state.combat)
    const savedScenario = makeSavedScenario({
      name: 'v26 scenario',
      scenario,
    }, 789)
    localStorage.setItem('wwcalc.app.v26.combat.workspace', JSON.stringify({
      version: 26,
      combat: state.combat,
    }))
    localStorage.setItem('wwcalc.app.v26.inventory.scenarios', JSON.stringify({
      version: 26,
      library: { scenarios: [savedScenario] },
    }))
    localStorage.setItem('wwcalc.app.v26.optimizer-context', JSON.stringify({
      version: 26,
      simulation: {
        optimizerContext: {
          resonatorId: contextScenarioMember(scenario).resonatorId,
          settings: {
            ...state.simulation.optimizerSettings,
            keepPercent: 0.75,
          },
        },
      },
    }))

    const migrated = loadPrssAppS()
    expect(migrated?.version).toBe(28)
    expect(migrated?.combat).toEqual(state.combat)
    expect(migrated?.library.scenarios).toEqual([savedScenario])
    expect(migrated?.simulation.optimizerSettings.keepPercent).toBe(0.75)
    expect(migrated?.simulation.optimizerSettingsResonatorId)
      .toBe(contextScenarioMember(scenario).resonatorId)
    expect(migrated?.simulation).not.toHaveProperty('optimizerContext')
  })

  it('renames calculator-root and benchmark-era preferences at the v28 boundary', () => {
    const current = makeAppState()
    const legacyPreferenceKeys = new Set([
      'showEvaluationStates',
      'animatedRailPortraits',
      'showcaseCards',
    ])
    const remainingPreferences = Object.fromEntries(
      Object.entries(current.ui.preferences).filter(([key]) => !legacyPreferenceKeys.has(key)),
    )
    const legacy = {
      ...current,
      version: 27,
      simulation: undefined,
      calculator: current.simulation,
      ui: {
        ...current.ui,
        preferences: {
          ...remainingPreferences,
          showBenchStates: true,
          benchAnim2d: false,
          benchmarkCards: {
            test: {
              style: {
                ...DEF_SHOWCASE_CARD_STYLE,
                customCss: '.bench-card { color: var(--bench-accent); }',
              },
              hidden: DEF_SHOWCASE_HIDE,
            },
          },
        },
      },
    }

    const migrated = parsePersisted(JSON.stringify(legacy))
    expect(migrated.version).toBe(28)
    expect(migrated.simulation).toEqual(current.simulation)
    expect(migrated).not.toHaveProperty('calculator')
    expect(migrated.ui.preferences.showEvaluationStates).toBe(true)
    expect(migrated.ui.preferences.animatedRailPortraits).toBe(false)
    expect(migrated.ui.preferences.showcaseCards.test.style.customCss)
      .toBe('.workspace-card { color: var(--workspace-accent); }')
    expect(migrated.ui.preferences).not.toHaveProperty('showBenchStates')
    expect(migrated.ui.preferences).not.toHaveProperty('benchmarkCards')
  })

  it('collapses experimental v25 duplicate contexts and keeps the selected document', () => {
    const current = makeAppState()
    const original = selectedCombatScenario(current.combat)
    const duplicateId = combatScenarioId('scenario:selected-duplicate')
    const duplicate = {
      ...structuredClone(original),
      id: duplicateId,
      target: { ...original.target, level: original.target.level + 9 },
    }
    const legacy = {
      ...current,
      version: 25,
      library: undefined,
      combat: {
        selectedScenarioId: duplicateId,
        order: [original.id, duplicateId],
        documentsById: {
          [original.id]: { id: original.id, name: 'Original', createdAt: 1, updatedAt: 1, scenario: original },
          [duplicateId]: { id: duplicateId, name: 'Selected', createdAt: 2, updatedAt: 2, scenario: duplicate },
        },
      },
    }

    const migrated = parsePersisted(JSON.stringify(legacy))
    expect(migrated.combat.order).toEqual([duplicateId])
    expect(migrated.combat.selectedScenarioId).toBe(duplicateId)
    expect(selectedCombatScenario(migrated.combat).target.level).toBe(duplicate.target.level)
  })

  it('round-trips working scenarios and all root artifact categories through granular storage', () => {
    const state = makeAppState()
    const scenario = selectedCombatScenario(state.combat)
    const rotation = makeSavedRotation({ name: 'Stored rotation', scenario }, 122)
    state.library.rotations.push(rotation)
    state.library.scenarios.push(makeSavedScenario({
      name: 'Stored scenario',
      note: 'snapshot',
      scenario,
    }, 123))

    saveAppState(state)
    expect(localStorage.getItem(APPSTORECMBT)).toContain('scenariosById')
    expect(localStorage.getItem(APPSTOREINVS)).toContain('Stored scenario')
    expect(localStorage.getItem(APPSTOREINVC)).toContain('"echoes"')
    const storedRotations = localStorage.getItem(APPSTOREINVR)
    expect(storedRotations?.startsWith('wwcalc-lz1:')).toBe(true)
    expect(storedRotations?.length).toBeLessThan(JSON.stringify({
      version: state.version,
      library: { rotations: [rotation] },
    }).length)
    expect(localStorage.getItem(APPSTOREOPTS)).toContain('optimizerSettings')
    expect(localStorage.getItem(APPSTOREOPTS)).toContain('optimizerSettingsResonatorId')
    expect(localStorage.getItem(APPSTOREUIPP)).toContain('theme')

    const loaded = loadPrssAppS()
    expect(loaded).not.toBeNull()
    expect(loaded?.combat).toEqual(state.combat)
    expect(loaded?.library.rotations).toEqual([rotation])
    expect(loaded?.library.scenarios).toEqual(state.library.scenarios)
  })

  it('keeps Echo attacks in the live program across storage hydration', () => {
    const state = makeAppState()
    const scenario = selectedCombatScenario(state.combat)
    const echoAttack = {
      id: 'rotation:feature:echo-attack',
      type: 'feature' as const,
      featureId: 'echo:6000221:feature:echo:6000221:skill:1',
      resonatorId: scenario.team.members[0].resonatorId,
      enabled: true,
      multiplier: 1,
    }
    scenario.program = {
      ...scenario.program,
      program: [...scenario.program.program, echoAttack],
      lastRanAt: 456,
    }

    saveAppState(state, { domains: ['combat.workspace'] })
    const loaded = loadPrssAppS()
    const loadedScenario = loaded && selectedCombatScenario(loaded.combat)

    expect(loadedScenario?.program.program).toContainEqual(echoAttack)
    expect(loadedScenario?.program.lastRanAt).toBe(456)
  })

  it('backfills the optimizer owner in earlier granular v28 settings', () => {
    const state = makeAppState()
    const resonatorId = contextScenarioMember(selectedCombatScenario(state.combat)).resonatorId
    saveAppState(state)
    localStorage.setItem(APPSTOREOPTS, JSON.stringify({
      version: 28,
      simulation: {
        optimizerSettings: {
          ...state.simulation.optimizerSettings,
          resultsLimit: 77,
        },
      },
    }))

    const loaded = loadPrssAppS()
    expect(loaded?.simulation.optimizerSettingsResonatorId).toBe(resonatorId)
    expect(loaded?.simulation.optimizerSettings.resultsLimit).toBe(77)
  })

  it('continues to read plain-json rotation domains written before compression', () => {
    const state = makeAppState()
    const rotation = makeSavedRotation({
      name: 'Plain JSON rotation',
      scenario: selectedCombatScenario(state.combat),
    }, 124)
    localStorage.setItem(APPSTOREINVR, JSON.stringify({
      version: state.version,
      library: { rotations: [rotation] },
    }))

    expect(loadPrssInvS().rotations).toEqual([rotation])
    expect(localStorage.getItem(APPSTOREINVR)?.startsWith('wwcalc-lz1:')).toBe(true)
  })

  it('continues saving later domains when one storage write exceeds quota', () => {
    const state = makeAppState()
    state.library.scenarios.push(makeSavedScenario({
      name: 'Still persisted',
      scenario: selectedCombatScenario(state.combat),
    }, 125))
    const originalSetItem = localStorage.setItem.bind(localStorage)
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === APPSTOREINVR) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      originalSetItem(key, value)
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    saveAppState(state, { domains: ['library.rotations', 'library.scenarios'] })

    expect(localStorage.getItem(APPSTOREINVS)).toContain('Still persisted')
    expect(console.warn).toHaveBeenCalledWith(
      '[storage] failed to persist inventory rotations',
      expect.objectContaining({ name: 'QuotaExceededError' }),
    )
  })

  it('moves split v25 calculator artifacts into the v27 root library', () => {
    const state = makeAppState()
    const scenario = selectedCombatScenario(state.combat)
    const rotation = makeSavedRotation({ name: 'Legacy split rotation', scenario }, 456)
    localStorage.setItem('wwcalc.app.v25.combat.workspace', JSON.stringify({
      version: 25,
      combat: state.combat,
    }))
    localStorage.setItem('wwcalc.app.v25.inventory.rotations', JSON.stringify({
      version: 25,
      simulation: { inventoryRotations: [rotation] },
    }))

    const migrated = loadPrssAppS()
    expect(migrated?.library.rotations).toEqual([rotation])
    expect(migrated?.simulation).not.toHaveProperty('inventoryRotations')
    expect(localStorage.getItem('wwcalc.app.v25.inventory.rotations')).toBeNull()
  })

  it('can defer every artifact category without changing working scenarios', () => {
    const state = makeAppState()
    state.library.scenarios.push(makeSavedScenario({
      name: 'Deferred scenario',
      scenario: selectedCombatScenario(state.combat),
    }))
    saveAppState(state)

    const loaded = loadPrssAppS({ includeInventory: false })
    expect(loaded?.combat).toEqual(state.combat)
    expect(loaded?.library).toEqual({ echoes: [], builds: [], rotations: [], scenarios: [] })
  })
})
