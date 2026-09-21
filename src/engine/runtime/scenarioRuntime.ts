/*
  Author: Runor Ewhro
  Description: Materializes one equal-member runtime projection from the
               canonical combat scenario for legacy calculation consumers.
*/

import type {
  CombatScenario,
  ScenarioTeamMember,
  TeamMemberId,
} from '@/domain/entities/combatScenario'
import { contextScenarioMember, primaryScenarioMember } from '@/domain/entities/combatScenario'
import type { ResRuntime, TeamMemRt, TeamSlots } from '@/domain/entities/runtime'
import type { ResProf } from '@/domain/entities/profile'
import type { ScenarioWorkspace } from '@/domain/entities/scenarioLibrary'
import { cloneEchoLoadout } from '@/domain/entities/inventoryStorage'
import { scopedTargetOwnerKey } from '@/domain/gameData/targetRouting'
import {
  cloneCmbtStt,
  cloneResBase,
  cloneRotation,
  cloneWpnMkSt,
} from '@/engine/runtime/runtimeCloning'
import {
  makeEmptyManualBuffs,
  resolveEnvironmentManualBuffs,
} from '@/engine/runtime/scenarioEnvironment'
import { cloneOptInventorySelection } from '@/domain/entities/profile'
import { cloneSntSet } from '@/domain/entities/sonataSetConditionals'
import { normResRtCnt } from '@/engine/gameData/controlOptions'

export function scenarioTeamSlots(scenario: CombatScenario): TeamSlots {
  return [
    scenario.team.members[0]?.resonatorId ?? null,
    scenario.team.members[1]?.resonatorId ?? null,
    scenario.team.members[2]?.resonatorId ?? null,
  ]
}

function compactMember(scenario: CombatScenario, member: ScenarioTeamMember): TeamMemRt {
  return {
    id: member.resonatorId,
    base: { sequence: member.progression.sequence },
    build: {
      weapon: {
        id: member.loadout.weapon.id,
        rank: member.loadout.weapon.rank,
        baseAtk: member.loadout.weapon.baseAtk,
      },
      echoes: cloneEchoLoadout(member.loadout.echoes),
    },
    manualBuffs: resolveEnvironmentManualBuffs(scenario.environment, member),
  }
}

export function projectScenarioMemberRuntime(
  scenario: CombatScenario,
  member: ScenarioTeamMember,
): ResRuntime {
  const compactTeammates = scenario.team.members
    .filter((candidate) => candidate.id !== member.id)
    .slice(0, 2)
    .map((candidate) => compactMember(scenario, candidate))

  return {
    id: member.resonatorId,
    base: cloneResBase(member.progression),
    build: {
      weapon: cloneWpnMkSt(member.loadout.weapon),
      echoes: cloneEchoLoadout(member.loadout.echoes),
      team: scenarioTeamSlots(scenario),
    },
    state: {
      controls: { ...member.local.controls },
      manualBuffs: resolveEnvironmentManualBuffs(scenario.environment, member),
      combat: cloneCmbtStt(scenario.environment.combatState),
    },
    rotation: cloneRotation(scenario.program),
    teamRuntimes: [compactTeammates[0] ?? null, compactTeammates[1] ?? null],
  }
}

export function flattenScenarioRouting(
  scenario: CombatScenario,
): Record<string, string | null> {
  const memberById = new Map(
    scenario.team.members.map((member) => [member.id, member]),
  )
  const selectedTargets: Record<string, string | null> = {}

  for (const sourceMember of scenario.team.members) {
    const routes = scenario.environment.routing.bySourceMemberId[sourceMember.id] ?? {}
    for (const [ownerKey, targetMemberId] of Object.entries(routes)) {
      const targetMember = targetMemberId
        ? memberById.get(targetMemberId) ?? null
        : null
      selectedTargets[scopedTargetOwnerKey(sourceMember.resonatorId, ownerKey)] =
        targetMember?.resonatorId ?? null
    }
  }
  return selectedTargets
}

export interface ScenarioRuntimeProjection {
  teamSlots: TeamSlots
  subjectMemberId: TeamMemberId
  subjectRuntime: ResRuntime
  runtimesByMemberId: Record<TeamMemberId, ResRuntime>
  runtimesById: Record<string, ResRuntime>
  selectedTargets: Record<string, string | null>
}

export function projectScenarioRuntimes(
  scenario: CombatScenario,
): ScenarioRuntimeProjection {
  const subject = contextScenarioMember(scenario)
  const runtimesByMemberId = Object.fromEntries(
    scenario.team.members.map((member) => [
      member.id,
      projectScenarioMemberRuntime(scenario, member),
    ]),
  ) as Record<TeamMemberId, ResRuntime>
  const runtimesById = Object.fromEntries(
    scenario.team.members.map((member) => [
      member.resonatorId,
      runtimesByMemberId[member.id],
    ]),
  )

  return {
    teamSlots: scenarioTeamSlots(scenario),
    subjectMemberId: subject.id,
    subjectRuntime: runtimesByMemberId[subject.id],
    runtimesByMemberId,
    runtimesById,
    selectedTargets: flattenScenarioRouting(scenario),
  }
}

