/*
  Author: Runor Ewhro
  Description: Verifies the team picker's one-step write: kept members keep their
               seat identity, departed ones are removed, new ones are appended,
               and the order matches the picked seats.
*/

import { beforeEach, describe, expect, it } from 'vitest'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { listResSds } from '@/data/catalog/resonatorSeedService'
import { makeResProfile, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults'
import { insertScenarioTeamMember } from '@/engine/runtime/scenarioMembers'
import { useAppStore } from '@/application/state/store'
import { consumePersist } from '@/application/persistence/storage'
import { withSupports } from '@/modules/simulation/features/teams/lib/teamSlots'

const make = (resonatorId: string) => {
  const seed = listResSds().find((candidate) => candidate.id === resonatorId)
  return seed ? makeScenarioMemberFromProfile(makeResProfile(seed)) : null
}

describe('withSupports', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })

  it('swaps, replaces and clears supports in one pass', () => {
    const seeds = listResSds()
    const base = selectedCombatScenario(useAppStore.getState().combat)
    const lead = base.team.members[0]
    const [a, b, c] = seeds.filter((seed) => seed.id !== lead.resonatorId).slice(0, 3).map((seed) => seed.id)
    let scenario = insertScenarioTeamMember(base, 1, make(a)!)
    scenario = insertScenarioTeamMember(scenario, 2, make(b)!)
    const memberA = scenario.team.members[1]!

    const swapped = withSupports(scenario, [b, a], make)
    expect(swapped.team.members.map((member) => member.resonatorId)).toEqual([lead.resonatorId, b, a])
    expect(swapped.team.members[2]!.id).toBe(memberA.id)

    const replaced = withSupports(scenario, [a, c], make)
    expect(replaced.team.members.map((member) => member.resonatorId)).toEqual([lead.resonatorId, a, c])
    expect(replaced.team.members[1]!.id).toBe(memberA.id)

    const cleared = withSupports(scenario, [null, null], make)
    expect(cleared.team.members.map((member) => member.resonatorId)).toEqual([lead.resonatorId])

    expect(withSupports(scenario, [a, b], make)).toBe(scenario)
    expect(withSupports(scenario, [a, 'missing-resonator'], make)).toBe(scenario)
  })
})
