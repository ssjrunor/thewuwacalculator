/*
  Author: Runor Ewhro
  Description: Info trigger for the optimizer rail header plus a cursor-following
               manual card that explains every console control, grouped by the
               rail's own sections.
*/

import type { FocusEvent as RctFcsVnt, MouseEvent as RctMsVnt } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { useAnimatedVisibility } from '@/shared/hooks/useAnimatedVisibility'
import { bodyPortal } from '@/shared/lib/portalTarget'

const CRSR_OFFSET_X = 18
const CRSR_OFFSET_Y = 20
const VWPRT_PAD = 12
const CARD_EXIT_MS = 200

interface ManualSctn {
  label: string
  rows: Array<[string, string]>
}

const MANUAL: ManualSctn[] = [
  {
    label: 'Readout',
    rows: [
      ['Permutations', 'Every echo loadout the search will score for this resonator.'],
      ['Processed', 'Loadouts scored so far in this run.'],
      ['Batch size', 'How many loadouts each engine pass scores; sized automatically.'],
      ['Echoes', 'The pool eligible for the five slots after your filters.'],
      ['Results', 'Best builds kept from the run, up to Limit.'],
    ],
  },
  {
    label: 'Tuning',
    rows: [
      ['Limit', 'How many top builds are kept; snaps to powers of two, up to 2^16.'],
      ['Filter', 'Trims low-value echoes before an Inventory search; higher is faster but can drop fringe picks.'],
      ['Low mem', 'Runs smaller batches for stability; slower, use it if big searches crash the tab.'],
    ],
  },
  {
    label: 'Mode',
    rows: [
      ['Inventory', 'Searches the echoes you own.'],
      ['Theorymax', 'Searches ideal theoretical echoes to show the build ceiling.'],
    ],
  },
]

export function RailManual() {
  const visibility = useAnimatedVisibility(CARD_EXIT_MS)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)

  const portalTarget = bodyPortal()

  const applyPlacement = useCallback((clientX: number, clientY: number) => {
    const root = rootRef.current
    const card = cardRef.current
    if (!root || !card) return

    const width = card.offsetWidth
    const height = card.offsetHeight

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
    // mousemove can outrun layout; one rAF keeps placement measurements fresh
    // without sync work on every pointer event.
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

  const onEnter = useCallback((event: RctMsVnt<HTMLButtonElement>) => {
    pointerRef.current = { x: event.clientX, y: event.clientY }
    visibility.show()
  }, [visibility])

  const onMove = useCallback((event: RctMsVnt<HTMLButtonElement>) => {
    if (!visibility.visible) return
    pointerRef.current = { x: event.clientX, y: event.clientY }
    schedulePlacement()
  }, [schedulePlacement, visibility.visible])

  const onLeave = useCallback(() => {
    visibility.hide()
  }, [visibility])

  const onFocus = useCallback((event: RctFcsVnt<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    pointerRef.current = { x: rect.left, y: rect.bottom }
    visibility.show()
  }, [visibility])

  useLayoutEffect(() => {
    if (!visibility.visible) return
    const pointer = pointerRef.current
    if (pointer) applyPlacement(pointer.x, pointer.y)
  }, [applyPlacement, visibility.visible])

  useEffect(() => clearFrame, [clearFrame])

  return (
    <>
      <button
        type="button" className="odk-info"
        aria-label="What each control does"
        onMouseEnter={onEnter}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onFocus={onFocus}
        onBlur={onLeave}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onLeave()
        }}
      >
        <Info size="0.9rem" aria-hidden="true" />
      </button>

      {visibility.visible && portalTarget
        ? createPortal(
            <div
              ref={rootRef} className="odk-man"
              data-open={visibility.open ? 'true' : undefined}
              data-closing={visibility.closing ? 'true' : undefined}
              role="presentation"
            >
              <div ref={cardRef} className="odk-man__card">
                <div className="odk-man__head">Manual</div>
                {MANUAL.map((section) => (
                  <div key={section.label} className="odk-man__section">
                    <span className="odk-man__section-label">{section.label}</span>
                    {section.rows.map(([term, desc]) => (
                      <div key={term} className="odk-man__row">
                        <span className="odk-man__term">{term}</span>
                        <span className="odk-man__desc">{desc}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>,
            portalTarget,
          )
        : null}
    </>
  )
}
