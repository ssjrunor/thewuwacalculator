/*
  Author: Runor Ewhro
  Description: Captures keyed card bounds before a state change, computes layout
               deltas after commit, delegates special moves, and cleans up clones
               used for removed cards.
*/

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

const SETTLE_EASE = 'cubic-bezier(.2, .8, .2, 1)'
// A snapshot is valid only for the immediate commit that follows capture().
const STALE_MS = 300
const MAX_CARDS = 600
// Skip animation work for cards outside this margin around the scroll root.
const VIEW_MARGIN = 80

export interface PickerMove {
  el: HTMLElement
  id: string
  dx: number
  dy: number
}

interface Snapshot {
  at: number
  cards: Map<string, { el: HTMLElement; rect: DOMRect }>
}

const calm = () => document.documentElement.classList.contains('reduce-animation')

function loadArt(el: HTMLElement) {
  el.querySelectorAll<HTMLImageElement>('img[data-deferred-src]').forEach((image) => {
    if (!image.getAttribute('src')) image.src = image.dataset.deferredSrc!
  })
}

// Returning true from onMove transfers ownership of that card's delta.
export function usePickerMotion(
  bodyRef: RefObject<HTMLElement | null>,
  onMove?: (move: PickerMove) => boolean,
) {
  const snapshot = useRef<Snapshot | null>(null)

  // Explicit origins replace measured bounds after a detached drag. Unknown
  // event-handler arguments are ignored.
  const capture = useCallback((origins?: unknown) => {
    const body = bodyRef.current
    if (!body) return
    // Once snapshots control card movement, disable the one-time grid animation.
    body.closest('.picker-modal__frame')?.classList.add('is-live')
    if (calm()) return
    const list = body.querySelectorAll<HTMLElement>('[data-pick-id]')
    if (list.length > MAX_CARDS) return
    const cards = new Map<string, { el: HTMLElement; rect: DOMRect }>()
    const from = origins instanceof Map ? origins as ReadonlyMap<string, DOMRect> : null
    list.forEach((el) => {
      const id = el.dataset.pickId!
      cards.set(id, { el, rect: from?.get(id) ?? el.getBoundingClientRect() })
    })
    snapshot.current = { at: performance.now(), cards }
  }, [bodyRef])

  useLayoutEffect(() => {
    const shot = snapshot.current
    const body = bodyRef.current
    snapshot.current = null
    if (!shot || !body || performance.now() - shot.at > STALE_MS) return

    const view = body.getBoundingClientRect()
    const near = (rect: DOMRect) => rect.bottom > view.top - VIEW_MARGIN && rect.top < view.bottom + VIEW_MARGIN
    const seen = new Set<string>()

    body.querySelectorAll<HTMLElement>('[data-pick-id]').forEach((el) => {
      const id = el.dataset.pickId!
      seen.add(id)
      const rect = el.getBoundingClientRect()
      if (!rect.width) return
      const was = shot.cards.get(id)
      if (!was || was.el !== el) loadArt(el)
      if (!was) {
        if (near(rect)) {
          el.animate(
            [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }],
            { duration: 320, delay: 90, easing: SETTLE_EASE, fill: 'backwards' },
          )
        }
        return
      }
      const dx = was.rect.left - rect.left
      const dy = was.rect.top - rect.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
      if (!near(rect) && !near(was.rect)) return
      // Cancel in-flight animations before applying a new measured delta.
      el.getAnimations().forEach((animation) => animation.cancel())
      if (onMove?.({ el, id, dx, dy })) return
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 440, easing: SETTLE_EASE })
    })

    for (const [id, { el, rect }] of shot.cards) {
      if (seen.has(id) || !near(rect)) continue
      const ghost = el.cloneNode(true) as HTMLElement
      ghost.removeAttribute('data-pick-id')
      ghost.setAttribute('aria-hidden', 'true')
      ghost.inert = true
      ghost.classList.add('picker-modal__leaving')
      Object.assign(ghost.style, {
        left: `${rect.left - view.left + body.scrollLeft}px`,
        top: `${rect.top - view.top + body.scrollTop}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      })
      body.appendChild(ghost)
      const fade = ghost.animate(
        [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.9)' }],
        { duration: 220, easing: 'ease-in', fill: 'forwards' },
      )
      fade.onfinish = () => ghost.remove()
      fade.oncancel = () => ghost.remove()
    }
  })

  return capture
}
