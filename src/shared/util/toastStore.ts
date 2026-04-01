/*
  Author: Runor Ewhro
  Description: Defines the global toast store used for showing, dismissing,
               and removing notification toasts.
*/

import { create } from 'zustand'
import type { ReactNode } from 'react'

export type ToastPosition =
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'

export type ToastVariant = 'default' | 'success' | 'error' | 'warning'

export interface Toast {
  id: string
  content: ReactNode
  variant?: ToastVariant
  position?: ToastPosition
  duration?: number
  action?: { label: string; onClick: () => void }
  onClick?: () => void
  exiting?: boolean
}

interface ToastStore {
  toasts: Toast[]
  show: (toast: Omit<Toast, 'id' | 'exiting'>) => string
  dismiss: (id: string) => void
  remove: (id: string) => void
}

let counter = 0

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  // show a new toast and schedule auto-dismiss if needed
  show(toast) {
    const id = `toast-${++counter}`
    const duration = toast.duration ?? 4000

    set((state) => ({
      toasts: [...state.toasts, { ...toast, id, exiting: false }],
    }))

    if (duration > 0) {
      setTimeout(() => get().dismiss(id), duration)
    }

    return id
  },

  // mark a toast as exiting so the ui can animate it out
  dismiss(id) {
    set((state) => ({
      toasts: state.toasts.map((toast) =>
          toast.id === id && !toast.exiting
              ? { ...toast, exiting: true }
              : toast,
      ),
    }))
  },

  // remove a toast from the store entirely
  remove(id) {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }))
  },
}))