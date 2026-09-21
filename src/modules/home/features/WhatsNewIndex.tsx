/*
  Author: Runor Ewhro
  Description: Flattens changelog releases into navigable stops and coordinates
               keyboard, wheel, touch, hash, media selection, and zoom state.
*/

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, TouchEvent as ReactTouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import { AxLink } from '@/shared/navigation/useNavX'
import { getWhatsNewEntries } from '@/data/content/changelogEntries'
import type { WnEntry, WnSection, WnShot } from '@/data/content/changelogEntries'
import { APP_ROUTES } from '@/shared/lib/appRoutes'
import { mainPortal } from '@/shared/lib/portalTarget'
import { HtmlContent } from '@/shared/ui/HtmlContent'
import { RailCardPreview } from '@/modules/simulation/api/previews'

interface WnStop {
  key: string
  entry: WnEntry
  entryIndex: number
  section: WnSection
  label: string
  body: string[]
  media: WnShot[]
}

// Match the breakpoint where the home route uses section snapping.
const SNAPS = '(min-width: 52rem) and (min-height: 34rem)'
// Treat nearby wheel events as one gesture so inertia cannot advance twice.
const GESTURE_GAP = 180
const WHEEL_STEP = 18
const SWIPE_STEP = 48

const ENTRIES = getWhatsNewEntries()

/* Flatten releases into stops. Headingless sections merge into the previous
   stop, and each release's first section inherits its hero media. */
const STOPS: WnStop[] = (() => {
  const stops: WnStop[] = []
  ENTRIES.forEach((entry, entryIndex) => {
    entry.sections.forEach((section, index) => {
      const media = [...(index === 0 && entry.hero ? [entry.hero] : []), ...(section.media ?? [])]
      const last = stops.at(-1)
      if (!section.kicker && !section.title && last?.entryIndex === entryIndex) {
        last.body = [...last.body, ...(section.body ?? [])]
        last.media = [...last.media, ...media]
        return
      }
      stops.push({
        key: `${entry.id}:${section.id}`,
        entry,
        entryIndex,
        section,
        label: section.kicker ?? section.title ?? entry.title,
        body: [...(section.body ?? [])],
        media,
      })
    })
  })
  return stops
})()

const pad = (value: number) => String(value).padStart(2, '0')

function firstStopOf(entryId: string | null): number | null {
  if (!entryId) return null
  const index = STOPS.findIndex((stop) => stop.entry.id === entryId)
  return index >= 0 ? index : null
}