/** Engine projection; environment sources are applied by the combat graph. */
export function projectScenarioEngineRuntimes(
  scenario: CombatScenario,
): ScenarioRuntimeProjection {
  const projection = projectScenarioRuntimes(scenario)
  const runtimesByMemberId = Object.fromEntries(
    Object.entries(projection.runtimesByMemberId).map(([memberId, runtime]) => [
      memberId,
      {
        ...runtime,
        state: { ...runtime.state, manualBuffs: makeEmptyManualBuffs() },
      },
    ]),
  ) as Record<TeamMemberId, ResRuntime>
  const runtimesById = Object.fromEntries(
    scenario.team.members.map((member) => [
      member.resonatorId,
      runtimesByMemberId[member.id],
    ]),
  )
  return {
    ...projection,
    subjectRuntime: runtimesByMemberId[projection.subjectMemberId],
    runtimesByMemberId,
    runtimesById,
  }
}

/** Temporary adapter for active-based UI: its visible subject is member zero. */
export function projectScenarioUiRuntimes(
  scenario: CombatScenario,
): ScenarioRuntimeProjection {
  const projection = projectScenarioRuntimes(scenario)
  const subject = primaryScenarioMember(scenario)
  return {
    ...projection,
    subjectMemberId: subject.id,
    subjectRuntime: projection.runtimesByMemberId[subject.id],
  }
}

/**
 * Compatibility-only profile projection for UI/import code. Scenario members
 * remain the owners of this data; callers must never persist this result.
 */
export function projectScenarioProfiles(
  scenario: CombatScenario,
): Record<string, ResProf> {
  const member = primaryScenarioMember(scenario)
  return {
    [member.resonatorId]: projectScenarioMemberProfile(scenario, member),
  }
}

export function projectScenarioMemberProfile(
  scenario: CombatScenario,
  member: ScenarioTeamMember,
): ResProf {
  const routing = flattenScenarioRouting(scenario)
  const runtime = projectScenarioMemberRuntime(scenario, member)
  const controls = { ...normResRtCnt(runtime) }

  // ResProf is a retired interchange shape whose teammate controls were stored
  // on the context profile. Encode that envelope only here so profile clipboard
  // round-trips cannot erase canonical scenario-member state.
  for (const teammate of scenario.team.members) {
    if (teammate.id === member.id) continue
    const prefix = `team:${teammate.resonatorId}:`
    const teammateRuntime = projectScenarioMemberRuntime(scenario, teammate)
    for (const [key, value] of Object.entries(normResRtCnt(teammateRuntime))) {
      controls[`${prefix}${key}`] = value
    }
  }

  return {
    resonatorId: member.resonatorId,
    runtime: {
      progression: cloneResBase(member.progression),
      build: {
        weapon: cloneWpnMkSt(member.loadout.weapon),
        echoes: cloneEchoLoadout(member.loadout.echoes),
      },
      local: {
        controls,
        manualBuffs: resolveEnvironmentManualBuffs(scenario.environment, member),
        combat: cloneCmbtStt(scenario.environment.combatState),
        setConditionals: cloneSntSet(member.local.setConditionals),
        optimizerInventory: cloneOptInventorySelection(member.local.optimizerInventory),
      },
      routing: {
        selectedTargetsByOwnerKey: { ...routing },
      },
      team: scenarioTeamSlots(scenario),
      rotation: cloneRotation(scenario.program),
      teamRuntimes: runtime.teamRuntimes,
    },
  } satisfies ResProf
}

/**
 * Compatibility profile view: each context-owned scenario contributes member
 * zero exactly once for UI and import consumers that remain resonator-keyed.
 */
export function projectScenarioWorkspaceProfiles(
  workspace: Pick<ScenarioWorkspace, 'selectedScenarioId' | 'order' | 'scenariosById'>,
): Record<string, ResProf> {
  const profiles: Record<string, ResProf> = {}
  const selected = workspace.scenariosById[workspace.selectedScenarioId]

  for (const scenarioId of workspace.order) {
    if (scenarioId === workspace.selectedScenarioId) continue
    const scenario = workspace.scenariosById[scenarioId]
    if (scenario) Object.assign(profiles, projectScenarioProfiles(scenario))
  }
  if (selected) Object.assign(profiles, projectScenarioProfiles(selected))
  return profiles
}
