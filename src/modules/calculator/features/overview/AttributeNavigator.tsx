/*
  Author: Runor Ewhro
  Description: Elemental spine navigator that smooth-scrolls the overview
               resonator strip to each attribute group and tracks the
               group currently in view.
*/

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties as CssProps, RefObject, SyntheticEvent as SyntVnt } from 'react'
import type { AttributeKey } from '@/domain/entities/stats'
import { toTitle } from '@/shared/lib/format'

export interface AttrGroup {
  attribute: AttributeKey
  accent: string
  firstId: string
  count: number
}

interface AttributeNavigatorProps {
  groups: AttrGroup[]
  stripRef: RefObject<HTMLElement | null>
  onImageError: (event: SyntVnt<HTMLImageElement>) => void
}

// resonator ids feed an attribute selector, so guard against any exotic chars.
function escapeId(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}

function anchorFor(strip: HTMLElement, id: string): HTMLElement | null {
  return strip.querySelector<HTMLElement>(`[data-res-id="${escapeId(id)}"]`)
}

// the strip flips between a vertical rail and a horizontal bar across breakpoints,
// so derive the scroll axis from whichever dimension actually overflows.
function isVertical(strip: HTMLElement): boolean {
  return strip.scrollHeight - strip.clientHeight >= strip.scrollWidth - strip.clientWidth
}

export function AttributeNavigator({ groups, stripRef, onImageError }: AttributeNavigatorProps) {
  const [active, setActive] = useState(0)

  // scroll-spy: light up whichever group anchor most recently crossed the lead edge.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip || groups.length === 0) {
      return
    }

    let frame = 0
    const compute = () => {
      frame = 0
      const vertical = isVertical(strip)
      const box = strip.getBoundingClientRect()
      const lead = vertical ? box.top : box.left
      const span = vertical ? box.height : box.width
      const threshold = lead + span * 0.28

      let idx = 0
      for (let i = 0; i < groups.length; i += 1) {
        const el = anchorFor(strip, groups[i].firstId)
        if (!el) {
          continue
        }
        const rect = el.getBoundingClientRect()
        const start = vertical ? rect.top : rect.left
        if (start <= threshold) {
          idx = i
        }
      }
      setActive(idx)
    }

    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(compute)
      }
    }

    compute()
    strip.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      strip.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) {
        cancelAnimationFrame(frame)
      }
    }
  }, [stripRef, groups])

  const goTo = useCallback((index: number) => {
    const strip = stripRef.current
    const group = groups[index]
    if (!strip || !group) {
      return
    }
    const el = anchorFor(strip, group.firstId)
    if (!el) {
      return
    }

    const box = strip.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    const pad = 8
    const reduce = document.documentElement.classList.contains('reduce-animation')

    // scroll on both axes; the off-axis delta is ~0 for the strip's static dimension.
    strip.scrollTo({
      top: strip.scrollTop + (rect.top - box.top) - pad,
      left: strip.scrollLeft + (rect.left - box.left) - pad,
      behavior: reduce ? 'auto' : 'smooth',
    })
    setActive(index)
  }, [groups, stripRef])

  if (groups.length < 2) {
    return null
  }

  const accent = groups[active]?.accent ?? groups[0].accent

  return (
    <nav
      className="attr-spine"
      aria-label="Jump to attribute"
      style={{ '--active-index': active, '--spine-accent': accent } as CssProps}
    >
      {groups.map((group, index) => {
        const label = toTitle(group.attribute)
        return (
          <button
            key={group.attribute}
            type="button"
            className="attr-spine-dot"
            aria-current={index === active ? 'true' : undefined}
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
              onError={onImageError}
            />
          </button>
        )
      })}
    </nav>
  )
}
