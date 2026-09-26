/*
  Author: Runor Ewhro
  Description: shared team slot assignment used by the team pane, the toolbar
               summary and the bench rail so every surface fills, swaps, and
               clears the selected scenario's canonical member slots.
*/

import { useCallback, useMemo } from 'react'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { CombatScenario, CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import { makeScenarioTeam, reviseCombatScenario } from '@/domain/entities/combatScenario.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { makeResProfile, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults.ts'
import { useAppStore } from '@/application/state'
import { insertScenarioTeamMember, removeScenarioTeamMember, replaceScenarioTeamMember } from '@/engine/runtime/scenarioMembers.ts'
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
  const commitScenarioConfig = useAppStore((state) => state.commitScenarioConfig)
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

  // Apply both support slots through one scenario update so undo history never
  // observes a partially changed team.
  const setTeam = useCallback((supportIds: readonly (string | null)[]) => {
    const makeMember = (resonatorId: string) => {
      const seed = getResSeedBy(resonatorId)
      return seed ? makeScenarioMemberFromProfile(makeResProfile(seed, { maxed: maxResOnInit })) : null
    }
    const update = (scenario: CombatScenario) => withSupports(scenario, supportIds, makeMember)
    let added: string[] = []
    const track = (scenario: CombatScenario) => {
      const before = new Set(scenario.team.members.map((member) => member.resonatorId))
      const next = update(scenario)
      added = next.team.members.slice(1).map((member) => member.resonatorId).filter((id) => !before.has(id))
      return next
    }

    if (configuration?.updateScenario) {
      configuration.updateScenario(track)
    } else {
      const { combat } = useAppStore.getState()
      const scenario = configuration?.scenarioId
        ? combat.scenariosById[configuration.scenarioId]
        : selectedCombatScenario(combat)
      if (!scenario) return
      commitScenarioConfig(scenario.id, track, 'Set Team')
    }
    for (const id of added) {
      const seat = supportIds.indexOf(id) + 1
      if (seat > 0) afterAssign(seat, id)
    }
  }, [afterAssign, commitScenarioConfig, configuration, maxResOnInit])

  return useMemo(() => ({ setMember, setTeam }), [setMember, setTeam])
}

// Preserve existing member objects for retained resonators, then reconcile the
// ordered support set without replacing the lead.
export function withSupports(
  scenario: CombatScenario,
  supportIds: readonly (string | null)[],
  makeMember: (resonatorId: string) => CombatScenario['team']['members'][number] | null,
): CombatScenario {
  const lead = scenario.team.members[0]
  const wanted = [...new Set(supportIds.filter((id): id is string => Boolean(id) && id !== lead.resonatorId))].slice(0, 2)
  const current = scenario.team.members.slice(1).map((member) => member.resonatorId)
  if (wanted.length === current.length && wanted.every((id, index) => id === current[index])) return scenario

  // Resolve every new member before changing the scenario. A missing seed must
  // not leave a partially cleared team behind.
  const existing = new Set(current)
  const created = new Map<string, CombatScenario['team']['members'][number]>()
  for (const id of wanted) {
    if (existing.has(id)) continue
    const member = makeMember(id)
    if (!member || member.resonatorId !== id) return scenario
    created.set(id, member)
  }

  let next = scenario
  for (const member of scenario.team.members.slice(1)) {
    if (!wanted.includes(member.resonatorId)) next = removeScenarioTeamMember(next, member.id)
  }
  for (const id of wanted) {
    if (next.team.members.some((member) => member.resonatorId === id)) continue
    const member = created.get(id)
    if (!member) return scenario
    next = insertScenarioTeamMember(next, next.team.members.length, member)
    if (!next.team.members.some((candidate) => candidate.resonatorId === id)) return scenario
  }
  const members = [
    next.team.members[0],
    ...wanted.flatMap((id) => next.team.members.filter((member) => member.resonatorId === id)),
  ]
  if (members.length === next.team.members.length
    && members.every((member, index) => member === next.team.members[index])) return next
  try {
    return reviseCombatScenario(next, { team: makeScenarioTeam(members) })
  } catch {
    return scenario
  }
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
