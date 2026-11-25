/*
  Author: Runor Ewhro
  description: a board as one list of every build. only rows near the view are
               rendered and the rest is spacing of the right height, so the
               scrollbar, jumps and the map line measure the whole board.
               unloaded rows show their standing (known from their position) over
               blank cells until their page loads. the open row's body is the one
               taller row, and its height stays reserved while it scrolls out of
               the rendered rows, which keeps the list from shifting.
*/

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BuildRow, rowColumns, Standing } from '../build/BuildRow'
import { scroller, type Listed } from '../../model/listed'

/** how far past the view rows are drawn, in px. */
const OVERSCAN = 700
/** a row is 2.9rem (.lbs .row). */
const ROW_REM = 2.9

export interface ListApi {
  /** the list's top in the scroller's content, px. */
  top: () => number
  /** top offset of row i within the list, in px. */
  off: (i: number) => number
}

interface Props {
  /** row count of this list (the board, or the rows matching its filters). */
  n: number
  /** bumped when a page lands. */
  ver: number
  rowAt: (i: number) => Listed | null
  /** the pages that cover rows first to last are wanted. */
  need: (first: number, last: number) => void
  open: string | null
  onToggle: (buildId: string) => void
  /** the rank last jumped to: its row flashes once. */
  flash: number | null
  /** the bottom bar's length for a score, 0 to 100. */
  bar: (score: number) => number
  /** how deep the sticky bars over the list reach, px from the scroller's top. */
  cover: () => number
  /** the places in view (1 for the first row), first and last; called as the page scrolls. */
  onRange: (a: number, b: number) => void
  /** passes the list's measurements to the parent for jumps. */
  bind: (api: ListApi) => void
}

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

function Placeholder({ rank, total }: { rank: number; total: number }) {
  return (
    <div className="row brow ph" style={{ gridTemplateColumns: rowColumns({}) }} aria-hidden>
      <Standing x={{ rank, total }} />
      <i className="k-ph" style={{ width: '42%' }} /><i className="k-ph" style={{ width: '1.2rem' }} /><i className="k-ph" style={{ width: '3.6rem' }} />
      <i className="k-ph" style={{ width: '2.4rem' }} /><i className="k-ph" style={{ width: '4rem' }} /><i className="k-ph r" />
      <i className="k-ph r" /><i className="k-ph r" /><i className="k-ph r" /><i className="k-ph r" />
    </div>
  )
}

export const BoardList = memo(function BoardList({ n, ver, rowAt, need, open, onToggle, flash, bar, cover, onRange, bind }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [rh, setRh] = useState(() => remPx() * ROW_REM)
  const [win, setWin] = useState<[number, number]>([0, Math.min(n, 40) - 1])
  // the open row's index while it is drawn; its body's height, measured then and held while it is not.
  let oi = -1
  if (open) for (let i = win[0]; i <= win[1]; i++) if (rowAt(i)?.buildId === open) { oi = i; break }
  const [held, setHeld] = useState<{ id: string | null; i: number; h: number }>({ id: null, i: -1, h: 0 })
  const mine = held.id === open && open != null
  const ki = oi >= 0 ? oi : mine ? held.i : -1, ex = mine ? held.h : 0

  const off = useCallback((i: number) => i * rh + (ki >= 0 && i > ki ? ex : 0), [rh, ki, ex])
  const at = useCallback((y: number) => {
    if (y <= 0) return 0
    const i = ki < 0 || y < (ki + 1) * rh ? Math.floor(y / rh) : y < (ki + 1) * rh + ex ? ki : Math.floor((y - ex) / rh)
    return Math.min(Math.max(0, n - 1), i)
  }, [rh, ki, ex, n])
  const top = useCallback(() => {
    const s = scroller(), el = host.current
    return s && el ? el.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop : 0
  }, [])
  useLayoutEffect(() => { bind({ top, off }) }, [bind, top, off])

  // which rows to draw, and which are in view, as the page scrolls.
  const look = useCallback(() => {
    const s = scroller()
    if (!s || !n) return
    const y0 = s.scrollTop - top(), seen = y0 + cover(), end = y0 + s.clientHeight
    const first = at(seen - OVERSCAN), last = at(end + OVERSCAN)
    setWin((w) => w[0] === first && w[1] === last ? w : [first, last])
    onRange(at(seen + rh * .5) + 1, at(end - rh * .5) + 1)
  }, [n, top, cover, at, onRange, rh])

  useEffect(() => {
    const s = scroller()
    let frame = 0
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; look() }) }
    const onResize = () => { setRh(remPx() * ROW_REM); look() }
    s?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    onScroll()
    return () => { cancelAnimationFrame(frame); s?.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize) }
  }, [look])
  // a page landing changes what is in view (the readout's ranks stay, but rows fill in).
  useEffect(() => { const f = requestAnimationFrame(look); return () => cancelAnimationFrame(f) }, [ver, look])

  // request the rendered rows' pages after the window settles briefly, so a fast drag requests only where it stops
  useEffect(() => {
    const t = window.setTimeout(() => need(win[0], win[1]), 70)
    return () => window.clearTimeout(t)
  }, [win, need, ver])

  // the open row's body: measured while it is drawn, kept while it is not.
  useLayoutEffect(() => {
    if (oi < 0 || !open) return
    const body = host.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(open)}"] + .k-ex`)
    if (!body) return
    const ro = new ResizeObserver(() => {
      const h = body.offsetHeight
      setHeld((v) => v.id === open && v.i === oi && Math.abs(v.h - h) < .5 ? v : { id: open, i: oi, h })
    })
    ro.observe(body)
    return () => ro.disconnect()
  }, [oi, open])

  const first = Math.min(win[0], Math.max(0, n - 1)), last = Math.min(win[1], n - 1)
  const rows = []
  for (let i = first; i <= last; i++) {
    const x = rowAt(i)
    if (!x) { rows.push(<Placeholder key={`ph${i}`} rank={i + 1} total={n} />); continue }
    rows.push(<BuildRow key={x.buildId} x={x} i={0} open={open === x.buildId} onToggle={() => onToggle(x.buildId)} p={bar(x.score)}
      cls={flash === x.rank ? 'flash' : undefined} />)
  }
  const total = n * rh + (ki >= 0 ? ex : 0)
  return (
    <div className="vl" ref={host} style={{ position: 'relative' }}>
      <div style={{ height: n ? off(first) : 0 }} />
      {n ? rows : null}
      <div style={{ height: n ? Math.max(0, total - off(last + 1)) : 0 }} />
    </div>
  )
})
