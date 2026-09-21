/*
  Author: Runor Ewhro
  Description: Maintains queued resonator selection and commits the chosen catalog entry to its owner.
*/

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  useResQStr,
  type SnapPosition,
} from '@/shared/util/resonatorQueueStore.ts'
import {GrDrag} from "react-icons/gr";
import {useAppStore} from "@/application/state";
import {withDefResMg} from "@/shared/lib/imageFallback.ts";
import {bodyPortal} from "@/shared/lib/portalTarget.ts";

const SNAP_MARGIN = 16

interface SafeArea {
  left: number
  top: number
  right: number
  bottom: number
}

// Keep the bubble inside the content aperture: the chrome head and the roster
// column own the edges, and a bubble parked over them reads as buried.
function getSafeArea(): SafeArea {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const rect = document.querySelector('.main-content')?.getBoundingClientRect()

  if (!rect || rect.width < 1 || rect.height < 1) {
    return { left: 0, top: 0, right: vw, bottom: vh }
  }

  return {
    left: Math.max(0, rect.left),
    top: Math.max(0, rect.top),
    right: Math.min(vw, rect.right),
    bottom: Math.min(vh, rect.bottom),
  }
}

function getSnapCrds(
  position: SnapPosition,
  area: SafeArea,
  bw: number,
  bh: number,
): { x: number; y: number } {
  const m = SNAP_MARGIN
  const left = area.left + m
  const right = Math.max(left, area.right - bw - m)
  const top = area.top + m
  const bottom = Math.max(top, area.bottom - bh - m)
  const cx = Math.max(left, Math.min(right, area.left + (area.right - area.left - bw) / 2))

  switch (position) {
    case 'top-left':
      return { x: left, y: top }
    case 'top-center':
      return { x: cx, y: top }
    case 'top-right':
      return { x: right, y: top }
    case 'bottom-left':
      return { x: left, y: bottom }
    case 'bottom-center':
      return { x: cx, y: bottom }
    case 'bottom-right':
      return { x: right, y: bottom }
  }
}

function resolveSnap(x: number, y: number, area: SafeArea, bw: number, bh: number): SnapPosition {
  const centerX = x + bw / 2
  const centerY = y + bh / 2
  const vertical = centerY < (area.top + area.bottom) / 2 ? 'top' : 'bottom'
  const third = (area.right - area.left) / 3
  const horizontal = centerX < area.left + third
    ? 'left'
    : centerX > area.left + third * 2 ? 'right' : 'center'
  return `${vertical}-${horizontal}` as SnapPosition
}

export function ResQBbbl() {
  const queue = useResQStr((s) => s.queue)
  const snapPosition = useResQStr((s) => s.snapPosition)
  const setSnapPstn = useResQStr((s) => s.setSnapPstn)
  const swtcToRes = useAppStore((s) => s.swRes)

  const bubbleRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const mounted = useRef(false)

  // The transition aperture is its own stacking context nested under the chrome
  // head and roster, so a fixed child of it stays buried however high it stacks.
  // Mount on the shell instead, where the theme tokens are declared too.
  const host = (typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('.app-shell')) ?? bodyPortal()

  // Compute snap on mount and when snap position changes
  useEffect(() => {
    if (dragging || queue.length === 0 || !host) return

    // Defer first calculation to next frame so bubble has rendered
    const id = requestAnimationFrame(() => {
      const el = bubbleRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const coords = getSnapCrds(snapPosition, getSafeArea(), rect.width, rect.height)
      setPos(coords)
      mounted.current = true
    })
    return () => cancelAnimationFrame(id)
  }, [snapPosition, dragging, queue.length, host])

  // Recalculate on resize
  useEffect(() => {
    if (queue.length === 0) return
    function handleResize() {
      const el = bubbleRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const snap = useResQStr.getState().snapPosition
      const coords = getSnapCrds(snap, getSafeArea(), rect.width, rect.height)
      setPos(coords)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [queue.length])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const el = bubbleRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()

    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
    setPos({ x: rect.left, y: rect.top })
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      const el = bubbleRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const area = getSafeArea()

      let nx = e.clientX - dragOffset.current.x
      let ny = e.clientY - dragOffset.current.y

      nx = Math.max(area.left, Math.min(nx, Math.max(area.left, area.right - rect.width)))
      ny = Math.max(area.top, Math.min(ny, Math.max(area.top, area.bottom - rect.height)))

      setPos({ x: nx, y: ny })
    },
    [dragging],
  )

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (!dragging) return
    setDragging(false)
    const el = bubbleRef.current
    if (!el || !pos) return
    const rect = el.getBoundingClientRect()
    const snap = resolveSnap(pos.x, pos.y, getSafeArea(), rect.width, rect.height)
    setSnapPstn(snap)
  }, [dragging, pos, setSnapPstn])

  if (queue.length === 0 || !host) return null

  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 900,
    left: pos?.x ?? undefined,
    top: pos?.y ?? undefined,
    // Before first measurement, park off-screen so it doesn't flash at 0,0
    ...(!pos ? { right: SNAP_MARGIN, bottom: SNAP_MARGIN, left: 'auto', top: 'auto' } : {}),
    transition: dragging
      ? 'opacity 180ms ease'
      : 'left 320ms cubic-bezier(0.22, 1, 0.36, 1), top 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease',
    touchAction: 'none',
  }

  return createPortal(
    <div ref={bubbleRef} className="resonator-queue-bubble" style={style}>
      <img
        src={queue[0].icon}
        alt={queue[0].name} className="resonator-queue-bubble__icon"
        draggable={false}
        onError={withDefResMg}
        onClick={() => swtcToRes(queue[0].id)}
        title={`Switch to ${queue[0].name}`}
      />
      <div className="resonator-queue-bubble__grip"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <GrDrag size="0.875rem" />
      </div>
      {queue.length > 1 && (
        <img
          src={queue[1].icon}
          alt={queue[1].name} className="resonator-queue-bubble__icon"
          draggable={false}
          onError={withDefResMg}
          onClick={() => swtcToRes(queue[1].id)}
          title={`Switch to ${queue[1].name}`}
        />
      )}
    </div>,
    host,
  )
}
