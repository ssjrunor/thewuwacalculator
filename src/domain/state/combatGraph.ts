/*
  Author: Runor Ewhro
  Description: Builds combat graphs from calculator or transient runtime
               state and provides helpers for participant slot resolution.
*/

import type { CalcState } from '@/domain/entities/appState'
import type { CombatGraph, CombatPart } from '@/domain/entities/combatGraph'
import type { ResRuntime, ResSeed, TeamSlots } from '@/domain/entities/runtime'
import type { SlotId } from '@/domain/entities/session'
import { getResSeedBy, resResBaseSt } from '@/domain/services/resonatorSeedService'
import {
  SLOT_IDS,
  cloneSlotLuo,
} from '@/domain/state/runtimeMaterialization'
import {
  mkWorkRtBndl,
  type WorkRtBndl,
} from '@/domain/state/runtimeAdapters'
import { cloneSlotRml } from '@/domain/state/defaults'
import {
  cloneResRtSt,
} from '@/domain/state/runtimeCloning'

interface MkTrnsCmbtGr {
  actRt: ResRuntime
  activeSeed?: ResSeed
  partRts?: Record<string, ResRuntime>
  targetsByRes?: Record<string, Record<string, string | null>>
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

// build a combat graph from persisted calculator state
export function mkCmbtGrphFr(
    calculator: CalcState,
    workspace: WorkRtBndl,
): CombatGraph {
  const participants = {} as Record<SlotId, CombatPart>
  const activeId = workspace.actResId
  const actProf = activeId ? calculator.profiles[activeId] : null

  // active slot
  if (activeId && actProf && workspace.actRt) {
    const seed = getResSeedBy(activeId)
    if (seed) {
      const runtime = workspace.actRt

      participants.active = {
        slotId: 'active',
        resonatorId: activeId,
        slot: {
          slotId: 'active',
          resonatorId: activeId,
          local: cloneSlotLuo(actProf.runtime.local),
          routing: cloneSlotRml(actProf.runtime.routing),
        },
        runtime: cloneResRtSt(runtime),
        baseStats: resResBaseSt(seed, runtime.base.level),
        snapshots: {},
      }
    }
  }

  // team slots sourced from the active profile's compact team runtimes
  if (actProf) {
    const slotIds: SlotId[] = ['team1', 'team2']

    for (let i = 0; i < 2; i += 1) {
      const tmr = actProf.runtime.teamRuntimes?.[i] ?? null
      if (!tmr) continue

      const seed = getResSeedBy(tmr.id)
      if (!seed) continue

      const runtime = workspace.partRtsById[tmr.id]
      if (!runtime) {
        continue
      }

      participants[slotIds[i]] = {
        slotId: slotIds[i],
        resonatorId: tmr.id,
        slot: {
          slotId: slotIds[i],
          resonatorId: tmr.id,
          local: cloneSlotLuo(runtime.state),
          routing: cloneSlotRml(actProf.runtime.routing),
        },
        runtime: cloneResRtSt(runtime),
        baseStats: resResBaseSt(seed, runtime.base.level),
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
export function mkCmbtGrph(calculator: CalcState): CombatGraph {
  return mkCmbtGrphFr(calculator, mkWorkRtBndl(calculator))
}

// build a temporary combat graph directly from runtime snapshots
export function makeCombatGraph({
                                            actRt: actRt,
                                            activeSeed,
                                            partRts: partRntm = {},
                                            targetsByRes: targetsByRes = {},
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
      resonatorId,
      slot: {
        slotId,
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
  }
}
