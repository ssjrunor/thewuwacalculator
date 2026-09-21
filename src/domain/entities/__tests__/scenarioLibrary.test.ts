/*
  Author: Runor Ewhro
  Description: Verifies the one-working-scenario-per-context-resonator invariant.
*/

import { describe, expect, it } from 'vitest'
import { combatScenarioId } from '@/domain/entities/combatScenario.ts'
import {
  addScenario,
  listContextResonatorScenarios,
  replaceScenario,
  scenarioForContextResonator,
  selectScenario,
} from '@/domain/entities/scenarioLibrary.ts'
import { makeAppState, makeResProfile, makeScenarioFromProfiles } from '@/engine/runtime/defaults.ts'
import { listResSds } from '@/data/catalog/resonatorSeedService.ts'

describe('scenario workspace', () => {
  it('indexes one stable working scenario for each context resonator', () => {
    const workspace = makeAppState().combat
    const seed = listResSds().find((candidate) => (
      candidate.id !== workspace.scenariosById[workspace.selectedScenarioId].team.members[0].resonatorId
    ))!
    const scenario = {
      ...makeScenarioFromProfiles({ [seed.id]: makeResProfile(seed) }, null, 0, seed.id),
      id: combatScenarioId(`scenario:${seed.id}`),
    }
    const added = addScenario(workspace, scenario, false)

    expect(listContextResonatorScenarios(added)).toHaveLength(2)
    expect(scenarioForContextResonator(added, seed.id)).toBe(scenario)
    expect(selectScenario(added, scenario.id).selectedScenarioId).toBe(scenario.id)
  })

  it('rejects another live scenario for an existing context but permits replacement in place', () => {
    const workspace = makeAppState().combat
    const current = workspace.scenariosById[workspace.selectedScenarioId]
    const duplicate = { ...structuredClone(current), id: combatScenarioId('scenario:duplicate') }

    expect(() => addScenario(workspace, duplicate)).toThrow(/working scenario already exists/i)

    const replacement = { ...structuredClone(current), revision: current.revision + 1 }
    const replaced = replaceScenario(workspace, replacement)
    expect(replaced.scenariosById[current.id]).toEqual(replacement)
    expect(replaced.order).toEqual(workspace.order)
  })
})
