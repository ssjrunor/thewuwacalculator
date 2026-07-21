/*
  Author: Runor Ewhro
  Description: Renders the resonator role-tag cluster plus a cursor-following
               card that lists every tag's icon, name, and description in one
               floating panel while the cluster is hovered or focused.
*/

import type {
  CSSProperties as CssProps,
  FocusEvent as RctFcsVnt,
  MouseEvent as RctMsVnt,
  SyntheticEvent,
} from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAnimVis } from '@/app/hooks/useAnimatedVisibility'
import { bodyPortal } from '@/shared/lib/portalTarget'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

const CRSR_OFFSET_X = 18
const CRSR_OFFSET_Y = 20
const VWPRT_PAD = 12
const CARD_EXIT_MS = 200

export interface IdentTag {
  id: string
  name: string
  desc: string
  color: string
}

interface IdentTagsTooltipProps {
  tags: IdentTag[]
  label?: string
  className?: string
  onIconError?: (event: SyntheticEvent<HTMLImageElement>) => void
}

function padCount(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

export function IdentTagsTooltip({
  tags,
  label = 'Resonator roles',
  className,
  onIconError,
}: IdentTagsTooltipProps) {
  const visibility = useAnimVis(CARD_EXIT_MS)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)

  const portalTarget = bodyPortal()

  const applyPlacement = useCallback((clientX: number, clientY: number) => {
    const root = rootRef.current
    const card = cardRef.current
    if (!root || !card) return

    const width = card.offsetWidth
    const height = card.offsetHeight

    // Default below-right of the cursor, then flip toward whichever side keeps
    // the whole card inside the viewport.
    let x = clientX + CRSR_OFFSET_X
    let y = clientY + CRSR_OFFSET_Y

    if (x + width + VWPRT_PAD > window.innerWidth) {
      x = clientX - width - CRSR_OFFSET_X
    }
    if (y + height + VWPRT_PAD > window.innerHeight) {
      y = clientY - height - CRSR_OFFSET_Y
    }

    x = Math.min(Math.max(VWPRT_PAD, x), window.innerWidth - width - VWPRT_PAD)
    y = Math.min(Math.max(VWPRT_PAD, y), window.innerHeight - height - VWPRT_PAD)

    root.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }, [])

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
    if (tags.length === 0) return
    pointerRef.current = { x: event.clientX, y: event.clientY }
    visibility.show()
  }, [tags.length, visibility])

  const onMove = useCallback((event: RctMsVnt<HTMLSpanElement>) => {
    if (!visibility.visible) return
    pointerRef.current = { x: event.clientX, y: event.clientY }
    schedulePlacement()
  }, [schedulePlacement, visibility.visible])

  const onLeave = useCallback(() => {
    visibility.hide()
  }, [visibility])

  const onFocus = useCallback((event: RctFcsVnt<HTMLSpanElement>) => {
    if (tags.length === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    pointerRef.current = { x: rect.left, y: rect.bottom }
    visibility.show()
  }, [tags.length, visibility])

  useLayoutEffect(() => {
    if (!visibility.visible) return
    const pointer = pointerRef.current
    if (pointer) applyPlacement(pointer.x, pointer.y)
  }, [applyPlacement, visibility.visible])

  useEffect(() => clearFrame, [clearFrame])

  if (tags.length === 0) return null

  return (
    <>
      <span
        ref={triggerRef}
        className={className ? `res-card__ident-tags ${className}` : 'res-card__ident-tags'}
        aria-label={label}
        tabIndex={0}
        onMouseEnter={onEnter}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onFocus={onFocus}
        onBlur={onLeave}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onLeave()
        }}
      >
        {tags.map((tag) => (
          <div
            aria-hidden="true"
            key={tag.id}
            style={{
              '--res-tag-color': `#${tag.color}`,
              WebkitMaskImage: `url(/assets/resonators/tag-icons/${tag.id}.webp)`,
              maskImage: `url(/assets/resonators/tag-icons/${tag.id}.webp)`,
            } as CssProps}
            className="res-card__tag-icon"
            onError={withDefIconM}
          />

        ))}
      </span>

      {visibility.visible && portalTarget
        ? createPortal(
            <div
              ref={rootRef}
              className="res-tag-tooltip"
              data-open={visibility.open ? 'true' : undefined}
              data-closing={visibility.closing ? 'true' : undefined}
              role="presentation"
            >
              <div ref={cardRef} className="res-tag-tooltip__card">
                <div className="res-tag-tooltip__head">
                  <span className="res-tag-tooltip__label">Roles</span>
                  <span className="res-tag-tooltip__count">
                    {padCount(tags.length)}
                    <span className="res-tag-tooltip__count-unit">
                      {tags.length === 1 ? 'role' : 'roles'}
                    </span>
                  </span>
                </div>

                <ul className="res-tag-tooltip__list">
                  {tags.map((tag) => (
                    <li
                      key={tag.id}
                      className="res-tag-tooltip__row"
                      style={{ '--res-tag-color': `#${tag.color}` } as CssProps}
                    >
                      <span className="res-tag-tooltip__icon">
                        <img
                          src={`/assets/resonators/tag-icons/${tag.id}.webp`}
                          alt=""
                          aria-hidden="true"
                          onError={onIconError}
                        />
                      </span>
                      <span className="res-tag-tooltip__text">
                        <span className="res-tag-tooltip__name">{tag.name}</span>
                        {tag.desc ? (
                          <span className="res-tag-tooltip__desc">{tag.desc}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>,
            portalTarget,
          )
        : null}
    </>
  )
}
