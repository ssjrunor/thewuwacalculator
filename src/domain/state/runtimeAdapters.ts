/*
  Author: Runor Ewhro
  Description: Provides helpers for adapting calculator profile state into
               active and team runtime views, lookup maps, and persisted updates.
*/

import type { CalculatorState } from '@/domain/entities/appState'
import { cloneCompactSonataSetConditionals, DEFAULT_SONATA_SET_CONDITIONALS } from '@/domain/entities/sonataSetConditionals'
import type { SlotLocalState } from '@/domain/entities/profile'
import type { SlotId } from '@/domain/entities/session'
import { normalizeResonatorRuntimeControls } from '@/domain/gameData/controlOptions'
import { normalizeNegativeEffectCombatState } from '@/domain/gameData/negativeEffects'
import type {
  ResonatorRuntimeState,
  TeamMemberRuntime,
  TeamMemberRuntimeView,
  TeamSlots,
} from '@/domain/entities/runtime'
import {
  cloneSlotRoutingState,
  makeDefaultCustomBuffs,
  makeDefaultSkillLevels,
  makeDefaultTeamMemberRuntime,
  makeDefaultTraceNodeBuffs,
  normalizeProfileTeam,
} from '@/domain/state/defaults'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import {
  materializeRuntimeFromProfileAndSlot,
  materializeTeamMemberFromCompactRuntime,
} from '@/domain/state/runtimeMaterialization'
import {
  cloneManualBuffs,
  cloneResonatorBaseState,
  cloneRotationState,
  cloneSkillLevels,
  cloneTraceNodeBuffs,
  cloneWeaponBuildState,
} from '@/domain/state/runtimeCloning'

export interface WorkspaceRuntimeBundle {
  activeResonatorId: string | null
  activeTeamSlots: TeamSlots
  activeTargetSelections: Record<string, string | null>
  activeRuntime: ResonatorRuntimeState | null
  participantRuntimesById: Record<string, ResonatorRuntimeState>
}

