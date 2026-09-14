/*
  Author: Runor Ewhro
  Description: Provides helpers for adapting scenario profile state into
               active and team runtime views, lookup maps, and persisted updates.
*/

import type { ScenarioWorkspace } from '@/domain/entities/scenarioLibrary'
import { contextScenarioMember } from '@/domain/entities/combatScenario'
import {
  reviseCombatScenario,
  makeScenarioTeam,
  scenarioMemberByResonatorId,
  teamMemberId,
  type CombatScenario,
  type ScenarioTeamMember,
  type TeamMemberId,
} from '@/domain/entities/combatScenario'
import { cloneSntSet, DEF_SET_COND } from '@/domain/entities/sonataSetConditionals'
import type { ResProf } from '@/domain/entities/profile'
import { cloneOptInventorySelection } from '@/domain/entities/profile'
import type { SlotId } from '@/domain/entities/combatGraph'
import { normResRtCnt } from '@/domain/gameData/controlOptions'
import { normNegFfctC } from '@/domain/gameData/negativeEffects'
import type {
  ResRuntime,
  RotationState,
  TeamMemRtVie,
  TeamSlots,
} from '@/domain/entities/runtime'
import { makeCustomBuff, normProfTeam } from '@/domain/state/defaults'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { repairEchoLoadoutForCatalog } from '@/domain/state/echoCatalogRepair'
import {
  cloneSlotLuo,
  matRtFromPro,
  matTeamMemFr,
} from '@/domain/state/runtimeMaterialization'
import { maxEchoIfChg } from '@/domain/state/sourceStateInit'
import {
  cloneRotation,
  cloneResBase,
  cloneSkllLvl,
  cloneTrcNode,
  cloneWpnMkSt,
} from '@/domain/state/runtimeCloning'
import { projectScenarioUiRuntimes } from '@/domain/state/scenarioRuntime'
import {
  extractMemberManualBuffs,
  removeMemberEnvironmentState,
  replaceMemberManualEffect,
  resolveEnvironmentManualBuffs,
} from '@/domain/state/scenarioEnvironment'

export interface WorkRtBndl {
  actResId: string | null
  actTeamSlots: TeamSlots
  actTgtSels: Record<string, string | null>
  actRt: ResRuntime | null
  partRtsById: Record<string, ResRuntime>
}

/** Keep only target routing that resolves inside the materialized team. */
export function normalizeTargets(
    selections: Record<string, string | null>,
    runtimesById: Record<string, ResRuntime>,
): Record<string, string | null> {
  const targetIds = new Set(Object.keys(runtimesById))
  return Object.fromEntries(
    Object.entries(selections)
      .filter(([, targetId]) => !targetId || targetIds.has(targetId)),
  )
}

function normRtNegFfc(runtime: ResRuntime): ResRuntime {
  const controls = normResRtCnt(runtime)
  const combat = normNegFfctC(runtime)
  const cntrNchn = Object.keys(controls).every((key) => controls[key] === runtime.state.controls[key])
    && Object.keys(runtime.state.controls).every((key) => runtime.state.controls[key] === controls[key])
  const cmbtNchn = Object.keys(combat).every(
    (key) => combat[key as keyof typeof combat] === runtime.state.combat[key as keyof typeof combat],
  )

  if (cntrNchn && cmbtNchn) {
    return runtime
  }

  return {
    ...runtime,
    state: {
      ...runtime.state,
      controls,
      combat,
    },
  }
}

// build the selected target routing map from the active profile
export function mkSelTgtResM(
    scenario: CombatScenario,
): Record<string, string | null> {
  return mkWorkRtBndl(scenario).actTgtSels
}

// materialize the active main runtime bundle once so callers can reuse
// active runtime, participant runtimes, team slots, and routing selections
export function mkWorkRtBndl(scenario: CombatScenario): WorkRtBndl {
  const projection = projectScenarioUiRuntimes(scenario)
  const partRntmById = Object.fromEntries(
    Object.entries(projection.runtimesById).map(([id, runtime]) => [id, normRtNegFfc(runtime)]),
  )
  const actRt = partRntmById[projection.subjectRuntime.id] ?? null

  return {
    actResId: actRt?.id ?? null,
    actTeamSlots: projection.teamSlots,
    actTgtSels: normalizeTargets(projection.selectedTargets, partRntmById),
    actRt,
    partRtsById: partRntmById,
  }
}

// member zero is the temporary subject adapter for active-based callers
export function getActResId(scenario: CombatScenario): string | null {
  return scenario.team.members[0]?.resonatorId ?? null
}

// build the active team slots from the active profile
export function mkActTeamSlt(scenario: CombatScenario): TeamSlots {
  const members = scenario.team.members
  return [
    members[0]?.resonatorId ?? null,
    members[1]?.resonatorId ?? null,
    members[2]?.resonatorId ?? null,
  ]
}

