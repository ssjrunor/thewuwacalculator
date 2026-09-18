/*
  Author: Runor Ewhro
  Description: Renders permanent Simulation links and measures the sliding
               indicator beneath the active tool.
*/

import { useCallback, useEffect, useLayoutEffect as useLytFfct, useRef } from 'react'
import { AxLink } from '@/app/nav/useNavX'

export interface GoStop {
  key: string
  name: string
  to: string
}

interface AppGoRunProps {
  stops: GoStop[]
  // the active Simulation tool, or null on another route
  at: string | null
}

export function AppGoRun({ stops, at }: AppGoRunProps) {
  const run = useRef<HTMLElement | null>(null)
  const bar = useRef<HTMLSpanElement | null>(null)

  // DOM measurements drive indicator offsets without an extra React render.
  const measure = useCallback(() => {
    const node = bar.current
    const stop = run.current?.querySelector<HTMLElement>('.ax-w.is-at')
    if (!node || !stop) return

    node.style.setProperty('--x', `${stop.offsetLeft}px`)
    node.style.setProperty('--w', `${stop.offsetWidth}px`)
  }, [])

  useLytFfct(measure, [measure, at, stops])

  useEffect(() => {
    const node = run.current
    if (!node) return

    // Font loading and container resizing can change offsets without a route change.
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    void document.fonts?.ready.then(measure)

    return () => observer.disconnect()
  }, [measure])

  // Hide the indicator when the current route has no matching navigation stop.
  const adrift = !stops.some((stop) => stop.key === at)

  return (
    <nav
      className={`ax-go${adrift ? ' is-adrift' : ''}`}
      ref={run}
      aria-label="Simulation tools"
    >
      <span className="ax-go-bar" ref={bar} aria-hidden="true" />

      {stops.map((stop) => (
        <AxLink
          className={`ax-w${stop.key === at ? ' is-at' : ''}`}
          key={stop.key}
          to={stop.to}
          aria-current={stop.key === at ? 'page' : undefined}
        >
          {stop.name}
        </AxLink>
      ))}
    </nav>
  )
}
