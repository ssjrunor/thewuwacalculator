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
  onClose: () => void
  children: ReactNode
}

function isFltnCtxMen(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('.floating-context-menu'))
}

function isFltnSelCtn(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('.selection-focus-actions'))
}

function isLqdSelMenu(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('.liquid-select__menu'))
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
  // The frosted-glass blur lives on its own layer that is a sibling of the
  // overlay, never an ancestor of the scrolling content. A backdrop-filter on
  // an ancestor of a scroller forces the whole viewport to re-blur on every
  // scroll frame; keeping it outside the overlay subtree avoids that.
  const blurClssNms = ['app-modal-blur', open ? 'open' : '', closing ? 'closing' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) {
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
            onInteractOutside={(event) => {
              // menus and floating selection actions should keep working even
              // when a dialog is mounted, so do not treat them as backdrop hits.
              if (
                isFltnCtxMen(event.target)
                || isFltnSelCtn(event.target)
                || isLqdSelMenu(event.target)
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
