/*
  Author: Runor Ewhro
  Description: Builds execution graphs from projected scenario members and
               resolves fixed-width engine coordinates.
*/

import {
  teamMemberId,
  type EnvironmentTargetModifiers,
  type TeamMemberId,
} from '@/domain/entities/combatScenario'
import type { ManualBuffs } from '@/domain/entities/manualBuffs'
import type { CombatGraph, CombatPart, SlotId } from '@/domain/entities/combatGraph'
import type { ResRuntime, ResSeed, TeamSlots } from '@/domain/entities/runtime'
import { getResSeedBy, resResBaseSt } from '@/domain/services/resonatorSeedService'
import {
  SLOT_IDS,
  cloneSlotLuo,
} from '@/domain/state/runtimeMaterialization'
import { cloneSlotRml } from '@/domain/state/defaults'
import {
  cloneResRtSt,
} from '@/domain/state/runtimeCloning'

interface MkTrnsCmbtGr {
  actRt: ResRuntime
  activeSeed?: ResSeed
  partRts?: Record<string, ResRuntime>
  targetsByRes?: Record<string, Record<string, string | null>>
  memberIdByResonatorId?: Readonly<Record<string, TeamMemberId>>
  environmentBuffsByMemberId?: Readonly<Record<TeamMemberId, ManualBuffs>>
  environmentTargetModifiers?: EnvironmentTargetModifiers
}

// find the slot id for a resonator inside a combat graph
export function findCombatPart(graph: CombatGraph, resonatorId: string): SlotId | null {
  for (const slotId of SLOT_IDS) {
    if (graph.participants[slotId]?.resonatorId === resonatorId) {
      return slotId
    }
  }

  return null
}

export function findCombatPartByMemberId(graph: CombatGraph, memberId: TeamMemberId): SlotId | null {
  for (const slotId of SLOT_IDS) {
    if (graph.participants[slotId]?.memberId === memberId) return slotId
  }
  return null
}

// rebuild team slots from the combat graph participants
export function mkCmbtGrphTe(graph: CombatGraph): TeamSlots {
  return [
    graph.participants.active?.resonatorId ?? null,
    graph.participants.team1?.resonatorId ?? null,
    graph.participants.team2?.resonatorId ?? null,
  ]
}

// rebuild one combat participant after a transient graph write
export function rbldCmbtPart(graph: CombatGraph, slotId: SlotId): CombatPart | null {
  const participant = graph.participants[slotId]
  if (!participant) {
    return null
  }

  const seed = getResSeedBy(participant.resonatorId)
  if (!seed) {
    return null
  }

  const runtime = {
    ...participant.runtime,
    build: {
      ...participant.runtime.build,
      team: mkCmbtGrphTe(graph),
    },
    state: cloneSlotLuo(participant.slot.local),
  }

  const nextPart: CombatPart = {
    ...participant,
    runtime,
    baseStats: resResBaseSt(seed, runtime.base.level),
    snapshots: {},
  }

  graph.participants[slotId] = nextPart
  return nextPart
}

// build a temporary combat graph directly from runtime snapshots
export function makeCombatGraph({
                                            actRt: actRt,
                                            activeSeed,
                                            partRts: partRntm = {},
                                            targetsByRes: targetsByRes = {},
                                            memberIdByResonatorId = {},
                                            environmentBuffsByMemberId,
                                            environmentTargetModifiers,
                                          }: MkTrnsCmbtGr): CombatGraph {
  const participants = {} as Record<SlotId, CombatPart>
  const teamSlots = [...actRt.build.team] as TeamSlots
  const shrdSelTrgtB = targetsByRes[actRt.id]

  for (const slotId of SLOT_IDS) {
    const resonatorId = teamSlots[slotId === 'active' ? 0 : slotId === 'team1' ? 1 : 2]
    if (!resonatorId) {
      continue
    }

    const runtime =
        resonatorId === actRt.id
            ? actRt
            : partRntm[resonatorId]

    const seed =
        resonatorId === actRt.id
            ? (activeSeed ?? getResSeedBy(resonatorId))
            : getResSeedBy(resonatorId)

    if (!runtime || !seed) {
      continue
    }

    const selTrgtByOwn =
        targetsByRes[resonatorId] ?? shrdSelTrgtB

    participants[slotId] = {
      slotId,
      memberId: memberIdByResonatorId[resonatorId] ?? teamMemberId(resonatorId),
      resonatorId,
      slot: {
        slotId,
        memberId: memberIdByResonatorId[resonatorId] ?? teamMemberId(resonatorId),
        resonatorId,
        local: cloneSlotLuo(runtime.state),
        routing: cloneSlotRml(
            selTrgtByOwn
                ? { selectedTargetsByOwnerKey: selTrgtByOwn }
                : undefined,
        ),
      },
      runtime: cloneResRtSt(runtime),
      baseStats: resResBaseSt(seed, runtime.base.level),
      snapshots: {},
    }
  }

  return {
    activeSlotId: 'active',
    participants,
    environmentBuffsByMemberId,
    environmentTargetModifiers,
  }
}
