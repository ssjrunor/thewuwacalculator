/*
  Author: Runor Ewhro
  Description: Shared confirmation dialog used for destructive or important
               yes-or-no actions across the app.
*/

import type { ReactNode } from 'react'
import { AlertTriangle as AlertIcon, Info } from 'lucide-react'
import { AppModal } from '@/shared/ui/AppModal'

interface CnfrMdlPrps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'info' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}

export function CnfrMdl({
  visible,
  open,
  closing = false,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'info',
  onConfirm,
  onCancel,
}: CnfrMdlPrps) {
  const Icon = variant === 'danger' ? AlertIcon : Info

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="confirmation"
      tone={variant}
      ariaLabel={title}
      onClose={onCancel}
    >
      <div className="confirmation-modal__icon">
        <Icon size={22} />
      </div>
      <div className="confirmation-modal__body">
        <h2 className="confirmation-modal__title">{title}</h2>
        <div className="confirmation-modal__message">{message}</div>
      </div>
      <div className="confirmation-modal__actions">
        <button
          type="button"
          className="confirmation-modal__btn confirmation-modal__btn--cancel"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`confirmation-modal__btn confirmation-modal__btn--confirm${variant === 'danger' ? ' confirmation-modal__btn--danger' : ''}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </AppModal>
  )
}
