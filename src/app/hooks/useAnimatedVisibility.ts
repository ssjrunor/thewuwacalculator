/*
  Author: Runor Ewhro
  Description: shared animated visibility hooks for modal, picker, and menu
               state so component files can stay focused on ui wiring.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// simple open/close animation state for boolean visibility flows
export function useAnimatedVisibility(exitDurationMs = 300) {
  const [visible, setVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const openFrameRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const clearPending = useCallback(() => {
    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current)
      openFrameRef.current = null
    }

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => () => {
    clearPending()
  }, [clearPending])

  const show = useCallback(() => {
    clearPending()
    setClosing(false)
    setOpen(false)
    setVisible(true)
    openFrameRef.current = window.requestAnimationFrame(() => {
      setOpen(true)
      openFrameRef.current = null
    })
  }, [clearPending])

  const hide = useCallback(
    (onHidden?: () => void) => {
      if (!visible) {
        onHidden?.()
        return
      }

      clearPending()
      setOpen(false)
      setClosing(true)
      closeTimerRef.current = window.setTimeout(() => {
        setVisible(false)
        setClosing(false)
        closeTimerRef.current = null
        onHidden?.()
      }, exitDurationMs)
    },
    [clearPending, exitDurationMs, visible],
  )

  return useMemo(() => ({
    closing,
    open,
    show,
    hide,
    visible,
  }), [closing, hide, open, show, visible])
}

// animated visibility helper that also carries a typed modal payload
export function useAnimatedModalValue<T>(exitDurationMs = 320) {
  const [value, setValue] = useState<T | null>(null)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const openFrameRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const clearPending = useCallback(() => {
    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current)
      openFrameRef.current = null
    }

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => () => {
    clearPending()
  }, [clearPending])

  const show = useCallback(
    (nextValue: T) => {
      clearPending()
      setValue(nextValue)
      setClosing(false)
      setOpen(false)
      openFrameRef.current = window.requestAnimationFrame(() => {
        setOpen(true)
        openFrameRef.current = null
      })
    },
    [clearPending],
  )

  const hide = useCallback(() => {
    if (value === null) {
      return
    }

    clearPending()
    setOpen(false)
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      setValue(null)
      setClosing(false)
      closeTimerRef.current = null
    }, exitDurationMs)
  }, [clearPending, exitDurationMs, value])

  const update = useCallback((updater: T | ((current: T) => T)) => {
    setValue((current) => {
      if (current === null) {
        return current
      }

      return typeof updater === 'function' ? (updater as (current: T) => T)(current) : updater
    })
  }, [])

  return useMemo(() => ({
    closing,
    open,
    show,
    hide,
    update,
    value,
    visible: value !== null,
  }), [closing, hide, open, show, update, value])
}
