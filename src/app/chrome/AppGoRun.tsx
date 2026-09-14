/*
  Author: Runor Ewhro
  Description: The half of the app you are standing in, stood on the line. Only
               ever one family: the four surfaces on a route you work on, the
               four references on a route you read, and the other family waits
               in the drawer. So the run is four words wide whichever route you
               are on, and the head never grows when navigation comes up into
               it.

               The mark under the word you are on is the rail's bar brought onto
               the line, which means it slides rather than fading in and out.
               The words are set from the page's own faces, so the bar has to be
               measured after they are laid out rather than derived from a pitch.
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
  // the stop you are standing on, or null on a route that is in neither family
  at: string | null
  // whether the run is the work rather than the reading, which is the only
  // thing that separates them once both are set in the same face
  simulation: boolean
}

export function AppGoRun({ stops, at, simulation }: AppGoRunProps) {
  const run = useRef<HTMLElement | null>(null)
  const bar = useRef<HTMLSpanElement | null>(null)

  // where the words land is the browser's answer, not React's, so the bar is
  // told where to stand rather than re-rendered into place
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

    // the words are laid out by the page's own faces, so the run has to be read
    // again once those land and again whenever the line is re-fitted
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    void document.fonts?.ready.then(measure)

    return () => observer.disconnect()
  }, [measure])

  // a route in neither family, or one this run has no word for, leaves the mark
  // empty without changing anything else about the line
  const adrift = !stops.some((stop) => stop.key === at)

  return (
    <nav
      className={`ax-go${simulation ? ' is-work' : ''}${adrift ? ' is-adrift' : ''}`}
      ref={run}
      aria-label={simulation ? 'Simulation tools' : 'Reading'}
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
