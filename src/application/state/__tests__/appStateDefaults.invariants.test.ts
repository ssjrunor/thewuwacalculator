/*
  Author: Runor Ewhro
  Description: Protects fresh-app max-on-init and saved-state preservation.
*/

import { describe, expect, it } from 'vitest'
import { contextScenarioMember } from '@/domain/entities/combatScenario'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { DEF_UI_PREFS } from '@/domain/entities/preferences'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import {
  DEF_RES_ID,
  initAppState,
  makeAppState,
  makeResProfile,
  makeScenarioFromProfiles,
} from '@/engine/runtime/defaults'

describe('app state defaults', () => {
  it('initializes the first resonator using the default max-on-init preference', () => {
    const seed = getResSeedBy(DEF_RES_ID)!
    const state = makeAppState()
    const member = contextScenarioMember(selectedCombatScenario(state.combat))
    const expected = makeResProfile(seed, { maxed: DEF_UI_PREFS.maxResOnInit })

    expect(state.ui.preferences.maxResOnInit).toBe(true)
    expect(member.resonatorId).toBe(DEF_RES_ID)
    expect(member.progression.level).toBe(90)
    expect(member.progression.sequence).toBe(0)
    expect(member.progression).toEqual(expected.runtime.progression)
    expect(member.loadout).toEqual(expected.runtime.build)
    expect(member.local.controls).toEqual(expected.runtime.local.controls)
  })

  it('does not max a saved resonator just because max-on-init is enabled', () => {
    const state = makeAppState()
    const seed = getResSeedBy(DEF_RES_ID)!
    const profile = makeResProfile(seed)
    const scenario = makeScenarioFromProfiles({ [seed.id]: profile }, null, 0, seed.id)
    const restored = initAppState({
      ...state,
      combat: {
        selectedScenarioId: scenario.id,
        order: [scenario.id],
        scenariosById: { [scenario.id]: scenario },
      },
    })
    const member = contextScenarioMember(selectedCombatScenario(restored.combat))

    expect(restored.ui.preferences.maxResOnInit).toBe(true)
    expect(member.progression).toEqual(profile.runtime.progression)
    expect(member.loadout).toEqual(profile.runtime.build)
    expect(member.local.controls).toEqual(profile.runtime.local.controls)
  })
})
