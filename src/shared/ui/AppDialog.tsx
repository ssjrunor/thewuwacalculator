import * as Dialog from '@radix-ui/react-dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import type { ReactNode } from 'react'

interface AppDialogProps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  overlayClassName?: string
  contentClassName?: string
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  onClose: () => void
  children: ReactNode
}

export function AppDialog({
  visible,
  open,
  closing = false,
  portalTarget,
  overlayClassName,
  contentClassName,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  onClose,
  children,
}: AppDialogProps) {
  if (!visible || !portalTarget) {
    return null
  }

  const overlayClassNames = ['app-modal-overlay', overlayClassName, open ? 'open' : '', closing ? 'closing' : '']
    .filter(Boolean)
    .join(' ')
  const contentClassNames = [contentClassName, open ? 'open' : '', closing ? 'closing' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        onClose()
      }
    }}>
      <Dialog.Portal forceMount container={portalTarget}>
        <Dialog.Overlay forceMount className={overlayClassNames}>
          <Dialog.Content
            forceMount
            className={contentClassNames}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
          >
            <VisuallyHidden>
              <Dialog.Title>{ariaLabel ?? 'Dialog'}</Dialog.Title>
            </VisuallyHidden>
            {children}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
