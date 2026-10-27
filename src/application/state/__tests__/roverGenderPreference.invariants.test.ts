/*
  Author: Runor Ewhro
  description: covers rover preference conversion, teammate collisions, and persistence.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contextScenarioMember, combatScenarioId, makeScenarioTeam, type CombatScenario } from '@/domain/entities/combatScenario'
import { makeSavedBuild, makeSavedRotation, makeSavedScenario } from '@/domain/entities/inventoryStorage'
import { ROVER_PAIRS, roverIdForGender, roverIsVisible } from '@/domain/entities/roverGender'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { listResSds } from '@/data/catalog/resonatorSeedService'
import { makeAppState, makeCustomBuff, makeResProfile, makeScenarioFromProfiles, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults'
import { parseCombatScenario, persistedSchema } from '@/engine/runtime/schema'
import {
  convertScenarioRoverGender,
  convertWorkspaceRoverGender,
  convertRotationNodesRoverGender,
  convertManualBuffsRoverGender,
  serializedByteSize,
} from '@/application/state/roverGenderConversion'
import { useAppStore } from '@/application/state/store'
import { makeInitialTeammate } from '@/application/state/teammateInitialization'
import { consumePersist, loadPrssAppS, saveAppState } from '@/application/persistence/storage'
import { selectPersisted } from '@/application/state/serialization'
import { makeMemberManualEffect, memberManualEffectId } from '@/engine/runtime/scenarioEnvironment'

const seeds = new Map(listResSds().map((seed) => [seed.id, seed]))
function seed(id: string) {
  const value = seeds.get(id)
  if (!value) throw new Error(`Missing test resonator ${id}`)
  return value
}

describe('Rover gender preference', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('maps every mirrored Rover form and leaves Both unfiltered', () => {
    for (const pair of ROVER_PAIRS) {
      expect(roverIdForGender(pair.female, 'male')).toBe(pair.male)
      expect(roverIdForGender(pair.male, 'female')).toBe(pair.female)
      expect(roverIsVisible(pair.male, 'male')).toBe(true)
      expect(roverIsVisible(pair.female, 'male')).toBe(false)
      expect(roverIsVisible(pair.female, 'both')).toBe(true)
    }
  })

it('converts nested imported values while preserving text and item IDs', () => {
    const nodes = [{
      id: 'repeat', type: 'repeat' as const,
      times: { type: 'read' as const, path: 'state.controls.resonator:1502:stacks' },
      items: [{
        id: 'feature', type: 'feature' as const, resonatorId: '1502', featureId: '1502:feature:1',
        attached: {
          conditions: [{ id: 'switch', type: 'condition' as const, changes: [
            { type: 'set' as const, path: 'runtime.rotation.activeResonatorId', value: '1502' },
            { type: 'set' as const, path: 'runtime.state.controls.resonator:1502:mode', value: '1502', resonatorId: '1502' },
            { type: 'set' as const, path: 'runtime.state.controls.weapon:21020046:passive:active', value: true, resonatorId: '1502' },
          ] }],
          features: [],
        },
      }],
      setup: [{ id: 'note', type: 'note' as const, text: '1502 is the original Rover' }],
    }]
    const mapped = convertRotationNodesRoverGender(nodes, 'male')
    expect(mapped[0]).toMatchObject({
      times: { path: 'state.controls.resonator:1501:stacks' },
      items: [{ resonatorId: '1501', featureId: '1501:feature:1', attached: { conditions: [{ changes: [
        { path: 'runtime.rotation.activeResonatorId', value: '1501' },
        { path: 'runtime.state.controls.resonator:1501:mode', value: '1502', resonatorId: '1501' },
        { path: 'runtime.state.controls.weapon:21020046:passive:active', value: true, resonatorId: '1501' },
      ] }] } }],
      setup: [{ text: '1502 is the original Rover' }],
    })
    expect(convertRotationNodesRoverGender(nodes, 'both')).toBe(nodes)
    expect(nodes[0].items[0].resonatorId).toBe('1502')
  })

  it('normalizes once even when opaque member IDs and notes retain the source Rover ID', () => {
    const scenario = makeScenarioFromProfiles({ '1502': makeResProfile(seed('1502')) }, null, 0, '1502')
    scenario.program.program = [{ id: 'note', type: 'note', text: 'Imported from 1502' }]
    const converted = convertScenarioRoverGender(scenario, 'male')
    expect(convertScenarioRoverGender(converted, 'male')).toBe(converted)
  })

  it('resolves imported skill-specific buffs in files and member environment effects', () => {
    const buffs = makeCustomBuff()
    buffs.modifiers = [{
      id: 'imported', enabled: true, scope: 'skill', matchMode: 'skillId',
      skillId: '1502:tune-break', effect: 'addMultiplier', value: 25, label: '1502 custom label',
    }]
    const scenario = makeScenarioFromProfiles({ '1502': makeResProfile(seed('1502')) }, null, 0, '1502')
    scenario.environment.manualEffects = [makeMemberManualEffect(scenario.team.members[0].id, buffs)]
    const converted = convertScenarioRoverGender(scenario, 'male')
    for (const buff of [convertManualBuffsRoverGender(buffs, 'male'), converted.environment.manualEffects[0].buffs]) {
      expect(buff.modifiers[0]).toMatchObject({ skillId: '1501:tune-break', value: 25, label: '1502 custom label' })
    }
    expect(convertManualBuffsRoverGender(buffs, 'both')).toBe(buffs)
    expect(buffs.modifiers[0]).toMatchObject({ skillId: '1502:tune-break' })
  })

  it('normalizes directly hydrated profiles and saved equipment owners using the imported preference', () => {
    const snapshot = makeAppState()
    const scenario = makeScenarioFromProfiles({ '1502': makeResProfile(seed('1502')) }, null, 0, '1502')
    snapshot.ui.preferences.roverGender = 'male'
    snapshot.combat = { order: [scenario.id], selectedScenarioId: scenario.id, scenariosById: { [scenario.id]: scenario } }
    snapshot.library.builds = [makeSavedBuild({ name: 'Imported build', resonatorId: '1502', resonatorName: 'Rover', build: scenario.team.members[0].loadout })]
    useAppStore.getState().hydrate(snapshot)
    expect(contextScenarioMember(selectedCombatScenario(useAppStore.getState().combat)).resonatorId).toBe('1501')
    expect(useAppStore.getState().library.builds[0].resonatorId).toBe('1501')
    expect(snapshot.library.builds[0].resonatorId).toBe('1502')
  })

  it('keeps the larger teammate state when both Rovers share a scenario', () => {
    const base = selectedCombatScenario(makeAppState().combat)
    const male = makeScenarioMemberFromProfile(makeResProfile(seed('1501')))
    const female = makeScenarioMemberFromProfile(makeResProfile(seed('1502')))
    female.local.controls.extra = 'a'.repeat(500)
    const scenario: CombatScenario = {
      ...base,
      team: makeScenarioTeam([base.team.members[0], male, female]),
      initialOnFieldMemberId: male.id,
      environment: {
        ...base.environment,
        routing: { bySourceMemberId: {
          [male.id]: { 'outroSkill:1501:outro': female.id },
          [female.id]: { 'outroSkill:1502:outro': male.id },
        } },
      },
      program: {
        ...base.program,
        program: [{
          id: 'rover-feature', type: 'feature' as const,
          resonatorId: '1502', featureId: '1502:feature:1',
        }],
      },
    }

    expect(serializedByteSize(female)).toBeGreaterThan(serializedByteSize(male))
    const converted = convertScenarioRoverGender(scenario, 'male')
    expect(converted.team.members).toHaveLength(2)
    expect(converted.team.members[1]).toMatchObject({
      id: female.id,
      resonatorId: '1501',
      local: { controls: { extra: 'a'.repeat(500) } },
    })
    expect(converted.initialOnFieldMemberId).toBe(female.id)
    expect(converted.environment.routing.bySourceMemberId[female.id]).toEqual({
      'outroSkill:1501:outro': female.id,
    })
    expect(converted.program.program[0]).toMatchObject({
      resonatorId: '1501', featureId: '1501:feature:1',
    })
    expect(parseCombatScenario(converted).success).toBe(true)
  })

  it('selects the larger complete Rover scenario before changing its identity', () => {
    const male = makeScenarioFromProfiles({ '1501': makeResProfile(seed('1501')) }, null, 0, '1501')
    const female = makeScenarioFromProfiles({ '1502': makeResProfile(seed('1502')) }, null, 0, '1502')
    const maleId = combatScenarioId('male-rover')
    const femaleId = combatScenarioId('female-rover')
    const largerFemale = {
      ...female,
      id: femaleId,
      program: {
        ...female.program,
        program: [{ id: 'extra', type: 'note' as const, text: 'long rotation'.repeat(200) }],
      },
    }
    const workspace = {
      selectedScenarioId: maleId,
      order: [maleId, femaleId],
      scenariosById: { [maleId]: { ...male, id: maleId }, [femaleId]: largerFemale },
    }

    expect(serializedByteSize(largerFemale)).toBeGreaterThan(serializedByteSize(workspace.scenariosById[maleId]))
    const converted = convertWorkspaceRoverGender(workspace, 'male')
    expect(converted.order).toEqual([femaleId])
    expect(converted.selectedScenarioId).toBe(femaleId)
    expect(contextScenarioMember(converted.scenariosById[femaleId]).resonatorId).toBe('1501')
    expect(converted.scenariosById[femaleId].program.program).toHaveLength(1)
  })

  it('uses a fuller dormant Rover setup when it collides with an active teammate', () => {
    const base = selectedCombatScenario(makeAppState().combat)
    const male = makeScenarioMemberFromProfile(makeResProfile(seed('1501')))
    const female = makeScenarioMemberFromProfile(makeResProfile(seed('1502')))
    female.local.controls.extra = 'x'.repeat(500)
    const scenario: CombatScenario = {
      ...base,
      team: makeScenarioTeam([base.team.members[0], male]),
      dormantMembersByResonatorId: { '1502': {
        member: female,
        manualEffect: {
          enabled: true,
          label: 'Rover support',
          buffs: makeMemberManualEffect(female.id, makeCustomBuff()).buffs,
        },
      } },
    }

    const converted = convertScenarioRoverGender(scenario, 'male')
    expect(converted.team.members[1]).toMatchObject({
      id: male.id,
      resonatorId: '1501',
      local: { controls: { extra: 'x'.repeat(500) } },
    })
    expect(converted.dormantMembersByResonatorId).toEqual({})
    expect(converted.environment.manualEffects.find((effect) => effect.id === memberManualEffectId(male.id)))
      .toMatchObject({ enabled: true, label: 'Rover support' })
    expect(parseCombatScenario(converted).success).toBe(true)
  })

  it('keeps the converted identity when switching back to Both', () => {
    const state = useAppStore.getState()
    const active = selectedCombatScenario(state.combat).team.members[0]
    const femaleBuild = makeSavedBuild({
      name: 'Female Rover',
      resonatorId: '1502',
      resonatorName: 'Rover: Spectro',
      build: active.loadout,
    })
    useAppStore.setState((current) => ({
      ...current,
      library: { ...current.library, builds: [femaleBuild] },
    }))

    useAppStore.getState().setRoverGender('male')
    expect(useAppStore.getState().ui.preferences.roverGender).toBe('male')
    expect(useAppStore.getState().library.builds[0].resonatorId).toBe('1501')

    useAppStore.getState().setRoverGender('both')
    expect(useAppStore.getState().library.builds[0].resonatorId).toBe('1501')
    expect(useAppStore.getState()).not.toHaveProperty('roverModeArchives')
    expect(persistedSchema.safeParse(selectPersisted(useAppStore.getState())).success).toBe(true)
  })

  it('initializes the other Rover fresh after returning to Both', () => {
    const female = makeScenarioFromProfiles({ '1502': makeResProfile(seed('1502')) }, null, 0, '1502')
    female.team.members[0].local.controls.previousSetup = 'saved only on female'
    useAppStore.getState().applyScenarioSnapshot(female)

    useAppStore.getState().setRoverGender('male')
    useAppStore.getState().setRoverGender('both')

    const selected = selectedCombatScenario(useAppStore.getState().combat)
    expect(contextScenarioMember(selected).resonatorId).toBe('1501')
    expect(selected.team.members[0].local.controls.previousSetup).toBe('saved only on female')
    const freshFemale = makeInitialTeammate('1502', selected)
    expect(freshFemale?.resonatorId).toBe('1502')
    expect(freshFemale?.local.controls).not.toHaveProperty('previousSetup')
  })

  it('normalizes a directly inserted Rover teammate', () => {
    useAppStore.getState().setRoverGender('male')
    const scenario = selectedCombatScenario(useAppStore.getState().combat)
    const female = makeScenarioMemberFromProfile(makeResProfile(seed('1502')))
    female.local.controls['1502:mode'] = true

    useAppStore.getState().insertScenarioMember(scenario.id, 1, female)

    const teammate = selectedCombatScenario(useAppStore.getState().combat).team.members[1]!
    expect(teammate.resonatorId).toBe('1501')
    expect(teammate.local.controls['1501:mode']).toBe(true)
  })

  it('converts saved rotation and scenario snapshots with the selected gender', () => {
    const female = makeScenarioFromProfiles({ '1502': makeResProfile(seed('1502')) }, null, 0, '1502')
    const rotation = makeSavedRotation({ name: 'Female rotation', scenario: female })
    const savedScenario = makeSavedScenario({ name: 'Female scenario', scenario: female })
    useAppStore.setState((current) => ({
      ...current,
      library: {
        ...current.library,
        rotations: [rotation],
        scenarios: [savedScenario],
      },
    }))

    useAppStore.getState().setRoverGender('male')
    const library = useAppStore.getState().library
    expect(contextScenarioMember(library.rotations[0].scenario).resonatorId).toBe('1501')
    expect(contextScenarioMember(library.scenarios[0].scenario).resonatorId).toBe('1501')
    expect(parseCombatScenario(library.rotations[0].scenario).success).toBe(true)
  })

it('persists the chosen gender with no inactive mode snapshot', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      get length() { return values.size },
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      key: (index: number) => [...values.keys()][index] ?? null,
    } as Storage)
    useAppStore.getState().setRoverGender('female')
    const snapshot = selectPersisted(useAppStore.getState())
    saveAppState(snapshot, { domains: ['ui.layout', 'combat.workspace'] })

    const loaded = loadPrssAppS({ includeInventory: false })
    expect(loaded?.ui.preferences.roverGender).toBe('female')
    expect(loaded).not.toHaveProperty('roverModeArchives')
  })
})
