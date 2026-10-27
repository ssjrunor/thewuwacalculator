/*
  Author: Runor Ewhro
  description: stores the active game data import review and navigation state.
*/

import { create } from 'zustand'
import type { YumeoGameDataImportSession } from '@/application/imports/yumeo/session'

export interface GameImportFile {
  name: string
  modified: number | null
}

interface GameImportState {
  session: YumeoGameDataImportSession | null
  file: GameImportFile | null
  // origin rectangle for the review transition
  origin: DOMRect | null
  requestId: number
  // incremented when review returns to file selection
  reopenDrop: number
  // exit action pending after the review transition
  leaving: 'close' | 'drop' | null
  // true after the review becomes visible
  shown: boolean
  open: (session: YumeoGameDataImportSession, file: GameImportFile, origin: DOMRect | null) => void
  close: () => void
  changeFile: () => void
  dismiss: (next?: 'close' | 'drop') => void
  markShown: () => void
}

export const useGameImport = create<GameImportState>((set) => ({
  session: null,
  file: null,
  origin: null,
  requestId: 0,
  reopenDrop: 0,
  leaving: null,
  shown: false,
  open: (session, file, origin) => set((state) => ({ session, file, origin, leaving: null, shown: false, requestId: state.requestId + 1 })),
  close: () => set({ session: null, file: null, origin: null, leaving: null, shown: false }),
  changeFile: () => set((state) => ({ session: null, file: null, origin: null, leaving: null, shown: false, reopenDrop: state.reopenDrop + 1 })),
  dismiss: (next = 'close') => set((state) => (state.session && !state.leaving ? { leaving: next } : {})),
  markShown: () => set({ shown: true }),
}))

export function useGameImportRequested(): boolean {
  return useGameImport((state) => state.session != null)
}
