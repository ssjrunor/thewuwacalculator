/*
  Author: Runor Ewhro
  Description: Applies immutable scenario-member replacement, insertion, and
               removal, maintaining environment routing and member references.
*/

import {
  makeScenarioTeam,
  reviseCombatScenario,
  type CombatScenario,
  type ScenarioTeamMember,
  type TeamMemberId,
} from '@/domain/entities/combatScenario.ts'
import { makeCustomBuff } from '@/domain/state/defaults.ts'
import { makeMemberManualEffect, removeMemberEnvironmentState } from '@/domain/state/scenarioEnvironment.ts'

export function replaceScenarioTeamMember(
  scenario: CombatScenario,
  memberId: TeamMemberId,
  member: ScenarioTeamMember,
): CombatScenario {
  const index = scenario.team.members.findIndex((candidate) => candidate.id === memberId)
  if (index < 0) return scenario
  const members = [...scenario.team.members]
  // Replacement changes member data, not the seat identity referenced by routing.
  members[index] = { ...structuredClone(member), id: memberId }
  try {
    return reviseCombatScenario(scenario, { team: makeScenarioTeam(members) })
  } catch {
    // Reject invalid team revisions without partially updating the scenario.
    return scenario
  }
}

export function insertScenarioTeamMember(
  scenario: CombatScenario,
  index: number,
  member: ScenarioTeamMember,
): CombatScenario {
  if (scenario.team.members.length >= 3) return scenario
  const members = [...scenario.team.members]
  members.splice(Math.max(0, Math.min(index, members.length)), 0, structuredClone(member))
  try {
    return reviseCombatScenario(scenario, {
      team: makeScenarioTeam(members),
      // A new seat starts with its own manual effects and no outgoing routing.
      environment: {
        ...scenario.environment,
        manualEffects: [
          ...scenario.environment.manualEffects,
          makeMemberManualEffect(member.id, makeCustomBuff()),
        ],
        routing: {
          bySourceMemberId: { ...scenario.environment.routing.bySourceMemberId, [member.id]: {} },
        },
      },
    })
  } catch {
    return scenario
  }
}

export function removeScenarioTeamMember(
  scenario: CombatScenario,
  memberId: TeamMemberId,
): CombatScenario {
  if (scenario.team.members.length === 1) return scenario
  const members = scenario.team.members.filter((member) => member.id !== memberId)
  if (members.length === scenario.team.members.length) return scenario
  const team = makeScenarioTeam(members)
  const ids = new Set(team.members.map((member) => member.id))
  // Remove the departed source and incoming routes to it; null targets remain valid.
  const bySourceMemberId = Object.fromEntries(team.members.map((member) => [
    member.id,
    Object.fromEntries(Object.entries(scenario.environment.routing.bySourceMemberId[member.id] ?? {})
      .filter(([, target]) => target === null || ids.has(target))),
  ]))
  // Subject and initial on-field references must resolve to a surviving member.
  return reviseCombatScenario(scenario, {
    team,
    contextMemberId: ids.has(scenario.contextMemberId) ? scenario.contextMemberId : team.members[0].id,
    environment: {
      ...removeMemberEnvironmentState(scenario.environment, memberId),
      routing: { bySourceMemberId },
    },
    initialOnFieldMemberId: ids.has(scenario.initialOnFieldMemberId)
      ? scenario.initialOnFieldMemberId
      : team.members[0].id,
  })
}
