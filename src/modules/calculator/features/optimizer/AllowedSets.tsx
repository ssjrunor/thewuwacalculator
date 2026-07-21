/*
  Author: Runor Ewhro
  Description: Edits optimizer sonata-set constraints and resolves dropdown
               overlay placement for the current modal or route context.
*/

import { ChevronDown, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/domain/state/store'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { OptSetChoice } from '@/domain/entities/optimizer'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

const MENUCLSDURMS = 180
const MENUMAXHGHT = 430
const MENUMINHGHT = 96
const VWPR_PDDN = 20
const MENU_OFFSET = 8
const SET_MENU_MIN_W = 540
const VRLYPRTLSLCT =
  '.app-modal-overlay, .char-menu-overlay'

interface LlwdSetDrpdP {
  selIdsByPc?: OptSetChoice
  onChange?: (nextSelIdsBy: OptSetChoice) => void
  selectedSetIds?: readonly number[]
  onSetIdsChange?: (nextSetIds: number[]) => void
  triggerClass?: string
  availableSetIds?: readonly number[]
  selectionMode?: 'multi' | 'single'
  closeOnSelect?: boolean
  menuMinWidth?: number
  placeholder?: string
  triggerVariant?: 'chip' | 'liquid'
  viewTrggCntn?: (args: { summaryLabel: string; open: boolean }) => ReactNode
}

type PieceCount = 1 | 3 | 5

interface MenuLayout {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
}

const EMPTY_SET_CHOICE: OptSetChoice = { 1: [], 3: [], 5: [] }

function pieceCountForSet(setId: number): PieceCount {
  const setMax = ECHO_SET_DEFS.find((set) => set.id === setId)?.setMax
  return setMax === 1 || setMax === 3 || setMax === 5 ? setMax : 5
}

function setIdsToChoice(ids: readonly number[]): OptSetChoice {
  const next: OptSetChoice = { 1: [], 3: [], 5: [] }
  for (const id of ids) {
    const pieceCount = pieceCountForSet(id)
    if (!next[pieceCount].includes(id)) {
      next[pieceCount].push(id)
    }
  }

  return {
    1: next[1].sort((left, right) => left - right),
    3: next[3].sort((left, right) => left - right),
    5: next[5].sort((left, right) => left - right),
  }
}

function choiceToSetIds(choice: OptSetChoice): number[] {
  return [...choice[1], ...choice[3], ...choice[5]].sort((left, right) => left - right)
}

export function AllowedSets({
                              selIdsByPc: selIdsByPc,
                              onChange,
                              selectedSetIds,
                              onSetIdsChange,
                              triggerClass: triggerClass,
                              availableSetIds,
                              selectionMode = 'multi',
                              closeOnSelect,
                              menuMinWidth = SET_MENU_MIN_W,
                              placeholder = 'All Sets',
                              triggerVariant = 'chip',
                              viewTrggCntn: rndrTrggCntn,
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

  const availableSetIdSet = useMemo(
    () => availableSetIds ? new Set(availableSetIds) : null,
    [availableSetIds],
  )

  const effectiveSelIdsByPc = useMemo(
    () => selIdsByPc ?? (selectedSetIds ? setIdsToChoice(selectedSetIds) : EMPTY_SET_CHOICE),
    [selectedSetIds, selIdsByPc],
  )

  const applyChange = useCallback((nextChoice: OptSetChoice) => {
    onChange?.(nextChoice)
    onSetIdsChange?.(choiceToSetIds(nextChoice))
  }, [onChange, onSetIdsChange])

  const summaryLabel = useMemo(() => {
    if (selectedSetIds) {
      if (selectedSetIds.length === 0) {
        return placeholder
      }
      if (selectedSetIds.length === 1) {
        return getSntSetNam(selectedSetIds[0] ?? 0)
      }
      return `${selectedSetIds.length} Sonata`
    }

    // summarize by selector bucket rather than set names so compact cards stay stable even when several sets are
    // selected.
    const fiveCount = effectiveSelIdsByPc[5].length
    const threeCount = effectiveSelIdsByPc[3].length
    const oneCount = effectiveSelIdsByPc[1].length
    if (oneCount === 0 && fiveCount === 0 && threeCount === 0) {
      return placeholder
    }

    const parts: string[] = []
    if (oneCount > 0) parts.push(`1pc ${oneCount}`)
    if (fiveCount > 0) parts.push(`5pc ${fiveCount}`)
    if (threeCount > 0) parts.push(`3pc ${threeCount}`)
    return parts.join(' • ')
  }, [effectiveSelIdsByPc, placeholder, selectedSetIds])

  const optionGroups = useMemo(
    () => ([
      {
        label: '5pc',
        pieceCount: 5 as PieceCount,
        options: ECHO_SET_DEFS
          .filter((set) => set.setMax === 5 && (!availableSetIdSet || availableSetIdSet.has(set.id)))
          .map((set) => ({
            id: set.id,
            name: set.name,
            icon: getSntSetIco(set.id) ?? '',
          })),
      },
      {
        label: '3pc',
        pieceCount: 3 as PieceCount,
        options: ECHO_SET_DEFS
          .filter((set) => set.setMax === 3 && (!availableSetIdSet || availableSetIdSet.has(set.id)))
          .map((set) => ({
            id: set.id,
            name: set.name,
            icon: getSntSetIco(set.id) ?? '',
          })),
      },
      {
        label: '1pc',
        pieceCount: 1 as PieceCount,
        options: ECHO_SET_DEFS
          .filter((set) => set.setMax === 1 && (!availableSetIdSet || availableSetIdSet.has(set.id)))
          .map((set) => ({
            id: set.id,
            name: set.name,
            icon: getSntSetIco(set.id) ?? '',
          })),
      },
    ]),
    [availableSetIdSet],
  )

  const selectedTotal = useMemo(
    () => effectiveSelIdsByPc[1].length + effectiveSelIdsByPc[3].length + effectiveSelIdsByPc[5].length,
    [effectiveSelIdsByPc],
  )
  const visibleOptionGroups = useMemo(
    () => optionGroups.filter((group) => group.options.length > 0),
    [optionGroups],
  )
  const visibleGroupCount = Math.max(1, visibleOptionGroups.length)

  const isReset = selectedTotal === 0

  const clearPc = useCallback((pieceCount: PieceCount) => {
    applyChange({
      ...effectiveSelIdsByPc,
      [pieceCount]: [],
    })
  }, [applyChange, effectiveSelIdsByPc])

  const setAll = useCallback(() => {
    applyChange({
      1: optionGroups.find((group) => group.pieceCount === 1)?.options.map((set) => set.id) ?? [],
      3: optionGroups.find((group) => group.pieceCount === 3)?.options.map((set) => set.id) ?? [],
      5: optionGroups.find((group) => group.pieceCount === 5)?.options.map((set) => set.id) ?? [],
    })
  }, [applyChange, optionGroups])

  const invPc = useCallback((pieceCount: PieceCount) => {
    const group = optionGroups.find((entry) => entry.pieceCount === pieceCount)
    if (!group) {
      return []
    }

    const selected = new Set(effectiveSelIdsByPc[pieceCount])
    return group.options
      .map((set) => set.id)
      .filter((id) => !selected.has(id))
  }, [effectiveSelIdsByPc, optionGroups])

  const invertAll = useCallback(() => {
    applyChange({
      1: invPc(1),
      3: invPc(3),
      5: invPc(5),
    })
  }, [applyChange, invPc])

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
    const width = Math.min(
      Math.max(rect.width, menuMinWidth),
      window.innerWidth - VWPR_PDDN * 2,
    )
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
  }, [menuMinWidth])

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

  const shouldCloseOnSelect = closeOnSelect ?? selectionMode === 'single'
  const showBulkCommands = selectionMode !== 'single'
  const liquidTrigger = triggerVariant === 'liquid'

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
          <div className={`co-set-dropdown__cmds${showBulkCommands ? '' : ' co-set-dropdown__cmds--single'}`} aria-label="Allowed set commands">
            <button
              type="button"
              className={`co-set-dropdown__cmd${isReset ? ' is-active' : ''}`}
              onClick={() => {
                applyChange({1: [], 3: [], 5: [] })
                if (shouldCloseOnSelect) {
                  closeMenu()
                }
              }}
              onMouseDown={(event) => event.preventDefault()}
            >
              Any
            </button>
            {showBulkCommands ? (
              <>
                <button
                  type="button"
                  className="co-set-dropdown__cmd"
                  onClick={setAll}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  All
                </button>
                <button
                  type="button"
                  className="co-set-dropdown__cmd"
                  onClick={invertAll}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  Invert
                </button>
              </>
            ) : null}
          </div>

          <div
            className="co-set-dropdown__board"
            style={{ '--set-group-count': visibleGroupCount } as CSSProperties}
          >
            {visibleOptionGroups.map((group) => (
              <section key={group.pieceCount} className="co-set-dropdown__col">
                <header className="co-set-dropdown__col-head">
                  <span>{group.label}</span>
                  <span className="co-set-dropdown__group-actions">
                      <span className="co-set-dropdown__group-count">
                        {effectiveSelIdsByPc[group.pieceCount].length}/{group.options.length}
                      </span>
                    {effectiveSelIdsByPc[group.pieceCount].length > 0 ? (
                      <button
                        type="button"
                        aria-label={`Clear ${group.label}`}
                        onClick={() => clearPc(group.pieceCount)}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        <X size={10} />
                      </button>
                    ) : null}
                    </span>
                </header>
                <div className="co-set-dropdown__stack">
                  {group.options.map((set) => {
                    const selected = effectiveSelIdsByPc[group.pieceCount].includes(set.id)
                    return (
                      <button
                        key={`${group.pieceCount}-${set.id}`}
                        type="button"
                        className={`co-set-dropdown__tile${selected ? ' selected is-active' : ''}`}
                        onClick={() => {
                          if (selectionMode === 'single') {
                            applyChange({
                              1: [],
                              3: [],
                              5: [],
                              [group.pieceCount]: selected ? [] : [set.id],
                            })
                          } else {
                            const current = effectiveSelIdsByPc[group.pieceCount]
                            const next = selected
                              ? current.filter((id) => id !== set.id)
                              : [...current, set.id].sort((left, right) => left - right)
                            applyChange({
                              ...effectiveSelIdsByPc,
                              [group.pieceCount]: next,
                            })
                          }
                          if (shouldCloseOnSelect) {
                            closeMenu()
                          }
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                          <span className="co-set-dropdown__tile-icon" aria-hidden="true">
                            <img src={set.icon} alt="" className="co-set-dropdown__icon" onError={withDefIconM} />
                          </span>
                        <span className="co-set-dropdown__tile-name">{set.name}</span>
                        <span className="co-set-dropdown__tile-dot" aria-hidden="true" />
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>

        </div>,
        rslvPrtlTgt,
      )
      : null

  return (
    <div ref={(node) => {
      rootRef.current = node
      setRootLmnt(node)
    }} className={`co-set-dropdown${liquidTrigger ? ' liquid-select' : ''}${open ? ` is-open${liquidTrigger ? ' open' : ''}` : ''}${closing ? ' closing' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`${liquidTrigger ? 'liquid-select__trigger' : 'co-chip'} co-set-dropdown__trigger${triggerClass ? ` ${triggerClass}` : ''}`}
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
        ) : liquidTrigger ? (
          <>
            <span className={`liquid-select__value${selectedTotal === 0 ? ' liquid-select__value--placeholder' : ''}`}>{summaryLabel}</span>
            <span className="liquid-select__icon">
              <ChevronDown size={14} />
            </span>
          </>
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
