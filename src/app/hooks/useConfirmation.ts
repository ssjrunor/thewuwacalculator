/*
  Author: Runor Ewhro
  Description: Exposes a small confirmation-dialog controller so callers can
               request confirm flows without owning the modal state directly.
*/

import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { useAppMdlVl } from '@/shared/ui/useAppModal'

interface CnfrStt {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'info' | 'danger'
  onConfirm: () => void
}

export function useCnfr() {
  const modal = useAppMdlVl<CnfrStt>()

  // run the confirm callback, then close the modal
  const onCnfr = useCallback(() => {
    modal.value?.onConfirm()
    modal.hide()
  }, [modal])

  return {
    visible: modal.visible,
    open: modal.open,
    closing: modal.closing,
    title: modal.value?.title ?? '',
    message: modal.value?.message ?? '',
    confirmLabel: modal.value?.confirmLabel,
    cancelLabel: modal.value?.cancelLabel,
    variant: modal.value?.variant,
    confirm: modal.show,
    onConfirm: onCnfr,
    onCancel: modal.hide,
  }
}