// get the resonator id occupying a given slot
export function getSlotResId(scenario: CombatScenario, slotId: SlotId): string | null {
  const team = mkActTeamSlt(scenario)

  switch (slotId) {
    case 'active':
      return team[0]
    case 'team1':
      return team[1]
    case 'team2':
      return team[2]
  }
}

// find the slot id for a resonator currently on the team
export function findSlotIdFo(scenario: CombatScenario, resonatorId: string): SlotId | null {
  const team = mkActTeamSlt(scenario)
  if (team[0] === resonatorId) return 'active'
  if (team[1] === resonatorId) return 'team1'
  if (team[2] === resonatorId) return 'team2'
  return null
}

// Build a normalized runtime from the scenario-owned member state.
export function materializeScenarioRuntime(
    scenario: CombatScenario,
    resonatorId: string,
): ResRuntime | null {
  const workspace = mkWorkRtBndl(scenario)
  return workspace.partRtsById[resonatorId] ?? null
}

/**
 * Materialize a detached, normalized active runtime from a stored profile.
 * Saved rotations use this path so inspecting one never has to load it into
 * scenario state first.
 */
export function runtimeFromSnapshot(
    profile: ResProf,
    options: {
      teamSlots?: TeamSlots
      rotation?: RotationState
    } = {},
): ResRuntime | null {
  const seed = getResSeedBy(profile.resonatorId)
  if (!seed) {
    return null
  }

  return normRtNegFfc(matRtFromPro({
    seed,
    profile,
    slotId: 'active',
    localState: profile.runtime.local,
    teamSlots: normProfTeam(
      profile.resonatorId,
      options.teamSlots ?? profile.runtime.team,
    ),
    rotation: options.rotation ?? profile.runtime.rotation,
  }))
}

// build the active runtime
export function mkActRt(scenario: CombatScenario): ResRuntime | null {
  return mkWorkRtBndl(scenario).actRt
}

// build a lookup of all active participant runtimes
export function mkPartRtLkp(scenario: CombatScenario): Record<string, ResRuntime> {
  return mkWorkRtBndl(scenario).partRtsById
}

// build a participant runtime lookup from one runtime and optional fallbacks
export function makeRuntimeMap(
    runtime: ResRuntime,
    fllbRntmById: Record<string, ResRuntime> = {},
): Record<string, ResRuntime> {
  const runtimes: Record<string, ResRuntime> = {
    [runtime.id]: runtime,
  }

  for (const memberId of runtime.build.team.slice(1)) {
    if (!memberId) {
      continue
    }

    const compactRuntime = (runtime.teamRuntimes ?? [null, null]).find((entry) => entry?.id === memberId) ?? null
    if (compactRuntime) {
      const seed = getResSeedBy(memberId)
      if (seed) {
        runtimes[memberId] = matTeamMemFr(
          seed,
          compactRuntime,
          runtime.state.controls,
          runtime.state.combat,
          runtime.build.team,
        )
        runtimes[memberId] = normRtNegFfc(runtimes[memberId])
        continue
      }
    }

    const fllbRt = fllbRntmById[memberId]
    if (fllbRt) {
      runtimes[memberId] = fllbRt
    }
  }

  return runtimes
}

// Build one standalone/context runtime per working scenario.
export function mkInitRtLkp(workspace: ScenarioWorkspace): Record<string, ResRuntime> {
  const runtimes: Record<string, ResRuntime> = {}

  for (const scenarioId of workspace.order) {
    const scenario = workspace.scenariosById[scenarioId]
    if (!scenario) continue
    const context = contextScenarioMember(scenario)
    const runtime = projectScenarioUiRuntimes(scenario).runtimesById[context.resonatorId]
    if (runtime) runtimes[context.resonatorId] = runtime
  }

  return runtimes
}

// build the lightweight team member runtime view used by teammate editing
export function mkTeamMemRtV(
    scenario: CombatScenario,
    resonatorId: string,
): TeamMemRtVie | null {
  const member = scenarioMemberByResonatorId(
    scenario,
    resonatorId,
  )
  if (!member || member === scenario.team.members[0]) return null

  return {
    id: resonatorId,
    base: {
      sequence: member.progression.sequence,
    },
    build: {
      weapon: cloneWpnMkSt(member.loadout.weapon),
      echoes: repairEchoLoadoutForCatalog(member.loadout.echoes),
    },
    state: {
      controls: { ...member.local.controls },
      manualBuffs: resolveEnvironmentManualBuffs(scenario.environment, member),
      combat: { ...scenario.environment.combatState },
    },
  }
}

// build a lookup of all teammate runtime views
export function mkTeamMemRtL(scenario: CombatScenario): Record<string, TeamMemRtVie> {
  const runtimes: Record<string, TeamMemRtVie> = {}
  for (const member of scenario.team.members.slice(1)) {
    const view = mkTeamMemRtV(scenario, member.resonatorId)
    if (view) {
      runtimes[member.resonatorId] = view
    }
  }

  return runtimes
}

