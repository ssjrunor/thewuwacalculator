/*
  Author: Runor Ewhro
  Description: Shared floating select control with portal-mounted options,
               keyboard navigation, and grouped option support.
*/

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as KeyboardEvent, ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {useAppStore} from "@/application/state";
import {withDefIconM} from "@/shared/lib/imageFallback.ts";
import {
  AnchoredAppPopup,
  useAppPopup,
  useAppPopupDismiss,
} from '@/shared/ui/AppPopup'

export type SelectValue = string | number

export interface SelectOption<T extends SelectValue = string> {
  value: T
  label: string
  icon?: string
}

export interface SelectGroup<T extends SelectValue = string> {
  label: string
  options: SelectOption<T>[]
}

interface LiquidSelectProps<T extends SelectValue> {
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
  renderTrigger?: (selPtn: SelectOption<T> | null, placeholder: string) => ReactNode
  renderOption?: (option: SelectOption<T>) => ReactNode
  triggerClass?: string
  motionIconGroup?: boolean
  placement?: 'auto' | 'down' | 'up'
}

export function LiquidSelect<T extends SelectValue>({
  value,
  options,
  groups,
  onChange,
  disabled = false,
  placeholder = 'Select an option',
  className,
  baseClass: baseClassProp,
  ariaLabel,
  ariaLabelBy: ariaLabelBy,
  portalTarget,
  renderTrigger: renderTriggerContent,
  renderOption: renderOptionContent,
  triggerClass: triggerClass,
  motionIconGroup = false,
  placement: preferredPlacement = 'auto',
}: LiquidSelectProps<T>) {
  const b = baseClassProp ?? 'liquid-select'
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const shouldScrollActiveRef = useRef(false)
  const listboxId = useId()
  const rslvPtns = useMemo(
    () => groups?.flatMap((group) => group.options) ?? options,
    [groups, options],
  )
  const selNdx = useMemo(
    () => rslvPtns.findIndex((option) => Object.is(option.value, value)),
    [rslvPtns, value],
  )
  const [activeIndex, setActNdx] = useState(selNdx >= 0 ? selNdx : 0)
  const popup = useAppPopup()
  const { open, closing, visible: menuVisible } = popup
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

  const selPtn = selNdx >= 0 ? rslvPtns[selNdx] : null

  const setRootNode = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node
  }, [])

  const openMenu = useCallback(() => {
    if (disabled || rslvPtns.length === 0) {
      return
    }

    shouldScrollActiveRef.current = true
    setActNdx(selNdx >= 0 ? selNdx : 0)
    popup.show()
  }, [disabled, popup, rslvPtns.length, selNdx])

  const closeMenu = useCallback(() => {
    popup.hide()
  }, [popup])

  useEffect(() => {
    if (!open) {
      return
    }

    menuRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open || !shouldScrollActiveRef.current) {
      return
    }

    shouldScrollActiveRef.current = false
    const activeOption = document.getElementById(`${listboxId}-option-${activeIndex}`)
    if (activeOption instanceof HTMLElement) {
      activeOption.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex, listboxId, open])

  useAppPopupDismiss({
    open,
    onDismiss: closeMenu,
    hostRef: rootRef,
    popupRef: menuRef,
    returnFocusRef: triggerRef,
  })

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
    shouldScrollActiveRef.current = true
    setActNdx(clampedIndex)
  }

  function onTrggKeyDow(event: KeyboardEvent<HTMLButtonElement>) {
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

  function onMenuKeyDow(event: KeyboardEvent<HTMLDivElement>) {
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

  const rootClssName = [b, open ? 'open' : '', closing ? 'closing' : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  const menu = (
          <AnchoredAppPopup
            visible={menuVisible}
            anchorRef={triggerRef}
            popupRef={menuRef}
            portalTarget={portalTarget}
            portalClassName={className}
            preferredPlacement={preferredPlacement}
            anchorWidth="minimum"
            id={listboxId}
            className={`${b} ${b}__menu ${actVar} ${actTextModeC}${ui.blurMode ? ' blur-off' : ''}`}
            open={open}
            closing={closing}
            role="listbox"
            aria-activedescendant={rslvPtns[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
            tabIndex={-1}
            onKeyDown={onMenuKeyDow}
          >
            {(() => {
              const renderItem = (option: SelectOption<T>, index: number) => {
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
                    onMouseEnter={() => {
                      shouldScrollActiveRef.current = false
                      setActNdx(index)
                    }}
                  >
                    <span className={`${b}__option-label`}>
                      {renderOptionContent ? (
                        renderOptionContent(option)
                      ) : (
                        <>
                          {option.icon ? <img src={option.icon} alt="" className={`${b}__option-icon`} onError={withDefIconM} /> : null}
                          <span className={`${b}__option-text`}>{option.label}</span>
                        </>
                      )}
                    </span>
                    <span className={`${b}__option-check`} aria-hidden="true">
                      <Check size="0.875rem" />
                    </span>
                  </div>
                )
              }

              if (!groups || groups.length === 0) {
                return rslvPtns.map((option, index) => renderItem(option, index))
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
                        {group.options.map((option, index) => renderItem(option, startIndex + index))}
                      </div>
                    </div>
                  )
                })
            })()}
          </AnchoredAppPopup>
  )

  return (
    <div ref={setRootNode} className={rootClssName}>
      <button
        ref={triggerRef}
        type="button"
        className={[`${b}__trigger`, triggerClass ?? ''].filter(Boolean).join(' ')}
        data-motion-icon-group={motionIconGroup ? '' : undefined}
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
        {renderTriggerContent ? (
          renderTriggerContent(selPtn, placeholder)
        ) : (
          <>
            <span className={selPtn ? `${b}__value` : `${b}__value ${b}__value--placeholder`}>
              {selPtn?.icon ? <img src={selPtn.icon} alt="" className={`${b}__option-icon`} onError={withDefIconM} /> : null}
              <span className={`${b}__value-text`}>{selPtn?.label ?? placeholder}</span>
            </span>
            <span className={`${b}__icon`} aria-hidden="true">
              <ChevronDown size="1rem" />
            </span>
          </>
        )}
      </button>
      {menu}
    </div>
  )
}