function normalizeRuntimeNegativeEffects(runtime: ResonatorRuntimeState): ResonatorRuntimeState {
  const controls = normalizeResonatorRuntimeControls(runtime)
  const combat = normalizeNegativeEffectCombatState(runtime)
  const controlsUnchanged = Object.keys(controls).every((key) => controls[key] === runtime.state.controls[key])
    && Object.keys(runtime.state.controls).every((key) => runtime.state.controls[key] === controls[key])
  const combatUnchanged = Object.keys(combat).every(
    (key) => combat[key as keyof typeof combat] === runtime.state.combat[key as keyof typeof combat],
  )

  if (controlsUnchanged && combatUnchanged) {
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

function buildLocalStateFromRuntimeState(
    runtimeState: ResonatorRuntimeState['state'],
    existingLocal?: SlotLocalState,
): SlotLocalState {
  return {
    controls: { ...runtimeState.controls },
    manualBuffs: cloneManualBuffs(runtimeState.manualBuffs),
    combat: { ...runtimeState.combat },
    setConditionals: cloneCompactSonataSetConditionals(
      existingLocal?.setConditionals ?? DEFAULT_SONATA_SET_CONDITIONALS,
    ),
  }
}

// build the selected target routing map from the active profile
export function buildSelectedTargetResonatorMap(
    calculator: CalculatorState,
): Record<string, string | null> {
  // all routing, including teammate routing, is stored on the active resonator profile
  const activeId = getActiveResonatorId(calculator)
  if (!activeId) return {}

  return {
    ...(calculator.profiles[activeId]?.runtime.routing.selectedTargetsByOwnerKey),
  }
}

// materialize the active workspace runtime bundle once so callers can reuse
// active runtime, participant runtimes, team slots, and routing selections
export function buildWorkspaceRuntimeBundle(calculator: CalculatorState): WorkspaceRuntimeBundle {
  const activeResonatorId = getActiveResonatorId(calculator)
  if (!activeResonatorId) {
    return {
      activeResonatorId: null,
      activeTeamSlots: [null, null, null],
      activeTargetSelections: {},
      activeRuntime: null,
      participantRuntimesById: {},
    }
  }

  const activeProfile = calculator.profiles[activeResonatorId]
  if (!activeProfile) {
    return {
      activeResonatorId,
      activeTeamSlots: [activeResonatorId, null, null],
      activeTargetSelections: {},
      activeRuntime: null,
      participantRuntimesById: {},
    }
  }

  const activeTeamSlots: TeamSlots = [
    activeResonatorId,
    activeProfile.runtime.teamRuntimes?.[0]?.id ?? null,
    activeProfile.runtime.teamRuntimes?.[1]?.id ?? null,
  ]
  const activeTargetSelections = {
    ...activeProfile.runtime.routing.selectedTargetsByOwnerKey,
  }
  const seed = getResonatorSeedById(activeResonatorId)
  const rawActiveRuntime = seed
      ? materializeRuntimeFromProfileAndSlot({
        seed,
        profile: activeProfile,
        slotId: 'active',
        localState: activeProfile.runtime.local,
        teamSlots: activeTeamSlots,
        rotation: activeProfile.runtime.rotation,
      })
      : null
  const activeRuntime = rawActiveRuntime ? normalizeRuntimeNegativeEffects(rawActiveRuntime) : null

  const participantRuntimesById: Record<string, ResonatorRuntimeState> = {}
  if (activeRuntime) {
    participantRuntimesById[activeRuntime.id] = activeRuntime
  }

  const compactTeamRuntimes = activeProfile.runtime.teamRuntimes ?? [null, null]
  for (let slotIndex = 0; slotIndex < compactTeamRuntimes.length; slotIndex += 1) {
    const compactRuntime = compactTeamRuntimes[slotIndex]
    if (!compactRuntime) {
      continue
    }

    const teammateSeed = getResonatorSeedById(compactRuntime.id)
    if (!teammateSeed) {
      continue
    }

    const runtime = materializeTeamMemberFromCompactRuntime(
        teammateSeed,
        compactRuntime,
        activeProfile.runtime.local.controls,
        activeRuntime?.state.combat ?? activeProfile.runtime.local.combat,
        activeTeamSlots,
    )
    participantRuntimesById[runtime.id] = normalizeRuntimeNegativeEffects(runtime)
  }

  return {
    activeResonatorId,
    activeTeamSlots,
    activeTargetSelections,
    activeRuntime,
    participantRuntimesById,
  }
}

// get the active resonator id from session state
export function getActiveResonatorId(calculator: CalculatorState): string | null {
  return calculator.session.activeResonatorId
}

// build the active team slots from the active profile
export function buildActiveTeamSlots(calculator: CalculatorState): TeamSlots {
  const activeResonatorId = getActiveResonatorId(calculator)
  if (!activeResonatorId) {
    return [null, null, null]
  }

  const activeProfile = calculator.profiles[activeResonatorId]
  if (!activeProfile) {
    return [activeResonatorId, null, null]
  }

  const tmr = activeProfile.runtime.teamRuntimes ?? [null, null]
  return [activeResonatorId, tmr[0]?.id ?? null, tmr[1]?.id ?? null]
}

// get the resonator id occupying a given slot
export function getSlotResonatorId(calculator: CalculatorState, slotId: SlotId): string | null {
  const team = buildActiveTeamSlots(calculator)

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
export function findSlotIdForResonator(calculator: CalculatorState, resonatorId: string): SlotId | null {
  const team = buildActiveTeamSlots(calculator)
  if (team[0] === resonatorId) return 'active'
  if (team[1] === resonatorId) return 'team1'
  if (team[2] === resonatorId) return 'team2'
  return null
}

// find the compact team runtime slot index for a teammate
function findTeamRuntimeSlotIndex(calculator: CalculatorState, resonatorId: string): number | null {
  const activeId = getActiveResonatorId(calculator)
  if (!activeId) return null

  const activeProfile = calculator.profiles[activeId]
  if (!activeProfile) return null

  const tmr = activeProfile.runtime.teamRuntimes ?? [null, null]
  if (tmr[0]?.id === resonatorId) return 0
  if (tmr[1]?.id === resonatorId) return 1
  return null
}

// materialize one teammate runtime from its compact stored form
function buildTeamMemberRuntimeFromSlot(
    calculator: CalculatorState,
    slotIndex: number,
): ResonatorRuntimeState | null {
  const activeId = getActiveResonatorId(calculator)
  if (!activeId) return null

  const activeProfile = calculator.profiles[activeId]
  if (!activeProfile) return null

  const tmr = (activeProfile.runtime.teamRuntimes ?? [null, null])[slotIndex]
  if (!tmr) return null

  const seed = getResonatorSeedById(tmr.id)
  if (!seed) return null

  return normalizeRuntimeNegativeEffects(materializeTeamMemberFromCompactRuntime(
    seed,
    tmr,
    activeProfile.runtime.local.controls,
    activeProfile.runtime.local.combat,
    buildActiveTeamSlots(calculator),
  ))
}

// build a full runtime for a resonator from calculator state
export function buildRuntimeFromProfile(
    calculator: CalculatorState,
    resonatorId: string,
): ResonatorRuntimeState | null {
  const workspace = buildWorkspaceRuntimeBundle(calculator)
  if (workspace.activeRuntime?.id === resonatorId) {
    return workspace.activeRuntime
  }

  const workspaceParticipant = workspace.participantRuntimesById[resonatorId]
  if (workspaceParticipant) {
    return workspaceParticipant
  }

  const slotId = findSlotIdForResonator(calculator, resonatorId)
  if (!slotId) {
    return null
  }

  // teammates are materialized from the active profile's compact team runtimes
  if (slotId !== 'active') {
    const slotIndex = findTeamRuntimeSlotIndex(calculator, resonatorId)
    if (slotIndex === null) return null
    return buildTeamMemberRuntimeFromSlot(calculator, slotIndex)
  }

  const seed = getResonatorSeedById(resonatorId)
  const profile = calculator.profiles[resonatorId]
  if (!seed || !profile) {
    return null
  }

  return normalizeRuntimeNegativeEffects(materializeRuntimeFromProfileAndSlot({
    seed,
    profile,
    slotId: 'active',
    localState: profile.runtime.local,
    teamSlots: buildActiveTeamSlots(calculator),
    rotation: profile.runtime.rotation,
  }))
}

// build a normalized initialized runtime view for a profile
export function buildInitializedRuntimeView(
    calculator: CalculatorState,
    resonatorId: string,
): ResonatorRuntimeState | null {
  const seed = getResonatorSeedById(resonatorId)
  const profile = calculator.profiles[resonatorId]
  if (!seed || !profile) {
    return null
  }

  return normalizeRuntimeNegativeEffects(materializeRuntimeFromProfileAndSlot({
    seed,
    profile,
    slotId: 'active',
    localState: profile.runtime.local,
    teamSlots: normalizeProfileTeam(resonatorId, profile.runtime.team),
    rotation: profile.runtime.rotation,
  }))
}

// build the active runtime
export function buildActiveRuntime(calculator: CalculatorState): ResonatorRuntimeState | null {
  return buildWorkspaceRuntimeBundle(calculator).activeRuntime
}

// build a lookup of all active participant runtimes
export function buildParticipantRuntimeLookup(calculator: CalculatorState): Record<string, ResonatorRuntimeState> {
  return buildWorkspaceRuntimeBundle(calculator).participantRuntimesById
}

// build a participant runtime lookup from one runtime and optional fallbacks
export function buildRuntimeParticipantLookup(
    runtime: ResonatorRuntimeState,
    fallbackRuntimesById: Record<string, ResonatorRuntimeState> = {},
): Record<string, ResonatorRuntimeState> {
  const runtimes: Record<string, ResonatorRuntimeState> = {
    [runtime.id]: runtime,
  }

  for (const memberId of runtime.build.team.slice(1)) {
    if (!memberId) {
      continue
    }

    const compactRuntime = (runtime.teamRuntimes ?? [null, null]).find((entry) => entry?.id === memberId) ?? null
    if (compactRuntime) {
      const seed = getResonatorSeedById(memberId)
      if (seed) {
        runtimes[memberId] = materializeTeamMemberFromCompactRuntime(
          seed,
          compactRuntime,
          runtime.state.controls,
          runtime.state.combat,
          runtime.build.team,
        )
        runtimes[memberId] = normalizeRuntimeNegativeEffects(runtimes[memberId])
        continue
      }
    }

    const fallbackRuntime = fallbackRuntimesById[memberId]
    if (fallbackRuntime) {
      runtimes[memberId] = fallbackRuntime
    }
  }

  return runtimes
}

// build initialized runtime views for every stored profile
export function buildInitializedRuntimeLookup(calculator: CalculatorState): Record<string, ResonatorRuntimeState> {
  const runtimes: Record<string, ResonatorRuntimeState> = {}

  for (const resonatorId of Object.keys(calculator.profiles)) {
    const runtime = buildInitializedRuntimeView(calculator, resonatorId)
    if (runtime) {
      runtimes[resonatorId] = runtime
    }
  }

  return runtimes
}

// build the lightweight team member runtime view used by teammate editing
export function buildTeamMemberRuntimeView(
    calculator: CalculatorState,
    resonatorId: string,
): TeamMemberRuntimeView | null {
  const slotIndex = findTeamRuntimeSlotIndex(calculator, resonatorId)
  if (slotIndex === null) return null

  const activeId = getActiveResonatorId(calculator)
  if (!activeId) return null

  const activeProfile = calculator.profiles[activeId]
  if (!activeProfile) return null

  const tmr = (activeProfile.runtime.teamRuntimes ?? [null, null])[slotIndex]
  if (!tmr) return null

  // extract namespaced controls from the active profile controls
  const prefix = `team:${tmr.id}:`
  const controls: Record<string, boolean | number | string> = {}
  for (const key of Object.keys(activeProfile.runtime.local.controls)) {
    if (key.startsWith(prefix)) {
      controls[key.slice(prefix.length)] = activeProfile.runtime.local.controls[key]
    }
  }

  return {
    id: resonatorId,
    base: {
      sequence: tmr.base.sequence,
    },
    build: {
      weapon: {
        id: tmr.build.weapon.id,
        rank: tmr.build.weapon.rank,
        baseAtk: tmr.build.weapon.baseAtk,
      },
      echoes: tmr.build.echoes,
    },
    state: {
      controls,
      manualBuffs: cloneManualBuffs(tmr.manualBuffs ?? makeDefaultCustomBuffs()),
      combat: { ...activeProfile.runtime.local.combat },
    },
  }
}

// build a lookup of all teammate runtime views
export function buildTeamMemberRuntimeLookup(calculator: CalculatorState): Record<string, TeamMemberRuntimeView> {
  const runtimes: Record<string, TeamMemberRuntimeView> = {}
  const activeId = getActiveResonatorId(calculator)
  if (!activeId) return runtimes

  const activeProfile = calculator.profiles[activeId]
  if (!activeProfile) return runtimes

  const tmRuntimes = activeProfile.runtime.teamRuntimes ?? [null, null]
  for (let i = 0; i < 2; i += 1) {
    const tmr = tmRuntimes[i]
    if (!tmr) continue
    const view = buildTeamMemberRuntimeView(calculator, tmr.id)
    if (view) {
      runtimes[tmr.id] = view
    }
  }

  return runtimes
}

// write a teammate runtime back into the active profile team runtime storage
function applyTeamMemberRuntimeToActiveProfile(
    calculator: CalculatorState,
    resonatorId: string,
    runtime: ResonatorRuntimeState,
): CalculatorState {
  const activeId = getActiveResonatorId(calculator)
  if (!activeId) return calculator

  const activeProfile = calculator.profiles[activeId]
  if (!activeProfile) return calculator

  const slotIndex = findTeamRuntimeSlotIndex(calculator, resonatorId)
  if (slotIndex === null) return calculator

  // build updated compact team member runtime
  const updatedTmr: TeamMemberRuntime = {
    id: resonatorId,
    base: cloneResonatorBaseState(runtime.base),
    build: {
      weapon: cloneWeaponBuildState(runtime.build.weapon),
      echoes: runtime.build.echoes,
    },
    manualBuffs: cloneManualBuffs(runtime.state.manualBuffs),
  }

  // update team runtimes array
  const nextTeamRuntimes = [...(activeProfile.runtime.teamRuntimes ?? [null, null])] as [
        TeamMemberRuntime | null,
        TeamMemberRuntime | null,
  ]
  nextTeamRuntimes[slotIndex] = updatedTmr

  // replace old namespaced controls with the new ones
  const prefix = `team:${resonatorId}:`
  const nextControls: Record<string, boolean | number | string> = {}
  for (const [key, value] of Object.entries(activeProfile.runtime.local.controls)) {
    if (!key.startsWith(prefix)) {
      nextControls[key] = value
    }
  }
  for (const [key, value] of Object.entries(runtime.state.controls)) {
    nextControls[`${prefix}${key}`] = value
  }

  // derive team slots from compact team runtimes
  const nextTeam: TeamSlots = [activeId, nextTeamRuntimes[0]?.id ?? null, nextTeamRuntimes[1]?.id ?? null]

  return {
    ...calculator,
    profiles: {
      ...calculator.profiles,
      [activeId]: {
        ...activeProfile,
        runtime: {
          ...activeProfile.runtime,
          local: {
            ...activeProfile.runtime.local,
            controls: nextControls,
          },
          team: nextTeam,
          teamRuntimes: nextTeamRuntimes,
        },
      },
    },
  }
}

// reconcile compact team runtimes to match normalized team slots
function reconcileTeamRuntimes(
    team: TeamSlots,
    current: [TeamMemberRuntime | null, TeamMemberRuntime | null],
): [TeamMemberRuntime | null, TeamMemberRuntime | null] {
  const result: [TeamMemberRuntime | null, TeamMemberRuntime | null] = [null, null]

  for (let i = 0; i < 2; i += 1) {
    const memberId = team[i + 1]
    if (!memberId) {
      result[i] = null
      continue
    }

    // keep the existing entry if it still matches this slot
    if (current[i]?.id === memberId) {
      result[i] = current[i]
      continue
    }

    // teammate may have swapped positions
    const otherIndex = 1 - i
    if (current[otherIndex]?.id === memberId) {
      result[i] = current[otherIndex]
      continue
    }

    // create a new compact runtime for a newly added teammate
    const seed = getResonatorSeedById(memberId)
    if (seed) {
      result[i] = makeDefaultTeamMemberRuntime(seed)
    }
  }

  return result
}

// apply a runtime back into calculator persisted state
export function applyRuntimeToCalculatorState(
    calculator: CalculatorState,
    resonatorId: string,
    runtime: ResonatorRuntimeState,
): CalculatorState {
  const slotId = findSlotIdForResonator(calculator, resonatorId)
  if (!slotId) {
    return calculator
  }

  // teammates write into the active profile team runtime storage
  if (slotId !== 'active') {
    return applyTeamMemberRuntimeToActiveProfile(calculator, resonatorId, runtime)
  }

  // active resonator writes directly into its own profile
  const normalizedRuntimeTeam = normalizeProfileTeam(runtime.id, runtime.build.team)
  const existingRuntime = calculator.profiles[resonatorId]?.runtime

  const fallbackRuntime = {
    progression: {
      level: 1,
      sequence: 0,
      skillLevels: makeDefaultSkillLevels(),
      traceNodes: makeDefaultTraceNodeBuffs(),
    },
    build: {
      weapon: runtime.build.weapon,
      echoes: runtime.build.echoes,
    },
    local: buildLocalStateFromRuntimeState(runtime.state, existingRuntime?.local),
    routing: cloneSlotRoutingState(existingRuntime?.routing),
    team: normalizedRuntimeTeam,
    rotation: cloneRotationState(runtime.rotation),
    teamRuntimes: reconcileTeamRuntimes(normalizedRuntimeTeam, runtime.teamRuntimes ?? [null, null]),
  }

  const nextProfiles = {
    ...calculator.profiles,
    [resonatorId]: {
      ...(calculator.profiles[resonatorId] ?? {
        resonatorId,
        runtime: fallbackRuntime,
      }),
      runtime: {
        ...(existingRuntime ?? fallbackRuntime),
        progression: {
          level: runtime.base.level,
          sequence: runtime.base.sequence,
          skillLevels: cloneSkillLevels(runtime.base.skillLevels),
          traceNodes: cloneTraceNodeBuffs(runtime.base.traceNodes),
        },
        build: {
          weapon: cloneWeaponBuildState(runtime.build.weapon),
          echoes: runtime.build.echoes,
        },
        local: buildLocalStateFromRuntimeState(runtime.state, existingRuntime?.local),
        routing: cloneSlotRoutingState(existingRuntime?.routing),
        team: normalizedRuntimeTeam,
        rotation: cloneRotationState(runtime.rotation),
        teamRuntimes: reconcileTeamRuntimes(
            normalizedRuntimeTeam,
            runtime.teamRuntimes ?? existingRuntime?.teamRuntimes ?? [null, null],
        ),
      },
    },
  }

  return {
    ...calculator,
    profiles: nextProfiles,
    session: {
      ...calculator.session,
      activeResonatorId: normalizedRuntimeTeam[0] ?? resonatorId,
    },
  }
}
