/*
  Author: Runor Ewhro
  Description: Shared radix-tooltip wrapper with app-level defaults for delay,
               placement, and close timing.
*/

import React from 'react'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import type {
  CSSProperties,
  FocusEvent as RctFcsVnt,
  MouseEvent as RctMsVnt,
  ReactNode,
} from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { bodyPortal, mainPortal } from '@/shared/lib/portalTarget'
import {
  AppPopupSurface,
  syncAppPopupTokens,
  useAppPopup,
} from '@/shared/ui/AppPopup'

export interface TooltipProps {
  children: ReactNode
  content: ReactNode
  placement?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
  triggerStyle?: CSSProperties
  delay?: number
}

export function AppTltpProv({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={140} skipDelayDuration={120} disableHoverableContent>
      {children}
    </RadixTooltip.Provider>
  )
}

export const Tooltip: React.FC<TooltipProps> = ({
  children,
  content,
  placement = 'top',
  className = '',
  triggerStyle,
  delay = 200,
}) => {
  const popup = useAppPopup()
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const scopeRef = useRef<HTMLDivElement | null>(null)
  const changeOpen = (nextOpen: boolean) => nextOpen ? popup.show() : popup.hide()
  const popupPlacement = placement === 'top' ? 'up' : placement === 'bottom' ? 'down' : placement

  useLayoutEffect(() => {
    if (popup.visible && triggerRef.current && scopeRef.current) {
      syncAppPopupTokens(triggerRef.current, scopeRef.current)
    }
  })

  return (
    <RadixTooltip.Root
      open={popup.open}
      onOpenChange={changeOpen}
      delayDuration={delay}
      disableHoverableContent
    >
      <RadixTooltip.Trigger asChild>
        <span ref={triggerRef} className={`tooltip-trigger ${className}`.trim()} style={{ display: 'inline-flex', ...triggerStyle }}>
          {children}
        </span>
      </RadixTooltip.Trigger>
      {/*
        forceMount belongs on the portal as well as the content: radix gates the
        portal on `open` alone, so without it the subtree is torn out the instant
        the tooltip closes and the exit animation never paints. The popup's own
        visibility gate below still unmounts once the exit has finished.
      */}
      {popup.visible ? (
        <RadixTooltip.Portal forceMount>
          <RadixTooltip.Content
            ref={scopeRef}
            forceMount
            side={placement}
            sideOffset={8}
            collisionPadding={12} className="app-tooltip-container"
            style={{ zIndex: 99999 }}
          >
            <AppPopupSurface className="app-tooltip-content"
              open={popup.open}
              closing={popup.closing}
              placement={popupPlacement}
            >
              {content}
            </AppPopupSurface>
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      ) : null}
    </RadixTooltip.Root>
  )
}

const HC_CRSR_OFFSET_X = 18
const HC_CRSR_OFFSET_Y = 20
const HC_VWPRT_PAD = 12
const HC_EXIT_MS = 200

export interface HoverCardProps {
  // The trigger remains mounted permanently; hover/focus handlers are attached
  // to the wrapper instead of mutating the child.
  children: ReactNode
  // A function defers expensive catalog lookup/formatting until the first
  // visible frame instead of paying it during the parent render.
  content: ReactNode | (() => ReactNode)
  // Disabled instances skip portal and pointer work while preserving trigger layout.
  disabled?: boolean
  label?: string
  // Class hooks are split so caller skins can target trigger, portal root, and
  // measured card independently of the shared placement mechanics.
  triggerClassName?: string
  rootClassName?: string
  cardClassName?: string
  offsetX?: number
  offsetY?: number
  exitMs?: number
}

