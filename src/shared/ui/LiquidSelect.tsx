/*
  Author: Runor Ewhro
  Description: Shared floating select control with portal-mounted options,
               keyboard navigation, and grouped option support.
*/

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as KybrVnt, ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { createPortal } from 'react-dom'
import {useAppStore} from "@/domain/state/store.ts";
import {withDefIconM} from "@/shared/lib/imageFallback.ts";

export type LqdSelVl = string | number

export interface SelectOption<T extends LqdSelVl = string> {
  value: T
  label: string
  icon?: string
}

export interface SelectGroup<T extends LqdSelVl = string> {
  label: string
  options: SelectOption<T>[]
}

interface LqdSelPrps<T extends LqdSelVl> {
  value: T
  options: SelectOption<T>[]
  groups?: SelectGroup<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  baseClass?: string
  ariaLabel?: string
  ariaLabelBy?: string
  portalTarget?: HTMLElement | null
  viewTrggCntn?: (selPtn: SelectOption<T> | null, placeholder: string) => ReactNode
  triggerClass?: string
  prfrPlcm?: 'auto' | 'down' | 'up'
}

const MENUCLSDURMS = 180
const MENUMAXHGHT = 320
const MENUMINHGHT = 96
const VWPR_PDDN = 20
const MENU_OFFSET = 8
const VRLYPRTLSLCT =
  '.app-modal-overlay, .char-menu-overlay'

interface MenuLayout {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
}

