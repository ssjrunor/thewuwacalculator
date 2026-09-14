/*
  Author: Runor Ewhro
  Description: Owns popup presence, dismissal, anchored placement, portal
               targeting, and the shared visual shell for menus, listboxes,
               hover cards, and tooltips.
*/

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import type {
  HTMLAttributes,
  Ref,
  ReactNode,
  RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useAnimatedVisibility } from '@/app/hooks/useAnimatedVisibility'
import { bodyPortal } from '@/shared/lib/portalTarget'

export const APP_POPUP_EXIT_MS = 180
export const APP_POPUP_VIEWPORT_PADDING = 20
export const APP_POPUP_OFFSET = 8

export type AppPopupPlacement = 'up' | 'right' | 'down' | 'left'

export interface AppPopupState {
  visible: boolean
  open: boolean
  closing: boolean
  show: () => void
  hide: (onHidden?: () => void) => void
  toggle: () => void
}

export function useAppPopup(exitMs = APP_POPUP_EXIT_MS): AppPopupState {
  const state = useAnimatedVisibility(exitMs)
  const toggle = useCallback(() => {
    if (state.visible) state.hide()
    else state.show()
  }, [state])

  return useMemo(() => ({ ...state, toggle }), [state, toggle])
}

export interface AppPopupSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  open?: boolean
  closing?: boolean
  placement?: AppPopupPlacement
}

function writeRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref) {
    ref.current = value
  }
}

export function syncAppPopupTokens(source: HTMLElement, target: HTMLElement) {
  for (const property of Array.from(target.style)) {
    if (property.startsWith('--')) target.style.removeProperty(property)
  }
  const sourceStyle = window.getComputedStyle(source)
  for (const property of Array.from(sourceStyle)) {
    if (!property.startsWith('--')) continue
    const value = sourceStyle.getPropertyValue(property)
    if (value) target.style.setProperty(property, value)
  }
}

interface AnchoredAppPopupProps extends AppPopupSurfaceProps {
  visible: boolean
  anchorRef: RefObject<HTMLElement | null>
  popupRef?: Ref<HTMLDivElement>
  portalTarget?: HTMLElement | null
  portalClassName?: string
  preferredPlacement?: 'auto' | 'down' | 'up'
  align?: 'start' | 'end'
  anchorWidth?: 'content' | 'minimum' | 'exact'
  minWidth?: number
  maxHeight?: number
  minHeight?: number
  offset?: number
  viewportPadding?: number
  flipBelowHeight?: number
}

/**
 * Portal-mounted popup anchored to a real DOM element. Placement is written
 * directly to the floating node before paint, keeping transient geometry out
 * of React state and making every consumer resilient to clipped ancestors.
 */