function memberFromRuntime(
  runtime: ResRuntime,
  previous: ScenarioTeamMember,
  primary: boolean,
): ScenarioTeamMember {
  const controls = Object.fromEntries(
    Object.entries(runtime.state.controls)
      .filter(([key]) => !primary || !key.startsWith('team:')),
  )
  return {
    ...previous,
    resonatorId: runtime.id,
    progression: {
      level: runtime.base.level,
      sequence: runtime.base.sequence,
      skillLevels: cloneSkllLvl(runtime.base.skillLevels),
      traceNodes: cloneTrcNode(runtime.base.traceNodes),
    },
    loadout: {
      weapon: cloneWpnMkSt(runtime.build.weapon),
      echoes: repairEchoLoadoutForCatalog(runtime.build.echoes),
    },
    local: {
      ...previous.local,
      controls,
    },
  }
}

function memberForAddedRuntime(
  scenario: CombatScenario,
  runtime: ResRuntime,
  resonatorId: string,
): ScenarioTeamMember | null {
  const existing = scenarioMemberByResonatorId(
    scenario,
    resonatorId,
  )
  if (existing) return existing

  const compact = runtime.teamRuntimes.find((member) => member?.id === resonatorId) ?? null
  const seed = getResSeedBy(resonatorId)
  const materialized = compact && seed
    ? matTeamMemFr(
      seed,
      compact,
      runtime.state.controls,
      runtime.state.combat,
      runtime.build.team,
    )
    : null
  if (!materialized) return null

  const local = cloneSlotLuo(materialized.state)
  const base: ScenarioTeamMember = {
    id: teamMemberId(resonatorId),
    resonatorId,
    progression: cloneResBase(materialized.base),
    loadout: {
      weapon: cloneWpnMkSt(materialized.build.weapon),
      echoes: repairEchoLoadoutForCatalog(materialized.build.echoes),
    },
    local: {
      controls: local.controls,
      setConditionals: cloneSntSet(DEF_SET_COND),
      optimizerInventory: cloneOptInventorySelection(),
    },
  }
  return base
}

// Apply a legacy runtime edit to the canonical scenario. Runtime team fields are
// interpreted only as a compatibility command payload for existing UI surfaces.
export function applyRuntimeToSimulation(
  scenario: CombatScenario,
  resonatorId: string,
  runtime: ResRuntime,
): { scenario: CombatScenario } {
  const memberIndex = scenario.team.members.findIndex(
    (member) => member.resonatorId === resonatorId,
  )
  if (memberIndex < 0) return { scenario }

  const primary = memberIndex === 0
  const updatedMember = memberFromRuntime(
    maxEchoIfChg(runtime, scenario.team.members[memberIndex].loadout.echoes),
    scenario.team.members[memberIndex],
    primary,
  )
  const requestedIds = primary
    ? runtime.build.team.filter((id): id is string => Boolean(id)).slice(0, 3)
    : scenario.team.members.map((member) => member.resonatorId)
  if (!requestedIds.includes(updatedMember.resonatorId)) {
    requestedIds[memberIndex] = updatedMember.resonatorId
  }
  const uniqueIds = [...new Set(requestedIds)]
  const members = uniqueIds.flatMap((id) => {
    if (id === updatedMember.resonatorId) return [updatedMember]
    const member = memberForAddedRuntime(scenario, runtime, id)
    return member ? [member] : []
  })
  if (members.length === 0) return { scenario }
  const team = makeScenarioTeam(members)
  const memberIds = new Set(team.members.map((member) => member.id))
  const bySourceMemberId = Object.fromEntries(team.members.map((member) => [
    member.id,
    Object.fromEntries(Object.entries(scenario.environment.routing.bySourceMemberId[member.id] ?? {})
      .filter(([, target]) => target === null || memberIds.has(target))),
  ])) as Record<TeamMemberId, Record<string, TeamMemberId | null>>
  let environment = scenario.environment
  for (const previousMember of scenario.team.members) {
    if (!memberIds.has(previousMember.id)) {
      environment = removeMemberEnvironmentState(environment, previousMember.id)
    }
  }
  environment = replaceMemberManualEffect(
    environment,
    updatedMember.id,
    extractMemberManualBuffs(
      scenario.environment,
      scenario.team.members[memberIndex],
      runtime.state.manualBuffs,
    ),
  )
  for (const member of team.members) {
    if (scenario.team.members.some((candidate) => candidate.id === member.id)) continue
    const compact = runtime.teamRuntimes.find((candidate) => candidate?.id === member.resonatorId)
    environment = replaceMemberManualEffect(
      environment,
      member.id,
      compact?.manualBuffs ?? makeCustomBuff(),
    )
  }
  const nextScenario = reviseCombatScenario(scenario, {
    team,
    environment: {
      ...environment,
      combatState: { ...runtime.state.combat },
      routing: { bySourceMemberId },
    },
    program: primary ? cloneRotation(runtime.rotation) : scenario.program,
    initialOnFieldMemberId: memberIds.has(scenario.initialOnFieldMemberId)
      ? scenario.initialOnFieldMemberId
      : team.members[0].id,
  })
  return { scenario: nextScenario }
}
