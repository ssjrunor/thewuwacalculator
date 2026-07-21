/*
  Author: Runor Ewhro
  Description: "What's New" surface. Every entry sits in the stream as a compact
               row; exactly one is always expanded, and opening another collapses
               the previous. The open entry morphs its row into the full feed
               (hero + scroll-revealed acts), so recent and older entries share
               one representation. The dispatch header and live equalizer carry
               the broadcast identity. No hash opens the most recent entry; a
               hash opens its target.
*/

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronLeft, Play, Plus, X } from 'lucide-react'
import {
  whatsNewEntries,
  type WnEntry,
  type WnSection,
  type WnShot,
} from '@/data/content/whatsNewEntries'
import { HtmlContent } from '@/shared/ui/HtmlContent'
import { CllpPageHeyf } from '@/shared/ui/CollapsiblePageHero'
import { RailCardPreview } from '@/modules/calculator/features/benchmark/RailCardPreview.tsx'

type Lightbox = { src: string; alt?: string; caption?: string } | null

const BAR_COUNT = 7

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  // when IntersectionObserver is unavailable, reveal immediately
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || shown) return
    // reveal on the next frame when the element already sits on screen at mount
    // (e.g. an entry expanded on load or via hash), so it never waits for a scroll.
    const rect = el.getBoundingClientRect()
    const viewportH = window.innerHeight || document.documentElement.clientHeight
    if (rect.top < viewportH * 0.92 && rect.bottom > 0) {
      const raf = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(raf)
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown])
  return { ref, shown }
}

function Reveal({
  children,
  className = '',
  delay = 0,
  style,
}: {
  children: ReactNode
  className?: string
  delay?: number
  style?: CSSProperties
}) {
  const { ref, shown } = useReveal<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={`wn-reveal ${shown ? 'is-in' : ''} ${className}`.trim()}
      style={{
        ...style,
        ...(delay ? { transitionDelay: `${delay}ms` } : {}),
      }}
    >
      {children}
    </div>
  )
}

function SignalBars({ live }: { live: boolean }) {
  return (
    <span className={live ? 'wn-bars wn-bars--live' : 'wn-bars'} aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span key={i} className="wn-bars__bar" style={{ ['--i' as string]: i }} />
      ))}
    </span>
  )
}

function Dispatch({ entry }: { entry: WnEntry }) {
  return (
    <div className="wn-dispatch__meta">
      <span className="wn-dispatch__live">
        <SignalBars live />
        On air
      </span>
      <span className="wn-tag">{entry.tag}</span>
      <span className="wn-freq">SIG {entry.signal}</span>
      <span className="wn-date">{entry.date}</span>
    </div>
  )
}