export function WhatsNewIndex({ still, openEntry }: { still: boolean; openEntry: string | null }) {
  const root = useRef<HTMLDivElement | null>(null)
  const track = useRef<HTMLDivElement | null>(null)
  const rule = useRef<HTMLDivElement | null>(null)
  const mark = useRef<HTMLElement | null>(null)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const touch = useRef<{ x: number; y: number } | null>(null)
  const panelId = useId()

  const [at, setAt] = useState(() => firstStopOf(openEntry) ?? 0)
  // Zero marks initial placement; later signs encode navigation direction.
  const [dir, setDir] = useState(0)
  const [zoomed, setZoomed] = useState<WnShot | null>(null)
  // The wheel listener is registered once, so it reads the current index through a ref.
  const atRef = useRef(at)

  useLayoutEffect(() => { atRef.current = at }, [at])

  const go = useCallback((next: number) => {
    const target = Math.max(0, Math.min(STOPS.length - 1, next))
    const current = atRef.current
    if (target === current) return
    atRef.current = target
    setDir(target > current ? 1 : -1)
    setAt(target)
  }, [])

  // Apply release deep-link changes without remounting the home route.
  const [seenEntry, setSeenEntry] = useState(openEntry)
  if (openEntry !== seenEntry) {
    setSeenEntry(openEntry)
    const index = firstStopOf(openEntry)
    if (index !== null && index !== at) {
      setDir(index > at ? 1 : -1)
      setAt(index)
    }
  }

  // Derive marker geometry from the active tab and keep it within the scrollable track.
  const place = useCallback((smooth: boolean) => {
    const tab = tabs.current[atRef.current]
    const line = track.current
    const bar = mark.current
    if (!tab || !line || !bar) return
    bar.style.width = `${tab.offsetWidth}px`
    bar.style.transform = `translateX(${tab.offsetLeft}px)`
    line.scrollTo({
      left: Math.max(0, tab.offsetLeft - line.clientWidth * 0.3),
      behavior: smooth ? 'smooth' : 'auto',
    })
  }, [])

  useLayoutEffect(() => {
    place(!still && dir !== 0)
  }, [at, dir, place, still])

  useEffect(() => {
    const line = track.current
    const names = rule.current
    if (!line || !names) return
    // Reposition after font or container width changes.
    const resize = new ResizeObserver(() => place(false))
    resize.observe(names)
    resize.observe(line)
    const frame = requestAnimationFrame(() => { names.dataset.ready = '' })
    const onScroll = () => line.classList.toggle('is-in', line.scrollLeft > 4)
    line.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      resize.disconnect()
      cancelAnimationFrame(frame)
      line.removeEventListener('scroll', onScroll)
    }
  }, [place])

  /* Intercept vertical wheel gestures only while this snapped section owns the
     aperture; horizontal gestures always navigate stops. */
  useEffect(() => {
    const node = root.current
    const act = node?.closest<HTMLElement>('.hm-act')
    const aperture = node?.closest<HTMLElement>('.main-content')
    if (!act || !aperture) return

    const snaps = window.matchMedia(SNAPS)
    let last = 0
    let held = false
    let sum = 0
    const resting = () => snaps.matches && Math.abs(act.offsetTop - aperture.scrollTop) < 6

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return
      const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      const delta = sideways ? event.deltaX : event.deltaY
      const now = performance.now()
      const gap = now - last
      last = now
      if (held) {
        if (gap < GESTURE_GAP) { event.preventDefault(); return }
        held = false
        sum = 0
      }
      if (!sideways && !resting()) return

      const step = delta > 0 ? 1 : -1
      const current = atRef.current
      if (step > 0 ? current >= STOPS.length - 1 : current <= 0) {
        // Consume horizontal overscroll so the browser does not treat it as history navigation.
        if (sideways) event.preventDefault()
        return
      }
      event.preventDefault()
      sum += delta
      if (Math.abs(sum) < WHEEL_STEP) return
      sum = 0
      held = true
      go(current + step)
    }

    act.addEventListener('wheel', onWheel, { passive: false })
    return () => act.removeEventListener('wheel', onWheel)
  }, [go])

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: atRef.current + 1,
      ArrowLeft: atRef.current - 1,
      Home: 0,
      End: STOPS.length - 1,
    }
    const next = moves[event.key]
    if (next === undefined) return
    const onTab = (event.target as HTMLElement).getAttribute('role') === 'tab'
    if (!onTab && event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    go(next)
    if (onTab) tabs.current[Math.max(0, Math.min(STOPS.length - 1, next))]?.focus({ preventScroll: true })
  }

  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    // Let native scrolling own gestures that start inside the tab track.
    if ((event.target as HTMLElement).closest('.hm-wn__track')) return
    const point = event.touches[0]
    touch.current = { x: point.clientX, y: point.clientY }
  }

  const onTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const from = touch.current
    touch.current = null
    if (!from) return
    const point = event.changedTouches[0]
    const dx = point.clientX - from.x
    const dy = point.clientY - from.y
    if (Math.abs(dx) > SWIPE_STEP && Math.abs(dx) > Math.abs(dy) * 1.3) go(atRef.current + (dx < 0 ? 1 : -1))
  }

  const stop = STOPS[at]
  if (!stop) return null
  const { entry } = stop

  return (
    <div className="hm-wn"
      ref={root}
      data-moved={dir !== 0 || undefined}
      onKeyDown={onKey}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <header className="hm-wn__head" key={entry.id}>
        <p className="hm-kick">
          {entry.tag} · {entry.date} · {stop.entryIndex === 0 ? 'Latest release' : 'Earlier release'}
        </p>
        <h2>{entry.title}</h2>
        <p className="hm-prose hm-wn__lede">{entry.lede}</p>
      </header>

      <div className="hm-wn__bar">
        <p className="hm-legal">
          <AxLink to={APP_ROUTES.changelog}>All releases</AxLink>
        </p>
        <div className="hm-wn__step">
          <span className="hm-wn__pos"><b>{pad(at + 1)}</b> / {pad(STOPS.length)}</span>
          <button type="button" aria-label="Previous section" disabled={at === 0} onClick={() => go(at - 1)}>
            <ChevronLeft size="0.8rem" />
          </button>
          <button type="button" aria-label="Next section" disabled={at === STOPS.length - 1} onClick={() => go(at + 1)}>
            <ChevronRight size="0.8rem" />
          </button>
        </div>
      </div>

      <div className="hm-wn__track" ref={track}>
        <div className="hm-wn__rule" ref={rule} role="tablist" aria-label="What changed">
          {ENTRIES.map((one, entryIndex) => (
            <Fragment key={one.id}>
              <span className={entryIndex === stop.entryIndex ? 'hm-wn__date is-on' : 'hm-wn__date'} aria-hidden="true">
                {one.date.slice(0, 5)}
              </span>
              {STOPS.map((each, index) => (each.entryIndex !== entryIndex ? null : (
                <button
                  type="button"
                  role="tab"
                  key={each.key}
                  ref={(node) => { tabs.current[index] = node }}
                  className={index === at ? 'hm-wn__tab is-on' : 'hm-wn__tab'}
                  aria-selected={index === at}
                  aria-controls={panelId}
                  tabIndex={index === at ? 0 : -1}
                  onClick={() => go(index)}
                >
                  {each.label}
                </button>
              )))}
            </Fragment>
          ))}
          <i className="hm-wn__mark" ref={mark} aria-hidden="true" />
        </div>
      </div>

      <div className="hm-wn__panel" id={panelId} role="tabpanel" aria-label={stop.label} data-dir={dir} key={stop.key}>
        <Feature stop={stop} still={still} onZoom={setZoomed} />
      </div>

      {zoomed ? <Zoom shot={zoomed} onClose={() => setZoomed(null)} /> : null}
    </div>
  )
}

