/*
  Author: Runor Ewhro
  description: creates the app's CombatScenario from a ScenarioInput: one maxed
               member per seat (level 90, skills and traces maxed, weapon at 90)
               holding the input's sequence, weapon rank, echoes and resonance
               mode, the scored seat as the context member, and the scoring
               enemy as the target. this is the scenario rotation creation and
               evaluation work on. the members' resonator data must be loaded
               first (ensureResonatorData(scenarioResonatorIds(input))).
*/

import type { CombatScenario, ScenarioTeamMember } from '@/domain/entities/combatScenario'
import { combatScenarioId, makeScenarioTeam, teamMemberId } from '@/domain/entities/combatScenario'
import type { ScenarioInput, ScenarioInputMember } from '@/domain/leaderboard/scenarioInput'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { MAX_RES_LVL, MAX_WPN_LVL, makeCombatState, makeCustomBuff, makeResProfile, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults'
import { makeCombatEnvironment, makeMemberManualEffect } from '@/engine/runtime/scenarioEnvironment'
import { wpnAtkAt } from '@/engine/runtime/weaponState'

/** control key for a resonator's resonance mode. */
export const modeControlKey = (resonatorId: string): string => `resonator:${resonatorId}:mode:value`

export const scenarioMemberId = (slot: number) => teamMemberId(`lb:${slot}`)

export function scenarioResonatorIds(input: ScenarioInput): string[] {
  return input.members.map((member) => member.resonatorId)
}

// normalize progression while preserving the input sequence, weapon rank, Echo stats, and named resonance mode.
function seatMember(member: ScenarioInputMember): ScenarioTeamMember {
  const seed = getResSeedBy(member.resonatorId)
  if (!seed) throw new Error(`Resonator ${member.resonatorId} is not loaded`)
  const base = makeScenarioMemberFromProfile(makeResProfile(seed, { maxed: true }))
  if (base.progression.level !== MAX_RES_LVL) throw new Error(`Resonator ${member.resonatorId} did not max`)
  return {
    ...base,
    id: scenarioMemberId(member.slot),
    progression: { ...base.progression, sequence: member.sequence },
    loadout: {
      weapon: {
        id: member.weapon.id,
        level: MAX_WPN_LVL,
        rank: member.weapon.rank,
        baseAtk: wpnAtkAt(member.weapon.id, MAX_WPN_LVL),
      },
      echoes: member.echoes.map((echo) => ({
        ...echo,
        mainStats: { primary: { ...echo.mainStats.primary }, secondary: { ...echo.mainStats.secondary } },
        substats: { ...echo.substats },
      })),
    },
    // every other state starts unset; the rotation decides what is active.
    local: {
      ...base.local,
      controls: member.mode ? { [modeControlKey(member.resonatorId)]: member.mode } : {},
    },
  }
}

// member ids retain authored slot identity while the context member is placed first for the app runtime.
export function createScenario(input: ScenarioInput): CombatScenario {
  const scored = input.members.find((member) => member.slot === input.scoredSlot)
  if (!scored || scored.role !== 'scored') throw new Error(`${input.scenarioId}: no scored seat at ${input.scoredSlot}`)
  const authored = [...input.members].sort((a, b) => a.slot - b.slot).map(seatMember)
  const context = authored.find(member => member.id === scenarioMemberId(input.scoredSlot))!
  const members = [context, ...authored.filter(member => member.id !== context.id)]

  return {
    id: combatScenarioId(input.scenarioId),
    revision: 0,
    team: makeScenarioTeam(members),
    contextMemberId: scenarioMemberId(input.scoredSlot),
    target: structuredClone(input.enemy),
    // default combat state, no target routing and no manual buffs.
    environment: makeCombatEnvironment(
      makeCombatState(),
      { bySourceMemberId: Object.fromEntries(members.map((member) => [member.id, {}])) },
      members.map((member) => makeMemberManualEffect(member.id, makeCustomBuff())),
    ),
    program: { sequence: [], program: [], lastRanAt: null },
    // the plan chooses the opener independently of the app's context-first order.
    initialOnFieldMemberId: authored[0].id,
  }
}
