/*
  Author: Runor Ewhro
  Description: Verifies the team-first scenario projection and preparation
               invariants while legacy active-profile persistence is migrated.
*/

import { describe, expect, it } from 'vitest'
import {
  combatScenarioId,
  instantiateCombatScenario,
  makeScenarioTeam,
  primaryScenarioMember,
  teamMemberId,
  type ScenarioTeamMember,
} from '@/domain/entities/combatScenario.ts'
import { scopedTargetOwnerKey } from '@/domain/gameData/targetRouting.ts'
import { listResSds } from '@/domain/services/resonatorSeedService.ts'
import {
  makeAppState,
  makeResProfile,
  makeTeamMember,
} from '@/domain/state/defaults.ts'
import { projectCombatScenario } from '@/domain/state/combatScenarioProjection.ts'
import { projectScenarioProfiles } from '@/domain/state/scenarioRuntime.ts'
import { parseCombatScenario } from '@/domain/state/schema.ts'
import {
  prepareCombatScenario,
  simulateCombatScenarioTeam,
} from '@/engine/pipeline/combatScenario.ts'
import { evaluateObjective } from '@/engine/objectives/evaluationObjective.ts'
import { getActResId } from '@/domain/state/runtimeAdapters.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'

function makeMember(id: string): ScenarioTeamMember {
  const seed = listResSds().find((candidate) => candidate.id === id)
  if (!seed) throw new Error(`Missing test resonator ${id}`)
  const profile = makeResProfile(seed)
  return {
    id: teamMemberId(`member:${id}`),
    resonatorId: id,
    progression: profile.runtime.progression,
    loadout: profile.runtime.build,
    local: {
      controls: profile.runtime.local.controls,
      setConditionals: profile.runtime.local.setConditionals,
      optimizerInventory: profile.runtime.local.optimizerInventory,
    },
  }
}