function Feature({ stop, still, onZoom }: { stop: WnStop; still: boolean; onZoom: (shot: WnShot) => void }) {
  const [shot, setShot] = useState(0)
  const [picked, setPicked] = useState(false)
  const [animated, setAnimated] = useState(!still)
  const lead = stop.media[shot] ?? null
  const { title, href, linkText } = stop.section

  return (
    <div className={lead ? 'hm-wn__feat' : 'hm-wn__feat is-text'}>
      <div className="hm-wn__copy">
        {title ? <h3>{title}</h3> : null}
        {stop.body.map((line, index) => <HtmlContent key={index} html={line} as="p" />)}
        {lead?.caption ? <p className="hm-wn__cap">{lead.caption}</p> : null}
        {href ? (
          <div className="hm-legal hm-wn__go">
            <AxLink to={href}>{linkText ?? 'Open page'}</AxLink>
          </div>
        ) : null}
        {lead?.kind === 'card' ? (
          <button type="button" className="hm-wn__l2d" aria-pressed={animated} onClick={() => setAnimated((on) => !on)}>
            Live2D {animated ? 'on' : 'off'}
          </button>
        ) : null}
        {stop.media.length > 1 ? (
          <div className="hm-wn__picks" role="group" aria-label="Screenshots in this section">
            {stop.media.map((one, index) => (
              <button
                type="button"
                key={index}
                className={index === shot ? 'is-on' : undefined}
                aria-label={`Screenshot ${index + 1} of ${stop.media.length}`}
                aria-pressed={index === shot}
                onClick={() => { setShot(index); setPicked(true) }}
              >
                {one.kind === 'image' && one.src ? <img src={one.src} alt="" decoding="async" /> : <span>{index + 1}</span>}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {lead ? (
        <div className={picked ? 'hm-wn__big is-picked' : 'hm-wn__big'} key={shot}>
          <Lead shot={lead} still={still} animated={animated} onZoom={onZoom} />
        </div>
      ) : null}
    </div>
  )
}

function Lead({ shot, still, animated, onZoom }: {
  shot: WnShot
  still: boolean
  animated: boolean
  onZoom: (shot: WnShot) => void
}) {
  if (shot.kind === 'card') return <RailCard resId={shot.resId ?? '1506'} animated={animated} />

  if (shot.kind === 'video') {
    // Remote hosts that cannot be embedded open externally; local clips use video.
    if (/^https?:\/\//.test(shot.src ?? '')) {
      return (
        <a className="hm-wn__watch" href={shot.src} target="_blank" rel="noopener noreferrer">
          <Play size="1rem" aria-hidden="true" />
          <span>{shot.caption ?? 'Watch the preview'}</span>
        </a>
      )
    }
    return (
      <video className="hm-wn__video"
        src={shot.src}
        poster={shot.poster}
        controls
        loop
        muted
        playsInline
        autoPlay={!still}
        preload="metadata"
      />
    )
  }

  // Intrinsic dimensions reserve the known aspect ratio before image decode.
  const ratio = shot.ar ?? 16 / 9
  return (
    <button
      type="button" className="hm-wn__shot"
      aria-label={`See full size: ${shot.alt ?? shot.caption ?? 'screenshot'}`}
      onClick={() => onZoom(shot)}
    >
      <img src={shot.src} alt={shot.alt ?? ''} width={Math.round(ratio * 1000)} height={1000} decoding="async" />
    </button>
  )
}

// Scale the full-size rail from its measured height into the preview container.
function RailCard({ resId, animated }: { resId: string; animated: boolean }) {
  const box = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const node = box.current
    if (!node) return
    const fit = () => {
      const rail = node.firstElementChild as HTMLElement | null
      if (!rail?.offsetHeight) return
      node.style.setProperty('--k', String(node.clientHeight / rail.offsetHeight))
    }
    fit()
    const resize = new ResizeObserver(fit)
    resize.observe(node)
    return () => resize.disconnect()
  }, [])

  return (
    <div className="hm-wn__card" ref={box}>
      <RailCardPreview resId={resId} animated={animated} />
    </div>
  )
}

// Portal outside the route aperture so the modal can cover the application shell.
function Zoom({ shot, onClose }: { shot: WnShot; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const host = mainPortal()
  if (!host || !shot.src) return null

  return createPortal(
    <div className="hm-wn-zoom"
      role="dialog"
      aria-modal="true"
      aria-label={shot.caption ?? shot.alt ?? 'Screenshot'}
      onClick={onClose}
    >
      <figure>
        <img src={shot.src} alt={shot.alt ?? ''} />
        {shot.caption ? <figcaption>{shot.caption}</figcaption> : null}
      </figure>
    </div>,
    host,
  )
}
