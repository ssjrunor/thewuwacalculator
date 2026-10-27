/*
  Author: Runor Ewhro
  description: reviews imported resonators, weapons, and Echoes before applying selections.
*/

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore, selInitRtLkp } from '@/application/state'
import type { YumeoGameDataImportSession } from '@/application/imports/yumeo/session'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay'
import { mainPortal } from '@/shared/lib/portalTarget'
import { useTstStr } from '@/shared/util/toastStore'
import { Echoes, type EchoTab } from './Echoes'
import { Team, TeamDefs } from './Team'
import { Conflict } from './Conflict'
import { useGameImport, type GameImportFile } from './lib/store'
import {
  buildGameImportReview,
  defaultEchoSelection,
  echoLocked,
  openConflicts,
  reviewChoices,
  rowEchoes,
  rowWeapon,
  slotKey,
  type ReviewRow,
  type RowKind,
} from './lib/model'
import '@/styles/features/imports/game-data.css'

type Filter = 'all' | RowKind

const KIND_LABEL: Record<RowKind, string> = { changed: 'Changed', new: 'New', same: 'Same' }
const FILTERS: Array<[Filter, string]> = [['all', 'All'], ['changed', 'Changed'], ['new', 'New'], ['same', 'Same']]

const SLIDE_AT_MS = 440
const CARD_ENTRY_DONE_MS = 1900
const EXIT_FALLBACK_MS = 800

