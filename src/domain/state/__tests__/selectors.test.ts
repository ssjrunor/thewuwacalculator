import { describe, expect, it } from 'vitest'
import type { AppStore } from '@/domain/state/store'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { makeAppState, makeResProfile, makeTeamMember } from '@/domain/state/defaults'
import { selWorkDrvd } from '@/domain/state/selectors'

const CHISA_UNRAVELING_CONTROL_KEY = 'team:1508:team:1508:unraveling_law_zero:active'

function asAppStore() {
  return makeAppState() as unknown as AppStore
}

describe('main prepared selectors', () => {
  it('reuses prepared main for non-runtime calculator changes', () => {
    const initial = asAppStore()
    const first = selWorkDrvd(initial)

    const secondState = {
      ...initial,
      calculator: {
        ...initial.calculator,
        suggestionsByResonatorId: {
          ...initial.calculator.suggestionsByResonatorId,
        },
      },
    } as AppStore

    const second = selWorkDrvd(secondState)

    expect(second.prepWork).toBe(first.prepWork)
  })

  it('rebuilds prepared main when runtime revision changes', () => {
    const initial = asAppStore()
    const first = selWorkDrvd(initial)

    const secondState = {
      ...initial,
      calculator: {
        ...initial.calculator,
        runtimeRevision: initial.calculator.runtimeRevision + 1,
      },
    } as AppStore

    const second = selWorkDrvd(secondState)

    expect(second.prepWork).not.toBe(first.prepWork)
  })

  it('normalizes negative-effect combat state in the derived main runtime', () => {
    const state = asAppStore()
    const activeSeed = getResSeedBy('1207')!
    const yuanwuSeed = getResSeedBy('1307')!
    const chisaSeed = getResSeedBy('1508')!
    const activeProfile = makeResProfile(activeSeed)

    activeProfile.runtime.team = ['1207', '1307', '1508']
    activeProfile.runtime.teamRuntimes = [
      makeTeamMember(yuanwuSeed),
      makeTeamMember(chisaSeed),
    ]
    activeProfile.runtime.local.combat.electroFlare = 20
    activeProfile.runtime.local.combat.electroRage = 20
    activeProfile.runtime.local.combat.havocBane = 9
    activeProfile.runtime.local.combat.spectroFrazzle = 4
    activeProfile.runtime.local.controls[CHISA_UNRAVELING_CONTROL_KEY] = true

    state.calculator.session.activeResonatorId = activeSeed.id
    state.calculator.profiles = {
      [activeSeed.id]: activeProfile,
    }
    state.calculator.runtimeRevision += 1

    const workspace = selWorkDrvd(state)

    expect(workspace.actRt?.state.combat.electroFlare).toBe(13)
    expect(workspace.actRt?.state.combat.electroRage).toBe(13)
    expect(workspace.actRt?.state.combat.havocBane).toBe(6)
    expect(workspace.actRt?.state.combat.spectroFrazzle).toBe(0)
  })

  it('zeros electro rage when electro flare is not above its default cap', () => {
    const state = asAppStore()
    const activeSeed = getResSeedBy('1207')!
    const yuanwuSeed = getResSeedBy('1307')!
    const activeProfile = makeResProfile(activeSeed)

    activeProfile.runtime.team = ['1207', '1307', null]
    activeProfile.runtime.teamRuntimes = [makeTeamMember(yuanwuSeed), null]
    activeProfile.runtime.local.combat.electroFlare = 10
    activeProfile.runtime.local.combat.electroRage = 6

    state.calculator.session.activeResonatorId = activeSeed.id
    state.calculator.profiles = {
      [activeSeed.id]: activeProfile,
    }
    state.calculator.runtimeRevision += 1

    const workspace = selWorkDrvd(state)

    expect(workspace.actRt?.state.combat.electroFlare).toBe(10)
    expect(workspace.actRt?.state.combat.electroRage).toBe(0)
  })

  it('forces glacio chafe to its resolved max when Hiyuki is on the team', () => {
    const state = asAppStore()
    const activeSeed = getResSeedBy('1207')!
    const hiyukiSeed = getResSeedBy('1108')!
    const activeProfile = makeResProfile(activeSeed)

    activeProfile.runtime.team = ['1207', '1108', null]
    activeProfile.runtime.teamRuntimes = [makeTeamMember(hiyukiSeed), null]
    activeProfile.runtime.local.combat.glacioChafe = 2

    state.calculator.session.activeResonatorId = activeSeed.id
    state.calculator.profiles = {
      [activeSeed.id]: activeProfile,
    }
    state.calculator.runtimeRevision += 1

    const workspace = selWorkDrvd(state)

    expect(workspace.actRt?.state.combat.glacioChafe).toBe(10)
  })
})
