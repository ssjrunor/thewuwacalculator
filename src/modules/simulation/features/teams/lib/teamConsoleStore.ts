/*
  Author: Runor Ewhro
  description: stores the open teammate-console request for the shared modal.
*/

import { create } from 'zustand'
import type { ChannelId } from '@/modules/simulation/features/teams/member/MemberConfig.tsx'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'

interface ConsoleTarget {
  resonatorId: string
  channel: ChannelId
  scenarioId?: CombatScenarioId | null
}

interface TeamConsoleStore {
  target: ConsoleTarget | null
  open: (resonatorId: string, channel?: ChannelId, scenarioId?: CombatScenarioId | null) => void
  switchMember: (resonatorId: string) => void
  setChannel: (channel: ChannelId) => void
  close: () => void
}

// the request is deliberately session-only: a console left open at unload
// should not reopen on the next visit.
export const useTeamCnsl = create<TeamConsoleStore>((set) => ({
  target: null,
  open: (resonatorId, channel = 'loadout', scenarioId) => {
    set({ target: { resonatorId, channel, scenarioId } })
  },
  switchMember: (resonatorId) => set((state) => (
    state.target ? { target: { ...state.target, resonatorId } } : state
  )),
  setChannel: (channel) => set((state) => (
    state.target ? { target: { ...state.target, channel } } : state
  )),
  close: () => set({ target: null }),
}))

export function openTeamCnsl(
  resonatorId: string,
  channel: ChannelId = 'loadout',
  scenarioId?: CombatScenarioId | null,
) {
  useTeamCnsl.getState().open(resonatorId, channel, scenarioId)
}
