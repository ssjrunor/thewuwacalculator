/*
  Author: Runor Ewhro
  description: the open build row, stored in ?build= so an open build is a
               link; opening another row closes the first. arriving through such
               a link (a reload, a pasted url, an external link) scrolls the row
               to the top of the view, directly under the sticky bars.
*/

import { useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { scroller } from '../model/listed'

// the build the viewer last opened by hand and when, which excludes it from arrivals; a timestamp makes an effect run
// twice (strict mode) skip it both times while a later visit by link still arrives
let mine: { id: string | null; at: number } = { id: null, at: 0 }

export function useOpen(): [string | null, (buildId: string | null) => void] {
  const [params, setParams] = useSearchParams()
  const open = params.get('build')
  const set = useCallback((buildId: string | null) => {
    mine = { id: buildId, at: performance.now() }
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (buildId) next.set('build', buildId); else next.delete('build')
      return next
    }, { replace: true })
  }, [setParams])
  useEffect(() => {
    if (!open || (open === mine.id && performance.now() - mine.at < 1000)) return
    return arrive(open)
  }, [open])
  return [open, set]
}

/** a row's toggle: open it, or close it when it is the open one. */
export const toggler = (open: string | null, set: (id: string | null) => void) => (id: string) => () => set(open === id ? null : id)

/** the sticky bars covering a row: sticky elements before it among its ancestors' children; sticky elements
    elsewhere sit in a box that ends before the row. */
function coversOf(row: HTMLElement, s: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  for (let a: HTMLElement | null = row; a && a !== s; a = a.parentElement) {
    for (let c = a.previousElementSibling; c; c = c.previousElementSibling) {
      if (c instanceof HTMLElement && getComputedStyle(c).position === 'sticky') out.push(c)
    }
  }
  return out
}

/** waits for the row, then holds it under the sticky bars until the page settles, measuring the bars' depth each
    frame because rows load late; the viewer's own scroll, click or key stops it. returns the cancel function. */
function arrive(id: string): () => void {
  const s = scroller()
  if (!s) return () => undefined
  let raf = 0, found = 0, covers: HTMLElement[] = []
  const t0 = performance.now()
  const stop = () => {
    cancelAnimationFrame(raf)
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.removeEventListener(type, stop, true)
  }
  for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.addEventListener(type, stop, { capture: true, passive: true })
  const tick = (now: number) => {
    const row = s.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`)
    if (!row) {
      if (now - t0 > 8000) return stop()
      raf = requestAnimationFrame(tick)
      return
    }
    if (!found) { found = now; covers = coversOf(row, s) }
    const top = s.getBoundingClientRect().top
    // each bar's stuck position: its own `top` below the scroller edge, at its folded height (a bar that folds on scroll
    // publishes its remaining fold in data-fold)
    const under = covers.reduce((y, c) => Math.max(y, top + (parseFloat(getComputedStyle(c).top) || 0)
      + c.offsetHeight - (parseFloat(c.dataset.fold ?? '') || 0)), top)
    const delta = row.getBoundingClientRect().top - under
    if (Math.abs(delta) >= 1) s.scrollTop += delta
    if (now - found > 1200) return stop()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return stop
}
