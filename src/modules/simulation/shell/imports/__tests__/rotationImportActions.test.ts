/*
  Author: Runor Ewhro
  description: verifies each post-parse rotation import choice changes only its promised state.
*/

import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/application/state/store'
import type { NormalizedImportedRotation } from '@/application/imports/rotationPayload.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { contextScenarioMember } from '@/domain/entities/combatScenario.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { consumePersist } from '@/application/persistence/storage.ts'
import { applyRotationImport } from '../rotation.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeResProfile, makeScenarioFromProfiles } from '@/engine/runtime/defaults'

function entry(name = 'Imported'): NormalizedImportedRotation {
  const scenario = structuredClone(selectedCombatScenario(useAppStore.getState().combat))
  const member = contextScenarioMember(scenario)
  const node: RotationNode = {
    id: 'imported-step',
    type: 'feature',
    featureId: 'imported-feature',
    resonatorId: member.resonatorId,
    enabled: true,
    multiplier: 1,
  }
  scenario.program = { ...scenario.program, program: [node] }
  scenario.target = { ...scenario.target, level: scenario.target.level + 10 }
  scenario.team.members[0].progression.level = 42
  return { name, resName: member.resonatorId, scenario }
}

describe('post-parse rotation import actions', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })

  it.each(['build', 'rotation'] as const)('loads and saves an opposite-gender Rover %s with resolved references', async (load) => {
    useAppStore.getState().setRoverGender('male')
    const existing = makeScenarioFromProfiles({ '1501': makeResProfile(getResSeedBy('1501')!) }, null, 0, '1501')
    existing.team.members[0].progression.level = 71
    useAppStore.getState().applyScenarioSnapshot(existing)
    const scenario = makeScenarioFromProfiles({ '1502': makeResProfile(getResSeedBy('1502')!) }, null, 0, '1502')
    scenario.team.members[0].progression.level = 42
    scenario.program.program = [{ id: 'switch', type: 'condition', resonatorId: '1502', changes: [
      { type: 'set', path: 'runtime.rotation.activeResonatorId', value: '1502' },
      { type: 'set', path: 'runtime.state.controls.resonator:1502:mode', value: true, resonatorId: '1502' },
    ] }]
    await applyRotationImport([{ name: 'Opposite Rover', resName: 'Rover', scenario }], { load, save: true })
    const state = useAppStore.getState()
    const current = selectedCombatScenario(state.combat)
    expect(contextScenarioMember(current).resonatorId).toBe('1501')
    expect(contextScenarioMember(current).progression.level).toBe(load === 'build' ? 42 : 71)
    for (const result of [current, state.library.rotations.at(-1)!.scenario]) {
      expect(result.program.program[0]).toMatchObject({ resonatorId: '1501', changes: [
        { path: 'runtime.rotation.activeResonatorId', value: '1501' },
        { path: 'runtime.state.controls.resonator:1501:mode', resonatorId: '1501' },
      ] })
    }
    expect(scenario.program.program[0]).toMatchObject({ resonatorId: '1502' })
  })

it('loads steps into the existing context and leaves saved rotations unchanged', async () => {
    const imported = entry()
    const before = structuredClone(selectedCombatScenario(useAppStore.getState().combat))
    const savedCount = useAppStore.getState().library.rotations.length

    await applyRotationImport([imported], { load: 'rotation', save: false })

    const after = selectedCombatScenario(useAppStore.getState().combat)
    expect(after.program.program).toEqual(imported.scenario.program.program)
    expect(after.program.program).not.toBe(imported.scenario.program.program)
    expect(after.target).toEqual(before.target)
    expect(after.team).toEqual(before.team)
    expect(after.environment).toEqual(before.environment)
    expect(useAppStore.getState().library.rotations).toHaveLength(savedCount)
  })

it('loads the full build and leaves saved rotations unchanged', async () => {
    const imported = entry()
    const savedCount = useAppStore.getState().library.rotations.length

    await applyRotationImport([imported], { load: 'build', save: false })

    const after = selectedCombatScenario(useAppStore.getState().combat)
    expect(after.program.program).toEqual(imported.scenario.program.program)
    expect(after.target.level).toBe(imported.scenario.target.level)
    expect(contextScenarioMember(after).progression.level).toBe(42)
    expect(useAppStore.getState().library.rotations).toHaveLength(savedCount)
  })

it('saves received rotations and preserves the working scenario', async () => {
    const entries = [entry('First'), entry('Second')]
    const before = structuredClone(selectedCombatScenario(useAppStore.getState().combat))
    const savedCount = useAppStore.getState().library.rotations.length

    await applyRotationImport(entries, { load: 'none', save: true })

    expect(selectedCombatScenario(useAppStore.getState().combat)).toEqual(before)
    expect(useAppStore.getState().library.rotations).toHaveLength(savedCount + 2)
  })

  it('loads the first received build and saves every received rotation when both are chosen', async () => {
    const entries = [entry('First'), entry('Second')]
    const savedCount = useAppStore.getState().library.rotations.length

    await applyRotationImport(entries, { load: 'build', save: true })

    expect(selectedCombatScenario(useAppStore.getState().combat).program.program)
      .toEqual(entries[0].scenario.program.program)
    expect(useAppStore.getState().library.rotations).toHaveLength(savedCount + 2)
  })
})
