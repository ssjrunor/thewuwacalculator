/*
  Author: Runor Ewhro
  Description: holds the open echo slot request, so any surface that draws an
               echo (an evaluation loadout, for one) opens the same editor and
               the same picker the echoes pane does.
*/

import { create } from 'zustand'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'

interface EchoSlotTarget {
  resonatorId: string
  slotIndex: number
  scenarioId?: CombatScenarioId | null
}

interface EchoConsoleStore {
  target: EchoSlotTarget | null
  open: (resonatorId: string, slotIndex: number, scenarioId?: CombatScenarioId | null) => void
  close: () => void
}

// session-only, like the teammate and weapon consoles: a slot left open at
// unload should not reopen on the next visit.
export const useEchoCnsl = create<EchoConsoleStore>((set) => ({
  target: null,
  open: (resonatorId, slotIndex, scenarioId) => set({ target: { resonatorId, slotIndex, scenarioId } }),
  close: () => set({ target: null }),
}))

export function openEchoCnsl(
  resonatorId: string,
  slotIndex: number,
  scenarioId?: CombatScenarioId | null,
): void {
  useEchoCnsl.getState().open(resonatorId, slotIndex, scenarioId)
}
