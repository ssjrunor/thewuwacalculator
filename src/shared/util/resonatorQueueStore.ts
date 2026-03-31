/*
  Author: Runor Ewhro
  Description: Defines the resonator queue store used for recent entries
               and queue panel snap-position preferences.
*/

import { create } from 'zustand'

const MAX_QUEUE = 2

export interface ResonatorQueueEntry {
  id: string
  name: string
  icon: string
}

export type SnapPosition =
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'

interface ResonatorQueueStore {
  queue: ResonatorQueueEntry[]
  snapPosition: SnapPosition
  pushToQueue: (entry: ResonatorQueueEntry) => void
  clearQueue: () => void
  setSnapPosition: (position: SnapPosition) => void
}

export const useResonatorQueueStore = create<ResonatorQueueStore>((set) => ({
  queue: [],
  snapPosition: 'bottom-right',

  // add a resonator to the front of the queue and keep entries unique
  pushToQueue(entry) {
    set((state) => {
      const filtered = state.queue.filter((e) => e.id !== entry.id)
      const next = [entry, ...filtered].slice(0, MAX_QUEUE)
      return { queue: next }
    })
  },

  // clear all queued resonators
  clearQueue() {
    set({ queue: [] })
  },

  // update the queue panel snap position
  setSnapPosition(position) {
    set({ snapPosition: position })
  },
}))