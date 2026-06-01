/*
  Author: Runor Ewhro
  Description: Renders the allowed sets surface for the calculator optimizer flow.
*/

import { Check, ChevronDown } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/domain/state/store'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { OptSetChoice } from '@/domain/entities/optimizer'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

const MENUCLSDURMS = 180
const MENUMAXHGHT = 320
const MENUMINHGHT = 96
const VWPR_PDDN = 20
const MENU_OFFSET = 8
const VRLYPRTLSLCT =
  '.app-modal-overlay, .char-menu-overlay'

interface LlwdSetDrpdP {
  selIdsByPc: OptSetChoice
  onChange: (nextSelIdsBy: OptSetChoice) => void
  triggerClass?: string
  viewTrggCntn?: (args: { summaryLabel: string; open: boolean }) => ReactNode
  resetLabel?: string
  resetMeta?: string
}

type PieceCount = 1 | 3 | 5

interface MenuLayout {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
}

export function AllowedSets({
  selIdsByPc: selIdsByPc,
  onChange,
  triggerClass: triggerClass,
  viewTrggCntn: rndrTrggCntn,
  resetLabel = 'All Sets',
  resetMeta = 'No set restriction',
}: LlwdSetDrpdP) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const clsTmrRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const [rootElement, setRootLmnt] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [placement, setPlacement] = useState<'up' | 'down'>('down')
  const [menuLayout, setMenuLyt] = useState<MenuLayout>({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: MENUMAXHGHT,
  })
  const ui = useAppStore((state) => state.ui)

  const actVar = useMemo(() => {
    if (ui.theme === 'background') {
      return ui.backgroundVariant
    }

    return ui.theme === 'dark' ? ui.darkVariant : ui.lightVariant
  }, [ui.backgroundVariant, ui.darkVariant, ui.lightVariant, ui.theme])

  const actTextModeC = useMemo(() => {
    if (ui.theme === 'background') {
      return `${ui.backgroundTextMode}-text`
    }

    return ui.theme === 'dark' ? 'dark-text' : 'light-text'
  }, [ui.backgroundTextMode, ui.theme])

  const summaryLabel = useMemo(() => {
    // summarize by selector bucket rather than set names so compact cards stay stable even when several sets are
    // selected.
    const fiveCount = selIdsByPc[5].length
    const threeCount = selIdsByPc[3].length
    const oneCount = selIdsByPc[1].length
    if (oneCount === 0 && fiveCount === 0 && threeCount === 0) {
      return 'All Sets'
    }

    const parts: string[] = []
    if (oneCount > 0) parts.push(`1pc ${oneCount}`)
    if (fiveCount > 0) parts.push(`5pc ${fiveCount}`)
    if (threeCount > 0) parts.push(`3pc ${threeCount}`)
    return parts.join(' • ')
  }, [selIdsByPc])

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
            icon: getSntSetIco(set.id) ?? '',
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
            icon: getSntSetIco(set.id) ?? '',
          })),
      },
      {
        label: '1-Piece Sets',
        pieceCount: 1 as PieceCount,
        options: ECHO_SET_DEFS
          .filter((set) => set.setMax === 1)
          .map((set) => ({
            id: set.id,
            name: set.name,
            icon: getSntSetIco(set.id) ?? '',
          })),
      },
    ]),
    [],
  )

  const rslvPrtlTgt =
    // render inside the nearest app/modal overlay when possible so dropdown z-order follows the surface that opened it.
    typeof document !== 'undefined'
      ? ((rootElement?.closest(VRLYPRTLSLCT) as HTMLElement | null) ?? document.body)
      : null

  const menuVisible = open || closing

  const clrClsTmr = useCallback(() => {
    if (clsTmrRef.current !== null) {
      window.clearTimeout(clsTmrRef.current)
      clsTmrRef.current = null
    }
  }, [])

  const clearMeasure = useCallback(() => {
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

    // choose upward placement only when the normal downward menu would be cramped and the space above is better.
    const spaceBelow = window.innerHeight - rect.bottom - VWPR_PDDN
    const spaceAbove = rect.top - VWPR_PDDN
    const openUpward = spaceBelow < 220 && spaceAbove > spaceBelow
    const vlblSpc = openUpward ? spaceAbove : spaceBelow
    const rslvMaxHght = Math.max(MENUMINHGHT, Math.min(MENUMAXHGHT, vlblSpc))
    const width = Math.min(rect.width, window.innerWidth - VWPR_PDDN * 2)
    const left = Math.min(
      Math.max(VWPR_PDDN, rect.left),
      Math.max(VWPR_PDDN, window.innerWidth - VWPR_PDDN - width),
    )

    setPlacement(openUpward ? 'up' : 'down')
    setMenuLyt({
      left,
      top: openUpward ? undefined : rect.bottom + MENU_OFFSET,
      bottom: openUpward ? window.innerHeight - rect.top + MENU_OFFSET : undefined,
      width,
      maxHeight: rslvMaxHght,
    })
  }, [])

  const schdMsrMenu = useCallback(() => {
    clearMeasure()
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measureMenu()
    })
  }, [clearMeasure, measureMenu])

  const closeMenu = useCallback(() => {
    if (!open && !closing) {
      return
    }

    // keep the menu mounted during its closing window so css exit animation can run before portal teardown.
    clrClsTmr()
    setOpen(false)
    setClosing(true)
    clsTmrRef.current = window.setTimeout(() => {
      setClosing(false)
      clsTmrRef.current = null
    }, MENUCLSDURMS)
  }, [clrClsTmr, closing, open])

  const openMenu = useCallback(() => {
    clrClsTmr()
    measureMenu()
    setClosing(false)
    setOpen(true)
  }, [clrClsTmr, measureMenu])

  useEffect(() => {
    return () => {
      clrClsTmr()
      clearMeasure()
    }
  }, [clrClsTmr, clearMeasure])

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

    // while open, remeasure on viewport movement and close only for outside pointer/scroll interactions.
    schdMsrMenu()

    const onPntrDown = (event: PointerEvent) => {
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

      schdMsrMenu()
    }

    const handleResize = () => {
      schdMsrMenu()
    }

    document.addEventListener('pointerdown', onPntrDown)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)

    return () => {
      document.removeEventListener('pointerdown', onPntrDown)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [closeMenu, open, schdMsrMenu])

  const menu =
    menuVisible && rslvPrtlTgt
      ? createPortal(
          <div
            ref={menuRef}
            className={`co-skill-select__menu co-skill-select__menu--${placement} co-set-dropdown__menu ${actVar} ${actTextModeC}${ui.blurMode ? ' blur-off' : ''}`}
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
                selIdsByPc[1].length === 0 && selIdsByPc[3].length === 0 && selIdsByPc[5].length === 0 ? ' selected is-active' : ''
              }`}
              onClick={() => {
              onChange({1: [],  3: [], 5: [] })
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
                    const selected = selIdsByPc[group.pieceCount].includes(set.id)
                    return (
                      <button
                        key={`${group.pieceCount}-${set.id}`}
                        type="button"
                        className={`co-skill-select__option co-set-dropdown__item${selected ? ' selected is-active' : ''}`}
                        onClick={() => {
                          const current = selIdsByPc[group.pieceCount]
                          const next = selected
                            ? current.filter((id) => id !== set.id)
                            : [...current, set.id].sort((left, right) => left - right)
                          onChange({
                            ...selIdsByPc,
                            [group.pieceCount]: next,
                          })
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        <span className="co-skill-select__option-label co-set-dropdown__copy">
                          <img src={set.icon} alt="" className="co-set-dropdown__icon" onError={withDefIconM} />
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
          rslvPrtlTgt,
        )
      : null

  return (
    <div ref={(node) => {
      rootRef.current = node
      setRootLmnt(node)
    }} className={`co-set-dropdown${open ? ' is-open' : ''}${closing ? ' closing' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`co-chip co-set-dropdown__trigger${triggerClass ? ` ${triggerClass}` : ''}`}
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
        {rndrTrggCntn ? (
          rndrTrggCntn({ summaryLabel, open })
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
