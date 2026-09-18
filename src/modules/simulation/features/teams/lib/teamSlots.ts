/*
  Author: Runor Ewhro
  Description: shared team slot assignment used by the team pane, the toolbar
               summary and the bench rail so every surface fills, swaps, and
               clears the selected scenario's canonical member slots.
*/

import { useCallback, useMemo } from 'react'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { CombatScenario, CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { makeResProfile, makeScenarioMemberFromProfile } from '@/domain/state/defaults.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { insertScenarioTeamMember, removeScenarioTeamMember, replaceScenarioTeamMember } from '@/domain/state/scenarioMembers.ts'
import { RES_MENU } from '@/modules/simulation/features/resonator/lib/resonator.ts'

// slot 0 is the active resonator and is switched through the roster, never
// assigned here; only the two support slots accept a member id.
export const TEAM_SUPPORT_SLOTS = [1, 2] as const

export function useTeamSlots(configuration?: {
  scenarioId?: CombatScenarioId | null
  updateScenario?: (updater: (scenario: CombatScenario) => CombatScenario) => void
}) {
  const maxResOnInit = useAppStore((state) => state.ui.preferences.maxResOnInit)
  const insertScenarioMember = useAppStore((state) => state.insertScenarioMember)
  const replaceScenarioMember = useAppStore((state) => state.replaceScenarioMember)
  const removeScenarioMember = useAppStore((state) => state.removeScenarioMember)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)

  const afterAssign = useCallback((slotIndex: number, nextMemberId: string | null) => {
    if (!nextMemberId) {
      return
    }

    bumpPickerFreq({
      bucket: 'teamResonator',
      slot: slotIndex === 1 ? 'teammate1' : 'teammate2',
      ids: [nextMemberId],
    })
  }, [bumpPickerFreq])

  const setMember = useCallback((slotIndex: number, nextMemberId: string | null) => {
    if (slotIndex < 1 || slotIndex > 2) return

    const seed = nextMemberId ? getResSeedBy(nextMemberId) : null
    if (nextMemberId && !seed) return
    const next = seed
      ? makeScenarioMemberFromProfile(makeResProfile(seed, { maxed: maxResOnInit }))
      : null
    if (configuration?.updateScenario) {
      configuration.updateScenario((scenario) => {
        const current = scenario.team.members[slotIndex] ?? null
        if (!next) return current ? removeScenarioTeamMember(scenario, current.id) : scenario
        if (scenario.team.members.some((member, index) => (
          index !== slotIndex && member.resonatorId === next.resonatorId
        ))) return scenario
        return current
          ? replaceScenarioTeamMember(scenario, current.id, next)
          : insertScenarioTeamMember(scenario, slotIndex, next)
      })
      afterAssign(slotIndex, nextMemberId)
      return
    }

    const { combat } = useAppStore.getState()
    const scenario = configuration?.scenarioId
      ? combat.scenariosById[configuration.scenarioId]
      : selectedCombatScenario(combat)
    if (!scenario) return
    const current = scenario.team.members[slotIndex] ?? null
    if (!nextMemberId) {
      if (current) removeScenarioMember(scenario.id, current.id)
      return
    }

    if (!next || scenario.team.members.some((member, index) => (
      index !== slotIndex && member.resonatorId === nextMemberId
    ))) return

    if (current) replaceScenarioMember(scenario.id, current.id, next)
    else insertScenarioMember(scenario.id, slotIndex, next)
    afterAssign(slotIndex, nextMemberId)
  }, [
    afterAssign,
    configuration,
    insertScenarioMember,
    maxResOnInit,
    removeScenarioMember,
    replaceScenarioMember,
  ])

  return useMemo(() => ({ setMember }), [setMember])
}

// slot eligibility is unique across teammates, while the edited slot keeps its
// current member so reopening the picker preserves the selection.
export function eligibleForSlot(team: ResRuntime['build']['team'], slotIndex: number | null) {
  if (slotIndex === null || slotIndex === 0) {
    return []
  }

  const blockedIds = new Set(
    team.filter(
      (memberId, memberIndex): memberId is string => Boolean(memberId) && memberIndex !== slotIndex,
    ),
  )

  return RES_MENU.filter((entry) => !blockedIds.has(entry.id))
}
