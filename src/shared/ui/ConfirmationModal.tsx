import type { ReactNode } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { AppDialog } from '@/shared/ui/AppDialog'

interface ConfirmationModalProps {
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

export function ConfirmationModal({
  visible,
  open,
  closing = false,
  portalTarget,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'info',
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  const Icon = variant === 'danger' ? AlertTriangle : Info

  return (
    <AppDialog
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      contentClassName={`app-modal-panel confirmation-modal confirmation-modal--${variant}`}
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
    </AppDialog>
  )
}
