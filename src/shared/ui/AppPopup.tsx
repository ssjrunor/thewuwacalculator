/*
  Author: Runor Ewhro
  description: renders floating controls with dismissal, anchored placement, portals, and tokens.
*/

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  HTMLAttributes,
  Ref,
  ReactNode,
  RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useAnimatedVisibility } from '@/shared/hooks/useAnimatedVisibility'
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

interface PopupBox {
  left: number
  top: number
  width: number
  height: number
}

const POPUP_RESIZE_MS = 240

function readBox(surface: HTMLElement): PopupBox {
  const style = window.getComputedStyle(surface)
  return {
    left: Number.parseFloat(style.left) || 0,
    top: Number.parseFloat(style.top) || 0,
    width: Number.parseFloat(style.width) || 0,
    height: Number.parseFloat(style.height) || 0,
  }
}

function sameBox(a: PopupBox, b: PopupBox) {
  return Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5
    && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5
}

function boxFrame(box: PopupBox): Keyframe {
  return { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }
}

/** writes portal-relative placement before paint without storing transient geometry in react. */
// shared popup and modal scaling must use the same screen-to-layout ratio.
const PHONE_POPUP_SCALE = 1.3

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
  open,
  closing,
  style,
  children,
  ...surfaceProps
}: AnchoredAppPopupProps) {
  // callers that drive the popup with a plain boolean get the exit from here:
  // the surface stays mounted in its closing state until the out animation ends.
  const ownsExit = closing === undefined
  const [lingering, setLingering] = useState(false)
  const [prevVisible, setPrevVisible] = useState(visible)
  if (prevVisible !== visible) {
    setPrevVisible(visible)
    setLingering(ownsExit && !visible)
  }

  useEffect(() => {
    if (!lingering) return
    const timer = window.setTimeout(() => setLingering(false), APP_POPUP_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [lingering])

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const scopeRef = useRef<HTMLDivElement | null>(null)
  const boxRef = useRef<PopupBox | null>(null)
  const resizeRef = useRef<{ animation: Animation; from: PopupBox } | null>(null)
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

    // measure the natural box: lift any running resize first, keeping where it was.
    const running = resizeRef.current
    const inFlight = running ? readBox(surface) : null
    const elapsed = running?.animation.currentTime ?? null
    running?.animation.cancel()
    resizeRef.current = null
    delete surface.dataset.resizing

    // copy inherited custom properties across the portal boundary.
    syncAppPopupTokens(anchor, scope)

    const anchorRect = anchor.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const availableWidth = Math.max(0, viewportWidth - viewportPadding * 2)

    // geometry is measured in screen pixels while the portalled surface may be
    // scaled from its top-left. divide authored sizes by the scale but retain
    // positions; browser zoom produces inconsistent element measurements.
    const phone = document.documentElement.classList.contains('mui')
    const zoom = phone ? PHONE_POPUP_SCALE : 1
    const css = (px: number) => `${px / zoom}px`
    surface.style.scale = phone ? String(zoom) : ''
    surface.style.transformOrigin = phone ? '0 0' : ''

    // clear prior placement geometry before measuring authored minimum sizing.
    surface.style.width = ''
    surface.style.minWidth = ''
    surface.style.maxWidth = ''
    const authoredMinWidth = (Number.parseFloat(window.getComputedStyle(surface).minWidth) || 0) * zoom

    surface.style.position = 'fixed'
    surface.style.right = 'auto'
    surface.style.bottom = 'auto'
    surface.style.width = anchorWidth === 'exact'
      ? css(Math.min(anchorRect.width, availableWidth))
      : ''
    const anchoredMinWidth = anchorWidth === 'content' ? 0 : anchorRect.width
    const resolvedMinWidth = Math.max(minWidth, anchoredMinWidth, authoredMinWidth)
    surface.style.minWidth = resolvedMinWidth > 0
      ? css(Math.min(resolvedMinWidth, availableWidth))
      : ''
    surface.style.maxWidth = css(availableWidth)
    // scaled surfaces consume the unscaled width while retaining screen-space anchors.
    if (phone) {
      surface.style.width = css(availableWidth)
      surface.style.minWidth = ''
    }

    const spaceBelow = viewportHeight - anchorRect.bottom - viewportPadding - offset
    const spaceAbove = anchorRect.top - viewportPadding - offset
    const desiredHeight = Math.min(surface.scrollHeight * zoom, maxHeight)
    const flipThreshold = flipBelowHeight ?? desiredHeight
    const openUpward = preferredPlacement === 'up'
      || (preferredPlacement === 'auto' && spaceBelow < flipThreshold && spaceAbove > spaceBelow)
    const placement: AppPopupPlacement = openUpward ? 'up' : 'down'
    const availableHeight = Math.max(0, openUpward ? spaceAbove : spaceBelow)
    const resolvedMaxHeight = Math.max(
      Math.min(minHeight, availableHeight),
      Math.min(maxHeight, availableHeight),
    )

    surface.style.maxHeight = css(resolvedMaxHeight)

    // the layout box times the scale: a bounding rect would include the
    // entrance animation's in-flight transform and place it slightly off.
    const surfaceRect = { width: surface.offsetWidth * zoom, height: surface.offsetHeight * zoom }
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
    if (phone) {
      surface.style.removeProperty('--app-popup-origin')
    } else {
      const originX = Math.min(Math.max(anchorRect.left + anchorRect.width / 2 - left, 0), surfaceRect.width)
      surface.style.setProperty('--app-popup-origin', `${originX}px ${openUpward ? '100%' : '0'}`)
    }
    surface.dataset.placement = placement
    surface.dataset.positioned = 'true'
    surface.scrollTop = previousScrollTop
    surface.scrollLeft = previousScrollLeft

    const next = readBox(surface)
    const settled = boxRef.current
    boxRef.current = next
    if (!settled || document.documentElement.classList.contains('reduce-animation')) return

    // resume resize animation when placement dimensions stabilize.
    const resume = running && sameBox(settled, next)
    const from = resume ? running.from : inFlight ?? settled
    if (sameBox(from, next)) return

    const animation = surface.animate([boxFrame(from), boxFrame(next)], {
      duration: POPUP_RESIZE_MS,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    })
    if (resume && elapsed !== null) animation.currentTime = elapsed
    surface.dataset.resizing = 'true'
    resizeRef.current = { animation, from }
    animation.onfinish = () => {
      if (resizeRef.current?.animation !== animation) return
      resizeRef.current = null
      delete surface.dataset.resizing
    }
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

  // every commit: content swapped by a render is caught before it paints at the new size.
  useLayoutEffect(() => {
    if (visible) place()
    else boxRef.current = null
  })

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
    // skip resize animation frames; render commits still update placement.
      : new ResizeObserver(() => {
        if (!resizeRef.current) schedulePlace()
      })
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

  if ((!visible && !lingering) || !target) return null

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
        open={lingering ? false : open}
        closing={lingering || closing}
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