const fmt = (n: number) => n.toLocaleString('en-US')
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`

function headBottom(): number {
  const head = document.querySelector('.ax-head')
  return head ? Math.max(0, head.getBoundingClientRect().bottom) : 0
}

function insetOf(rect: { top: number; right: number; bottom: number; left: number } | null, top: number, radius: string): string {
  if (!rect) return `inset(0px 0px 100% 0px round ${radius})`
  const w = window.innerWidth
  const h = window.innerHeight - top
  const t = Math.max(0, rect.top - top)
  const b = Math.max(0, Math.min(h - t - 4, h - (rect.bottom - top)))
  const l = Math.max(0, rect.left)
  const r = Math.max(0, Math.min(w - l - 4, w - rect.right))
  return `inset(${t}px ${r}px ${b}px ${l}px round ${radius})`
}

function triggerRect(): DOMRect | null {
  return document.querySelector('.isht-trigger-icon')?.getBoundingClientRect() ?? null
}

function fileDate(file: GameImportFile): string {
  return file.modified ? new Date(file.modified).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

interface ReviewProps {
  session: YumeoGameDataImportSession
  file: GameImportFile
  origin: DOMRect | null
  onLeave: (next?: 'close' | 'drop') => void
  onShown: () => void
  onGone: () => void
}

export function Review({ session, file, origin, onLeave, onShown, onGone }: ReviewProps) {
  const showToast = useTstStr((state) => state.show)
  const roverGender = useAppStore((state) => state.ui.preferences.roverGender)
  // compare the import with app state captured when the review opens.
  const [runtimes] = useState(() => selInitRtLkp(useAppStore.getState()))
  const model = useMemo(
    () => buildGameImportReview(session.review, runtimes, roverGender),
    [session, runtimes, roverGender],
  )

  const [skip, setSkip] = useState<ReadonlySet<string>>(() => new Set())
  const [weapons, setWeapons] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [slots, setSlots] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [sel, setSel] = useState<ReadonlySet<string>>(() => defaultEchoSelection(model))
  const [tab, setTab] = useState<EchoTab>('all')
  const [filter, setFilter] = useState<Filter>('all')
  const [done, setDone] = useState(false)
  const [imported, setImported] = useState<{ resonators: number; echoesAdded: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [stripVisible, setStripVisible] = useState(false)
  const [cardsEntering, setCardsEntering] = useState(true)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [pop, setPop] = useState<{ id: string; slot: number | null; anchor: HTMLElement } | null>(null)
  const [top, setTop] = useState(headBottom)
  const anchorRef = useRef<string | null>(null)

  const hostRef = useRef<HTMLElement | null>(null)
  const scrRef = useRef<HTMLDivElement | null>(null)
  const lineRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef(0)
  const wxRef = useRef(0)

  const picks = useMemo(() => ({ skip, weapons, slots, echoes: sel }), [skip, weapons, slots, sel])
  const rows = useMemo(() => (filter === 'all' ? model.rows : model.rows.filter((row) => row.kind === filter)), [model, filter])
  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: model.rows.length, changed: 0, new: 0, same: 0 }
    for (const row of model.rows) out[row.kind]++
    return out
  }, [model])
  const owners = useMemo(() => Object.fromEntries(model.rows.map((row) => [row.id, { profile: row.profile, name: row.name }])), [model])
  const entries = useMemo(() => model.groups.flatMap((group) => group.items), [model])
  const order = useMemo(() => entries.map((entry) => entry.echo.uid), [entries])

  const kept = model.rows.filter((row) => !skip.has(row.id))
  const weaponsIn = kept.filter((row) => (row.conflict ? weapons.has(row.id) : row.weaponFromFile)).length
  const echoesIn = entries.filter((entry) => echoLocked(entry, picks) || sel.has(entry.echo.uid)).length
  const waiting = openConflicts(model, picks)
  const needs = new Set(waiting.map((open) => open.row.id))
  const hasSelection = kept.length > 0 || echoesIn > 0
  const canImport = hasSelection && waiting.length === 0

  const width = () => hostRef.current?.offsetWidth ?? 1440
  const stripH = () => hostRef.current?.querySelector<HTMLElement>('.gdi-strip')?.offsetHeight ?? 0
  const cardAt = (j: number) => {
    const cards = lineRef.current?.querySelectorAll<HTMLElement>('.gdi-layer.is-file .gdi-tm')
    const first = cards?.[0]
    if (!first) return 0
    const step = cards[1] ? cards[1].offsetLeft - first.offsetLeft : first.offsetWidth
    return first.offsetLeft + j * step
  }
  const applyPan = useCallback((value: number) => {
    const row = lineRef.current?.querySelector<HTMLElement>('.gdi-row')
    const span = row ? Math.max(0, row.scrollWidth - width()) : 0
    panRef.current = Math.max(-span, Math.min(0, value))
    lineRef.current?.querySelectorAll<HTMLElement>('.gdi-row').forEach((el) => { el.style.transform = `translateX(${panRef.current}px)` })
  }, [])
  const applyWipe = useCallback((value: number) => {
    const w = width()
    wxRef.current = Math.max(60, Math.min(w - 60, value))
    const now = lineRef.current?.querySelector<HTMLElement>('.gdi-layer.is-now')
    const wipe = lineRef.current?.querySelector<HTMLElement>('.gdi-wipe')
    if (now) now.style.clipPath = `inset(0 ${w - wxRef.current}px 0 0)`
    if (wipe) wipe.style.left = `${wxRef.current}px`
  }, [])

  useLayoutEffect(() => {
    applyWipe(width() * 0.625)
    applyPan(0)
    const timers: number[] = []
    let started = false
    const start = () => {
      if (started) return
      started = true
      rootRef.current?.classList.replace('is-pre', 'is-in')
      onShown()
      timers.push(
        window.setTimeout(() => {
          lineRef.current?.classList.add('is-anim')
          applyWipe(width() / 2)
        }, SLIDE_AT_MS),
        window.setTimeout(() => lineRef.current?.classList.remove('is-anim'), SLIDE_AT_MS + 1150),
        window.setTimeout(() => setCardsEntering(false), CARD_ENTRY_DONE_MS),
      )
    }
    const frame = requestAnimationFrame(() => requestAnimationFrame(start))
    timers.push(window.setTimeout(start, 120))
    return () => { cancelAnimationFrame(frame); timers.forEach((timer) => window.clearTimeout(timer)) }
  }, [applyPan, applyWipe, onShown])

  // subscribe to exit requests without rerendering the review.
  const goneRef = useRef(false)
  const onGoneRef = useRef(onGone)
  onGoneRef.current = onGone
  const gone = useCallback(() => {
    if (goneRef.current) return
    goneRef.current = true
    onGoneRef.current()
  }, [])
  useEffect(() => {
    let fallback = 0
    const leave = () => {
      const root = rootRef.current
      if (!root || root.classList.contains('is-out')) return
      root.style.setProperty('--gdi-to', insetOf(triggerRect() ?? origin, headBottom(), '0.5rem'))
      root.classList.remove('is-pre', 'is-in')
      root.classList.add('is-out')
      setPop(null)
      fallback = window.setTimeout(gone, EXIT_FALLBACK_MS)
    }
    if (useGameImport.getState().leaving) leave()
    const unsubscribe = useGameImport.subscribe((state) => { if (state.leaving) leave() })
    return () => { unsubscribe(); window.clearTimeout(fallback) }
  }, [gone, origin])

  useLayoutEffect(() => {
    applyPan(panRef.current)
    applyWipe(done ? width() : wxRef.current)
  })

  useEffect(() => {
    const onResize = () => setTop(headBottom())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const scr = scrRef.current
    const line = lineRef.current
    if (!scr || !line) return
    const observer = new IntersectionObserver(([entry]) => setStripVisible(!entry.isIntersecting), {
      root: scr,
      rootMargin: `-${stripH() + 40}px 0px 0px 0px`,
    })
    observer.observe(line)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const line = lineRef.current
    if (!line) return
    const onWheel = (event: WheelEvent) => {
      if (!(event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))) return
      event.preventDefault()
      applyPan(panRef.current - (event.deltaX || event.deltaY))
    }
    line.addEventListener('wheel', onWheel, { passive: false })
    return () => line.removeEventListener('wheel', onWheel)
  }, [applyPan])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onLeave()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onLeave])

  const scale = () => {
    const host = hostRef.current
    return host ? host.getBoundingClientRect().width / host.offsetWidth || 1 : 1
  }

  const onLineDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as Element
    const grip = target.closest('.gdi-grip')
    if (target.closest('button') && !grip) return
    const line = event.currentTarget
    const x0 = event.clientX
    const p0 = panRef.current
    const w0 = wxRef.current
    const k = scale()
    line.setPointerCapture(event.pointerId)
    line.classList.add('is-drag')
    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - x0) / k
      if (grip && !done) applyWipe(w0 + dx)
      else applyPan(p0 + dx)
    }
    const up = () => {
      line.removeEventListener('pointermove', move)
      line.removeEventListener('pointerup', up)
      line.removeEventListener('pointercancel', up)
      line.classList.remove('is-drag')
    }
    line.addEventListener('pointermove', move)
    line.addEventListener('pointerup', up)
    line.addEventListener('pointercancel', up)
  }

  const seek = useCallback((id: string) => {
    const j = rows.findIndex((row) => row.id === id)
    if (j < 0) return
    scrRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    const rowEls = lineRef.current?.querySelectorAll<HTMLElement>('.gdi-row')
    rowEls?.forEach((el) => { el.style.transition = 'transform 640ms cubic-bezier(0.16, 1, 0.3, 1)' })
    applyPan(wxRef.current + 30 - cardAt(j))
    window.setTimeout(() => rowEls?.forEach((el) => { el.style.transition = '' }), 700)
  }, [applyPan, rows])

  const openPop = useCallback((id: string, anchor: HTMLElement, slot: number | null = null) => {
    const host = hostRef.current
    if (!host) return
    const hr = host.getBoundingClientRect()
    const ar = anchor.getBoundingClientRect()
    const inFoot = anchor.closest('.gdi-foot') != null
    if (!inFoot && (ar.left < hr.left + 20 || ar.right > hr.right - 20 || ar.top < hr.top + 120 * scale())) {
      if (filter !== 'all' && model.rows.find((row) => row.id === id)?.kind !== filter) setFilter('all')
      seek(id)
      window.setTimeout(() => {
        const key = slot == null ? id : slotKey(id, slot)
        const fresh = lineRef.current?.querySelector<HTMLElement>(`.gdi-layer.is-file [data-resolve="${key}"]`)
        if (fresh) setPop({ id, slot, anchor: fresh })
      }, 700)
      return
    }
    setPop({ id, slot, anchor })
  }, [filter, model, seek])

  const onResolve = useCallback((id: string, anchor: HTMLElement, slot?: number) => {
    if (pop?.id === id && pop.slot === (slot ?? null)) setPop(null)
    else openPop(id, anchor, slot ?? null)
  }, [openPop, pop])

  const onSkip = useCallback((id: string) => {
    setSkip((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const onPick = useCallback((uid: string, event: MouseEvent) => {
    setSel((current) => {
      const next = new Set(current)
      const turnOn = !current.has(uid)
      const anchor = anchorRef.current
      if (event.shiftKey && anchor) {
        const i0 = order.indexOf(anchor)
        const i1 = order.indexOf(uid)
        for (const key of order.slice(Math.min(i0, i1), Math.max(i0, i1) + 1)) {
          const entry = entries.find((one) => one.echo.uid === key)
          if (!entry || echoLocked(entry, picks)) continue
          if (turnOn) next.add(key)
          else next.delete(key)
        }
      } else if (turnOn) next.add(uid)
      else next.delete(uid)
      anchorRef.current = uid
      return next
    })
  }, [entries, order, picks])

  const onGroup = useCallback((groupId: string) => {
    const group = model.groups.find((one) => one.id === groupId)
    if (!group) return
    setSel((current) => {
      const free = group.items.filter((entry) => !echoLocked(entry, picks))
      const all = free.every((entry) => current.has(entry.echo.uid))
      const next = new Set(current)
      for (const entry of free) {
        if (all) next.delete(entry.echo.uid)
        else next.add(entry.echo.uid)
      }
      return next
    })
  }, [model, picks])

  const onJump = useCallback((groupId: string) => {
    const scr = scrRef.current
    const el = document.getElementById(`gdi-g-${groupId}`)
    const bar = hostRef.current?.querySelector<HTMLElement>('.gdi-ex-bar')?.offsetHeight ?? 64
    if (scr && el) scr.scrollTo({ top: el.offsetTop - stripH() - bar, behavior: 'smooth' })
  }, [])

  const runImport = async () => {
    if (busy || done) return
    setBusy(true)
    try {
      const result = session.apply(reviewChoices(session.review, model, picks))
      setImported({ resonators: result.resonators, echoesAdded: result.echoesAdded + result.optionalEchoesAdded })
      lineRef.current?.classList.add('is-anim')
      setDone(true)
      window.setTimeout(() => lineRef.current?.classList.remove('is-anim'), 1150)
    } catch (error) {
      showToast({ content: error instanceof Error ? error.message : 'Could not import the file.', variant: 'error', duration: 4500 })
    } finally {
      setBusy(false)
    }
  }

  const onGo = (event: MouseEvent<HTMLButtonElement>) => {
    if (canImport) {
      void runImport()
      return
    }
    const first = waiting[0]
    if (first) openPop(first.row.id, event.currentTarget, first.slotIndex)
  }

  const popRow = pop ? model.rows.find((row) => row.id === pop.id) ?? null : null
  const target = mainPortal()
  if (!target) return null

  const card = (row: ReviewRow, index: number, side: 'file' | 'now') => {
    const off = skip.has(row.id)
    const fileSide = side === 'file'
    const filed = fileSide || (done && !off)
    const build = filed ? (row.echoConflicts.length ? { ...row.file, echoes: rowEchoes(row, picks) } : row.file) : row.now
    const weapon = filed ? rowWeapon(row, picks) : row.now?.weapon ?? null
    const rowSlots = new Map(row.echoConflicts.map((entry) => [entry.slotIndex, slots.has(slotKey(row.id, entry.slotIndex))]))
    return (
      <Team
        key={row.id}
        row={row}
        index={index}
        side={side}
        build={build}
        current={fileSide ? row.now : null}
        weapon={weapon}
        open={fileSide && row.conflict != null && !weapons.has(row.id)}
        slots={rowSlots}
        off={fileSide && off}
        done={done}
        onSkip={onSkip}
        onResolve={onResolve}
      />
    )
  }

  const byKind = (['changed', 'new', 'same'] as RowKind[])
    .map((kind) => [kind, rows.filter((row) => row.kind === kind)] as const)
    .filter(([, list]) => list.length)

  return createPortal(
    <div
      ref={rootRef}
      className="gdi-layer-root is-pre"
      style={{ top, '--gdi-from': insetOf(origin ?? triggerRect(), top, '0.75rem') } as CSSProperties}
    >
      <div className="gdi-veil" onClick={() => onLeave()} />
      <section
        className="gdi"
        ref={hostRef}
        role="dialog"
        aria-label="Game data import"
        onAnimationEnd={(event) => { if (event.target === event.currentTarget && event.animationName === 'gdi-shut') gone() }}
      >
        <TeamDefs />
        <header className="gdi-head">
          <h2>Game data</h2>
          <span className="gdi-chip">
            <span className="tag">JSON</span>
            {file.name}
            {fileDate(file) ? <span>{fileDate(file)}</span> : null}
            {done ? null : <button type="button" className="chg" onClick={() => onLeave('drop')}>Change file</button>}
          </span>
          <nav className="gdi-filter">
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={filter === key ? 'is-on' : ''}
                onClick={() => { setFilter(key); applyPan(0) }}
              >
                {label}<b>{counts[key]}</b>
              </button>
            ))}
          </nav>
          <button type="button" className="gdi-close" aria-label="Close" onClick={() => onLeave()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className={`gdi-scroll${rows.length ? '' : ' is-no-line'}`} ref={scrRef} onScroll={() => { if (pop) setPop(null) }}>
          <div className={`gdi-strip${stripVisible ? ' is-on' : ''}`}>
            <div className="gdi-rail">
              {byKind.map(([kind, list]) => (
                <div className={`gdi-rail-g is-${kind}`} key={kind}>
                  <span className="gdi-rail-l">{KIND_LABEL[kind]}<b>{list.length}</b></span>
                  <div className="gdi-rail-row">
                    {list.map((row, index) => (
                      <button
                        key={row.id}
                        type="button"
                        className={`gdi-md is-${kind}${skip.has(row.id) ? ' is-off' : ''}${needs.has(row.id) ? ' is-need' : ''}`}
                        style={{ '--el': ATTR_COLORS[row.attribute], '--i': index } as CSSProperties}
                        aria-label={row.name}
                        onClick={() => seek(row.id)}
                      >
                        <i className="gdi-md-b" /><i className="gdi-md-r" />
                        <img alt="" src={row.profile} />
                        <span className="gdi-md-nm">{row.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="gdi-line" ref={lineRef} onPointerDown={onLineDown}>
            <div className="gdi-layer is-file">
              <div className={`gdi-row${cardsEntering ? ' is-entering' : ''}`}>{rows.map((row, index) => card(row, index, 'file'))}</div>
            </div>
            <div className={`gdi-layer is-now${done ? ' is-done' : ''}`}>
              <div className="gdi-row">{rows.map((row, index) => card(row, index, 'now'))}</div>
            </div>
            <div className="gdi-wipe">
              <span className="gdi-side l">Now</span>
              {done ? null : (
                <>
                  <span className="gdi-side r">File</span>
                  <button
                    type="button"
                    className="gdi-grip"
                    aria-label="Move the line between Now and File"
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowLeft') applyWipe(wxRef.current - 40)
                      if (event.key === 'ArrowRight') applyWipe(wxRef.current + 40)
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 7-5 5 5 5" /><path d="m15 7 5 5-5 5" /></svg>
                  </button>
                </>
              )}
            </div>
          </div>

          <Echoes
            groups={model.groups}
            unlevelled={model.unlevelled}
            total={model.echoTotal}
            count={echoesIn}
            tab={tab}
            lock={picks}
            sel={sel}
            done={done}
            owners={owners}
            onTab={setTab}
            onPick={onPick}
            onGroup={onGroup}
            onJump={onJump}
          />
        </div>

        <footer className="gdi-foot">
          {done ? (
            <>
              <span className="gdi-sum">
                <span>Import complete</span>
                <b>{plural(imported?.resonators ?? 0, 'resonator')}</b>
                <b>{plural(weaponsIn, 'weapon')}</b>
                <b>{plural(imported?.echoesAdded ?? 0, 'new echo', 'new echoes')}</b>
              </span>
              <button type="button" className="gdi-ghost" onClick={() => onLeave()}>Close</button>
            </>
          ) : (
            <>
              <span className="gdi-sum">
                <span><b>{kept.length}</b> <i>/ {model.rows.length}</i> resonators</span>
                <span><b>{weaponsIn}</b> <i>/ {fmt(model.weaponTotal)}</i> weapons</span>
                <span><b>{fmt(echoesIn)}</b> <i>/ {fmt(model.echoTotal)}</i> echoes</span>
              </span>
              <button type="button" className={`gdi-go${canImport ? '' : ' is-wait'}`} disabled={busy || !hasSelection} onClick={onGo}>
                {waiting.length
                  ? `${waiting[0].row.name}: ${waiting[0].slotIndex == null ? 'pick a weapon' : `pick slot ${waiting[0].slotIndex + 1}`}`
                  : 'Import'}
              </button>
            </>
          )}
        </footer>

        {pop && popRow && hostRef.current ? (
          <Conflict
            key={pop.slot == null ? pop.id : slotKey(pop.id, pop.slot)}
            row={popRow}
            slotIndex={pop.slot}
            anchor={pop.anchor}
            host={hostRef.current}
            kept={(pop.slot == null ? weapons.get(pop.id) : slots.get(slotKey(pop.id, pop.slot))) ?? null}
            onPick={(sourceIndex) => {
              if (pop.slot == null) setWeapons((current) => new Map(current).set(pop.id, sourceIndex))
              else setSlots((current) => new Map(current).set(slotKey(pop.id, pop.slot!), sourceIndex))
            }}
            onClose={() => setPop(null)}
          />
        ) : null}
      </section>
    </div>,
    target,
  )
}