export function LiquidSelect<T extends LqdSelVl>({
  value,
  options,
  groups,
  onChange,
  disabled = false,
  placeholder = 'Select an option',
  className,
  baseClass: baseClssProp,
  ariaLabel,
  ariaLabelBy: ariaLabelBy,
  portalTarget,
  viewTrggCntn: rndrTrggCntn,
  triggerClass: triggerClass,
  prfrPlcm: prfrPlcm = 'auto',
}: LqdSelPrps<T>) {
  const b = baseClssProp ?? 'liquid-select'
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const clsTmrRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const listboxId = useId()
  const [rootElement, setRootLmnt] = useState<HTMLDivElement | null>(null)
  const rslvPtns = useMemo(
    () => groups?.flatMap((group) => group.options) ?? options,
    [groups, options],
  )
  const selNdx = useMemo(
    () => rslvPtns.findIndex((option) => Object.is(option.value, value)),
    [rslvPtns, value],
  )
  const [activeIndex, setActNdx] = useState(selNdx >= 0 ? selNdx : 0)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [placement, setPlacement] = useState<'up' | 'down'>('down')
  const ui = useAppStore((state) => state.ui)

  const actVar = useMemo(() => {
    // use persisted theme state to choose the select menu's contrast class
    // without querying computed styles from the portal-mounted menu.
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


  const [menuLayout, setMenuLyt] = useState<MenuLayout>({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: MENUMAXHGHT,
  })

  const selPtn = selNdx >= 0 ? rslvPtns[selNdx] : null
  const menuVisible = open || closing

  const rslvPrtlTgt =
    portalTarget ??
    (typeof document !== 'undefined'
      ? ((rootElement?.closest(VRLYPRTLSLCT) as HTMLElement | null) ?? document.body)
      : null)

  const setRootNode = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node
    setRootLmnt(node)
  }, [])

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
    if (!rect) return

    // measure after the menu exists so placement can flip above the trigger
    // when the lower viewport edge has less room than the upper edge.
    const spaceBelow = window.innerHeight - rect.bottom - VWPR_PDDN
    const spaceAbove = rect.top - VWPR_PDDN
    const openUpward =
      prfrPlcm === 'up'
        ? true
        : prfrPlcm === 'down'
          ? false
          : spaceBelow < 220 && spaceAbove > spaceBelow
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
  }, [prfrPlcm])

  const schdMsrMenu = useCallback(() => {
    clearMeasure()
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measureMenu()
    })
  }, [clearMeasure, measureMenu])

  const openMenu = useCallback(() => {
    if (disabled || rslvPtns.length === 0) {
      return
    }

    clrClsTmr()
    setActNdx(selNdx >= 0 ? selNdx : 0)
    measureMenu()
    setClosing(false)
    setOpen(true)
  }, [clrClsTmr, disabled, measureMenu, rslvPtns.length, selNdx])

  const closeMenu = useCallback(() => {
    if (!open && !closing) {
      return
    }

    clrClsTmr()
    setOpen(false)
    setClosing(true)
    clsTmrRef.current = window.setTimeout(() => {
      setClosing(false)
      clsTmrRef.current = null
    }, MENUCLSDURMS)
  }, [clrClsTmr, closing, open])

  useEffect(() => {
    return () => {
      if (clsTmrRef.current !== null) {
        window.clearTimeout(clsTmrRef.current)
      }
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
      }
    }
  }, [])

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

    const activeOption = document.getElementById(`${listboxId}-option-${activeIndex}`)
    if (activeOption instanceof HTMLElement) {
      activeOption.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex, listboxId, open])

  useEffect(() => {
    if (!open) {
      return
    }

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

  function cmmtSel(option: SelectOption<T>) {
    // selection always closes through the same path so pointer and keyboard
    // commits leave focus and closing state consistent.
    onChange(option.value)
    closeMenu()
    triggerRef.current?.focus()
  }

  function moveActNdx(nextIndex: number) {
    if (rslvPtns.length === 0) {
      return
    }

    const clampedIndex = Math.max(0, Math.min(rslvPtns.length - 1, nextIndex))
    setActNdx(clampedIndex)
  }

  function onTrggKeyDow(event: KybrVnt<HTMLButtonElement>) {
    if (disabled || rslvPtns.length === 0) {
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu()
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) {
        closeMenu()
      } else {
        openMenu()
      }
    }
  }

  function onMenuKeyDow(event: KybrVnt<HTMLDivElement>) {
    if (!rslvPtns.length) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActNdx(activeIndex + 1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActNdx(activeIndex - 1)
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      moveActNdx(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      moveActNdx(rslvPtns.length - 1)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = rslvPtns[activeIndex]
      if (option) {
        cmmtSel(option)
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      triggerRef.current?.focus()
      return
    }

    if (event.key === 'Tab') {
      closeMenu()
    }
  }

  const rootClssName = [b, open ? 'open' : '', closing ? 'closing' : '', `${b}--${placement}`, className ?? '']
    .filter(Boolean)
    .join(' ')

  const menu =
    menuVisible && rslvPrtlTgt
      ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            className={`${b} ${b}__menu ${b}__menu--${placement} ${actVar} ${actTextModeC}${ui.blurMode ? ' blur-off' : ''}`}
            role="listbox"
            aria-activedescendant={rslvPtns[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
            tabIndex={-1}
            data-state={open ? 'open' : 'closed'}
            style={{
              left: `${menuLayout.left}px`,
              top: menuLayout.top !== undefined ? `${menuLayout.top}px` : undefined,
              bottom: menuLayout.bottom !== undefined ? `${menuLayout.bottom}px` : undefined,
              maxHeight: `${menuLayout.maxHeight}px`,
            }}
            onKeyDown={onMenuKeyDow}
          >
            {(() => {
              const renderOption = (option: SelectOption<T>, index: number) => {
                const isSelected = Object.is(option.value, value)
                const isActive = index === activeIndex

                return (
                  <div
                    key={`${String(option.value)}-${index}`}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`${b}__option${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}`}
                    onClick={() => cmmtSel(option)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActNdx(index)}
                  >
                    <span className={`${b}__option-label`}>
                      {option.icon ? <img src={option.icon} alt="" className={`${b}__option-icon`} onError={withDefIconM} /> : null}
                      {option.label}
                    </span>
                    <span className={`${b}__option-check`} aria-hidden="true">
                      <Check size={14} />
                    </span>
                  </div>
                )
              }

              if (!groups || groups.length === 0) {
                return rslvPtns.map((option, index) => renderOption(option, index))
              }

              let optionOffset = 0
              return groups
                .filter((group) => group.options.length > 0)
                .map((group) => {
                  const startIndex = optionOffset
                  optionOffset += group.options.length

                  return (
                    <div key={group.label} className={`${b}__group`}>
                      <div className={`${b}__group-label`} aria-hidden="true">
                        {group.label}
                      </div>
                      <div className={`${b}__group-options`}>
                        {group.options.map((option, index) => renderOption(option, startIndex + index))}
                      </div>
                    </div>
                  )
                })
            })()}
          </div>,
          rslvPrtlTgt,
        )
      : null

  return (
    <div ref={setRootNode} className={rootClssName}>
      <button
        ref={triggerRef}
        type="button"
        className={[`${b}__trigger`, triggerClass ?? ''].filter(Boolean).join(' ')}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={menuVisible ? listboxId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelBy}
        disabled={disabled}
        onClick={() => {
          if (open) {
            closeMenu()
          } else {
            openMenu()
          }
        }}
        onKeyDown={onTrggKeyDow}
      >
        {rndrTrggCntn ? (
          rndrTrggCntn(selPtn, placeholder)
        ) : (
          <>
            <span className={selPtn ? `${b}__value` : `${b}__value ${b}__value--placeholder`}>
              {selPtn?.icon ? <img src={selPtn.icon} alt="" className={`${b}__option-icon`} onError={withDefIconM} /> : null}
              {selPtn?.label ?? placeholder}
            </span>
            <span className={`${b}__icon`} aria-hidden="true">
              <ChevronDown size={16} />
            </span>
          </>
        )}
      </button>
      {menu}
    </div>
  )
}
