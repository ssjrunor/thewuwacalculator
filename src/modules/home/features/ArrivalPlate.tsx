/*
  Author: Runor Ewhro
  Description: Coordinates paired arrival data, artwork fallback, one-time
               activation, pointer-derived motion, and shared active selection.
*/

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as RPointerEvent } from 'react'
import type { ArrivedResonator, Arrivals } from '@/modules/home/model/arrivals'

type Side = 'l' | 'r'

interface ArrivalPlateProps {
  arrivals: Arrivals
  /** Whether this section owns the current rested home reading. */
  reading: boolean
  /** Reports the active resonator to sibling arrival metadata. */
  onLit?: (id: string | null) => void
  /** Disables entrance and pointer motion. */
  still: boolean
}

// Remounting by artwork key resets fallback state when release data changes.
function Figure({ who, className }: { who: ArrivedResonator, className: string }) {
  const [src, setSrc] = useState(who.art)

  return (
    <span className={className} aria-hidden="true">
      <img
        src={src}
        alt=""
        onError={() => {
          if (who.artFallback && src !== who.artFallback) setSrc(who.artFallback)
        }}
      />
    </span>
  )
}

function Half({ who }: { who: ArrivedResonator }) {
  return (
    <>
      <Figure who={who} className="hm-half__art" key={who.art} />
      <span className="hm-half__bloom" aria-hidden="true" />
      <span className="hm-half__scrim" aria-hidden="true" />

      <span className="hm-half__txt">
        <span className="hm-half__el">
          {[who.attributeName, who.weaponName].filter(Boolean).join(' · ')}
        </span>
        <span className="hm-half__name">{who.name}</span>
        <span className="hm-half__says">
          {who.tags.length > 0
            ? who.tags.join(', ')
            : `A new ${who.attributeName || ''} resonator.`}
        </span>
        <span className="hm-chips">
          {who.signature ? <span className="hm-chip">{who.signature.name}</span> : null}
          <span className="hm-chip hm-chip--el">{who.attributeName}</span>
        </span>
        <span className={`hm-half__held${who.held ? '' : ' is-waiting'}`}>
          <i aria-hidden="true" />
          {who.held ? 'In the app' : 'Not in yet'}
        </span>
      </span>
    </>
  )
}

export function ArrivalPlate({ arrivals, reading, onLit, still }: ArrivalPlateProps) {
  const plate = useRef<HTMLDivElement | null>(null)
  const [lit, setLit] = useState<Side | null>(null)
  const [swept, setSwept] = useState(() => still)

  const pair = arrivals.resonators.slice(0, 2)
  const [left, right] = pair

  /* Run activation once when the rested section first becomes active. Two
     animation frames ensure the initial state commits before activation. */
  useEffect(() => {
    if (!reading || swept) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSwept(true))
    })
    return () => {
      cancelAnimationFrame(first)
      if (second) cancelAnimationFrame(second)
    }
  }, [reading, swept])

  if (pair.length < 2) return null

  // Normalize pointer coordinates to [-1, 1] CSS variables unless motion is disabled.
  const track = (event: RPointerEvent<HTMLDivElement>) => {
    const node = plate.current
    if (!node || still) return
    const box = node.getBoundingClientRect()
    node.style.setProperty('--hm-px', ((event.clientX - box.left) / box.width * 2 - 1).toFixed(3))
    node.style.setProperty('--hm-py', ((event.clientY - box.top) / box.height * 2 - 1).toFixed(3))
  }

  const light = (side: Side | null, id: string | null) => {
    setLit(side)
    onLit?.(id)
  }

  const rest = () => {
    light(null, null)
    const node = plate.current
    if (!node) return
    node.style.setProperty('--hm-px', '0')
    node.style.setProperty('--hm-py', '0')
  }

  return (
    <div
      className={`hm-split${swept ? '' : ' is-shut'}`}
      ref={plate}
      data-lit={lit ?? undefined}
      style={{ '--el-l': left.colour, '--el-r': right.colour } as CSSProperties}
      onPointerMove={track}
      onPointerLeave={rest}
    >
      {pair.map((who, index) => {
        const side: Side = index === 0 ? 'l' : 'r'
        return (
          <button
            type="button" className="hm-half"
            key={who.id}
            data-side={side}
            style={{ '--el': who.colour } as CSSProperties}
            aria-label={`${who.name}, ${who.attributeName} ${who.weaponName}, ${who.held ? 'in the app' : 'not in yet'}`}
            onPointerEnter={() => light(side, who.id)}
            onFocus={() => light(side, who.id)}
            onBlur={rest}
            onClick={() => (lit === side ? rest() : light(side, who.id))}
          >
            <Half who={who} />
          </button>
        )
      })}

      <span className="hm-seam" aria-hidden="true" />
    </div>
  )
}
