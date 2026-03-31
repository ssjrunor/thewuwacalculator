/*
  Author: Runor Ewhro
  Description: Builds combat graphs from calculator or transient runtime
               state and provides helpers for participant slot resolution.
*/

import type { CalculatorState } from '@/domain/entities/appState'
import type { CombatGraph, CombatParticipant } from '@/domain/entities/combatGraph'
import type { ResonatorRuntimeState, ResonatorSeed, TeamSlots } from '@/domain/entities/runtime'
import type { SlotId } from '@/domain/entities/session'
import { getResonatorSeedById, resolveResonatorBaseStats } from '@/domain/services/resonatorSeedService'
import {
  SLOT_IDS,
  cloneSlotLocalState,
} from '@/domain/state/runtimeMaterialization'
import {
  buildWorkspaceRuntimeBundle,
  type WorkspaceRuntimeBundle,
} from '@/domain/state/runtimeAdapters'
import { cloneSlotRoutingState } from '@/domain/state/defaults'
import {
  cloneResonatorRuntimeState,
} from '@/domain/state/runtimeCloning'

interface BuildTransientCombatGraphOptions {
  activeRuntime: ResonatorRuntimeState
  activeSeed?: ResonatorSeed
  participantRuntimes?: Record<string, ResonatorRuntimeState>
  selectedTargetsByResonatorId?: Record<string, Record<string, string | null>>
}

// find the slot id for a resonator inside a combat graph
export function findCombatParticipantSlotId(graph: CombatGraph, resonatorId: string): SlotId | null {
  for (const slotId of SLOT_IDS) {
    if (graph.participants[slotId]?.resonatorId === resonatorId) {
      return slotId
    }
  }

  return null
}

// rebuild team slots from the combat graph participants
export function buildCombatGraphTeamSlots(graph: CombatGraph): TeamSlots {
  return [
    graph.participants.active?.resonatorId ?? null,
    graph.participants.team1?.resonatorId ?? null,
    graph.participants.team2?.resonatorId ?? null,
  ]
}

// rebuild one combat participant after a transient graph write
export function rebuildCombatParticipant(graph: CombatGraph, slotId: SlotId): CombatParticipant | null {
  const participant = graph.participants[slotId]
  if (!participant) {
    return null
  }

  const seed = getResonatorSeedById(participant.resonatorId)
  if (!seed) {
    return null
  }

  const runtime = {
    ...participant.runtime,
    build: {
      ...participant.runtime.build,
      team: buildCombatGraphTeamSlots(graph),
    },
    state: cloneSlotLocalState(participant.slot.local),
  }

  const nextParticipant: CombatParticipant = {
    ...participant,
    runtime,
    baseStats: resolveResonatorBaseStats(seed, runtime.base.level),
    snapshots: {},
  }

  graph.participants[slotId] = nextParticipant
  return nextParticipant
}

// build a combat graph from persisted calculator state
export function buildCombatGraphFromWorkspaceBundle(
    calculator: CalculatorState,
    workspace: WorkspaceRuntimeBundle,
): CombatGraph {
  const participants = {} as Record<SlotId, CombatParticipant>
  const activeId = workspace.activeResonatorId
  const activeProfile = activeId ? calculator.profiles[activeId] : null

  // active slot
  if (activeId && activeProfile && workspace.activeRuntime) {
    const seed = getResonatorSeedById(activeId)
    if (seed) {
      const runtime = workspace.activeRuntime

      participants.active = {
        slotId: 'active',
        resonatorId: activeId,
        slot: {
          slotId: 'active',
          resonatorId: activeId,
          local: cloneSlotLocalState(activeProfile.runtime.local),
          routing: cloneSlotRoutingState(activeProfile.runtime.routing),
        },
        runtime: cloneResonatorRuntimeState(runtime),
        baseStats: resolveResonatorBaseStats(seed, runtime.base.level),
        snapshots: {},
      }
    }
  }

  // team slots sourced from the active profile's compact team runtimes
  if (activeProfile) {
    const slotIds: SlotId[] = ['team1', 'team2']

    for (let i = 0; i < 2; i += 1) {
      const tmr = activeProfile.runtime.teamRuntimes?.[i] ?? null
      if (!tmr) continue

      const seed = getResonatorSeedById(tmr.id)
      if (!seed) continue

      const runtime = workspace.participantRuntimesById[tmr.id]
      if (!runtime) {
        continue
      }

      participants[slotIds[i]] = {
        slotId: slotIds[i],
        resonatorId: tmr.id,
        slot: {
          slotId: slotIds[i],
          resonatorId: tmr.id,
          local: cloneSlotLocalState(runtime.state),
          routing: cloneSlotRoutingState(activeProfile.runtime.routing),
        },
        runtime: cloneResonatorRuntimeState(runtime),
        baseStats: resolveResonatorBaseStats(seed, runtime.base.level),
        snapshots: {},
      }
    }
  }

  return {
    activeSlotId: 'active',
    participants,
  }
}

// build a combat graph from persisted calculator state
export function buildCombatGraph(calculator: CalculatorState): CombatGraph {
  return buildCombatGraphFromWorkspaceBundle(calculator, buildWorkspaceRuntimeBundle(calculator))
}

// build a temporary combat graph directly from runtime snapshots
export function buildTransientCombatGraph({
                                            activeRuntime,
                                            activeSeed,
                                            participantRuntimes = {},
                                            selectedTargetsByResonatorId = {},
                                          }: BuildTransientCombatGraphOptions): CombatGraph {
  const participants = {} as Record<SlotId, CombatParticipant>
  const teamSlots = [...activeRuntime.build.team] as TeamSlots
  const sharedSelectedTargetsByOwnerKey = selectedTargetsByResonatorId[activeRuntime.id]

  for (const slotId of SLOT_IDS) {
    const resonatorId = teamSlots[slotId === 'active' ? 0 : slotId === 'team1' ? 1 : 2]
    if (!resonatorId) {
      continue
    }

    const runtime =
        resonatorId === activeRuntime.id
            ? activeRuntime
            : participantRuntimes[resonatorId]

    const seed =
        resonatorId === activeRuntime.id
            ? (activeSeed ?? getResonatorSeedById(resonatorId))
            : getResonatorSeedById(resonatorId)

    if (!runtime || !seed) {
      continue
    }

    const selectedTargetsByOwnerKey =
        selectedTargetsByResonatorId[resonatorId] ?? sharedSelectedTargetsByOwnerKey

    participants[slotId] = {
      slotId,
      resonatorId,
      slot: {
        slotId,
        resonatorId,
        local: cloneSlotLocalState(runtime.state),
        routing: cloneSlotRoutingState(
            selectedTargetsByOwnerKey
                ? { selectedTargetsByOwnerKey }
                : undefined,
        ),
      },
      runtime: cloneResonatorRuntimeState(runtime),
      baseStats: resolveResonatorBaseStats(seed, runtime.base.level),
      snapshots: {},
    }
  }

  return {
    activeSlotId: 'active',
    participants,
  }
}
