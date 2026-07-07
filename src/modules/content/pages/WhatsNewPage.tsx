/*
  Author: Runor Ewhro
  Description: "What's New" surface. The latest entry premieres as a short
               scroll story: a hero, then a sequence of full-width acts, each
               with its own media composition (stage / split / text note) that
               rises into view on scroll. Older entries sit below as collapsible
               log rows that expand into the same act sequence. The dispatch
               header and the live equalizer carry the broadcast identity.
*/

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
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
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const { ref, shown } = useReveal<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={`wn-reveal ${shown ? 'is-in' : ''} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
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
    <Reveal className={`wn-act wn-act--${layout}`}>
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

function Act({ section, onZoom }: { section: WnSection; onZoom: (lb: Lightbox) => void }) {
  const { layout, media } = section
  const hasCopy = Boolean(section.kicker || section.title || section.body?.length)

  if (media?.[0]?.kind === 'card') {
    return <CardAct section={section} />
  }

  if (layout === 'text') {
    if (section.href) {
      return (
        <Reveal className="wn-act wn-act--text wn-act--link">
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
      <Reveal className="wn-act wn-act--text">
        <Copy section={section} />
      </Reveal>
    )
  }

  if ((layout === 'split' || layout === 'splitReverse') && media?.length) {
    return (
      <Reveal className={`wn-act wn-act--${layout}`}>
        <Copy section={section} />
        <div className="wn-act__media">
          <Shot item={media[0]} onZoom={onZoom} />
        </div>
      </Reveal>
    )
  }

  // stage
  return (
    <Reveal className="wn-act wn-act--stage">
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

function FeaturedEntry({ entry, onZoom }: { entry: WnEntry; onZoom: (lb: Lightbox) => void }) {
  return (
    <article className="wn-entry wn-entry--featured">
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
    </article>
  )
}

function LogEntry({
  entry,
  open,
  onToggle,
  onZoom,
}: {
  entry: WnEntry
  open: boolean
  onToggle: () => void
  onZoom: (lb: Lightbox) => void
}) {
  const panelId = useId()
  return (
    <article className={open ? 'wn-entry wn-entry--log is-open' : 'wn-entry wn-entry--log'}>
      <button
        type="button"
        className="wn-row"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <SignalBars live={open} />
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
          {open ? '−' : '+'}
        </span>
      </button>
      <div className="wn-collapse" id={panelId} role="region">
        <div className="wn-collapse__inner" inert={!open}>
          <Acts entry={entry} onZoom={onZoom} />
        </div>
      </div>
    </article>
  )
}

export function WhatsNewPage() {
  const featured = whatsNewEntries[0] ?? null
  const older = whatsNewEntries.slice(1)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [lightbox, setLightbox] = useState<Lightbox>(null)

  const toggle = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

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

      {featured ? (
        <div className="wn-feed">
          <FeaturedEntry entry={featured} onZoom={setLightbox} />

          {older.length > 0 ? (
            <section className="wn-log" aria-label="Earlier broadcasts">
              <div className="wn-log__head">
                <span className="wn-log__line" />
                <span className="wn-log__label">Earlier broadcasts</span>
                <span className="wn-log__line" />
              </div>
              {older.map((entry) => (
                <LogEntry
                  key={entry.id}
                  entry={entry}
                  open={openIds.has(entry.id)}
                  onToggle={() => toggle(entry.id)}
                  onZoom={setLightbox}
                />
              ))}
            </section>
          ) : (
            <p className="wn-empty">That's all...</p>
          )}
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
