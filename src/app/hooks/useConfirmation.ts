/*
  Author: Runor Ewhro
  Description: Manages confirmation modal state, open and close timing,
               and confirm/cancel handlers for shared modal usage.
*/

import { useCallback, useEffect, useRef, useState } from 'react'

const EXIT_MS = 320

interface ConfirmationState {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'info' | 'danger'
  onConfirm: () => void
}

export function useConfirmation() {
  const [pending, setPending] = useState<ConfirmationState | null>(null)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)

  const openFrameRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  // clean up timers and animation frames on unmount
  useEffect(() => {
    return () => {
      if (openFrameRef.current !== null) {
        window.cancelAnimationFrame(openFrameRef.current)
      }

      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  // clear any scheduled open or close work
  const clearTimers = useCallback(() => {
    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current)
      openFrameRef.current = null
    }

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  // open the confirmation modal with new pending state
  const confirm = useCallback(
      (state: ConfirmationState) => {
        clearTimers()
        setPending(state)
        setClosing(false)
        setOpen(false)

        // defer the open flag one frame so enter transitions can trigger cleanly
        openFrameRef.current = window.requestAnimationFrame(() => {
          setOpen(true)
          openFrameRef.current = null
        })
      },
      [clearTimers],
  )

  // begin closing the modal and clear pending state after the exit transition
  const hide = useCallback(() => {
    if (!pending) return

    clearTimers()
    setOpen(false)
    setClosing(true)

    closeTimerRef.current = window.setTimeout(() => {
      setPending(null)
      setClosing(false)
      closeTimerRef.current = null
    }, EXIT_MS)
  }, [clearTimers, pending])

  // run the confirm callback, then close the modal
  const handleConfirm = useCallback(() => {
    pending?.onConfirm()
    hide()
  }, [pending, hide])

  return {
    visible: pending !== null,
    open,
    closing,
    title: pending?.title ?? '',
    message: pending?.message ?? '',
    confirmLabel: pending?.confirmLabel,
    cancelLabel: pending?.cancelLabel,
    variant: pending?.variant,
    confirm,
    onConfirm: handleConfirm,
    onCancel: hide,
  }
}