export function AnchoredAppPopup({
  visible,
  anchorRef,
  popupRef,
  portalTarget,
  portalClassName,
  preferredPlacement = 'auto',
  align = 'start',
  anchorWidth = 'content',
  minWidth = 0,
  maxHeight = 320,
  minHeight = 96,
  offset = APP_POPUP_OFFSET,
  viewportPadding = APP_POPUP_VIEWPORT_PADDING,
  flipBelowHeight,
  className,
  placement: placementProp,
  style,
  children,
  ...surfaceProps
}: AnchoredAppPopupProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const scopeRef = useRef<HTMLDivElement | null>(null)
  const target = portalTarget ?? bodyPortal()

  const setSurfaceNode = useCallback((node: HTMLDivElement | null) => {
    surfaceRef.current = node
    writeRef(popupRef, node)
  }, [popupRef])

  const place = useCallback(() => {
    const anchor = anchorRef.current
    const surface = surfaceRef.current
    const scope = scopeRef.current
    if (!anchor || !surface || !scope) return

    const previousScrollTop = surface.scrollTop
    const previousScrollLeft = surface.scrollLeft

    // A portal leaves the feature subtree, so bridge its inherited design
    // tokens onto a neutral wrapper. Popup-local class declarations still win
    // because they are declared on the child rather than this wrapper.
    syncAppPopupTokens(anchor, scope)

    const anchorRect = anchor.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const availableWidth = Math.max(0, viewportWidth - viewportPadding * 2)

    // Measure authored sizing without stale inline geometry from an earlier
    // placement pass. Feature CSS may require a wider floor than the anchor.
    surface.style.width = ''
    surface.style.minWidth = ''
    surface.style.maxWidth = ''
    const authoredMinWidth = Number.parseFloat(window.getComputedStyle(surface).minWidth) || 0

    surface.style.position = 'fixed'
    surface.style.right = 'auto'
    surface.style.bottom = 'auto'
    surface.style.width = anchorWidth === 'exact'
      ? `${Math.min(anchorRect.width, availableWidth)}px`
      : ''
    const anchoredMinWidth = anchorWidth === 'content' ? 0 : anchorRect.width
    const resolvedMinWidth = Math.max(minWidth, anchoredMinWidth, authoredMinWidth)
    surface.style.minWidth = resolvedMinWidth > 0
      ? `${Math.min(resolvedMinWidth, availableWidth)}px`
      : ''
    surface.style.maxWidth = `${availableWidth}px`

    const spaceBelow = viewportHeight - anchorRect.bottom - viewportPadding - offset
    const spaceAbove = anchorRect.top - viewportPadding - offset
    const desiredHeight = Math.min(surface.scrollHeight, maxHeight)
    const flipThreshold = flipBelowHeight ?? desiredHeight
    const openUpward = preferredPlacement === 'up'
      || (preferredPlacement === 'auto' && spaceBelow < flipThreshold && spaceAbove > spaceBelow)
    const placement: AppPopupPlacement = openUpward ? 'up' : 'down'
    const availableHeight = Math.max(0, openUpward ? spaceAbove : spaceBelow)
    const resolvedMaxHeight = Math.max(
      Math.min(minHeight, availableHeight),
      Math.min(maxHeight, availableHeight),
    )

    surface.style.maxHeight = `${resolvedMaxHeight}px`

    const surfaceRect = surface.getBoundingClientRect()
    const alignedLeft = align === 'end'
      ? anchorRect.right - surfaceRect.width
      : anchorRect.left
    const left = Math.min(
      Math.max(viewportPadding, alignedLeft),
      Math.max(viewportPadding, viewportWidth - viewportPadding - surfaceRect.width),
    )
    const naturalTop = openUpward
      ? anchorRect.top - offset - surfaceRect.height
      : anchorRect.bottom + offset
    const top = Math.min(
      Math.max(viewportPadding, naturalTop),
      Math.max(viewportPadding, viewportHeight - viewportPadding - surfaceRect.height),
    )

    surface.style.left = `${left}px`
    surface.style.top = `${top}px`
    surface.dataset.placement = placement
    surface.dataset.positioned = 'true'
    surface.scrollTop = previousScrollTop
    surface.scrollLeft = previousScrollLeft
  }, [
    align,
    anchorRef,
    flipBelowHeight,
    anchorWidth,
    maxHeight,
    minHeight,
    minWidth,
    offset,
    preferredPlacement,
    viewportPadding,
  ])

  useLayoutEffect(() => {
    if (visible) place()
  }, [place, visible])

  useEffect(() => {
    if (!visible) return

    let placementFrame = 0
    const schedulePlace = () => {
      window.cancelAnimationFrame(placementFrame)
      placementFrame = window.requestAnimationFrame(place)
    }
    const onScroll = (event: Event) => {
      const surface = surfaceRef.current
      if (surface && event.target instanceof Node && surface.contains(event.target)) return
      schedulePlace()
    }
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(schedulePlace)
    if (anchorRef.current) resizeObserver?.observe(anchorRef.current)
    if (surfaceRef.current) resizeObserver?.observe(surfaceRef.current)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', schedulePlace)

    return () => {
      window.cancelAnimationFrame(placementFrame)
      resizeObserver?.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', schedulePlace)
    }
  }, [anchorRef, place, visible])

  if (!visible || !target) return null

  return createPortal(
    <div
      ref={scopeRef}
      className={['app-popup-portal-scope', portalClassName].filter(Boolean).join(' ')}
    >
      <AppPopupSurface
        {...surfaceProps}
        ref={setSurfaceNode}
        className={['app-popup--anchored', className].filter(Boolean).join(' ')}
        placement={placementProp ?? (preferredPlacement === 'up' ? 'up' : 'down')}
        style={style}
      >
        {children}
      </AppPopupSurface>
    </div>,
    target,
  )
}

export const AppPopupSurface = forwardRef<HTMLDivElement, AppPopupSurfaceProps>(
  function AppPopupSurface({
    children,
    className,
    open,
    closing = false,
    placement = 'down',
    ...props
  }, ref) {
    const state = closing ? 'closing' : open === true ? 'open' : open === false ? 'closed' : undefined

    return (
      <div
        {...props}
        ref={ref}
        className={['app-popup', className].filter(Boolean).join(' ')}
        data-placement={placement}
        data-state={state}
      >
        {children}
      </div>
    )
  },
)

export function AppPopupHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['app-popup__header', className].filter(Boolean).join(' ')}>{children}</div>
}

export function AppPopupFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['app-popup__footer', className].filter(Boolean).join(' ')}>{children}</div>
}

export function AppPopupFill() {
  return <span className="app-popup__fill" aria-hidden="true" />
}

interface AppPopupDismissOptions {
  open: boolean
  onDismiss: () => void
  hostRef?: RefObject<HTMLElement | null>
  popupRef?: RefObject<HTMLElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
  pointerEvent?: 'pointerdown' | 'mousedown'
}

export function useAppPopupDismiss({
  open,
  onDismiss,
  hostRef,
  popupRef,
  returnFocusRef,
  pointerEvent = 'pointerdown',
}: AppPopupDismissOptions) {
  useEffect(() => {
    if (!open) return

    const onPointer = (event: PointerEvent | MouseEvent) => {
      const target = event.target as Node
      if (hostRef?.current?.contains(target) || popupRef?.current?.contains(target)) return
      onDismiss()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onDismiss()
      returnFocusRef?.current?.focus()
    }

    document.addEventListener(pointerEvent, onPointer as EventListener, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener(pointerEvent, onPointer as EventListener, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [hostRef, onDismiss, open, pointerEvent, popupRef, returnFocusRef])
}
