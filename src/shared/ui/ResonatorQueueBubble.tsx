import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  useResonatorQueueStore,
  type SnapPosition,
} from '@/shared/util/resonatorQueueStore.ts'
import {GrDrag} from "react-icons/gr";
import {useAppStore} from "@/domain/state/store.ts";

const SNAP_MARGIN = 16

function getSnapCoords(
  position: SnapPosition,
  vw: number,
  vh: number,
  bw: number,
  bh: number,
): { x: number; y: number } {
  const m = SNAP_MARGIN
  const cx = (vw - bw) / 2

  switch (position) {
    case 'top-left':
      return { x: m, y: m }
    case 'top-center':
      return { x: cx, y: m }
    case 'top-right':
      return { x: vw - bw - m, y: m }
    case 'bottom-left':
      return { x: m, y: vh - bh - m }
    case 'bottom-center':
      return { x: cx, y: vh - bh - m }
    case 'bottom-right':
      return { x: vw - bw - m, y: vh - bh - m }
  }
}

function resolveSnap(x: number, y: number, vw: number, vh: number, bw: number, bh: number): SnapPosition {
  const centerX = x + bw / 2
  const centerY = y + bh / 2
  const vertical = centerY < vh / 2 ? 'top' : 'bottom'
  const third = vw / 3
  const horizontal = centerX < third ? 'left' : centerX > third * 2 ? 'right' : 'center'
  return `${vertical}-${horizontal}` as SnapPosition
}

export function ResonatorQueueBubble() {
  const queue = useResonatorQueueStore((s) => s.queue)
  const snapPosition = useResonatorQueueStore((s) => s.snapPosition)
  const setSnapPosition = useResonatorQueueStore((s) => s.setSnapPosition)
  const switchToResonator = useAppStore((s) => s.switchToResonator)

  const bubbleRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const mounted = useRef(false)

  // Compute snap on mount and when snap position changes
  useEffect(() => {
    if (dragging || queue.length === 0) return

    // Defer first calculation to next frame so bubble has rendered
    const id = requestAnimationFrame(() => {
      const el = bubbleRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const coords = getSnapCoords(snapPosition, window.innerWidth, window.innerHeight, rect.width, rect.height)
      setPos(coords)
      mounted.current = true
    })
    return () => cancelAnimationFrame(id)
  }, [snapPosition, dragging, queue.length])

  // Recalculate on resize
  useEffect(() => {
    if (queue.length === 0) return
    function handleResize() {
      const el = bubbleRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const snap = useResonatorQueueStore.getState().snapPosition
      const coords = getSnapCoords(snap, window.innerWidth, window.innerHeight, rect.width, rect.height)
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
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      const el = bubbleRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()

      let nx = e.clientX - dragOffset.current.x
      let ny = e.clientY - dragOffset.current.y

      nx = Math.max(0, Math.min(nx, window.innerWidth - rect.width))
      ny = Math.max(0, Math.min(ny, window.innerHeight - rect.height))

      setPos({ x: nx, y: ny })
    },
    [dragging],
  )

  const onPointerUp = useCallback(() => {
    if (!dragging) return
    setDragging(false)
    const el = bubbleRef.current
    if (!el || !pos) return
    const rect = el.getBoundingClientRect()
    const snap = resolveSnap(pos.x, pos.y, window.innerWidth, window.innerHeight, rect.width, rect.height)
    setSnapPosition(snap)
  }, [dragging, pos, setSnapPosition])

  if (queue.length === 0) return null

  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 900,
    left: pos?.x ?? undefined,
    top: pos?.y ?? undefined,
    // Before first measurement, park off-screen so it doesn't flash at 0,0
    ...(!pos ? { right: SNAP_MARGIN, bottom: SNAP_MARGIN, left: 'auto', top: 'auto' } : {}),
    transition: dragging ? 'none' : 'left 320ms cubic-bezier(0.22, 1, 0.36, 1), top 320ms cubic-bezier(0.22, 1, 0.36, 1)',
    touchAction: 'none',
  }

  return (
    <div ref={bubbleRef} className="resonator-queue-bubble" style={style}>
      <img
        src={queue[0].icon}
        alt={queue[0].name}
        className="resonator-queue-bubble__icon"
        draggable={false}
        onClick={() => switchToResonator(queue[0].id)}
        title={`Switch to ${queue[0].name}`}
      />
      <div
        className="resonator-queue-bubble__grip"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GrDrag size={14} />
      </div>
      {queue.length > 1 && (
        <img
          src={queue[1].icon}
          alt={queue[1].name}
          className="resonator-queue-bubble__icon"
          draggable={false}
          onClick={() => switchToResonator(queue[1].id)}
          title={`Switch to ${queue[1].name}`}
        />
      )}
    </div>
  )
}
