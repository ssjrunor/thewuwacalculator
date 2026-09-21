/*
  Author: Runor Ewhro
  Description: Provides scenario-first preparation and evaluation entrypoints.
               The compatibility runtime projection is confined here while
               the remaining engine is migrated from ResRuntime ownership.
*/

import type { CombatScenario, TeamMemberId } from '@/domain/entities/combatScenario'
import type { ResRuntime } from '@/domain/entities/runtime'
import { findCombatPartByMemberId, makeCombatGraph } from '@/engine/runtime/combatGraph'
import {
  projectScenarioEngineRuntimes,
  projectScenarioUiRuntimes,
  type ScenarioRuntimeProjection,
} from '@/engine/runtime/scenarioRuntime'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import {
  mkPrepWork,
  runPrepWorkDetailedProgram,
  runPrepWorkS,
  type PrepWork,
} from '@/engine/pipeline/preparedWorkspace'
import type { SimResult } from '@/engine/pipeline/types'
import type { ProgramResult } from '@/engine/rotation/execute'
import type { RunDetail } from '@/engine/rotation/runTypes'
import type { RotationNode } from '@/domain/gameData/contracts'
import type { DamageTotals } from '@/engine/pipeline/types'
import { summarizeRotationEntries } from '@/engine/pipeline/rotationTotals'
import type { NumericTeamState } from '@/engine/effects/numericTeam'
import { resolveEnvironmentManualBuffs } from '@/engine/runtime/scenarioEnvironment'

export interface PreparedCombatScenario {
  scenario: CombatScenario
  subjectMemberId: TeamMemberId
  subjectRuntime: ResRuntime
  runtimesByMemberId: Readonly<Record<TeamMemberId, ResRuntime>>
  runtimesById: Readonly<Record<string, ResRuntime>>
  selectedTargets: Readonly<Record<string, string | null>>
  numericTeam: NumericTeamState | null
  numericLaneByMemberId: Readonly<Record<TeamMemberId, number>>
  /** Object-rich preparation retained for inspection and current UI projections. */
  workspace: PrepWork
}

export interface TeamMemberSimulationResult extends SimResult {
  memberId: TeamMemberId
  resonatorId: string
}

export interface TeamSimulationResult {
  members: Readonly<Record<TeamMemberId, TeamMemberSimulationResult>>
  totals: DamageTotals
  subjectMemberId: TeamMemberId
}

function prepareProjectedCombatScenario(
  scenario: CombatScenario,
  projection: ScenarioRuntimeProjection,
): PreparedCombatScenario {
  const subjectMember = scenario.team.members.find(
    (member) => member.id === projection.subjectMemberId,
  )
  if (!subjectMember) {
    throw new Error(`Scenario context member is not part of the team: ${projection.subjectMemberId}`)
  }
  const subjectSeed = getResSeedBy(subjectMember.resonatorId)
  if (!subjectSeed) {
    throw new Error(`Missing resonator data for scenario member ${subjectMember.resonatorId}`)
  }

  const { runtimesByMemberId, runtimesById, subjectRuntime, selectedTargets } = projection
  const graph = makeCombatGraph({
    actRt: subjectRuntime,
    activeSeed: subjectSeed,
    partRts: runtimesById,
    targetsByRes: Object.fromEntries(
      scenario.team.members.map((member) => [member.resonatorId, selectedTargets]),
    ),
    memberIdByResonatorId: Object.fromEntries(
      scenario.team.members.map((member) => [member.resonatorId, member.id]),
    ),
    environmentBuffsByMemberId: Object.fromEntries(
      scenario.team.members.map((member) => [
        member.id,
        resolveEnvironmentManualBuffs(scenario.environment, member),
      ]),
    ),
    environmentTargetModifiers: scenario.environment.targetModifiers,
  })
  const initialOnFieldMember = scenario.team.members.find(
    (member) => member.id === scenario.initialOnFieldMemberId,
  )
  if (!initialOnFieldMember) {
    throw new Error(`Initial on-field member is not part of scenario: ${scenario.initialOnFieldMemberId}`)
  }
  const initialOnFieldSlot = findCombatPartByMemberId(graph, initialOnFieldMember.id)
  if (!initialOnFieldSlot) {
    throw new Error(`Missing combat slot for initial on-field member: ${initialOnFieldMember.id}`)
  }
  graph.activeSlotId = initialOnFieldSlot

  const workspace = mkPrepWork({
    revision: scenario.revision,
    runtime: subjectRuntime,
    seed: subjectSeed,
    enemy: scenario.target,
    prtcRntmById: runtimesById,
    activeTarget: selectedTargets,
    combatGraph: graph,
  })
  const numericLaneByMemberId = Object.fromEntries(
    scenario.team.members.map((member) => [
      member.id,
      workspace.cntxByResId[member.resonatorId]?.numericLane ?? -1,
    ]),
  ) as Record<TeamMemberId, number>

  return {
    scenario,
    subjectMemberId: subjectMember.id,
    subjectRuntime,
    runtimesByMemberId,
    runtimesById,
    selectedTargets,
    numericTeam: workspace.activeContext?.numericTeam ?? null,
    numericLaneByMemberId,
    workspace,
  }
}

