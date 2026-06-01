/*
  Author: Runor Ewhro
  Description: shared animated visibility hooks for modal, picker, and menu
               state so component files can stay focused on ui wiring.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type NmtnFrmRef = { current: number | null }

function schdOpenFrm(
  frameRef: NmtnFrmRef,
  setOpen: (open: boolean) => void,
  frameCount: number,
) {
  const runFrame = (rmnnFrms: number) => {
    frameRef.current = window.requestAnimationFrame(() => {
      if (rmnnFrms <= 1) {
        setOpen(true)
        frameRef.current = null
        return
      }

      runFrame(rmnnFrms - 1)
    })
  }

  runFrame(Math.max(1, frameCount))
}

// simple open/close animation state for boolean visibility flows
export function useAnimVis(exitDurMs = 300, openDlyFrms = 1) {
  const [visible, setVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const openFrameRef = useRef<number | null>(null)
  const clsTmrRef = useRef<number | null>(null)

  const clearPending = useCallback(() => {
    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current)
      openFrameRef.current = null
    }

    if (clsTmrRef.current !== null) {
      window.clearTimeout(clsTmrRef.current)
      clsTmrRef.current = null
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
    schdOpenFrm(openFrameRef, setOpen, openDlyFrms)
  }, [clearPending, openDlyFrms])

  const hide = useCallback(
    (onHidden?: () => void) => {
      if (!visible) {
        onHidden?.()
        return
      }

      clearPending()
      setOpen(false)
      setClosing(true)
      clsTmrRef.current = window.setTimeout(() => {
        setVisible(false)
        setClosing(false)
        clsTmrRef.current = null
        onHidden?.()
      }, exitDurMs)
    },
    [clearPending, exitDurMs, visible],
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
export function useAnimMdlVl<T>(exitDurMs = 320, openDlyFrms = 1) {
  const [value, setValue] = useState<T | null>(null)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const openFrameRef = useRef<number | null>(null)
  const clsTmrRef = useRef<number | null>(null)

  const clearPending = useCallback(() => {
    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current)
      openFrameRef.current = null
    }

    if (clsTmrRef.current !== null) {
      window.clearTimeout(clsTmrRef.current)
      clsTmrRef.current = null
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
      schdOpenFrm(openFrameRef, setOpen, openDlyFrms)
    },
    [clearPending, openDlyFrms],
  )

  const hide = useCallback(() => {
    if (value === null) {
      return
    }

    clearPending()
    setOpen(false)
    setClosing(true)
    clsTmrRef.current = window.setTimeout(() => {
      setValue(null)
      setClosing(false)
      clsTmrRef.current = null
    }, exitDurMs)
  }, [clearPending, exitDurMs, value])

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
