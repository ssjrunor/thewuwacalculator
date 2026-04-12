import { Check, ChevronDown } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/domain/state/store'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { OptimizerSetSelections } from '@/domain/entities/optimizer'
import { getSonataSetIcon } from '@/data/gameData/catalog/sonataSets'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'

const MENU_CLOSE_DURATION_MS = 180
const MENU_MAX_HEIGHT = 320
const MENU_MIN_HEIGHT = 96
const VIEWPORT_PADDING = 20
const MENU_OFFSET = 8
const OVERLAY_PORTAL_SELECTOR =
  '.app-modal-overlay, .picker-modal__overlay, .skills-modal-overlay, .skill-menu-overlay, .char-menu-overlay'

interface AllowedSetDropdownProps {
  selectedIdsByPiece: OptimizerSetSelections
  onChange: (nextSelectedIdsByPiece: OptimizerSetSelections) => void
  triggerClassName?: string
  renderTriggerContent?: (args: { summaryLabel: string; open: boolean }) => ReactNode
  resetLabel?: string
  resetMeta?: string
}

type PieceCount = 3 | 5

interface MenuLayout {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
}

export function AllowedSetDropdown({
  selectedIdsByPiece,
  onChange,
  triggerClassName,
  renderTriggerContent,
  resetLabel = 'All Sets',
  resetMeta = 'No set restriction',
}: AllowedSetDropdownProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [placement, setPlacement] = useState<'up' | 'down'>('down')
  const [menuLayout, setMenuLayout] = useState<MenuLayout>({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: MENU_MAX_HEIGHT,
  })
  const ui = useAppStore((state) => state.ui)

  const activeVariant = useMemo(() => {
    if (ui.theme === 'background') {
      return ui.backgroundVariant
    }

    return ui.theme === 'dark' ? ui.darkVariant : ui.lightVariant
  }, [ui.backgroundVariant, ui.darkVariant, ui.lightVariant, ui.theme])

  const activeTextModeClass = useMemo(() => {
    if (ui.theme === 'background') {
      return `${ui.backgroundTextMode}-text`
    }

    return ui.theme === 'dark' ? 'dark-text' : 'light-text'
  }, [ui.backgroundTextMode, ui.theme])

  const summaryLabel = useMemo(() => {
    const fiveCount = selectedIdsByPiece[5].length
    const threeCount = selectedIdsByPiece[3].length
    if (fiveCount === 0 && threeCount === 0) {
      return 'All Sets'
    }

    const parts: string[] = []
    if (fiveCount > 0) {
      parts.push(`5pc ${fiveCount}`)
    }
    if (threeCount > 0) {
      parts.push(`3pc ${threeCount}`)
    }
    return parts.join(' • ')
  }, [selectedIdsByPiece])

  const optionGroups = useMemo(
    () => ([
      {
        label: '5-Piece Sets',
        pieceCount: 5 as PieceCount,
        options: ECHO_SET_DEFS
          .filter((set) => set.setMax === 5)
          .map((set) => ({
            id: set.id,
            name: set.name,
            icon: getSonataSetIcon(set.id) ?? '',
          })),
      },
      {
        label: '3-Piece Sets',
        pieceCount: 3 as PieceCount,
        options: ECHO_SET_DEFS
          .filter((set) => set.setMax === 3)
          .map((set) => ({
            id: set.id,
            name: set.name,
            icon: getSonataSetIcon(set.id) ?? '',
          })),
      },
    ]),
    [],
  )

  const resolvedPortalTarget =
    typeof document !== 'undefined'
      ? ((rootElement?.closest(OVERLAY_PORTAL_SELECTOR) as HTMLElement | null) ?? document.body)
      : null

  const menuVisible = open || closing

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const clearMeasureFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const measureMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }

    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PADDING
    const spaceAbove = rect.top - VIEWPORT_PADDING
    const openUpward = spaceBelow < 220 && spaceAbove > spaceBelow
    const availableSpace = openUpward ? spaceAbove : spaceBelow
    const resolvedMaxHeight = Math.max(MENU_MIN_HEIGHT, Math.min(MENU_MAX_HEIGHT, availableSpace))
    const width = Math.min(rect.width, window.innerWidth - VIEWPORT_PADDING * 2)
    const left = Math.min(
      Math.max(VIEWPORT_PADDING, rect.left),
      Math.max(VIEWPORT_PADDING, window.innerWidth - VIEWPORT_PADDING - width),
    )

    setPlacement(openUpward ? 'up' : 'down')
    setMenuLayout({
      left,
      top: openUpward ? undefined : rect.bottom + MENU_OFFSET,
      bottom: openUpward ? window.innerHeight - rect.top + MENU_OFFSET : undefined,
      width,
      maxHeight: resolvedMaxHeight,
    })
  }, [])

  const scheduleMeasureMenu = useCallback(() => {
    clearMeasureFrame()
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measureMenu()
    })
  }, [clearMeasureFrame, measureMenu])

  const closeMenu = useCallback(() => {
    if (!open && !closing) {
      return
    }

    clearCloseTimer()
    setOpen(false)
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      setClosing(false)
      closeTimerRef.current = null
    }, MENU_CLOSE_DURATION_MS)
  }, [clearCloseTimer, closing, open])

  const openMenu = useCallback(() => {
    clearCloseTimer()
    measureMenu()
    setClosing(false)
    setOpen(true)
  }, [clearCloseTimer, measureMenu])

  useEffect(() => {
    return () => {
      clearCloseTimer()
      clearMeasureFrame()
    }
  }, [clearCloseTimer, clearMeasureFrame])

  useEffect(() => {
    if (!open) {
      return
    }

    menuRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    scheduleMeasureMenu()

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }

      closeMenu()
    }

    const handleScroll = (event: Event) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }

      scheduleMeasureMenu()
    }

    const handleResize = () => {
      scheduleMeasureMenu()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [closeMenu, open, scheduleMeasureMenu])

  const menu =
    menuVisible && resolvedPortalTarget
      ? createPortal(
          <div
            ref={menuRef}
            className={`co-skill-select__menu co-skill-select__menu--${placement} co-set-dropdown__menu ${activeVariant} ${activeTextModeClass}${ui.blurMode === 'off' ? ' blur-off' : ''}`}
            tabIndex={-1}
            data-state={open ? 'open' : 'closed'}
            style={{
              left: `${menuLayout.left}px`,
              width: `${menuLayout.width}px`,
              top: menuLayout.top !== undefined ? `${menuLayout.top}px` : undefined,
              bottom: menuLayout.bottom !== undefined ? `${menuLayout.bottom}px` : undefined,
              maxHeight: `${menuLayout.maxHeight}px`,
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                closeMenu()
              }
            }}
          >
            <button
              type="button"
              className={`co-skill-select__option co-set-dropdown__item co-set-dropdown__item--reset${
                selectedIdsByPiece[3].length === 0 && selectedIdsByPiece[5].length === 0 ? ' selected is-active' : ''
              }`}
              onClick={() => {
              onChange({ 3: [], 5: [] })
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <span className="co-skill-select__option-label co-set-dropdown__copy">
              <span className="co-set-dropdown__name">{resetLabel}</span>
              <span className="co-set-dropdown__meta">{resetMeta}</span>
            </span>
            <span className="co-skill-select__option-check co-set-dropdown__check" aria-hidden="true">
              <Check size={14} />
            </span>
          </button>

            {optionGroups.map((group) => (
              <div key={group.pieceCount} className="co-skill-select__group">
                <div className="co-skill-select__group-label" aria-hidden="true">
                  {group.label}
                </div>
                <div className="co-set-dropdown__list">
                  {group.options.map((set) => {
                    const selected = selectedIdsByPiece[group.pieceCount].includes(set.id)
                    return (
                      <button
                        key={`${group.pieceCount}-${set.id}`}
                        type="button"
                        className={`co-skill-select__option co-set-dropdown__item${selected ? ' selected is-active' : ''}`}
                        onClick={() => {
                          const current = selectedIdsByPiece[group.pieceCount]
                          const next = selected
                            ? current.filter((id) => id !== set.id)
                            : [...current, set.id].sort((left, right) => left - right)
                          onChange({
                            ...selectedIdsByPiece,
                            [group.pieceCount]: next,
                          })
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        <span className="co-skill-select__option-label co-set-dropdown__copy">
                          <img src={set.icon} alt="" className="co-set-dropdown__icon" />
                          <span className="co-set-dropdown__name">{set.name}</span>
                        </span>
                        <span className="co-skill-select__option-check co-set-dropdown__check" aria-hidden="true">
                          <Check size={14} />
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>,
          resolvedPortalTarget,
        )
      : null

  return (
    <div ref={(node) => {
      rootRef.current = node
      setRootElement(node)
    }} className={`co-set-dropdown${open ? ' is-open' : ''}${closing ? ' closing' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`co-chip co-set-dropdown__trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          if (open) {
            closeMenu()
          } else {
            openMenu()
          }
        }}
      >
        {renderTriggerContent ? (
          renderTriggerContent({ summaryLabel, open })
        ) : (
          <>
            <span className="co-set-dropdown__trigger-value">{summaryLabel}</span>
            <ChevronDown size={12} />
          </>
        )}
      </button>
      {menu}
    </div>
  )
}
