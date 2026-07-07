import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent, RefCallback, RefObject } from 'react'
import type { AttributeKey } from '@/domain/entities/stats'
import type { BenchmarkViewMode } from '@/domain/entities/preferences'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { toTitle } from '@/shared/lib/format'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import { type CssVars } from './ui.tsx'

export interface BenchAttrGroup {
  attribute: AttributeKey
  accent: string
  firstId: string
  count: number
}

export interface BenchmarkRosterEntry {
  id: string
  name: string
  profile: string
  sprite: string
  spriteCss: CSSProperties
  attribute: AttributeKey
  accent: string
  level: number
  sequence: number
}

export function BenchmarkResonatorRail({
  viewMode,
  roster,
  groups,
  stripRef,
  selectedResId,
  activeResId,
  phase,
  onSelect,
  selection,
}: {
  viewMode: BenchmarkViewMode
  roster: BenchmarkRosterEntry[]
  groups: BenchAttrGroup[]
  stripRef: RefObject<HTMLElement | null>
  selectedResId: string | null
  activeResId: string | null
  phase: 'idle' | 'out' | 'in'
  onSelect: (id: string) => void
  selection?: {
    selectionMode: boolean
    isSelected: (id: string) => boolean
    buildClickCapture: (id: string) => (event: MouseEvent<HTMLElement>) => void
    getItems: (id: string) => MenuEntry[]
    surfaceProps: {
      ref?: RefCallback<HTMLElement>
      tabIndex?: number
      onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
      'data-selection-focus-scope'?: string
      'data-selection-focus-active'?: string
      'data-selection-mode-active'?: string
    }
  }
}) {
  const isShowcase = viewMode === 'showcase'
  const setStripRef = useCallback((element: HTMLElement | null) => {
    stripRef.current = element
    selection?.surfaceProps.ref?.(element)
  }, [selection, stripRef])

  return (
    <div className={isShowcase ? 'overview-resonator-rail' : 'bench-roster-dock'} data-phase={phase}>
      <BenchmarkAttributeRail viewMode={viewMode} groups={groups} stripRef={stripRef} />
      <nav
        className={isShowcase ? 'overview-resonator-strip' : 'bench-roster'}
        aria-label={isShowcase ? 'Resonator browser' : 'Initialized resonators'}
        ref={setStripRef}
        tabIndex={selection?.surfaceProps.tabIndex}
        data-selection-focus-scope={selection?.surfaceProps['data-selection-focus-scope']}
        data-selection-focus-active={selection?.surfaceProps['data-selection-focus-active']}
        data-selection-mode-active={selection?.surfaceProps['data-selection-mode-active']}
        onKeyDown={selection?.surfaceProps.onKeyDown}
      >
      {roster.map((entry, index) => {
        const isSelected = entry.id === selectedResId
        const isActive = entry.id === activeResId
        const isPicked = selection?.isSelected(entry.id) ?? false
        const selectionClasses = [
          isPicked ? 'focus-selected' : '',
          selection?.selectionMode ? 'selection-mode' : '',
        ].filter(Boolean).join(' ')
        const button = isShowcase ? (
          <button
            key={entry.id}
            type="button"
            className={[
              'overview-resonator-pill',
              isSelected ? 'inspected' : '',
              selectionClasses,
            ].filter(Boolean).join(' ')}
            onClick={() => onSelect(entry.id)}
            onClickCapture={selection?.buildClickCapture(entry.id)}
            aria-pressed={isSelected}
            data-res-id={entry.id}
            data-inspected={isSelected ? 'true' : undefined}
            data-selected={isPicked ? 'true' : undefined}
            data-selection-focus-item="true"
            style={{
              '--browser-accent': entry.accent,
              ...entry.spriteCss,
            } as CssVars}
          >
            <span className="overview-resonator-pill-frame" aria-hidden="true">
              <img
                src={entry.sprite}
                alt=""
                className="overview-resonator-pill-portrait"
                loading="lazy"
                decoding="async"
                onError={withDefIconM}
              />
            </span>
            <span className="overview-resonator-pill-name">{entry.name}</span>
            <span className="overview-resonator-pill-meta">
              <span className="overview-resonator-pill-level">Lv.{entry.level}</span>
              <span
                className="overview-resonator-pill-sequence"
                aria-label={`Sequence ${entry.sequence} of 6`}
              >
                {Array.from({ length: 6 }, (_, pip) => (
                  <i key={pip} data-on={pip < entry.sequence ? 'true' : undefined} />
                ))}
              </span>
            </span>
            {isActive ? <span className="overview-resonator-pill-current" aria-label="Currently active" /> : null}
          </button>
        ) : (
          <button
            key={entry.id}
            type="button"
            data-res-id={entry.id}
            className={[
              'bench-roster-item',
              isSelected ? 'is-active' : '',
              selectionClasses,
            ].filter(Boolean).join(' ')}
            style={{ '--browser-accent': entry.accent, '--ri': index } as CssVars}
            onClick={() => onSelect(entry.id)}
            onClickCapture={selection?.buildClickCapture(entry.id)}
            aria-pressed={isSelected}
            data-selected={isPicked ? 'true' : undefined}
            data-selection-focus-item="true"
            title={`${entry.name} · Lv.${entry.level} · S${entry.sequence}`}
          >
            {!isSelected ? (
              <span className="bench-roster-hint" aria-hidden="true">{entry.name}</span>
            ) : null}
            <span className="bench-roster-frame">
              <img
                src={entry.profile}
                alt={entry.name}
                className="bench-roster-portrait"
                loading="lazy"
                decoding="async"
                onError={withDefIconM}
              />
              {getAttributeIconSrc(entry.attribute) ? (
                <img
                  src={getAttributeIconSrc(entry.attribute) ?? ''}
                  alt=""
                  className="bench-roster-attr"
                  loading="lazy"
                  onError={withDefIconM}
                />
              ) : null}
            </span>
            {isSelected ? (
              <span className="bench-roster-meta">
                <strong className="bench-roster-name">{entry.name}</strong>
                <span className="bench-roster-sub">
                  <span className="bench-roster-lv">Lv.{entry.level}</span>
                  <span className="bench-roster-seq" aria-label={`Sequence ${entry.sequence} of 6`}>
                    {Array.from({ length: 6 }, (_, pip) => (
                      <i key={pip} data-on={pip < entry.sequence ? 'true' : undefined} />
                    ))}
                  </span>
                </span>
              </span>
            ) : null}
          </button>
        )
        return selection ? (
          <ContextTrigger
            key={entry.id}
            asChild
            ariaLabel={`${entry.name} actions`}
            items={selection.getItems(entry.id)}
          >
            {button}
          </ContextTrigger>
        ) : (
          button
        )
      })}
      </nav>
    </div>
  )
}

