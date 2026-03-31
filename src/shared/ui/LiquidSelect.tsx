import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { createPortal } from 'react-dom'
import {useAppStore} from "@/domain/state/store.ts";

export type LiquidSelectValue = string | number

export interface LiquidSelectOption<T extends LiquidSelectValue = string> {
  value: T
  label: string
  icon?: string
}

export interface LiquidSelectOptionGroup<T extends LiquidSelectValue = string> {
  label: string
  options: LiquidSelectOption<T>[]
}

interface LiquidSelectProps<T extends LiquidSelectValue> {
  value: T
  options: LiquidSelectOption<T>[]
  groups?: LiquidSelectOptionGroup<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  baseClass?: string
  ariaLabel?: string
  ariaLabelledBy?: string
  portalTarget?: HTMLElement | null
  renderTriggerContent?: (selectedOption: LiquidSelectOption<T> | null, placeholder: string) => ReactNode
  triggerClassName?: string
  preferredPlacement?: 'auto' | 'down' | 'up'
}

const MENU_CLOSE_DURATION_MS = 180
const MENU_MAX_HEIGHT = 320
const MENU_MIN_HEIGHT = 96
const VIEWPORT_PADDING = 20
const MENU_OFFSET = 8
const OVERLAY_PORTAL_SELECTOR =
  '.app-modal-overlay, .picker-modal__overlay, .skills-modal-overlay, .skill-menu-overlay, .char-menu-overlay'

interface MenuLayout {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
}

export function LiquidSelect<T extends LiquidSelectValue>({
  value,
  options,
  groups,
  onChange,
  disabled = false,
  placeholder = 'Select an option',
  className,
  baseClass: baseClassProp,
  ariaLabel,
  ariaLabelledBy,
  portalTarget,
  renderTriggerContent,
  triggerClassName,
  preferredPlacement = 'auto',
}: LiquidSelectProps<T>) {
  const b = baseClassProp ?? 'liquid-select'
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const listboxId = useId()
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null)
  const resolvedOptions = useMemo(
    () => groups?.flatMap((group) => group.options) ?? options,
    [groups, options],
  )
  const selectedIndex = useMemo(
    () => resolvedOptions.findIndex((option) => Object.is(option.value, value)),
    [resolvedOptions, value],
  )
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [placement, setPlacement] = useState<'up' | 'down'>('down')
  const ui = useAppStore((state) => state.ui)

  const activeVariant = useMemo(() => {
    if (ui.theme === 'background') {
      return ui.backgroundVariant
    }

    return ui.theme === 'dark' ? ui.darkVariant : ui.lightVariant
  }, [ui.backgroundVariant, ui.darkVariant, ui.lightVariant, ui.theme])


  const [menuLayout, setMenuLayout] = useState<MenuLayout>({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: MENU_MAX_HEIGHT,
  })

  const selectedOption = selectedIndex >= 0 ? resolvedOptions[selectedIndex] : null
  const menuVisible = open || closing

  const resolvedPortalTarget =
    portalTarget ??
    (typeof document !== 'undefined'
      ? ((rootElement?.closest(OVERLAY_PORTAL_SELECTOR) as HTMLElement | null) ?? document.body)
      : null)

  const setRootNode = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node
    setRootElement(node)
  }, [])

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
    if (!rect) return

    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PADDING
    const spaceAbove = rect.top - VIEWPORT_PADDING
    const openUpward =
      preferredPlacement === 'up'
        ? true
        : preferredPlacement === 'down'
          ? false
          : spaceBelow < 220 && spaceAbove > spaceBelow
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
  }, [preferredPlacement])

  const scheduleMeasureMenu = useCallback(() => {
    clearMeasureFrame()
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measureMenu()
    })
  }, [clearMeasureFrame, measureMenu])

  const openMenu = useCallback(() => {
    if (disabled || resolvedOptions.length === 0) {
      return
    }

    clearCloseTimer()
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    measureMenu()
    setClosing(false)
    setOpen(true)
  }, [clearCloseTimer, disabled, measureMenu, resolvedOptions.length, selectedIndex])

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

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
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

  function commitSelection(option: LiquidSelectOption<T>) {
    onChange(option.value)
    closeMenu()
    triggerRef.current?.focus()
  }

  function moveActiveIndex(nextIndex: number) {
    if (resolvedOptions.length === 0) {
      return
    }

    const clampedIndex = Math.max(0, Math.min(resolvedOptions.length - 1, nextIndex))
    setActiveIndex(clampedIndex)
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || resolvedOptions.length === 0) {
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

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!resolvedOptions.length) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActiveIndex(activeIndex + 1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActiveIndex(activeIndex - 1)
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      moveActiveIndex(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      moveActiveIndex(resolvedOptions.length - 1)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = resolvedOptions[activeIndex]
      if (option) {
        commitSelection(option)
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

  const rootClassName = [b, open ? 'open' : '', closing ? 'closing' : '', `${b}--${placement}`, className ?? '']
    .filter(Boolean)
    .join(' ')

  const menu =
    menuVisible && resolvedPortalTarget
      ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            className={`${b} ${b}__menu ${b}__menu--${placement} app-shell ${activeVariant}`}
            role="listbox"
            aria-activedescendant={resolvedOptions[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
            tabIndex={-1}
            data-state={open ? 'open' : 'closed'}
            style={{
              left: `${menuLayout.left}px`,
              top: menuLayout.top !== undefined ? `${menuLayout.top}px` : undefined,
              bottom: menuLayout.bottom !== undefined ? `${menuLayout.bottom}px` : undefined,
              maxHeight: `${menuLayout.maxHeight}px`,
            }}
            onKeyDown={handleMenuKeyDown}
          >
            {(() => {
              const renderOption = (option: LiquidSelectOption<T>, index: number) => {
                const isSelected = Object.is(option.value, value)
                const isActive = index === activeIndex

                return (
                  <div
                    key={`${String(option.value)}-${index}`}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`${b}__option${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}`}
                    onClick={() => commitSelection(option)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className={`${b}__option-label`}>
                      {option.icon ? <img src={option.icon} alt="" className={`${b}__option-icon`} /> : null}
                      {option.label}
                    </span>
                    <span className={`${b}__option-check`} aria-hidden="true">
                      <Check size={14} />
                    </span>
                  </div>
                )
              }

              if (!groups || groups.length === 0) {
                return resolvedOptions.map((option, index) => renderOption(option, index))
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
          resolvedPortalTarget,
        )
      : null

  return (
    <div ref={setRootNode} className={rootClassName}>
      <button
        ref={triggerRef}
        type="button"
        className={[`${b}__trigger`, triggerClassName ?? ''].filter(Boolean).join(' ')}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={menuVisible ? listboxId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        onClick={() => {
          if (open) {
            closeMenu()
          } else {
            openMenu()
          }
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        {renderTriggerContent ? (
          renderTriggerContent(selectedOption, placeholder)
        ) : (
          <>
            <span className={selectedOption ? `${b}__value` : `${b}__value ${b}__value--placeholder`}>
              {selectedOption?.icon ? <img src={selectedOption.icon} alt="" className={`${b}__option-icon`} /> : null}
              {selectedOption?.label ?? placeholder}
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
