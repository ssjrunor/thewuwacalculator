/*
  Author: Runor Ewhro
  Description: holds the open weapon console request, so the bench rail and any
               other surface carrying a weapon open the same modal.
*/

import { create } from 'zustand'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'

interface WeaponConsoleStore {
  target: { resonatorId: string; scenarioId?: CombatScenarioId | null } | null
  open: (resonatorId: string, scenarioId?: CombatScenarioId | null) => void
  close: () => void
}

// session-only, like the teammate console: a console left open at unload should
// not reopen on the next visit.
export const useWpnCnsl = create<WeaponConsoleStore>((set) => ({
  target: null,
  open: (resonatorId, scenarioId) => set({ target: { resonatorId, scenarioId } }),
  close: () => set({ target: null }),
}))

export function openWpnCnsl(resonatorId: string, scenarioId?: CombatScenarioId | null): void {
  useWpnCnsl.getState().open(resonatorId, scenarioId)
}
