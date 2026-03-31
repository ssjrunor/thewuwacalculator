import { useId } from 'react'
import type { ReactNode } from 'react'
import { AppDialog } from '@/shared/ui/AppDialog'
import { ModalCloseButton } from '@/shared/ui/ModalCloseButton'

export type PickerModalRarity = 1 | 2 | 3 | 4 | 5

export interface PickerModalItem {
  id: string
  title: string
  subtitle?: string
  description?: string
  rarity?: PickerModalRarity
  leading?: ReactNode
  trailing?: ReactNode
  meta?: ReactNode
  footer?: ReactNode
  selected?: boolean
  disabled?: boolean
  onSelect: () => void
}

interface PickerModalProps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  title: string
  eyebrow?: string
  description?: string
  summary?: ReactNode
  filters?: ReactNode
  items: PickerModalItem[]
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
}: PickerModalProps) {
  const titleId = useId()
  const descriptionId = useId()

  if (!visible || !portalTarget) {
    return null
  }

  return (
    <AppDialog
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      overlayClassName="picker-modal__overlay"
      contentClassName={`app-modal-panel picker-modal__panel ${panelWidth === 'wide' ? 'app-modal-panel--wide picker-modal__panel--wide' : ''}`}
      ariaLabelledBy={titleId}
      ariaDescribedBy={description ? descriptionId : undefined}
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
                <p id={descriptionId} className="picker-modal__description">
                  {description}
                </p>
              ) : null}
            </div>
            {summary ? <div className="picker-modal__summary">{summary}</div> : null}
            <ModalCloseButton className="picker-modal__close" onClick={onClose} label={closeLabel} />
          </div>
          {filters ? <div className="picker-modal__filters">{filters}</div> : null}
        </div>

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
    </AppDialog>
  )
}
