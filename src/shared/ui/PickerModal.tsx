/*
  Author: Runor Ewhro
  Description: Shared picker modal that renders filterable card grids for
               resonators, weapons, echoes, and other selection surfaces.
*/

import { useId } from 'react'
import type { CSSProperties as CssProps, ReactNode } from 'react'
import { AppModal } from '@/shared/ui/AppModal'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton'
import { useGridColumns } from '@/shared/lib/useGridColumns.ts'
import { rarityVars } from '@/modules/calculator/model/display.ts'

export type PckrMdlRrty = 1 | 2 | 3 | 4 | 5

export interface PckrMdlItem {
  id: string
  title: string
  subtitle?: string
  description?: string
  rarity?: PckrMdlRrty
  leading?: ReactNode
  trailing?: ReactNode
  cornerNote?: ReactNode
  meta?: ReactNode
  specClassName?: string
  selected?: boolean
  disabled?: boolean
  bis?: boolean
  onSelect: () => void
}

interface PckrMdlPrps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  variant?: string
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
  variant,
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
  const [gridRef, columns] = useGridColumns()

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
      <div className="picker-modal__frame" data-variant={variant} onClick={(event) => event.stopPropagation()}>
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
            <div className="picker-modal__grid picker-modal__grid--cards" ref={gridRef}>
              {items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`picker-modal__card ${item.selected ? 'is-selected' : ''} ${!item.leading ? 'picker-modal__card--plain' : ''}`}
                  style={{
                    ...rarityVars(item.rarity, item.bis),
                    animationDelay: `${Math.min(Math.floor(index / columns), 6) * 55}ms`,
                  } as CssProps}
                  aria-pressed={item.selected}
                  data-bis={item.bis ? 'true' : undefined}
                  onClick={item.onSelect}
                  disabled={item.disabled}
                >
                  <span className="picker-card-bracket picker-card-bracket--tl" aria-hidden="true" />
                  <span className="picker-card-bracket picker-card-bracket--br" aria-hidden="true" />

                  {item.leading ? (
                    <div className="picker-modal__card-art">
                      {item.leading}
                      {item.cornerNote ? <div className="picker-modal__card-flag picker-modal__card-flag--left">{item.cornerNote}</div> : null}
                      {item.trailing ? <div className="picker-modal__card-flag">{item.trailing}</div> : null}
                      <div className="picker-modal__card-scrim">
                        <div className="picker-modal__card-title">{item.title}</div>
                        {item.subtitle ? <div className="picker-modal__card-subtitle">{item.subtitle}</div> : null}
                      </div>
                    </div>
                  ) : (
                    <div className="picker-modal__card-plate">
                      <div className="picker-modal__card-title">{item.title}</div>
                      {item.subtitle ? <div className="picker-modal__card-subtitle">{item.subtitle}</div> : null}
                      {item.trailing ? <div className="picker-modal__card-flag picker-modal__card-flag--inline">{item.trailing}</div> : null}
                    </div>
                  )}

                  {item.meta ? (
                    <div className={`picker-modal__card-spec ${item.specClassName ?? ''}`}>
                      {item.meta}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppModal>
  )
}
