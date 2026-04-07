import { describe, expect, it } from 'vitest'
import type { AppStore } from '@/domain/state/store'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { createDefaultAppState, createDefaultResonatorProfile, makeDefaultTeamMemberRuntime } from '@/domain/state/defaults'
import { selectWorkspaceDerived } from '@/domain/state/selectors'

const CHISA_UNRAVELING_CONTROL_KEY = 'team:1508:team:1508:unraveling_law_zero:active'

function asAppStore() {
  return createDefaultAppState() as unknown as AppStore
}

describe('workspace prepared selectors', () => {
  it('reuses prepared workspace for non-runtime calculator changes', () => {
    const initial = asAppStore()
    const first = selectWorkspaceDerived(initial)

    const secondState = {
      ...initial,
      calculator: {
        ...initial.calculator,
        suggestionsByResonatorId: {
          ...initial.calculator.suggestionsByResonatorId,
        },
      },
    } as AppStore

    const second = selectWorkspaceDerived(secondState)

    expect(second.preparedWorkspace).toBe(first.preparedWorkspace)
  })

  it('rebuilds prepared workspace when runtime revision changes', () => {
    const initial = asAppStore()
    const first = selectWorkspaceDerived(initial)

    const secondState = {
      ...initial,
      calculator: {
        ...initial.calculator,
        runtimeRevision: initial.calculator.runtimeRevision + 1,
      },
    } as AppStore

    const second = selectWorkspaceDerived(secondState)

    expect(second.preparedWorkspace).not.toBe(first.preparedWorkspace)
  })

  it('normalizes negative-effect combat state in the derived workspace runtime', () => {
    const state = asAppStore()
    const activeSeed = getResonatorSeedById('1207')!
    const yuanwuSeed = getResonatorSeedById('1307')!
    const chisaSeed = getResonatorSeedById('1508')!
    const activeProfile = createDefaultResonatorProfile(activeSeed)

    activeProfile.runtime.team = ['1207', '1307', '1508']
    activeProfile.runtime.teamRuntimes = [
      makeDefaultTeamMemberRuntime(yuanwuSeed),
      makeDefaultTeamMemberRuntime(chisaSeed),
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

    const workspace = selectWorkspaceDerived(state)

    expect(workspace.activeRuntime?.state.combat.electroFlare).toBe(13)
    expect(workspace.activeRuntime?.state.combat.electroRage).toBe(13)
    expect(workspace.activeRuntime?.state.combat.havocBane).toBe(6)
    expect(workspace.activeRuntime?.state.combat.spectroFrazzle).toBe(0)
  })

  it('zeros electro rage when electro flare is not above its default cap', () => {
    const state = asAppStore()
    const activeSeed = getResonatorSeedById('1207')!
    const yuanwuSeed = getResonatorSeedById('1307')!
    const activeProfile = createDefaultResonatorProfile(activeSeed)

    activeProfile.runtime.team = ['1207', '1307', null]
    activeProfile.runtime.teamRuntimes = [makeDefaultTeamMemberRuntime(yuanwuSeed), null]
    activeProfile.runtime.local.combat.electroFlare = 10
    activeProfile.runtime.local.combat.electroRage = 6

    state.calculator.session.activeResonatorId = activeSeed.id
    state.calculator.profiles = {
      [activeSeed.id]: activeProfile,
    }
    state.calculator.runtimeRevision += 1

    const workspace = selectWorkspaceDerived(state)

    expect(workspace.activeRuntime?.state.combat.electroFlare).toBe(10)
    expect(workspace.activeRuntime?.state.combat.electroRage).toBe(0)
  })

  it('forces glacio chafe to its resolved max when Hiyuki is on the team', () => {
    const state = asAppStore()
    const activeSeed = getResonatorSeedById('1207')!
    const hiyukiSeed = getResonatorSeedById('1108')!
    const activeProfile = createDefaultResonatorProfile(activeSeed)

    activeProfile.runtime.team = ['1207', '1108', null]
    activeProfile.runtime.teamRuntimes = [makeDefaultTeamMemberRuntime(hiyukiSeed), null]
    activeProfile.runtime.local.combat.glacioChafe = 2

    state.calculator.session.activeResonatorId = activeSeed.id
    state.calculator.profiles = {
      [activeSeed.id]: activeProfile,
    }
    state.calculator.runtimeRevision += 1

    const workspace = selectWorkspaceDerived(state)

    expect(workspace.activeRuntime?.state.combat.glacioChafe).toBe(10)
  })
})
