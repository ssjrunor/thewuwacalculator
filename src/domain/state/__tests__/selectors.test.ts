/*
  Author: Runor Ewhro
  Description: Verifies stable scenario-derived compatibility selectors.
*/

import { describe, expect, it } from 'vitest'
import type { AppStore } from '@/domain/state/store.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { makeScenarioTeam } from '@/domain/entities/combatScenario.ts'
import { addScenario, selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import {
  makeAppState,
  makeResProfile,
  makeScenarioMemberFromProfile,
  makeScenarioFromProfiles,
} from '@/domain/state/defaults.ts'
import {
  selActResId,
  selContextMemberId,
  selContextResonatorId,
  selInitRtLkp,
  selScenarioProfiles,
  selSubjectMemberId,
  selVrvwDrvd,
  selWorkDrvd,
} from '@/domain/state/selectors.ts'
import { listResSds } from '@/domain/services/resonatorSeedService.ts'
import { makeLiveRotationEntry } from '@/domain/state/liveRotationEntry.ts'

describe('workspace selectors', () => {
  it('uses scenario member zero for active-based UI selection', () => {
    const state = makeAppState() as AppStore
    const scenario = selectedCombatScenario(state.combat)
    const member = scenario.team.members[0]

    expect(selActResId(state)).toBe(member.resonatorId)
    expect(selSubjectMemberId(state)).toBe(member.id)
    expect(selContextMemberId(state)).toBe(member.id)
    expect(selContextResonatorId(state)).toBe(member.resonatorId)
    expect(selWorkDrvd(state).scenario).toBe(scenario)
  })

  it('keeps UI preparation on member zero while context may name another equal member', () => {
    const [primarySeed, contextSeed] = listResSds().slice(0, 2)
    const state = makeAppState() as AppStore
    const base = selectedCombatScenario(state.combat)
    const primaryMember = makeScenarioMemberFromProfile(makeResProfile(primarySeed))
    const contextMember = makeScenarioMemberFromProfile(makeResProfile(contextSeed))
    const scenario = {
      ...base,
      revision: base.revision + 1,
      team: makeScenarioTeam([primaryMember, contextMember]),
      contextMemberId: contextMember.id,
      environment: {
        ...base.environment,
        routing: { bySourceMemberId: { [primaryMember.id]: {}, [contextMember.id]: {} } },
      },
      initialOnFieldMemberId: primaryMember.id,
    }
    state.combat = {
      ...state.combat,
      scenariosById: { ...state.combat.scenariosById, [scenario.id]: scenario },
    }
    const before = structuredClone(state.combat)

    expect(selWorkDrvd(state).actRt?.id).toBe(primarySeed.id)
    expect(selVrvwDrvd(state).actRt?.id).toBe(primarySeed.id)
    expect(selContextMemberId(state)).toBe(contextMember.id)
    expect(selContextResonatorId(state)).toBe(contextSeed.id)
    expect(state.combat).toEqual(before)
  })

  it('returns referentially stable derived profiles until the workspace changes', () => {
    const state = makeAppState() as AppStore
    const first = selScenarioProfiles(state)
    expect(selScenarioProfiles(state)).toBe(first)

    const current = selectedCombatScenario(state.combat)
    const changedScenario = {
      ...current,
      target: { ...current.target, level: current.target.level + 1 },
    }
    const changed = {
      ...state,
      combat: {
        ...state.combat,
        scenariosById: { ...state.combat.scenariosById, [current.id]: changedScenario },
      },
    } as AppStore

    expect(selScenarioProfiles(changed)).not.toBe(first)
    expect(selWorkDrvd(changed).prepWork.enemy.level).toBe(current.target.level + 1)
  })

  it('builds one initialized runtime per context scenario', () => {
    const [firstSeed, secondSeed] = listResSds().slice(0, 2)
    const state = makeAppState() as AppStore
    const firstId = selectedCombatScenario(state.combat).team.members[0].resonatorId
    const otherSeed = secondSeed.id === firstId ? firstSeed : secondSeed
    const other = {
      ...makeScenarioFromProfiles({ [otherSeed.id]: makeResProfile(otherSeed) }, null, 0, otherSeed.id),
      id: `scenario:${otherSeed.id}` as typeof state.combat.selectedScenarioId,
    }
    state.combat = addScenario(state.combat, other, false)

    const runtimes = selInitRtLkp(state)
    expect(new Set(Object.keys(runtimes))).toEqual(new Set([firstId, otherSeed.id]))
    expect(selInitRtLkp(state)).toBe(runtimes)
  })

  it('projects a last-run program as a detached temporary saved rotation', () => {
    const seed = listResSds()[0]
    const scenario = makeScenarioFromProfiles({ [seed.id]: makeResProfile(seed) }, null, 0, seed.id)
    expect(makeLiveRotationEntry(scenario, seed.name)).toBeNull()
    const item: RotationNode = {
      id: 'live-feature',
      type: 'feature',
      featureId: 'feature:live',
      resonatorId: seed.id,
      enabled: true,
      multiplier: 1,
    }
    const ranScenario = structuredClone(scenario)
    ranScenario.program.program = [item]
    ranScenario.program.lastRanAt = 42_000
    const entry = makeLiveRotationEntry(ranScenario, seed.name)

    expect(entry).toMatchObject({ createdAt: 42_000, updatedAt: 42_000, duration: 0, note: '' })
    expect(entry?.scenario.program.program).toEqual([item])
    expect(entry?.scenario).not.toBe(ranScenario)
  })
})
