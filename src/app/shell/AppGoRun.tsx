/*
  Author: Runor Ewhro
  Description: Maps active and pending routes to Simulation navigation stops
               and measures the matching indicator position.
*/

import { useCallback, useEffect, useLayoutEffect as useLytFfct, useRef } from 'react'
import { AxLink } from '@/shared/navigation/useNavX'
import { useNavPrgrs } from '@/shared/navigation/navProgress'

export interface GoStop {
  key: string
  name: string
  to: string
}

interface AppGoRunProps {
  stops: GoStop[]
  // Active stop key; null when the current route is outside Simulation.
  at: string | null
}

function aimedAt(stops: GoStop[], to: string | null): string | null {
  if (to === null) return null
  const stop = stops.find((entry) => to === entry.to || to.startsWith(`${entry.to}/`))
  return stop?.key ?? null
}

export function AppGoRun({ stops, at }: AppGoRunProps) {
  const run = useRef<HTMLElement | null>(null)
  const bar = useRef<HTMLSpanElement | null>(null)

  // Pending routes position the indicator immediately; running changes its
  // state only after the shared progress threshold has elapsed.
  const aim = useNavPrgrs((state) => state.to)
  const held = useNavPrgrs((state) => state.running)
  const aimKey = aimedAt(stops, aim)

  // DOM measurements drive indicator offsets without an extra React render.
  const measure = useCallback(() => {
    const node = bar.current
    const field = run.current
    if (!node || !field) return

    const stop = field.querySelector<HTMLElement>('.ax-w.is-aim')
      ?? field.querySelector<HTMLElement>('.ax-w.is-at')
    if (!stop) return

    node.style.setProperty('--x', `${stop.offsetLeft}px`)
    node.style.setProperty('--w', `${stop.offsetWidth}px`)
  }, [])

  useLytFfct(measure, [measure, at, stops, aimKey, held])

  useEffect(() => {
    const node = run.current
    if (!node) return

    // Font loading and container resizing can change offsets without a route change.
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    void document.fonts?.ready.then(measure)

    return () => observer.disconnect()
  }, [measure])

  // Hide the indicator when neither the current route nor the press it is
  // waiting on has a matching navigation stop.
  const adrift = !stops.some((stop) => stop.key === at) && aimKey === null

  return (
    <nav
      className={`ax-go${adrift ? ' is-adrift' : ''}${held && aimKey !== null ? ' is-held' : ''}`}
      ref={run}
      aria-label="Simulation tools"
    >
      <span className="ax-go-bar" ref={bar} aria-hidden="true" />

      {stops.map((stop) => (
        <AxLink
          className={`ax-w${stop.key === at ? ' is-at' : ''}${stop.key === aimKey ? ' is-aim' : ''}`}
          key={stop.key}
          to={stop.to}
          data-word={stop.name}
          aria-current={stop.key === at ? 'page' : undefined}
        >
          {stop.name}
        </AxLink>
      ))}
    </nav>
  )
}
