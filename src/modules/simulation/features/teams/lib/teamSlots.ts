/*
  Author: Runor Ewhro
  Description: shared team slot assignment used by the team pane, the toolbar
               summary and the bench rail so every surface fills, swaps, and
               clears slots through the same runtime materialization path.

               A team lives on the profile holding it, so the write is scoped to
               an owner: `setMember` writes the resonator in front, `setMemberFor`
               writes whichever profile the surface is standing on.
*/

import { useCallback, useMemo } from 'react'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { makeTeamMember, maxRtInit } from '@/domain/state/defaults.ts'
import { initWpnStts } from '@/domain/state/sourceStateInit.ts'
import { matTeamMemFr } from '@/domain/state/runtimeMaterialization.ts'
import { teamRuntime, mkMateCntr } from '@/domain/state/teamRuntime.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { RES_MENU } from '@/modules/simulation/features/resonator/lib/resonator.ts'

// slot 0 is the active resonator and is switched through the roster, never
// assigned here; only the two support slots accept a member id.
export const TEAM_SUPPORT_SLOTS = [1, 2] as const

// the slot write itself, stated once: the surfaces differ only in which profile
// they hand it.
function assignSlot(
  prev: ResRuntime,
  slotIndex: number,
  nextMemberId: string | null,
  maxResOnInit: boolean,
): ResRuntime {
  const nextTeam = [...prev.build.team] as ResRuntime['build']['team']
  nextTeam[slotIndex] = nextMemberId
  const nextTeamRuns = [...prev.teamRuntimes] as ResRuntime['teamRuntimes']

  if (!nextMemberId) {
    nextTeamRuns[slotIndex - 1] = null

    return {
      ...prev,
      build: {
        ...prev.build,
        team: nextTeam,
      },
      teamRuntimes: nextTeamRuns,
    }
  }

  const seed = getResSeedBy(nextMemberId)
  if (!seed) {
    return prev
  }

  const currentRuntime = prev.teamRuntimes[slotIndex - 1]
  const materialRuntime = matTeamMemFr(
    seed,
    currentRuntime?.id === nextMemberId ? currentRuntime : makeTeamMember(seed),
    prev.state.controls,
    prev.state.combat,
    nextTeam,
  )
  const shouldInitMember = currentRuntime?.id !== nextMemberId
  const nextRuntime = maxResOnInit && shouldInitMember
    ? maxRtInit(materialRuntime)
    : shouldInitMember
      ? initWpnStts(materialRuntime, { maxed: false })
      : materialRuntime
  const memberIdsClear = Array.from(
    new Set([
      currentRuntime?.id,
      prev.build.team[slotIndex],
      nextMemberId,
    ].filter((value): value is string => Boolean(value))),
  )

  nextTeamRuns[slotIndex - 1] = teamRuntime(nextRuntime)

  return {
    ...prev,
    build: {
      ...prev.build,
      team: nextTeam,
    },
    state: {
      ...prev.state,
      controls: mkMateCntr(prev.state.controls, memberIdsClear, nextMemberId, nextRuntime),
    },
    teamRuntimes: nextTeamRuns,
  }
}

export function useTeamSlots() {
  const maxResOnInit = useAppStore((state) => state.ui.preferences.maxResOnInit)
  const ensTeamMemRt = useAppStore((state) => state.ensTeamRt)
  const updActRt = useAppStore((state) => state.updActRt)
  const updResRt = useAppStore((state) => state.updResRt)
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

  const ensureMemberRt = useCallback((nextMemberId: string | null) => {
    if (!nextMemberId) {
      return
    }

    const fullSeed = getResSeedBy(nextMemberId)
    if (fullSeed) {
      // create the compact teammate runtime before slot assignment so target
      // and source-state selectors can resolve the member in the same update.
      ensTeamMemRt(fullSeed)
    }
  }, [ensTeamMemRt])

  const setMember = useCallback((slotIndex: number, nextMemberId: string | null) => {
    if (slotIndex === 0) {
      return
    }

    ensureMemberRt(nextMemberId)
    updActRt((prev) => assignSlot(prev, slotIndex, nextMemberId, maxResOnInit))
    afterAssign(slotIndex, nextMemberId)
  }, [afterAssign, ensureMemberRt, maxResOnInit, updActRt])

  // the same write aimed at a named profile, for a surface standing on a
  // resonator that is not the one in front (the bench rail inspecting a roster
  // entry, for one).
  const setMemberFor = useCallback((
    ownerResId: string,
    slotIndex: number,
    nextMemberId: string | null,
  ) => {
    if (slotIndex === 0) {
      return
    }

    ensureMemberRt(nextMemberId)
    updResRt(ownerResId, (prev) => assignSlot(prev, slotIndex, nextMemberId, maxResOnInit))
    afterAssign(slotIndex, nextMemberId)
  }, [afterAssign, ensureMemberRt, maxResOnInit, updResRt])

  return useMemo(() => ({ setMember, setMemberFor }), [setMember, setMemberFor])
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
