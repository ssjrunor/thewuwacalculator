/*
  Author: Runor Ewhro
  Description: Provides presentational suggestion-pane fragments shared by the
               calculator suggestions surface.
*/

import type { ReactNode } from 'react'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton.tsx'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

// keep the shared modal shell separate so the main pane only handles state and data flow.
export function SuggsMdl(props: {
  open: boolean
  closing: boolean
  visible: boolean
  title: string
  onClose: () => void
  onApply?: () => void
  xtrClssName?: string
  children: ReactNode
}) {
  const { open, closing, visible, title, onClose, onApply, xtrClssName: xtrClssName, children } = props
  const dashIdx = title.indexOf(' - ')
  const eyebrow = dashIdx !== -1 ? title.slice(0, dashIdx) : null
  const mainTitle = dashIdx !== -1 ? title.slice(dashIdx + 3) : title
  const variant = xtrClssName ? xtrClssName : 'suggestions'

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant={variant}
      ariaLabel={title}
      onClose={onClose}
    >
      <div className="app-modal-header suggestions-modal-header">
        <div className="app-modal-header-top">
          <div className="suggestions-modal-heading">
            {eyebrow && <span className="picker-modal__eyebrow">{eyebrow}</span>}
            <h3 className="suggestions-modal-title">{mainTitle}</h3>
          </div>
          <div className="suggestions-modal-header-actions">
            {onApply && (
              <button
                type="button"
                className="suggestions-apply-btn"
                onClick={() => { onApply(); onClose() }}
              >
                Apply
              </button>
            )}
            <MdlClsBttn onClick={onClose} />
          </div>
        </div>
      </div>
      <div className="suggestions-modal-body">{children}</div>
    </AppModal>
  )
}

export function SetBadge({
  setId,
  pieces,
  className = 'echo-buff set-badge',
}: {
  setId: number
  pieces: number
  className?: string
}) {
  const label = getSntSetNam(setId)
  const icon = getSntSetIco(setId)

  return (
    <span className={className}>
      {icon ? (
        <img
          src={icon}
          alt={label}
          className="set-icon"
          loading="lazy"
          onError={withDefIconM}
        />
      ) : null}
      {pieces}pc {label}
    </span>
  )
}
