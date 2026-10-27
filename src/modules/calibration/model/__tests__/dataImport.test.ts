/*
  Author: Runor Ewhro
  description: locks the off-thread import resolver to the same current and
               legacy persistence contracts used by the settings page.
*/

import { describe, expect, it, vi } from 'vitest'
import { makeAppState, makeResProfile, makeScenarioFromProfiles, makeSuggest } from '@/engine/runtime/defaults'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { contextScenarioMember } from '@/domain/entities/combatScenario'
import { scenarioIdForContextResonator } from '@/domain/entities/scenarioLibrary'
import { makeSavedBuild, makeSavedRotation, makeSavedScenario } from '@/domain/entities/inventoryStorage'
import { DEF_SHOWCASE_CARD_STYLE, DEF_SHOWCASE_HIDE } from '@/domain/entities/preferences'
import { resMprtData } from '../dataManagement'
import { runDataImportJob } from '../dataImport'
import { runDataImport } from '../dataImportClient'

describe('calibration data import jobs', () => {
  function roverSnapshot() {
    const snapshot = makeAppState()
    const profile = makeResProfile(getResSeedBy('1502')!)
    profile.runtime.progression.level = 42
    const scenario = makeScenarioFromProfiles({ '1502': profile }, null, 0, '1502')
    scenario.team.members[0].local.controls['resonator:1502:mode'] = true
    scenario.program.program = [{ id: 'switch', type: 'condition', changes: [
      { type: 'set', path: 'runtime.rotation.activeResonatorId', value: '1502' },
    ] }]
    snapshot.combat = { order: [scenario.id], selectedScenarioId: scenario.id, scenariosById: { [scenario.id]: scenario } }
    snapshot.library.builds = [makeSavedBuild({ name: 'Rover build', resonatorId: '1502', resonatorName: 'Rover', build: scenario.team.members[0].loadout })]
    snapshot.library.rotations = [makeSavedRotation({ name: 'Rover rotation', scenario })]
    snapshot.library.scenarios = [makeSavedScenario({ name: 'Rover scenario', scenario })]
    snapshot.simulation.suggestionsByResonatorId = { '1502': makeSuggest() }
    snapshot.simulation.optimizerSettingsResonatorId = '1502'
    snapshot.ui.preferences.showcaseCards = { '1502': { style: { ...DEF_SHOWCASE_CARD_STYLE }, hidden: { ...DEF_SHOWCASE_HIDE } } }
    return { snapshot, profile, scenario }
  }

  it('auto job tells app data, game data and everything else apart', async () => {
    const { snapshot } = roverSnapshot()
    const current = makeAppState()
    const auto = (raw: string) => runDataImportJob({ kind: 'auto', source: { kind: 'text', raw }, currentState: current })

    expect((await auto(JSON.stringify(snapshot))).kind).toBe('snapshot')
    expect((await auto(JSON.stringify({ exportFormat: 'wwcalc-data', version: 1, kind: 'settings', exportedAt: '', data: { ui: snapshot.ui } }))).kind).toBe('snapshot')
    expect((await auto(JSON.stringify({ charInfo: {}, controls: {}, stores: {} }))).kind).toBe('legacy')
    const game = JSON.stringify({ resonators: [], weapons: [], echoes: [] })
    expect(await auto(game)).toEqual({ kind: 'gameData', raw: game })
    const rotation = JSON.stringify({ kind: 'rotation-export', rotations: [] })
    expect(await auto(rotation)).toEqual({ kind: 'other', raw: rotation })
    expect(await auto('k3V-tQ9')).toEqual({ kind: 'other', raw: 'k3V-tQ9' })
  })

  it.each(['male', 'female', 'both'] as const)('resolves a full snapshot using its own %s preference', (gender) => {
    const { snapshot } = roverSnapshot()
    snapshot.ui.preferences.roverGender = gender
    const current = makeAppState()
    current.ui.preferences.roverGender = 'male'
    const imported = resMprtData(JSON.stringify(snapshot), current).snapshot
    const targetId = gender === 'male' ? '1501' : '1502'
    expect(imported.ui.preferences.roverGender).toBe(gender)
    const scenarioId = scenarioIdForContextResonator(imported.combat, targetId)!
    expect(scenarioId).toBeTruthy()
    expect(contextScenarioMember(imported.combat.scenariosById[scenarioId]).progression.level).toBe(42)
    expect(imported.library.builds[0].resonatorId).toBe(targetId)
    for (const entry of [...imported.library.rotations, ...imported.library.scenarios]) {
      expect(contextScenarioMember(entry.scenario).resonatorId).toBe(targetId)
      expect(entry.scenario.program.program[0]).toMatchObject({ changes: [{ value: targetId }] })
    }
    expect(Object.keys(imported.simulation.suggestionsByResonatorId)).toEqual([targetId])
    expect(imported.simulation.optimizerSettingsResonatorId).toBe(targetId)
    expect(Object.keys(imported.ui.preferences.showcaseCards)).toEqual([targetId])
  })

  it.each(['current-resonator', 'profiles', 'inventory', 'settings', 'session'] as const)('normalizes a %s slice before it is saved or hydrated', (kind) => {
    const { snapshot: source, profile, scenario } = roverSnapshot()
    const current = makeAppState()
    current.ui.preferences.roverGender = 'male'
    let data: unknown
    if (kind === 'current-resonator') {
      const existing = makeScenarioFromProfiles({ '1501': makeResProfile(getResSeedBy('1501')!) }, null, 0, '1501')
      existing.program.program = [{ id: 'larger-existing', type: 'note', text: 'Existing state'.repeat(500) }]
      current.combat = { order: [existing.id], selectedScenarioId: existing.id, scenariosById: { [existing.id]: existing } }
      data = { profile, suggestions: makeSuggest() }
    } else if (kind === 'profiles') data = { profiles: { '1502': profile }, activeResonatorId: '1502' }
    else if (kind === 'inventory') data = { inventoryEchoes: [], inventoryBuilds: source.library.builds, inventoryRotations: source.library.rotations, savedScenarios: source.library.scenarios }
    else if (kind === 'settings') {
      current.combat = source.combat
      current.library = source.library
      data = { ui: current.ui }
    } else {
      current.combat = source.combat
      data = { session: { activeResonatorId: '1502', enemyProfile: scenario.target } }
    }
    const imported = resMprtData(JSON.stringify({ exportFormat: 'wwcalc-data', version: 1, kind, data }), current).snapshot
    expect(imported.ui.preferences.roverGender).toBe('male')
    expect(imported.combat.order.map(id => contextScenarioMember(imported.combat.scenariosById[id]).resonatorId)).not.toContain('1502')
    expect(imported.library.builds.some(entry => entry.resonatorId === '1502')).toBe(false)
    for (const entry of [...imported.library.rotations, ...imported.library.scenarios]) expect(contextScenarioMember(entry.scenario).resonatorId).toBe('1501')
    if (kind === 'current-resonator' || kind === 'profiles') {
      const id = scenarioIdForContextResonator(imported.combat, '1501')!
      expect(contextScenarioMember(imported.combat.scenariosById[id]).progression.level).toBe(42)
    }
  })

  it('keeps the current Rover preference when importing a legacy account through the worker job', async () => {
    const currentState = makeAppState()
    currentState.ui.preferences.roverGender = 'male'
    const result = await runDataImportJob({ kind: 'legacy', currentState, source: { kind: 'text', raw: JSON.stringify({
      charInfo: { activeCharacterId: '1502', characterRuntimeStates: { '1502': { Id: '1502', CharacterLevel: 42 } } },
      controls: {}, stores: { echoPresets: [{ charId: '1502', name: 'Rover build', echoes: [] }] },
    }) } })
    const snapshot = result.result.snapshot
    expect(snapshot.ui.preferences.roverGender).toBe('male')
    const id = scenarioIdForContextResonator(snapshot.combat, '1501')!
    expect(id).toBeTruthy()
    expect(contextScenarioMember(snapshot.combat.scenariosById[id]).progression.level).toBe(42)
    expect(snapshot.library.builds[0].resonatorId).toBe('1501')
  })

  it('releases its import worker after the completed job', async () => {
    vi.useFakeTimers()
    const workers: WorkerStub[] = []
    class WorkerStub {
      constructor() { workers.push(this) }
      onmessage: ((event: MessageEvent<{ id: number; ok: boolean; result: unknown }>) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      postMessage = vi.fn()
      terminate = vi.fn()
    }
    vi.stubGlobal('Worker', WorkerStub)
    try {
      const pending = runDataImport('legacy', '{}')
      await Promise.resolve()
      expect(workers).toHaveLength(1)
      workers[0]!.onmessage?.({ data: { id: 1, ok: true, result: {} } } as MessageEvent<{ id: number; ok: boolean; result: unknown }>)
      await pending
      vi.advanceTimersByTime(1_999)
      expect(workers[0]!.terminate).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(workers[0]!.terminate).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('resolves a current snapshot supplied as transferred file bytes', async () => {
    const snapshot = makeAppState()
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).buffer
    const resolved = await runDataImportJob({
      kind: 'snapshot',
      source: { kind: 'bytes', bytes },
      currentState: snapshot,
    })

    expect(resolved.kind).toBe('snapshot')
    if (resolved.kind === 'snapshot') {
      expect(resolved.result.label).toBe('full snapshot')
      expect(resolved.result.snapshot).toEqual(snapshot)
    }
  })

  it('preserves the current state outside an imported settings slice', async () => {
    const currentState = makeAppState()
    const changedUi = {
      ...currentState.ui,
      compactInv: !currentState.ui.compactInv,
    }
    const raw = JSON.stringify({
      exportFormat: 'wwcalc-data',
      version: 1,
      kind: 'settings',
      exportedAt: '2026-09-15T00:00:00.000Z',
      data: { ui: changedUi },
    })
    const resolved = await runDataImportJob({
      kind: 'snapshot',
      source: { kind: 'text', raw },
      currentState,
    })

    expect(resolved.kind).toBe('snapshot')
    if (resolved.kind === 'snapshot') {
      expect(resolved.result.label).toBe('settings backup')
      expect(resolved.result.snapshot.ui.compactInv).toBe(changedUi.compactInv)
      expect(resolved.result.snapshot.combat).toEqual(currentState.combat)
      expect(resolved.result.snapshot.library).toEqual(currentState.library)
    }
  })
})
