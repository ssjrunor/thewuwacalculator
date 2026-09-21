/*
  Author: Runor Ewhro
  Description: holds the open teammate console request so the team pane and the
               toolbar summary open the same modal from anywhere in the shell.
*/

import { create } from 'zustand'
import type { ChannelId } from '@/modules/simulation/features/teams/stage/MemberStage.tsx'
import { useAppStore } from '@/application/state'
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
    // The console reads saved builds immediately, while that persistence slice
    // stays unloaded until a consumer asks for it. Hydrate before publishing
    // the target so the first console render has the actual inventory.
    useAppStore.getState().ensInvHydr()
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
