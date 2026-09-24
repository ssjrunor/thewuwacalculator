/*
  Author: Runor Ewhro
  Description: Verifies the one-working-scenario-per-context-resonator invariant.
*/

import { describe, expect, it, vi } from 'vitest'
import { combatScenarioId } from '@/domain/entities/combatScenario.ts'
import {
  addScenario,
  listContextResonatorScenarios,
  replaceScenario,
  scenarioForContextResonator,
  selectScenario,
  summarizeScenario,
  type ScenarioWorkspace,
} from '@/domain/entities/scenarioLibrary.ts'
import { makeAppState, makeResProfile, makeScenarioFromProfiles } from '@/engine/runtime/defaults.ts'
import { listResSds } from '@/data/catalog/resonatorSeedService.ts'

describe('scenario workspace', () => {
  it('replaces a getter-backed record without hydrating other scenarios or mutating the original', () => {
    const workspace = makeAppState().combat
    const current = workspace.scenariosById[workspace.selectedScenarioId]
    const inactiveId = combatScenarioId('scenario:inactive')
    const inactive = vi.fn(() => { throw new Error('Inactive scenario was hydrated') })
    const currentGetter = vi.fn(() => current)
    const records: ScenarioWorkspace['scenariosById'] = Object.defineProperties({}, {
      [current.id]: { enumerable: true, configurable: true, get: currentGetter },
      [inactiveId]: { enumerable: true, configurable: true, get: inactive },
    })
    const lazyWorkspace = {
      ...workspace,
      order: [...workspace.order, inactiveId],
      scenariosById: records,
      summaryById: {
        [current.id]: summarizeScenario(current),
        [inactiveId]: { resonatorId: 'unloaded', level: 1, sequence: 0, rotationNodes: 0 },
      },
    }
    Object.freeze(records)
    const replacement = { ...current, revision: current.revision + 1 }
    const replaced = replaceScenario(lazyWorkspace, replacement)

    expect(replaced.scenariosById[current.id]).toBe(replacement)
    expect(Object.getOwnPropertyDescriptor(replaced.scenariosById, current.id)).toMatchObject({
      value: replacement, writable: true, configurable: true, enumerable: true,
    })
    expect(Object.getOwnPropertyDescriptor(replaced.scenariosById, inactiveId)?.get).toBe(inactive)
    expect(Object.getOwnPropertyDescriptor(records, current.id)?.get).toBe(currentGetter)
    expect(records[current.id]).toBe(current)
    expect(inactive).not.toHaveBeenCalled()
    expect(replaced.summaryById).toBe(lazyWorkspace.summaryById)
  })

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