// The card is lazily mounted, placed from the latest pointer position, and
// clamped/flipped inside the viewport; callers provide only trigger/content and
// optional classes.
export function HoverCard({
  children,
  content,
  disabled = false,
  label,
  triggerClassName,
  rootClassName,
  cardClassName,
  offsetX = HC_CRSR_OFFSET_X,
  offsetY = HC_CRSR_OFFSET_Y,
  exitMs = HC_EXIT_MS,
}: HoverCardProps) {
  const visibility = useAppPopup(exitMs)
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)

  /*
    the shell, not the body: the theme's tokens are declared on `.app-shell`, so
    a card portalled outside it paints its highlights from whatever :root
    happens to hold rather than from the theme the page is wearing.
  */
  const portalTarget = mainPortal() ?? bodyPortal()

  const applyPlacement = useCallback((clientX: number, clientY: number) => {
    const root = rootRef.current
    const card = cardRef.current
    if (!root || !card) return

    const width = card.offsetWidth
    const height = card.offsetHeight

    // Default below-right of the cursor, then flip toward whichever side keeps
    // the whole card inside the viewport.
    let x = clientX + offsetX
    let y = clientY + offsetY

    if (x + width + HC_VWPRT_PAD > window.innerWidth) {
      x = clientX - width - offsetX
    }
    if (y + height + HC_VWPRT_PAD > window.innerHeight) {
      y = clientY - height - offsetY
    }

    x = Math.min(Math.max(HC_VWPRT_PAD, x), window.innerWidth - width - HC_VWPRT_PAD)
    y = Math.min(Math.max(HC_VWPRT_PAD, y), window.innerHeight - height - HC_VWPRT_PAD)

    root.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }, [offsetX, offsetY])

  const schedulePlacement = useCallback(() => {
    if (frameRef.current !== null) return
    // Mousemove can fire faster than layout can settle; one rAF keeps placement
    // measurements current without forcing sync work on every pointer event.
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      const pointer = pointerRef.current
      if (pointer) applyPlacement(pointer.x, pointer.y)
    })
  }, [applyPlacement])

  const clearFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const onEnter = useCallback((event: RctMsVnt<HTMLSpanElement>) => {
    if (disabled) return
    pointerRef.current = { x: event.clientX, y: event.clientY }
    visibility.show()
  }, [disabled, visibility])

  const onMove = useCallback((event: RctMsVnt<HTMLSpanElement>) => {
    if (!visibility.visible) return
    pointerRef.current = { x: event.clientX, y: event.clientY }
    schedulePlacement()
  }, [schedulePlacement, visibility.visible])

  const onLeave = useCallback(() => {
    visibility.hide()
  }, [visibility])

  const onFocus = useCallback((event: RctFcsVnt<HTMLSpanElement>) => {
    if (disabled) return
    const rect = event.currentTarget.getBoundingClientRect()
    pointerRef.current = { x: rect.left, y: rect.bottom }
    visibility.show()
  }, [disabled, visibility])

  useLayoutEffect(() => {
    if (!visibility.visible) return
    if (triggerRef.current && rootRef.current) {
      syncAppPopupTokens(triggerRef.current, rootRef.current)
    }
    const pointer = pointerRef.current
    if (pointer) applyPlacement(pointer.x, pointer.y)
  }, [applyPlacement, visibility.visible])

  useEffect(() => clearFrame, [clearFrame])

  return (
    <>
      <span
        ref={triggerRef}
        className={triggerClassName ? `hover-card__trigger ${triggerClassName}` : 'hover-card__trigger'}
        aria-label={label}
        tabIndex={disabled ? undefined : 0}
        onMouseEnter={onEnter}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onFocus={onFocus}
        onBlur={onLeave}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onLeave()
        }}
      >
        {children}
      </span>

      {visibility.visible && portalTarget
        ? createPortal(
            <div
              ref={rootRef}
              className={rootClassName ? `hover-card ${rootClassName}` : 'hover-card'}
              role="presentation"
            >
              <AppPopupSurface
                ref={cardRef}
                className={cardClassName}
                open={visibility.open}
                closing={visibility.closing}
              >
                {typeof content === 'function' ? content() : content}
              </AppPopupSurface>
            </div>,
            portalTarget,
          )
        : null}
    </>
  )
}

interface DmgTltpPrps {
  label: string
  metric: 'normal' | 'crit' | 'avg'
  formula?: string
}

export const DmgTltp: React.FC<DmgTltpPrps> = ({ label, metric, formula }) => {
  return (
    <div className="trace-node-tooltip damage-tooltip-wrapper">
      <div className="tooltip-header">
        <div className="tooltip-title">{label}</div>
      </div>

      {formula && (
        <div className="tooltip-section">
          <code className="formula-code">{`out.${metric} = ${formula}`}</code>
        </div>
      )}
    </div>
  )
}