describe('combat scenario invariants', () => {
  it('requires a dense unique team of one to three equal members', () => {
    const seeds = listResSds().slice(0, 4)
    expect(seeds).toHaveLength(4)
    const members = seeds.map((seed) => makeMember(seed.id))

    expect(makeScenarioTeam([members[0]]).members).toHaveLength(1)
    expect(makeScenarioTeam(members.slice(0, 3)).members).toHaveLength(3)
    expect(() => makeScenarioTeam([])).toThrow('requires 1 to 3 members')
    expect(() => makeScenarioTeam(members)).toThrow('requires 1 to 3 members')
    expect(() => makeScenarioTeam([members[0], members[0]])).toThrow(
      'Duplicate scenario member id',
    )
  })

  it('rekeys every member-addressed reference when a scenario is instantiated', () => {
    const state = makeAppState()
    const base = structuredClone(selectedCombatScenario(state.combat))
    const member = base.team.members[0]
    const source = {
      ...base,
      environment: {
        ...base.environment,
        routing: {
          bySourceMemberId: {
            ...base.environment.routing.bySourceMemberId,
            [member.id]: { target: member.id },
          },
        },
        manualEffects: [{
          id: 'member-effect',
          enabled: true,
          selector: { kind: 'members' as const, memberIds: [member.id] },
          buffs: makeResProfile(listResSds()[0]).runtime.local.manualBuffs,
        }],
      },
    }

    const copy = instantiateCombatScenario(source, combatScenarioId('scenario:copy'))
    const copiedMember = copy.team.members[0]

    expect(copy.id).toBe('scenario:copy')
    expect(copy.revision).toBe(0)
    expect(copiedMember.id).not.toBe(member.id)
    expect(copy.contextMemberId).toBe(copiedMember.id)
    expect(copy.initialOnFieldMemberId).toBe(copiedMember.id)
    expect(copy.environment.routing.bySourceMemberId[copiedMember.id]).toEqual({
      target: copiedMember.id,
    })
    expect(copy.environment.manualEffects[0]?.selector).toEqual({
      kind: 'members',
      memberIds: [copiedMember.id],
    })
  })

  it('rejects member references that escape the persisted scenario team', () => {
    const base = selectedCombatScenario(makeAppState().combat)
    const missing = teamMemberId('missing-member')
    const invalid = {
      ...base,
      contextMemberId: missing,
      initialOnFieldMemberId: missing,
      environment: {
        ...base.environment,
        routing: {
          bySourceMemberId: {
            [missing]: { target: missing },
          },
        },
        manualEffects: [{
          id: 'invalid-members',
          enabled: true,
          selector: { kind: 'members' as const, memberIds: [missing] },
          buffs: makeResProfile(listResSds()[0]).runtime.local.manualBuffs,
        }],
      },
    }

    const parsed = parseCombatScenario(invalid)
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      'Scenario context member must belong to the team',
      'Initial on-field member must belong to the team',
      'Routing source must belong to the scenario team',
      'Routing target must belong to the scenario team',
      'Environment effect member must belong to the scenario team',
    ]))
  })

  it('projects legacy active ownership into one team and scopes routing by source member', () => {
    const [primarySeed, secondSeed, thirdSeed] = listResSds().slice(0, 3)
    expect(primarySeed && secondSeed && thirdSeed).toBeTruthy()
    if (!primarySeed || !secondSeed || !thirdSeed) return

    const state = makeAppState()
    const profile = makeResProfile(primarySeed)
    profile.runtime.team = [primarySeed.id, secondSeed.id, thirdSeed.id]
    profile.runtime.teamRuntimes = [
      makeTeamMember(secondSeed),
      makeTeamMember(thirdSeed),
    ]
    profile.runtime.local.controls = {
      primaryMode: 1,
      [`team:${secondSeed.id}:supportMode`]: 2,
      [`team:${thirdSeed.id}:supportMode`]: 3,
    }
    profile.runtime.routing.selectedTargetsByOwnerKey = {
      legacyPrimaryRoute: secondSeed.id,
      [scopedTargetOwnerKey(secondSeed.id, 'supportRoute')]: thirdSeed.id,
    }
    const profiles = {
      [primarySeed.id]: profile,
    }

    const scenario = projectCombatScenario({
      profiles,
      runtimeRevision: 7,
      session: {
        activeResonatorId: primarySeed.id,
        enemyProfile: selectedCombatScenario(state.combat).target,
      },
    })
    expect(scenario).not.toBeNull()
    if (!scenario) return

    expect(scenario.revision).toBe(7)
    expect(scenario.team.members.map((member) => member.resonatorId)).toEqual([
      primarySeed.id,
      secondSeed.id,
      thirdSeed.id,
    ])
    const [primaryMember, secondMember, thirdMember] = scenario.team.members
    expect(secondMember && thirdMember).toBeTruthy()
    if (!secondMember || !thirdMember) return
    expect(primaryScenarioMember(scenario).resonatorId).toBe(primarySeed.id)
    expect(primaryMember.local.controls).toEqual({ primaryMode: 1 })
    expect(secondMember.local.controls).toMatchObject({ supportMode: 2 })
    expect(thirdMember.local.controls).toMatchObject({ supportMode: 3 })
    expect(scenario.environment.routing.bySourceMemberId[primaryMember.id]).toEqual({
      legacyPrimaryRoute: secondMember.id,
    })
    expect(scenario.environment.routing.bySourceMemberId[secondMember.id]).toEqual({
      supportRoute: thirdMember.id,
    })

    const prepared = prepareCombatScenario({
      ...scenario,
      initialOnFieldMemberId: secondMember.id,
    })
    expect(prepared.subjectMemberId).toBe(primaryMember.id)
    expect(Object.keys(prepared.runtimesByMemberId)).toHaveLength(3)
    expect(new Set(Object.keys(prepared.runtimesById))).toEqual(new Set([
      primarySeed.id,
      secondSeed.id,
      thirdSeed.id,
    ]))
    expect(prepared.workspace.combatGraph?.participants).toHaveProperty('active')
    expect(prepared.workspace.combatGraph?.participants).toHaveProperty('team1')
    expect(prepared.workspace.combatGraph?.participants).toHaveProperty('team2')
    expect(prepared.workspace.activeContext?.numericTeam.activeLane).toBe(
      prepared.workspace.activeContext?.numericTeam.program.laneById[secondSeed.id],
    )
    expect(prepared.selectedTargets).toEqual({
      [scopedTargetOwnerKey(primarySeed.id, 'legacyPrimaryRoute')]: secondSeed.id,
      [scopedTargetOwnerKey(secondSeed.id, 'supportRoute')]: thirdSeed.id,
    })
    expect(prepared.numericTeam).not.toBeNull()
    expect(new Set(Object.values(prepared.numericLaneByMemberId))).toEqual(new Set([0, 1, 2]))

    const withEnvironment = prepareCombatScenario({
      ...scenario,
      environment: {
        ...scenario.environment,
        manualEffects: [{
          id: 'shared-atk',
          enabled: true,
          selector: { kind: 'all' },
          buffs: {
            quick: {
              atk: { flat: 0, percent: 12 },
              hp: { flat: 0, percent: 0 },
              def: { flat: 0, percent: 0 },
              critRate: 0,
              critDmg: 0,
              energyRegen: 0,
              healingBonus: 0,
            },
            modifiers: [],
          },
        }],
        targetModifiers: {
          defenseReduction: 20,
          resistanceReduction: { [primarySeed.attribute]: 15 },
          damageTakenAmplification: 8,
        },
      },
    })
    for (const member of scenario.team.members) {
      const basePool = prepared.workspace.cntxByResId[member.resonatorId]?.buffs
      const environmentPool = withEnvironment.workspace.cntxByResId[member.resonatorId]?.buffs
      expect(environmentPool?.atk.percent).toBe((basePool?.atk.percent ?? 0) + 12)
      expect(environmentPool?.defShred).toBe((basePool?.defShred ?? 0) + 20)
      expect(environmentPool?.dmgVuln).toBe((basePool?.dmgVuln ?? 0) + 8)
      expect(environmentPool?.attribute[primarySeed.attribute].resShred)
        .toBe((basePool?.attribute[primarySeed.attribute].resShred ?? 0) + 15)
    }

    const contextual = prepareCombatScenario({
      ...scenario,
      contextMemberId: secondMember.id,
    })
    expect(contextual.subjectMemberId).toBe(secondMember.id)
    expect(contextual.subjectRuntime.id).toBe(secondSeed.id)
    expect(getActResId({ ...scenario, contextMemberId: secondMember.id })).toBe(primarySeed.id)
    expect(Object.keys(projectScenarioProfiles(scenario))).toEqual([primarySeed.id])

    const result = simulateCombatScenarioTeam(prepared)
    expect(result).not.toBeNull()
    if (!result) return
    expect(Object.keys(result.members)).toHaveLength(3)
    const expectedRotationAvg = Object.values(result.members).reduce(
      (total, member) => total + member.rotation.sequence.total.avg,
      0,
    )
    expect(evaluateObjective(result, {
      kind: 'rotation',
      program: 'sequence',
      metric: 'avg',
    })).toBe(expectedRotationAvg)
  })
})
