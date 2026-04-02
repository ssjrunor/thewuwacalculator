/*
  Author: Runor Ewhro
  Description: Materializes runtime state for active and teammate slots,
               including local state cloning and compact teammate expansion.
*/

import type { ResonatorProfile, SlotLocalState } from '@/domain/entities/profile'
import { cloneCompactSonataSetConditionals, DEFAULT_SONATA_SET_CONDITIONALS } from '@/domain/entities/sonataSetConditionals'
import type { SlotId } from '@/domain/entities/session'
import type {
  ResonatorRuntimeState,
  ResonatorSeed,
  RotationState,
  TeamMemberRuntime,
  TeamSlots,
} from '@/domain/entities/runtime'
import {
  MAX_RESONATOR_LEVEL,
  MAX_SKILL_LEVEL,
  MAX_WEAPON_LEVEL,
  makeDefaultCombatState,
  makeDefaultCustomBuffs,
  makeDefaultRotation,
} from '@/domain/state/defaults'
import { makeMaxTraceNodeBuffs } from '@/domain/state/traceNodes'
import {
  cloneManualBuffs,
  cloneResonatorBaseState,
  cloneRotationState,
  cloneSkillLevels,
  cloneTraceNodeBuffs,
  cloneWeaponBuildState,
} from '@/domain/state/runtimeCloning'

export const SLOT_IDS: SlotId[] = ['active', 'team1', 'team2']

type SlotLocalStateSource = SlotLocalState | ResonatorRuntimeState['state']

// clone persisted slot-local state with safe defaults
export function cloneSlotLocalState(state?: SlotLocalStateSource): SlotLocalState {
  const setConditionals =
      state && 'setConditionals' in state
          ? state.setConditionals
          : undefined

  return {
    controls: { ...(state?.controls ?? {}) },
    manualBuffs: cloneManualBuffs(state?.manualBuffs ?? makeDefaultCustomBuffs()),
    combat: { ...(state?.combat ?? makeDefaultCombatState()) },
    setConditionals: cloneCompactSonataSetConditionals(
      setConditionals ?? DEFAULT_SONATA_SET_CONDITIONALS,
    ),
  }
}

function materializeRuntimeState(state?: SlotLocalState): ResonatorRuntimeState['state'] {
  return {
    controls: { ...(state?.controls ?? {}) },
    manualBuffs: cloneManualBuffs(state?.manualBuffs ?? makeDefaultCustomBuffs()),
    combat: { ...(state?.combat ?? makeDefaultCombatState()) },
  }
}

// materialize progression for the given slot
function materializeSlotProgression(
    seed: ResonatorSeed,
    profile: ResonatorProfile,
    slotId: SlotId,
) {
  if (slotId === 'active') {
    return {
      level: profile.runtime.progression.level,
      sequence: profile.runtime.progression.sequence,
      skillLevels: cloneSkillLevels(profile.runtime.progression.skillLevels),
      traceNodes: cloneTraceNodeBuffs(profile.runtime.progression.traceNodes),
    }
  }

  return {
    level: MAX_RESONATOR_LEVEL,
    sequence: profile.runtime.progression.sequence,
    skillLevels: {
      normalAttack: MAX_SKILL_LEVEL,
      resonanceSkill: MAX_SKILL_LEVEL,
      forteCircuit: MAX_SKILL_LEVEL,
      resonanceLiberation: MAX_SKILL_LEVEL,
      introSkill: MAX_SKILL_LEVEL,
      tuneBreak: MAX_SKILL_LEVEL,
    },
    traceNodes: makeMaxTraceNodeBuffs(seed),
  }
}

// materialize weapon data for the given slot
function materializeSlotWeapon(profile: ResonatorProfile, slotId: SlotId) {
  if (slotId === 'active') {
    return cloneWeaponBuildState(profile.runtime.build.weapon)
  }

  return {
    ...profile.runtime.build.weapon,
    level: MAX_WEAPON_LEVEL,
  }
}

interface MaterializeRuntimeOptions {
  seed: ResonatorSeed
  profile: ResonatorProfile
  slotId: SlotId
  localState: SlotLocalState
  teamSlots: TeamSlots
  rotation?: RotationState
}

// materialize a full runtime from a profile and slot context
export function materializeRuntimeFromProfileAndSlot({
                                                       seed,
                                                       profile,
                                                       slotId,
                                                       localState,
                                                       teamSlots,
                                                       rotation,
                                                     }: MaterializeRuntimeOptions): ResonatorRuntimeState {
  return {
    id: seed.id,
    base: materializeSlotProgression(seed, profile, slotId),
    build: {
      weapon: materializeSlotWeapon(profile, slotId),
      echoes: profile.runtime.build.echoes,
      team: teamSlots,
    },
    state: materializeRuntimeState(localState),
    rotation:
        slotId === 'active'
            ? cloneRotationState(rotation ?? makeDefaultRotation(seed))
            : makeDefaultRotation(seed),
    teamRuntimes:
        slotId === 'active'
            ? (profile.runtime.teamRuntimes ?? [null, null])
            : [null, null],
  }
}

// extract namespaced teammate controls from the active control map
function extractNamespacedControls(
    activeControls: Record<string, boolean | number | string>,
    resonatorId: string,
): Record<string, boolean | number | string> {
  const prefix = `team:${resonatorId}:`
  const controls: Record<string, boolean | number | string> = {}

  for (const key of Object.keys(activeControls)) {
    if (key.startsWith(prefix) && !key.startsWith(`${prefix}__mb:`)) {
      controls[key.slice(prefix.length)] = activeControls[key]
    }
  }

  return controls
}

// materialize a full runtime from a compact teammate runtime
export function materializeTeamMemberFromCompactRuntime(
    seed: ResonatorSeed,
    tmr: TeamMemberRuntime,
    activeControls: Record<string, boolean | number | string>,
    activeCombat: ResonatorRuntimeState['state']['combat'],
    teamSlots: TeamSlots,
): ResonatorRuntimeState {
  return {
    id: tmr.id,
    base: cloneResonatorBaseState(tmr.base),
    build: {
      weapon: cloneWeaponBuildState(tmr.build.weapon),
      echoes: [...tmr.build.echoes],
      team: teamSlots,
    },
    state: {
      controls: extractNamespacedControls(activeControls, tmr.id),
      manualBuffs: cloneManualBuffs(tmr.manualBuffs ?? makeDefaultCustomBuffs()),
      combat: { ...activeCombat },
    },
    rotation: makeDefaultRotation(seed),
    teamRuntimes: [null, null],
  }
}
