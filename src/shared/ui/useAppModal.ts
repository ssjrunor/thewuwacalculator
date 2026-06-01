/*
  Author: Runor Ewhro
  Description: Wraps the shared animated-visibility hooks with modal-shaped
               state and a small reset helper for value-carrying dialogs.
*/

import { useCallback, useMemo, useState } from 'react'
import { useAnimMdlVl, useAnimVis } from '@/app/hooks/useAnimatedVisibility'
import type { AppMdlStt } from '@/shared/ui/AppModal'

export const APPMDLEXITMS = 320
const APPMDLOPENDL = 2

function getDlgPrps(state: AppMdlStt): AppMdlStt {
  return {
    visible: state.visible,
    open: state.open,
    closing: state.closing,
  }
}

export function useAppModal() {
  const modal = useAnimVis(APPMDLEXITMS, APPMDLOPENDL)

  return useMemo(() => ({
    ...modal,
    // many dialog features only care about the visibility triple, so expose
    // that shape directly to keep call sites compact.
    dialogProps: getDlgPrps(modal),
  }), [modal])
}

export function useAppMdlVl<T>() {
  const modal = useAnimMdlVl<T>(APPMDLEXITMS, APPMDLOPENDL)

  return useMemo(() => ({
    ...modal,
    dialogProps: getDlgPrps(modal),
  }), [modal])
}

export function useAppMdlVlW<T>(
  initialValue: T,
  resetValue: (next: T) => void,
) {
  const [value, setValue] = useState<T>(initialValue)
  const modal = useAppModal()

  const show = useCallback((nextValue: T) => {
    // reset external draft state before opening so the modal never animates in
    // with stale content from the previous selection.
    resetValue(nextValue)
    setValue(nextValue)
    modal.show()
  }, [modal, resetValue])

  return useMemo(() => ({
    ...modal,
    show,
    value,
  }), [modal, show, value])
}
