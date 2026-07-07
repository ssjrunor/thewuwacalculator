/*
  Author: Runor Ewhro
  Description: inline page hero plus a small floating pill that drops in
               from above the viewport once the user has scrolled past
               the hero. Eyebrow + title characters stagger in. Clicking
               the pill smoothly scrolls the scroll container back to top.
*/

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence as NmtPrsn, motion } from 'motion/react'

type Variant = 'default' | 'split'

type CllpPageHero = {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
  variant?: Variant
  layoutKey?: string
  onFltnCtvt?: () => void
  floatingTop?: string | number
}

const SHOW_AT = 1.0
const HIDE_AT = 0.5

const DROP_TRNS = {
  duration: 0.42,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
}

const CHARBASEDLY = 0.18
const CHAR_STAGGER = 0.024

export function CllpPageHeyf({
  eyebrow,
  title,
  subtitle,
  meta,
  trailing,
  variant = 'default',
  onFltnCtvt: onFltnCtvt,
  floatingTop,
}: CllpPageHero) {
  const heroRef = useRef<HTMLElement | null>(null)
  const scrollerRef = useRef<HTMLElement | Window | null>(null)
  const [floating, setFloating] = useState(false)

  useEffect(() => {
    const el = heroRef.current
    if (!el) return

    let scroller: HTMLElement | null = el.parentElement
    while (scroller) {
      const overflowY = getComputedStyle(scroller).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') break
      scroller = scroller.parentElement
    }
    const scrollSource: HTMLElement | Window = scroller ?? window
    scrollerRef.current = scrollSource

    let frame = 0
    const measure = () => {
      frame = 0
      const rect = el.getBoundingClientRect()
      const scrollerTop =
        scrollSource instanceof Window
          ? 0
          : (scrollSource as HTMLElement).getBoundingClientRect().top
      const heroBttmRel = rect.bottom - scrollerTop
      const h = el.offsetHeight || 1
      const p = 1 - heroBttmRel / h
      setFloating((prev) => {
        if (prev && p < HIDE_AT) return false
        if (!prev && p >= SHOW_AT) return true
        return prev
      })
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    scrollSource.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)

    return () => {
      scrollSource.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  const scrollToTop = useCallback(() => {
    onFltnCtvt?.()
    const target = scrollerRef.current
    if (!target) return
    if (target instanceof Window) {
      target.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      target.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [onFltnCtvt])

  return (
    <>
      <header
        ref={heroRef}
        className={variant === 'split' ? 'page-hero page-hero--split' : 'page-hero'}
      >
        {variant === 'split' ? (
          <>
            <div>
              {eyebrow ? <div className="page-hero-eyebrow">{eyebrow}</div> : null}
              <h1>{title}</h1>
              {meta ? <p className="page-hero-meta">{meta}</p> : null}
            </div>
            {trailing}
          </>
        ) : (
          <>
            {eyebrow ? <div className="page-hero-eyebrow">{eyebrow}</div> : null}
            <h1>{title}</h1>
            {subtitle ? <p className="page-hero-meta">{subtitle ? subtitle : meta ? meta : null}</p> : null}
          </>
        )}
      </header>

      <FltnHeroPrtl
        show={floating}
        eyebrow={eyebrow}
        title={title}
        onActivate={scrollToTop}
        top={floatingTop}
      />
    </>
  )
}

function FltnHeroPrtl({
  show,
  eyebrow,
  title,
  onActivate,
  top,
}: {
  show: boolean
  eyebrow?: ReactNode
  title: ReactNode
  onActivate: () => void
  top?: string | number
}) {
  const target = typeof document === 'undefined' ? null : document.body
  if (!target) return null

  return createPortal(
    <NmtPrsn>
      {show ? <FloatingHero eyebrow={eyebrow} title={title} onActivate={onActivate} top={top} /> : null}
    </NmtPrsn>,
    target,
  )
}

function FloatingHero({
  eyebrow,
  title,
  onActivate,
  top,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  onActivate: () => void
  top?: string | number
}) {
  const eyebrowChars = useMemo(() => splitToChars(eyebrow), [eyebrow])
  const titleChars = useMemo(() => splitToChars(title), [title])
  const eyebrowCount = eyebrowChars?.length ?? 0
  const ttlStartDly = CHARBASEDLY + eyebrowCount * CHAR_STAGGER + 0.02

  const ariaLabel = (() => {
    const parts: string[] = []
    if (typeof eyebrow === 'string') parts.push(eyebrow)
    if (typeof title === 'string') parts.push(title)
    return `Scroll to top: ${parts.join(' · ')}`.trim()
  })()

  return (
    <motion.button
      type="button"
      className="floating-page-hero"
      onClick={onActivate}
      aria-label={ariaLabel || 'Scroll to top'}
      style={top !== undefined ? { top } : undefined}
      initial={{ y: -64, opacity: 0, filter: 'blur(8px)' }}
      animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
      exit={{ y: -64, opacity: 0, filter: 'blur(8px)' }}
      transition={DROP_TRNS}
      whileHover={{ y: 2 }}
      whileTap={{ scale: 0.97 }}
    >
      <span className="floating-page-hero__indicator" aria-hidden="true" />

      {eyebrowChars ? (
        <span className="floating-page-hero__eyebrow" aria-hidden="true">
          {eyebrowChars.map((ch, i) => (
            <motion.span
              key={`e-${i}`}
              className="floating-page-hero__char"
              initial={{ opacity: 0, y: -10, rotateX: -80, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, rotateX: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, filter: 'blur(4px)', transition: { duration: 0.14 } }}
              transition={{
                delay: CHARBASEDLY + i * CHAR_STAGGER,
                duration: 0.42,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {ch === ' ' ? ' ' : ch}
            </motion.span>
          ))}
        </span>
      ) : eyebrow ? (
        <span className="floating-page-hero__eyebrow">{eyebrow}</span>
      ) : null}

      {titleChars ? (
        <span className="floating-page-hero__title" aria-hidden="true">
          {titleChars.map((ch, i) => (
            <motion.span
              key={`t-${i}`}
              className="floating-page-hero__char floating-page-hero__char--title"
              initial={{ opacity: 0, y: -14, rotateX: -85, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, rotateX: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8, filter: 'blur(6px)', transition: { duration: 0.16 } }}
              transition={{
                delay: ttlStartDly + i * CHAR_STAGGER,
                duration: 0.5,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {ch === ' ' ? ' ' : ch}
            </motion.span>
          ))}
        </span>
      ) : (
        <span className="floating-page-hero__title">{title}</span>
      )}

      <motion.span
        className="floating-page-hero__seal"
        aria-hidden="true"
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 6, transition: { duration: 0.12 } }}
        transition={{
          delay: ttlStartDly + (titleChars?.length ?? 0) * CHAR_STAGGER + 0.04,
          duration: 0.32,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        §
      </motion.span>
    </motion.button>
  )
}

function splitToChars(node: ReactNode): string[] | null {
  if (typeof node === 'string') return Array.from(node)
  if (typeof node === 'number') return Array.from(String(node))
  return null
}