/** Prepare the complete team using the scenario's explicit context member. */
export function prepareCombatScenario(
  scenario: CombatScenario,
): PreparedCombatScenario {
  return prepareProjectedCombatScenario(scenario, projectScenarioEngineRuntimes(scenario))
}

/**
 * Temporary active-based UI adapter. Existing Simulation surfaces receive
 * member zero without changing the scenario's canonical context member.
 */
export function prepareCombatScenarioForUi(
  scenario: CombatScenario,
): PreparedCombatScenario {
  return prepareProjectedCombatScenario(scenario, projectScenarioUiRuntimes(scenario))
}

export function simulateCombatScenario(
  prepared: PreparedCombatScenario,
  options: {
    sequence?: RotationNode[]
    program?: RotationNode[]
    detail?: RunDetail
  } = {},
): SimResult | null {
  return runPrepWorkS(prepared.workspace, options)
}

/** Canonical team-shaped result; the single-result API is a UI compatibility view. */
export function simulateCombatScenarioTeam(
  prepared: PreparedCombatScenario,
  options: {
    sequence?: RotationNode[]
    program?: RotationNode[]
    detail?: RunDetail
  } = {},
): TeamSimulationResult | null {
  const simulation = runPrepWorkS(prepared.workspace, options)
  if (!simulation) return null

  const members = Object.fromEntries(prepared.scenario.team.members.map((member) => {
    const allFeatures = simulation.allFeatures.filter(
      (entry) => entry.resonatorId === member.resonatorId,
    )
    const sequence = summarizeRotationEntries(
      simulation.rotation.sequence.entries.filter(
        (entry) => entry.resonatorId === member.resonatorId,
      ),
    )
    const program = summarizeRotationEntries(
      simulation.rotation.program.entries.filter(
        (entry) => entry.resonatorId === member.resonatorId,
      ),
    )
    const context = prepared.workspace.cntxByResId[member.resonatorId]
    const result: TeamMemberSimulationResult = {
      memberId: member.id,
      resonatorId: member.resonatorId,
      finalStats: context?.finalStats ?? simulation.finalStats,
      allFeatures,
      rotation: { sequence, program },
      allSkills: allFeatures.filter((entry) => entry.feature.variant !== 'subHit'),
      perSkill: sequence.entries,
      total: sequence.total,
      totalsByGroup: sequence.totalsByGroup,
    }
    return [member.id, result]
  })) as Record<TeamMemberId, TeamMemberSimulationResult>

  return {
    members,
    totals: simulation.total,
    subjectMemberId: prepared.subjectMemberId,
  }
}

export function executeCombatScenarioProgram(
  prepared: PreparedCombatScenario,
  items: RotationNode[] = prepared.scenario.program.program,
): ProgramResult | null {
  return runPrepWorkDetailedProgram(prepared.workspace, items)
}