function rosterAnchor(strip: HTMLElement, id: string): HTMLElement | null {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(id)
    : id.replace(/["\\]/g, '\\$&')
  return strip.querySelector<HTMLElement>(`[data-res-id="${escaped}"]`)
}

interface RailMetrics {
  positions: number[]
  active: number
  thumbStart: number
  thumbSize: number
}

const EMPTY_RAIL_METRICS: RailMetrics = { positions: [], active: 0, thumbStart: 0, thumbSize: 1 }

function railIsVertical(strip: HTMLElement): boolean {
  return strip.scrollHeight - strip.clientHeight >= strip.scrollWidth - strip.clientWidth
}

function BenchmarkAttributeRail({
  viewMode,
  groups,
  stripRef,
}: {
  viewMode: BenchmarkViewMode
  groups: BenchAttrGroup[]
  stripRef: RefObject<HTMLElement | null>
}) {
  const [metrics, setMetrics] = useState<RailMetrics>(EMPTY_RAIL_METRICS)

  const measure = useCallback(() => {
    const strip = stripRef.current
    if (!strip || groups.length === 0) {
      return
    }
    const vertical = viewMode === 'benchmark' || railIsVertical(strip)
    const total = (vertical ? strip.scrollHeight : strip.scrollWidth) || 1
    const view = vertical ? strip.clientHeight : strip.clientWidth
    const scroll = vertical ? strip.scrollTop : strip.scrollLeft
    const stripRect = strip.getBoundingClientRect()
    const threshold = scroll + view * 0.3

    let active = 0
    const positions = groups.map((group, index) => {
      const el = rosterAnchor(strip, group.firstId)
      if (!el) {
        return 0
      }
      const rect = el.getBoundingClientRect()
      const start = vertical
        ? (rect.top - stripRect.top) + strip.scrollTop
        : (rect.left - stripRect.left) + strip.scrollLeft
      if (start <= threshold) {
        active = index
      }
      const center = start + (vertical ? rect.height : rect.width) / 2
      return Math.max(0, Math.min(1, center / total))
    })

    setMetrics({
      positions,
      active,
      thumbStart: Math.max(0, Math.min(1, scroll / total)),
      thumbSize: Math.max(0.08, Math.min(1, view / total)),
    })
  }, [groups, stripRef, viewMode])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) {
      return
    }
    let frame = 0
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0
          measure()
        })
      }
    }
    strip.addEventListener('scroll', schedule, { passive: true })
    strip.addEventListener('transitionend', schedule)
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    observer?.observe(strip)
    return () => {
      strip.removeEventListener('scroll', schedule)
      strip.removeEventListener('transitionend', schedule)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
      if (frame) {
        cancelAnimationFrame(frame)
      }
    }
  }, [measure, stripRef])

  const goTo = useCallback((index: number) => {
    const strip = stripRef.current
    const group = groups[index]
    if (!strip || !group) {
      return
    }
    const el = rosterAnchor(strip, group.firstId)
    if (!el) {
      return
    }
    const box = strip.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    const vertical = viewMode === 'benchmark' || railIsVertical(strip)
    const pad = viewMode === 'benchmark' ? 16 : 8
    const reduce = document.documentElement.classList.contains('reduce-animation')
    strip.scrollTo({
      top: vertical ? strip.scrollTop + (rect.top - box.top) - pad : strip.scrollTop,
      left: vertical ? strip.scrollLeft : strip.scrollLeft + (rect.left - box.left) - pad,
      behavior: reduce ? 'auto' : 'smooth',
    })
    setMetrics((current) => ({ ...current, active: index }))
  }, [groups, stripRef, viewMode])

  if (groups.length < 2) {
    return null
  }

  const activeAccent = groups[metrics.active]?.accent ?? groups[0]?.accent ?? 'var(--resonator-accent)'

  if (viewMode === 'showcase') {
    return (
      <nav
        className="attr-spine"
        aria-label="Jump to attribute"
        style={{ '--active-index': metrics.active, '--spine-accent': activeAccent } as CssVars}
      >
        {groups.map((group, index) => {
          const label = toTitle(group.attribute)
          return (
            <button
              key={group.attribute}
              type="button"
              className="attr-spine-dot"
              aria-current={index === metrics.active ? 'true' : undefined}
              aria-label={`${label} - ${group.count} ${group.count === 1 ? 'resonator' : 'resonators'}`}
              title={label}
              onClick={() => goTo(index)}
            >
              <img
                src={`/assets/attributes/attributes alt/${group.attribute}.webp`}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
                onError={withDefIconM}
              />
            </button>
          )
        })}
      </nav>
    )
  }

  return (
    <div
      className="bench-attr-rail"
      role="navigation"
      aria-label="Jump to attribute"
      style={{ '--spine-accent': activeAccent } as CssVars}
    >
      <span className="bench-attr-rail-track" aria-hidden="true" />
      <span
        className="bench-attr-thumb"
        aria-hidden="true"
        style={{ '--thumb-top': metrics.thumbStart, '--thumb-h': metrics.thumbSize } as CssVars}
      />
      {groups.map((group, index) => {
        const isActive = index === metrics.active
        return (
          <button
            key={group.attribute}
            type="button"
            className={`bench-attr-dot${isActive ? ' is-active' : ''}`}
            style={{ '--dot-accent': group.accent, '--pos': metrics.positions[index] ?? 0 } as CssVars}
            aria-current={isActive ? 'true' : undefined}
            title={`${toTitle(group.attribute)} · ${group.count}`}
            onClick={() => goTo(index)}
          >
            {getAttributeIconSrc(group.attribute) ? (
              <img
                src={getAttributeIconSrc(group.attribute) ?? ''}
                alt={toTitle(group.attribute)}
                className="bench-attr-dot-icon"
                loading="lazy"
                decoding="async"
                onError={withDefIconM}
              />
            ) : null}
            <span className="bench-attr-dot-count">{group.count}</span>
          </button>
        )
      })}
    </div>
  )
}