function Shot({ item, onZoom }: { item: WnShot; onZoom: (lb: Lightbox) => void }) {
  if (item.kind === 'video') {
    const external = /^https?:\/\//.test(item.src ?? '')

    // a local clip (served from /public) plays inline; external hosts like
    // Streamable refuse to be framed, so those still link out instead.
    if (!external) {
      const reduceMotion =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('reduce-animation')
      return (
        <figure className="wn-media wn-media--video">
          <video
            className="wn-media__video"
            src={item.src}
            poster={item.poster}
            controls
            loop
            muted
            playsInline
            autoPlay={!reduceMotion}
            preload="metadata"
          />
          {item.caption ? <figcaption className="wn-media__cap">{item.caption}</figcaption> : null}
        </figure>
      )
    }

    return (
      <figure className="wn-media wn-media--video">
        <a
          className="wn-media__play"
          href={item.src ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${item.caption ?? 'Watch the preview'} (opens in a new tab)`}
        >
          <span className="wn-media__play-icon" aria-hidden="true">
            <Play size={22} />
          </span>
          <span className="wn-media__play-label">Watch the preview</span>
        </a>
        {item.caption ? <figcaption className="wn-media__cap">{item.caption}</figcaption> : null}
      </figure>
    )
  }

  const tall = typeof item.ar === 'number' && item.ar < 1
  return (
    <figure className={tall ? 'wn-media wn-media--image wn-media--tall' : 'wn-media wn-media--image'}>
      <button
        type="button"
        className="wn-media__shot"
        onClick={() => onZoom({ src: item.src ?? '', alt: item.alt, caption: item.caption })}
        aria-label={`Enlarge image: ${item.alt ?? item.caption ?? 'screenshot'}`}
      >
        <img src={item.src ?? ''} alt={item.alt ?? ''} loading="lazy" />
        <span className="wn-media__zoom" aria-hidden="true">
          <Plus size={14} />
        </span>
      </button>
      {item.caption ? <figcaption className="wn-media__cap">{item.caption}</figcaption> : null}
    </figure>
  )
}

// one or more shots in a single band, columns sized to each shot's aspect ratio
// so differently shaped images land at matched heights, no cropping or stretch.
function MediaBand({ items, onZoom }: { items: WnShot[]; onZoom: (lb: Lightbox) => void }) {
  if (items.length === 1) {
    return (
      <div className="wn-band wn-band--single">
        <Shot item={items[0]} onZoom={onZoom} />
      </div>
    )
  }
  const cols = items.map((it) => `${it.ar ?? (it.kind === 'video' ? 16 / 9 : 1)}fr`).join(' ')
  return (
    <div className="wn-band wn-band--row" style={{ gridTemplateColumns: cols }}>
      {items.map((it, i) => (
        <Shot key={i} item={it} onZoom={onZoom} />
      ))}
    </div>
  )
}

function Copy({ section, extra }: { section: WnSection; extra?: ReactNode }) {
  return (
    <div className="wn-copy">
      {section.kicker ? <span className="wn-kicker">{section.kicker}</span> : null}
      {section.title ? <h3 className="wn-act-title">{section.title}</h3> : null}
      {section.body?.map((p, i) => (
        <HtmlContent key={i} html={p} className="wn-prose" as="p" />
      ))}
      {extra}
    </div>
  )
}

function L2dToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="wn-l2d-toggle"
      data-on={on || undefined}
      aria-pressed={on}
      onClick={onToggle}
    >
      <span className="wn-l2d-dot" aria-hidden="true" />
      Live2D {on ? 'on' : 'off'}
    </button>
  )
}

// the rail-preview act keeps the Live2D toggle beside the copy and drives the
// rail's animation, instead of floating a toolbar over the card.
function CardAct({ section }: { section: WnSection }) {
  const [animated, setAnimated] = useState(true)
  const card = section.media?.[0]
  const layout = section.layout === 'splitReverse' ? 'splitReverse' : 'split'
  return (
    <Reveal className={`wn-act wn-act--${layout}`} style={sectionSpanStyle(section)}>
      <Copy section={section} extra={<L2dToggle on={animated} onToggle={() => setAnimated((v) => !v)} />} />
      <div className="wn-act__media">
        <figure className="wn-media wn-media--card">
          <RailCardPreview resId={card?.resId ?? '1506'} animated={animated} />
          {card?.caption ? <figcaption className="wn-media__cap">{card.caption}</figcaption> : null}
        </figure>
      </div>
    </Reveal>
  )
}

function sectionSpanStyle(section: WnSection): CSSProperties | undefined {
  const span = section.span
  if (!span) {
    return undefined
  }

  const style: CSSProperties = {}
  if (span.columns === 'full') {
    style.gridColumn = '1 / -1'
  } else if (typeof span.columns === 'number') {
    style.gridColumn = `span ${Math.max(1, Math.min(12, span.columns))}`
  }
  if (typeof span.rows === 'number') {
    style.gridRow = `span ${Math.max(1, span.rows)}`
  }

  return style
}

function Act({ section, onZoom }: { section: WnSection; onZoom: (lb: Lightbox) => void }) {
  const { layout, media } = section
  const hasCopy = Boolean(section.kicker || section.title || section.body?.length)
  const spanStyle = sectionSpanStyle(section)

  if (media?.[0]?.kind === 'card') {
    return <CardAct section={section} />
  }

  if (layout === 'text') {
    if (section.href) {
      return (
        <Reveal className="wn-act wn-act--text wn-act--link" style={spanStyle}>
          <Link to={section.href} className="wn-act__link">
            <Copy section={section} />
            <span className="wn-act__cue">
              {section.linkText ?? 'Open page'}
              <span className="wn-act__cue-arrow" aria-hidden="true">
                &rarr;
              </span>
            </span>
          </Link>
        </Reveal>
      )
    }
    return (
      <Reveal className="wn-act wn-act--text" style={spanStyle}>
        <Copy section={section} />
      </Reveal>
    )
  }

  if ((layout === 'split' || layout === 'splitReverse') && media?.length) {
    return (
      <Reveal className={`wn-act wn-act--${layout}`} style={spanStyle}>
        <Copy section={section} />
        <div className="wn-act__media">
          <Shot item={media[0]} onZoom={onZoom} />
        </div>
      </Reveal>
    )
  }

  // stage
  return (
    <Reveal className="wn-act wn-act--stage" style={spanStyle}>
      {hasCopy ? <Copy section={section} /> : null}
      {media?.length ? (
        <div className="wn-act__media">
          <MediaBand items={media} onZoom={onZoom} />
        </div>
      ) : null}
    </Reveal>
  )
}

function Acts({ entry, onZoom }: { entry: WnEntry; onZoom: (lb: Lightbox) => void }) {
  return (
    <div className="wn-acts">
      {entry.sections.map((section) => (
        <Act key={section.id} section={section} onZoom={onZoom} />
      ))}
    </div>
  )
}

// the open representation of any entry: the full broadcast feed, identical for
// the newest entry and the oldest one.
function EntryFeed({ entry, onZoom }: { entry: WnEntry; onZoom: (lb: Lightbox) => void }) {
  return (
    <>
      <header className="wn-hero">
        <Reveal className="wn-hero__dispatch">
          <Dispatch entry={entry} />
        </Reveal>
        <Reveal className="wn-hero__headline" delay={80}>
          <h2 className="wn-hero__title">{entry.title}</h2>
        </Reveal>
        <Reveal className="wn-hero__lede-wrap" delay={160}>
          <p className="wn-hero__lede">{entry.lede}</p>
        </Reveal>
        {entry.hero ? (
          <Reveal className="wn-hero__media" delay={240}>
            <Shot item={entry.hero} onZoom={onZoom} />
          </Reveal>
        ) : null}
      </header>
      <Acts entry={entry} onZoom={onZoom} />
    </>
  )
}

// one stream entry: a row fold (collapsed) and a feed fold (expanded) that trade
// height so the row appears to grow into the feed. The feed mounts only while it
// is open or collapsing; settled means fully open, so it drops its overflow clip.
function StreamEntry({
  entry,
  open,
  renderFeed,
  settled,
  onOpen,
  onZoom,
}: {
  entry: WnEntry
  open: boolean
  renderFeed: boolean
  settled: boolean
  onOpen: () => void
  onZoom: (lb: Lightbox) => void
}) {
  const panelId = useId()
  return (
    <article
      id={entry.id}
      className="wn-entry"
      data-open={open || undefined}
      data-settled={settled || undefined}
    >
      <div className="wn-fold wn-fold--row">
        <div className="wn-fold__inner" inert={open}>
          <button
            type="button"
            className="wn-row"
            onClick={onOpen}
            aria-expanded={open}
            aria-controls={panelId}
          >
            <SignalBars live={false} />
            <span className="wn-row__main">
              <span className="wn-row__head">
                <span className="wn-tag">{entry.tag}</span>
                <span className="wn-freq">SIG {entry.signal}</span>
                <span className="wn-date">{entry.date}</span>
              </span>
              <span className="wn-row__title">{entry.title}</span>
              <span className="wn-row__summary">{entry.summary}</span>
            </span>
            <span className="wn-row__caret" aria-hidden="true">
              +
            </span>
          </button>
        </div>
      </div>
      <div className="wn-fold wn-fold--feed" id={panelId} role="region">
        <div className="wn-fold__inner" inert={!open}>
          {renderFeed ? <EntryFeed entry={entry} onZoom={onZoom} /> : null}
        </div>
      </div>
    </article>
  )
}

function resolveInitialOpen(entries: WnEntry[]): string | null {
  if (typeof window !== 'undefined') {
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''))
    if (hash && entries.some((entry) => entry.id === hash)) {
      return hash
    }
  }
  return entries[0]?.id ?? null
}

export function WhatsNewPage() {
  const location = useLocation()
  const entries = whatsNewEntries
  const [openId, setOpenId] = useState<string | null>(() => resolveInitialOpen(entries))
  // the open entry always renders its feed; closingIds holds an outgoing entry
  // just long enough to animate its collapse before it unmounts.
  const [closingIds, setClosingIds] = useState<Set<string>>(() => new Set())
  const [settledId, setSettledId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<Lightbox>(null)
  const openRef = useRef(openId)
  useEffect(() => {
    openRef.current = openId
  }, [openId])

  const openEntry = useCallback((nextId: string) => {
    const prev = openRef.current
    if (prev === nextId) return
    if (prev) {
      const closing = prev
      setClosingIds((set) => {
        const next = new Set(set)
        next.add(closing)
        return next
      })
      window.setTimeout(() => {
        setClosingIds((set) => {
          if (!set.has(closing)) return set
          const next = new Set(set)
          next.delete(closing)
          return next
        })
      }, 560)
    }
    setOpenId(nextId)
  }, [])

  // once the open feed finishes expanding it settles, dropping the overflow clip
  // so media hover shadows reach past the panel again.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledId(openId), 480)
    return () => window.clearTimeout(timer)
  }, [openId])

  useEffect(() => {
    const targetId = decodeURIComponent(location.hash.replace(/^#/, ''))
    if (!targetId || !entries.some((entry) => entry.id === targetId)) {
      return
    }

    const timer = window.setTimeout(() => {
      openEntry(targetId)
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)

    return () => window.clearTimeout(timer)
  }, [location.hash, entries, openEntry])

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  return (
    <div className="page whatsnew-page">
      <CllpPageHeyf
        eyebrow="Broadcast"
        title="What's New"
        subtitle="What changed, the long version."
        layoutKey="whatsnew-hero"
      />

      <Link to="/changelog" className="wn-back">
        <ChevronLeft size={15} />
        <span>Back to changelog</span>
      </Link>

      {entries.length > 0 ? (
        <div className="wn-feed">
          <div className="wn-stream">
            {entries.map((entry) => (
              <StreamEntry
                key={entry.id}
                entry={entry}
                open={entry.id === openId}
                renderFeed={entry.id === openId || closingIds.has(entry.id)}
                settled={entry.id === settledId}
                onOpen={() => openEntry(entry.id)}
                onZoom={setLightbox}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="wn-empty">Nothing on air right now. Check back soon.</p>
      )}

      {lightbox ? (
        <div
          className="wn-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.caption ?? lightbox.alt ?? 'Enlarged image'}
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="wn-lightbox__close"
            onClick={() => setLightbox(null)}
            aria-label="Close"
          >
            <X size={18} />
          </button>
          <figure className="wn-lightbox__figure" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.src} alt={lightbox.alt ?? ''} />
            {lightbox.caption ? <figcaption className="wn-lightbox__cap">{lightbox.caption}</figcaption> : null}
          </figure>
        </div>
      ) : null}
    </div>
  )
}
