/*
  Author: Runor Ewhro
  Description: Coordinates the latest Echo-import destination with Modulation's
               active seat and transfers pending seat requests between routes.
*/

import { create } from 'zustand'

export type LandingKind = 'context' | 'team'

export interface ImportLanding {
  key: number
  resonatorId: string
  kind: LandingKind
  // Team members are scenario-scoped; contextId disambiguates the owning team.
  contextId: string
  // True when the destination was not the active Modulation seat at import time.
  linked: boolean
}

export interface ModulationSeat {
  contextId: string
  memberId: string
}

interface ImportLandingState {
  landing: ImportLanding | null
  seat: ModulationSeat | null
  seatAsk: ModulationSeat | null
  land: (landing: Omit<ImportLanding, 'key' | 'linked'>) => void
  clear: (key: number) => void
  setSeat: (seat: ModulationSeat | null) => void
  askSeat: (seat: ModulationSeat) => void
  takeSeat: () => void
}

let counter = 0

export function isSeated(seat: ModulationSeat | null, landing: Pick<ImportLanding, 'contextId' | 'resonatorId'>): boolean {
  return seat?.contextId === landing.contextId && seat.memberId === landing.resonatorId
}

export const useImportLanding = create<ImportLandingState>((set, get) => ({
  landing: null,
  seat: null,
  seatAsk: null,

  land: (landing) => set({
    landing: {
      ...landing,
      key: ++counter,
      linked: !isSeated(get().seat, landing),
    },
  }),

  clear: (key) => set((state) => (state.landing?.key === key ? { landing: null } : state)),

  setSeat: (seat) => set((state) => (
    state.seat?.contextId === seat?.contextId && state.seat?.memberId === seat?.memberId
      ? state
      : { seat }
  )),

  askSeat: (seatAsk) => set({ seatAsk }),
  takeSeat: () => set({ seatAsk: null }),
}))
