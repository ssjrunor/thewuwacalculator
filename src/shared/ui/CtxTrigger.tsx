/*
  Author: Runor Ewhro
  Description: Attaches context-menu open behavior to arbitrary children,
               including right-click and long-press support.
*/

import {
  Children,
  cloneElement,
  isValidElement as isVldElem,
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as RctMsVnt,
  type PointerEvent as RctPntrVnt,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { MenuEntry, CtxOpenEvent } from '@/shared/ui/CtxMenu.tsx'
import { useAppCtxMen } from '@/shared/ui/AppContextMenu'
import { isDtblVntTgt } from '@/shared/lib/isEditableEventTarget'

const TOUCH_HOLD_MS = 3000
const TOUCH_MOVE_MAX = 12
const TOUCH_HOLD_CLS = 'context-menu-touch-hold-active'

interface SyntCtxTrggV extends CtxOpenEvent {
  curTgt: EventTarget | null
  defaultPrevented: boolean
}

type CtxTrggVnt = RctMsVnt<HTMLElement> | SyntCtxTrggV

interface CtxTrggPrps {
  ariaLabel: string
  items?: MenuEntry[]
  getItems?: (event: CtxTrggVnt) => MenuEntry[]
  width?: number
  disabled?: boolean
  llwDtblTgt?: boolean
  asChild?: boolean
  children: ReactNode
}

type CtxTrggChldP = {
  onContextMenu?: (event: CtxTrggVnt) => void
  onPointerDown?: (event: RctPntrVnt<HTMLElement>) => void
  onPointerMove?: (event: RctPntrVnt<HTMLElement>) => void
  onPointerUp?: (event: RctPntrVnt<HTMLElement>) => void
  onPointerCancel?: (event: RctPntrVnt<HTMLElement>) => void
  onPointerLeave?: (event: RctPntrVnt<HTMLElement>) => void
  onClickCapture?: (event: RctMsVnt<HTMLElement>) => void
}

function resolveItems(
  event: CtxTrggVnt,
  items?: MenuEntry[],
  getItems?: (event: CtxTrggVnt) => MenuEntry[],
): MenuEntry[] {
  if (typeof getItems === 'function') {
    return getItems(event)
  }

  return items ?? []
}

// centralizes right-click wiring so feature features only supply menu content.
export function ContextTrigger({
  ariaLabel,
  items,
  getItems,
  width,
  disabled = false,
  llwDtblTgt: llwDtblTrgt = false,
  asChild = false,
  children,
}: CtxTrggPrps) {
  const contextMenu = useAppCtxMen()
  const tchHoldTmrRe = useRef<number | null>(null)
  const touchHoldRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startTime: number
    event: SyntCtxTrggV
    opened: boolean
  } | null>(null)
  const spprNextClck = useRef(false)
  const gnrNextCtxMe = useRef(false)

  const dsblTchHoldS = () => {
    document.body.classList.add(TOUCH_HOLD_CLS)
  }

  const nblTchHoldSe = () => {
    document.body.classList.remove(TOUCH_HOLD_CLS)
  }

  const clrTchHold = useCallback(() => {
    if (tchHoldTmrRe.current !== null) {
      window.clearTimeout(tchHoldTmrRe.current)
      tchHoldTmrRe.current = null
    }
    touchHoldRef.current = null
    nblTchHoldSe()
  }, [])

  useEffect(() => clrTchHold, [clrTchHold])

  const mkSyntVnt = (
    target: EventTarget | null,
    curTgt: EventTarget | null,
    clientX: number,
    clientY: number,
  ): SyntCtxTrggV => {
    const syntVnt: SyntCtxTrggV = {
      clientX,
      clientY,
      target,
      curTgt: curTgt,
      defaultPrevented: false,
      preventDefault: () => {
        syntVnt.defaultPrevented = true
      },
      stopPropagation: () => {},
    }

    return syntVnt
  }

  const openRslvCtxM = (event: CtxTrggVnt) => {
    if (disabled) {
      return false
    }

    if (!llwDtblTrgt && isDtblVntTgt(event.target)) {
      return false
    }

    const resolveTimers = resolveItems(event, items, getItems)
    if (resolveTimers.length === 0 && !contextMenu.hasGlblTms) {
      return false
    }

    return contextMenu.open(event, {
      ariaLabel,
      items: resolveTimers,
      width,
    })
  }

  const openTchHoldC = () => {
    const touchHold = touchHoldRef.current
    if (!touchHold || touchHold.opened) {
      return false
    }

    const opened = openRslvCtxM(touchHold.event)
    if (opened) {
      touchHold.opened = true
      spprNextClck.current = true
      gnrNextCtxMe.current = true
    }

    return opened
  }

  const onCtxMenu = (event: CtxTrggVnt) => {
    clrTchHold()

    if (gnrNextCtxMe.current) {
      gnrNextCtxMe.current = false
      event.preventDefault()
      event.stopPropagation()
      return
    }

    openRslvCtxM(event)
  }

  const onPntrDown = (event: RctPntrVnt<HTMLElement>) => {
    clrTchHold()

    if (event.pointerType !== 'touch' || disabled) {
      return
    }

    if (!llwDtblTrgt && isDtblVntTgt(event.target)) {
      return
    }

    touchHoldRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: window.performance.now(),
      event: mkSyntVnt(
        event.target,
        event.currentTarget,
        event.clientX,
        event.clientY,
      ),
      opened: false,
    }
    dsblTchHoldS()

    tchHoldTmrRe.current = window.setTimeout(() => {
      openTchHoldC()
    }, TOUCH_HOLD_MS)
  }

  const onPntrMove = (event: RctPntrVnt<HTMLElement>) => {
    const touchHold = touchHoldRef.current
    if (!touchHold || touchHold.pointerId !== event.pointerId) {
      return
    }

    const deltaX = Math.abs(event.clientX - touchHold.startX)
    const deltaY = Math.abs(event.clientY - touchHold.startY)
    if (deltaX > TOUCH_MOVE_MAX || deltaY > TOUCH_MOVE_MAX) {
      clrTchHold()
    }
  }

  const onPntrEnd = (event: RctPntrVnt<HTMLElement>) => {
    const touchHold = touchHoldRef.current
    if (!touchHold || touchHold.pointerId !== event.pointerId) {
      return
    }

    const elapsedMs = window.performance.now() - touchHold.startTime
    if (elapsedMs >= TOUCH_HOLD_MS) {
      event.preventDefault()
      openTchHoldC()
    }

    clrTchHold()
  }

  const onClckCptr = (event: RctMsVnt<HTMLElement>) => {
    if (!spprNextClck.current) {
      return
    }

    spprNextClck.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  if (asChild) {
    const child = Children.only(children)
    if (!isVldElem(child)) {
      throw new Error('ContextTrigger with asChild expects a single React element child')
    }

    const childElement = child as ReactElement<CtxTrggChldP>
    const chldOnCtxMen = childElement.props.onContextMenu
    const chldOnPntrDo = childElement.props.onPointerDown
    const chldOnPntrMo = childElement.props.onPointerMove
    const chldOnPntrUp = childElement.props.onPointerUp
    const chldOnPntrCn = childElement.props.onPointerCancel
    const chldOnPntrLv = childElement.props.onPointerLeave
    const chldOnClckCp = childElement.props.onClickCapture

    const hndlCtxMen = (event: CtxTrggVnt) => {
      chldOnCtxMen?.(event)
      if (event.defaultPrevented) {
        return
      }

      onCtxMenu(event)
    }
    const hndlPntrDo = (event: RctPntrVnt<HTMLElement>) => {
      chldOnPntrDo?.(event)
      if (event.defaultPrevented) {
        return
      }

      onPntrDown(event)
    }
    const hndlPntrMo = (event: RctPntrVnt<HTMLElement>) => {
      chldOnPntrMo?.(event)
      if (event.defaultPrevented) {
        return
      }

      onPntrMove(event)
    }
    const hndlPntrUp = (event: RctPntrVnt<HTMLElement>) => {
      chldOnPntrUp?.(event)
      onPntrEnd(event)
    }
    const hndlPntrCn = (event: RctPntrVnt<HTMLElement>) => {
      chldOnPntrCn?.(event)
      onPntrEnd(event)
    }
    const hndlPntrLv = (event: RctPntrVnt<HTMLElement>) => {
      chldOnPntrLv?.(event)
      onPntrEnd(event)
    }
    const hndlClckCp = (event: RctMsVnt<HTMLElement>) => {
      chldOnClckCp?.(event)
      if (event.defaultPrevented) {
        return
      }

      onClckCptr(event)
    }
    const injectedProps: Partial<CtxTrggChldP> = {
      onContextMenu: hndlCtxMen,
      onPointerDown: hndlPntrDo,
      onPointerMove: hndlPntrMo,
      onPointerUp: hndlPntrUp,
      onPointerCancel: hndlPntrCn,
      onPointerLeave: hndlPntrLv,
      onClickCapture: hndlClckCp,
    }

    // cloneelement receives event handlers, not values read for rendering; the
    // handlers are allowed to touch refs later when the browser fires events.
    // eslint-disable-next-line react-hooks/refs
    return cloneElement(childElement, injectedProps)
  }

  return (
    <div
      onContextMenu={onCtxMenu}
      onPointerDown={onPntrDown}
      onPointerMove={onPntrMove}
      onPointerUp={onPntrEnd}
      onPointerCancel={onPntrEnd}
      onPointerLeave={onPntrEnd}
      onClickCapture={onClckCptr}
    >
      {children}
    </div>
  )
}
