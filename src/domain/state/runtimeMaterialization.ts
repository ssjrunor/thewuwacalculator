/*
  Author: Runor Ewhro
  Description: Materializes runtime state for active and teammate slots,
               including local state cloning and compact teammate expansion.
*/

import type { ResProf, SlotLocalState } from '@/domain/entities/profile'
import { cloneSntSet, DEF_SET_COND } from '@/domain/entities/sonataSetConditionals'
import type { SlotId } from '@/domain/entities/session'
import type {
  ResRuntime,
  ResSeed,
  RotationState,
  TeamMemRt,
  TeamSlots,
} from '@/domain/entities/runtime'
import {
  MAX_RES_LVL,
  MAX_SKILL_LEVEL,
  MAX_WPN_LVL,
  makeCombatState,
  makeCustomBuff,
  mkMaxSkllLvl,
  mkDefRot,
} from '@/domain/state/defaults'
import { mkMaxTrcNode } from '@/domain/state/traceNodes'
import {
  cloneBuffs,
  cloneRotation,
  cloneSkllLvl,
  cloneTrcNode,
  cloneWpnMkSt,
} from '@/domain/state/runtimeCloning'

export const SLOT_IDS: SlotId[] = ['active', 'team1', 'team2']

type SlotLclSttSr = SlotLocalState | ResRuntime['state']

// clone persisted slot-local state with safe defaults
export function cloneSlotLuo(state?: SlotLclSttSr): SlotLocalState {
  const setConds =
      state && 'setConditionals' in state
          ? state.setConditionals
          : undefined

  return {
    controls: { ...(state?.controls ?? {}) },
    manualBuffs: cloneBuffs(state?.manualBuffs ?? makeCustomBuff()),
    combat: { ...(state?.combat ?? makeCombatState()) },
    setConditionals: cloneSntSet(
      setConds ?? DEF_SET_COND,
    ),
  }
}

function matRtStt(state?: SlotLocalState): ResRuntime['state'] {
  return {
    controls: { ...(state?.controls ?? {}) },
    manualBuffs: cloneBuffs(state?.manualBuffs ?? makeCustomBuff()),
    combat: { ...(state?.combat ?? makeCombatState()) },
  }
}

// materialize progression for the given slot
function matSlotPrgr(
    seed: ResSeed,
    profile: ResProf,
    slotId: SlotId,
) {
  if (slotId === 'active') {
    return {
      level: profile.runtime.progression.level,
      sequence: profile.runtime.progression.sequence,
      skillLevels: cloneSkllLvl(profile.runtime.progression.skillLevels),
      traceNodes: cloneTrcNode(profile.runtime.progression.traceNodes),
    }
  }

  return {
    level: MAX_RES_LVL,
    sequence: profile.runtime.progression.sequence,
    skillLevels: {
      normalAttack: MAX_SKILL_LEVEL,
      resonanceSkill: MAX_SKILL_LEVEL,
      forteCircuit: MAX_SKILL_LEVEL,
      resonanceLiberation: MAX_SKILL_LEVEL,
      introSkill: MAX_SKILL_LEVEL,
      tuneBreak: MAX_SKILL_LEVEL,
    },
    traceNodes: mkMaxTrcNode(seed),
  }
}

// materialize weapon data for the given slot
function matSlotWpn(profile: ResProf, slotId: SlotId) {
  if (slotId === 'active') {
    return cloneWpnMkSt(profile.runtime.build.weapon)
  }

  return {
    ...profile.runtime.build.weapon,
    level: MAX_WPN_LVL,
  }
}

interface MatRtPtns {
  seed: ResSeed
  profile: ResProf
  slotId: SlotId
  localState: SlotLocalState
  teamSlots: TeamSlots
  rotation?: RotationState
}

// materialize a full runtime from a profile and slot context
export function matRtFromPro({
                                                       seed,
                                                       profile,
                                                       slotId,
                                                       localState,
                                                       teamSlots,
                                                       rotation,
                                                     }: MatRtPtns): ResRuntime {
  return {
    id: seed.id,
    base: matSlotPrgr(seed, profile, slotId),
    build: {
      weapon: matSlotWpn(profile, slotId),
      echoes: profile.runtime.build.echoes,
      team: teamSlots,
    },
    state: matRtStt(localState),
    rotation:
        slotId === 'active'
            ? cloneRotation(rotation ?? mkDefRot(seed))
            : mkDefRot(seed),
    teamRuntimes:
        slotId === 'active'
            ? (profile.runtime.teamRuntimes ?? [null, null])
            : [null, null],
  }
}

// extract namespaced teammate controls from the active control map
function xtrcNmspCntr(
    actCntr: Record<string, boolean | number | string>,
    resonatorId: string,
): Record<string, boolean | number | string> {
  const prefix = `team:${resonatorId}:`
  const controls: Record<string, boolean | number | string> = {}

  for (const key of Object.keys(actCntr)) {
    if (key.startsWith(prefix) && !key.startsWith(`${prefix}__mb:`)) {
      controls[key.slice(prefix.length)] = actCntr[key]
    }
  }

  return controls
}

// materialize a full runtime from a compact teammate runtime
export function matTeamMemFr(
    seed: ResSeed,
    tmr: TeamMemRt,
    actCntr: Record<string, boolean | number | string>,
    activeCombat: ResRuntime['state']['combat'],
    teamSlots: TeamSlots,
): ResRuntime {
  return {
    id: tmr.id,
    base: {
      sequence: tmr.base.sequence,
      level: MAX_RES_LVL,
      skillLevels: mkMaxSkllLvl(),
      traceNodes: mkMaxTrcNode(seed),
    },
    build: {
      weapon: {
        ...tmr.build.weapon,
        level: MAX_WPN_LVL,
      },
      echoes: [...tmr.build.echoes],
      team: teamSlots,
    },
    state: {
      controls: xtrcNmspCntr(actCntr, tmr.id),
      manualBuffs: cloneBuffs(tmr.manualBuffs ?? makeCustomBuff()),
      combat: { ...activeCombat },
    },
    rotation: mkDefRot(seed),
    teamRuntimes: [null, null],
  }
}
