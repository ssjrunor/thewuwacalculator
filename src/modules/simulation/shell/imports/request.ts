/*
  Author: Runor Ewhro
  description: stores pending shared rotation import requests.
*/

import { create } from 'zustand'

interface ImportRequestState {
  pending: { raw: string | null } | null
  request: (raw?: string | null) => void
  take: () => { raw: string | null } | null
}

export const useImportRequest = create<ImportRequestState>((set, get) => ({
  pending: null,
  request: (raw = null) => set({ pending: { raw } }),
  take: () => {
    const pending = get().pending
    if (pending) set({ pending: null })
    return pending
  },
}))

export function requestSharedImport(raw?: string | null): void {
  useImportRequest.getState().request(raw)
}
