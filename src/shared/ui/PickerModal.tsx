/*
  Author: Runor Ewhro
  Description: Shared picker modal that renders filterable card grids for
               resonators, weapons, echoes, and other selection surfaces.
*/

import { useId } from 'react'
import type { ReactNode } from 'react'
import { AppModal } from '@/shared/ui/AppModal'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton'

export type PckrMdlRrty = 1 | 2 | 3 | 4 | 5

export interface PckrMdlItem {
  id: string
  title: string
  subtitle?: string
  description?: string
  rarity?: PckrMdlRrty
  leading?: ReactNode
  trailing?: ReactNode
  meta?: ReactNode
  footer?: ReactNode
  selected?: boolean
  disabled?: boolean
  onSelect: () => void
}

interface PckrMdlPrps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  title: string
  eyebrow?: string
  description?: string
  summary?: ReactNode
  filters?: ReactNode
  items: PckrMdlItem[]
  emptyState?: ReactNode
  closeLabel?: string
  panelWidth?: 'regular' | 'wide'
  onClose: () => void
}

export function PickerModal({
  visible,
  open,
  closing = false,
  portalTarget,
  title,
  eyebrow,
  description,
  summary,
  filters,
  items,
  emptyState,
  closeLabel = 'Close',
  panelWidth = 'regular',
  onClose,
}: PckrMdlPrps) {
  const titleId = useId()
  const dscrId = useId()

  if (!visible || !portalTarget) {
    return null
  }

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="picker"
      size={panelWidth}
      ariaLabelBy={titleId}
      ariaDscrBy={description ? dscrId : undefined}
      onClose={onClose}
    >
      <div className="picker-modal__frame" onClick={(event) => event.stopPropagation()}>
        <div className="picker-modal__header">
          <div className="picker-modal__header-top">
            <div className="picker-modal__heading">
              {eyebrow ? <div className="picker-modal__eyebrow">{eyebrow}</div> : null}
              <h2 id={titleId} className="picker-modal__title">
                {title}
              </h2>
              {description ? (
                <p id={dscrId} className="picker-modal__description">
                  {description}
                </p>
              ) : null}
            </div>
            <div className="picker-modal__actions">
              {summary ? <div className="picker-modal__summary">{summary}</div> : null}
              <MdlClsBttn className="picker-modal__close" onClick={onClose} label={closeLabel} />
            </div>
          </div>
        </div>

        {filters ? <div className="picker-modal__filters">{filters}</div> : null}

        <div className="picker-modal__body">
          {items.length === 0 ? (
            <div className="picker-modal__empty">
              {emptyState ?? <p>No items available.</p>}
            </div>
          ) : (
            <div className="picker-modal__grid">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`picker-modal__card ${item.rarity ? `rarity-${item.rarity}` : ''} ${item.selected ? 'is-selected' : ''}`}
                  data-rarity={item.rarity}
                  onClick={item.onSelect}
                  disabled={item.disabled}
                >
                  <span className="picker-card-bracket picker-card-bracket--tl" aria-hidden="true" />
                  <span className="picker-card-bracket picker-card-bracket--br" aria-hidden="true" />

                  <div className="picker-modal__card-main">
                    {item.leading ? <div className="picker-modal__card-media">{item.leading}</div> : null}

                    <div className="picker-modal__card-copy">
                      <div className="picker-modal__card-head">
                        <div className="picker-modal__card-heading">
                          <div className="picker-modal__card-title">{item.title}</div>
                          {item.subtitle ? <div className="picker-modal__card-subtitle">{item.subtitle}</div> : null}
                        </div>
                        {item.trailing ? <div className="picker-modal__card-trailing">{item.trailing}</div> : null}
                      </div>

                      {item.meta ? <div className="picker-modal__card-meta">{item.meta}</div> : null}
                    </div>
                  </div>

                  {item.footer ? <div className="picker-modal__card-footer">{item.footer}</div> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppModal>
  )
}
