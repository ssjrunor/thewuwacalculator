/*
  Author: Runor Ewhro
  Description: Defines the resonator queue store used for recent entries
               and queue panel snap-position preferences.
*/

import { create } from 'zustand'

const MAX_QUEUE = 2

export interface ResQEnt {
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

interface ResQStr {
  queue: ResQEnt[]
  queueIds: string[]
  snapPosition: SnapPosition
  pushToQueue: (entry: ResQEnt) => void
  clearQueue: () => void
  setSnapPstn: (position: SnapPosition) => void
}

export const useResQStr = create<ResQStr>((set) => ({
  queue: [],
  queueIds: [],
  snapPosition: 'bottom-right',

  // add a resonator to the front of the queue and keep entries unique
  pushToQueue(entry) {
    set((state) => {
      const filtered = state.queue.filter((e) => e.id !== entry.id)
      const next = [entry, ...filtered].slice(0, MAX_QUEUE)
      return {
        queue: next,
        queueIds: next.map((e) => e.id),
      }
    })
  },

  // clear all queued resonators
  clearQueue() {
    set({
      queue: [],
      queueIds: [],
    })
  },

  // update the queue panel snap position
  setSnapPstn(position) {
    set({ snapPosition: position })
  },
}))