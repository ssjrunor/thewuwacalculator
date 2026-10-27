/*
  Author: Runor Ewhro
  description: stores app-header echo import requests without changing the active resonator.
*/

import { create } from 'zustand'

interface EchoImportState {
  isOpen: boolean
  initialResonatorId: string | null
  // card supplied before the reader opens
  initialFile: File | null
  requestId: number
  open: (resonatorId?: string | null, file?: File | null) => void
  close: () => void
}

export const useEchoImport = create<EchoImportState>((set) => ({
  isOpen: false,
  initialResonatorId: null,
  initialFile: null,
  requestId: 0,
  open: (resonatorId = null, file = null) => set((state) => ({
    isOpen: true,
    initialResonatorId: resonatorId,
    initialFile: file,
    requestId: state.requestId + 1,
  })),
  close: () => set({ isOpen: false, initialFile: null }),
}))

export function openEchoImport(resonatorId?: string | null, file?: File | null): void {
  useEchoImport.getState().open(resonatorId, file)
}

export function useEchoImportRequested(): boolean {
  return useEchoImport((state) => state.isOpen)
}
