/*
  Author: Runor Ewhro
  Description: Coordinates queued confirmation requests and promise resolution through the shared dialog.
*/

import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { useAppModalValue } from '@/shared/ui/useAppModal'
import type { ConfirmControl } from '@/shared/ui/ConfirmationModal.tsx'

interface ConfirmRequest {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  // Secondary is a distinct commit path, not a second cancel path; callers use
  // it when the same prompt can complete through two valid mutations.
  secondaryLabel?: string
  variant?: 'info' | 'danger'
  onConfirm: () => void
  onSecondary?: () => void
}

export function useConfirm(): ConfirmControl & {
  confirm: (value: ConfirmRequest) => void
} {
  const modal = useAppModalValue<ConfirmRequest>()

  const confirmChoice = useCallback(() => {
    modal.value?.onConfirm()
    modal.hide()
  }, [modal])

  const secondChoice = useCallback(() => {
    modal.value?.onSecondary?.()
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
    secondaryLabel: modal.value?.secondaryLabel,
    variant: modal.value?.variant,
    confirm: modal.show,
    onConfirm: confirmChoice,
    onSecondary: modal.value?.onSecondary ? secondChoice : undefined,
    onCancel: modal.hide,
  }
}
