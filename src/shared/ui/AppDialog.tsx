/*
  Author: Runor Ewhro
  Description: Wraps the shared radix dialog primitives with the app's portal,
               overlay, and outside-interaction safeguards.
*/

import * as Dialog from '@radix-ui/react-dialog'
import { VisuallyHidden as VsllHddn } from '@radix-ui/react-visually-hidden'
import type { CSSProperties, ReactNode } from 'react'

interface AppDlgPrps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  contentClass?: string
  contentStyle?: CSSProperties
  ariaLabel?: string
  ariaLabelBy?: string
  ariaDscrBy?: string
  dismissible?: boolean
  onClose: () => void
  children: ReactNode
}

function isFltnSelCtn(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('.selection-focus-actions'))
}

function isAppPopup(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('.app-popup'))
}

export function AppDialog({
  visible,
  open,
  closing = false,
  portalTarget,
  contentClass: contentClass,
  contentStyle,
  ariaLabel,
  ariaLabelBy: ariaLabelBy,
  ariaDscrBy: ariaDscrBy,
  dismissible = true,
  onClose,
  children,
}: AppDlgPrps) {
  if (!visible || !portalTarget) {
    return null
  }

  const vrlyClssNms = ['app-modal-overlay', open ? 'open' : '', closing ? 'closing' : '']
    .filter(Boolean)
    .join(' ')
  const cntnClssNms = [contentClass, open ? 'open' : '', closing ? 'closing' : '']
    .filter(Boolean)
    .join(' ')
  // Keep backdrop filtering outside the scrolling subtree to avoid re-filtering each frame.
  const blurClssNms = ['app-modal-blur', open ? 'open' : '', closing ? 'closing' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && dismissible) {
        onClose()
      }
    }}>
      <Dialog.Portal forceMount container={portalTarget}>
        <div className={blurClssNms} aria-hidden="true" />
        <Dialog.Overlay
          forceMount
          className={vrlyClssNms}
          data-app-modal-overlay="true"
        >
          <Dialog.Content
            forceMount
            className={cntnClssNms}
            style={contentStyle}
            data-app-modal-content="true"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelBy}
            aria-describedby={ariaDscrBy}
            onEscapeKeyDown={(event) => {
              if (!dismissible) {
                event.preventDefault()
              }
            }}
            onInteractOutside={(event) => {
              if (!dismissible) {
                event.preventDefault()
                return
              }

              // Nested popups and selection actions are not outside-dialog interactions.
              if (
                isAppPopup(event.target)
                || isFltnSelCtn(event.target)
              ) {
                event.preventDefault()
              }
            }}
          >
            <VsllHddn>
              <Dialog.Title>{ariaLabel ?? 'Dialog'}</Dialog.Title>
            </VsllHddn>
            {ariaDscrBy ? null : (
              <VsllHddn>
                <Dialog.Description />
              </VsllHddn>
            )}
            {children}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
