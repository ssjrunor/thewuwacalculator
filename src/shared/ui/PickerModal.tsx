/*
  Author: Runor Ewhro
  Description: Owns picker modal behavior and state transitions for the ui module.
*/

import { useId } from 'react'
import type { CSSProperties as CssProps, ReactNode } from 'react'
import { AppModal } from '@/shared/ui/AppModal'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { useGridColumns } from '@/shared/lib/useGridColumns.ts'
import { rarityVars } from '@/modules/simulation/model/display.ts'

export type PckrMdlRrty = 1 | 2 | 3 | 4 | 5

export interface PckrMdlItem {
  id: string
  title: string
  subtitle?: string
  rarity?: PckrMdlRrty
  // what the item is, in colour: its element, its sonata, its rarity. only thin
  // marks and the tile's own glow wear it
  tone?: string
  leading?: ReactNode
  trailing?: ReactNode
  cornerNote?: ReactNode
  meta?: ReactNode
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
  railFoot?: ReactNode
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
  summary,
  filters,
  railFoot,
  items,
  emptyState,
  closeLabel = 'Close',
  panelWidth = 'regular',
  onClose,
}: PckrMdlPrps) {
  const titleId = useId()
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
      onClose={onClose}
    >
      <div className="amdl picker-modal__frame" data-variant={variant} onClick={(event) => event.stopPropagation()}>
        <ModalHeader
          over={eyebrow}
          title={<h2 id={titleId}>{title}</h2>}
          closeLabel={closeLabel}
          onClose={onClose}
        >
          {summary ? <div className="amdl__gauge">{summary}</div> : null}
        </ModalHeader>

        <div className={`picker-modal__stage ${filters ? 'has-rail' : ''}`}>
          {filters ? (
            <nav className="amdl__rail pkr-rail" aria-label="Filters">
              {filters}
              {railFoot ? <div className="amdl__rail-foot">{railFoot}</div> : null}
            </nav>
          ) : null}

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
                      ...(item.tone ? { '--picker-item-tone': item.tone } : null),
                      animationDelay: `${Math.min(Math.floor(index / columns), 6) * 55}ms`,
                    } as CssProps}
                    aria-pressed={item.selected}
                    data-bis={item.bis ? 'true' : undefined}
                    onClick={item.onSelect}
                    disabled={item.disabled}
                  >
                    {item.leading ? (
                      <div className="picker-modal__card-art">
                        {item.leading}
                        {item.cornerNote ? <div className="picker-modal__card-flag picker-modal__card-flag--left">{item.cornerNote}</div> : null}
                        {item.trailing ? <div className="picker-modal__card-flag">{item.trailing}</div> : null}
                      </div>
                    ) : null}

                    <div className="picker-modal__card-cap">
                      <div className="picker-modal__card-title">{item.title}</div>
                      {item.subtitle ? <div className="picker-modal__card-subtitle">{item.subtitle}</div> : null}
                      {item.meta ? (
                        <div className="picker-modal__card-spec">{item.meta}</div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppModal>
  )
}
