/*
  Author: Runor Ewhro
  Description: Coordinates the transient Echo-import notification with route
               context, Modulation seat state, timeout control, and navigation.
*/

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { useAppStore, selContextResonatorId } from '@/application/state'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display.ts'
import { SIMULATION_ROUTES } from '@/shared/lib/appRoutes.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { withDefResMg } from '@/shared/lib/imageFallback'
import { useNavX } from '@/shared/navigation/useNavX'
import {
  isSeated,
  useImportLanding,
  type ImportLanding,
} from '@/modules/simulation/features/echoes/lib/importLanding.ts'

// A notification that can navigate to an unresolved destination needs a longer
// lifetime than one confirming an already-seated import.
const LIFE_SEEN = 2800
const LIFE_LINKED = 17000
const EXIT_MS = 240
const TAB_SELECTOR = `.ax-go .ax-w[href="${SIMULATION_ROUTES.modulation}"]`

interface TabBox {
  left: number
  right: number
  top: number
  bottom: number
}

function onModulation(pathname: string): boolean {
  const root = SIMULATION_ROUTES.modulation
  return pathname === root || pathname.startsWith(`${root}/`)
}

function useTabBox(active: boolean, pathname: string): TabBox | null {
  const [box, setBox] = useState<TabBox | null>(null)

  const measure = useCallback(() => {
    const tab = document.querySelector<HTMLElement>(TAB_SELECTOR)
    if (!tab) {
      setBox(null)
      return
    }
    const rect = tab.getBoundingClientRect()
    setBox((prev) => (
      prev && prev.left === rect.left && prev.right === rect.right
        && prev.top === rect.top && prev.bottom === rect.bottom
        ? prev
        : { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    ))
  }, [])

  useLayoutEffect(() => {
    if (!active) return undefined

    // Re-measure for every source of navigation geometry changes. ResizeObserver
    // supplies the initial measurement when the header is already mounted.
    const head = document.querySelector<HTMLElement>('.ax-head')
    const observer = new ResizeObserver(measure)
    if (head) observer.observe(head)
    head?.addEventListener('transitionend', measure)
    window.addEventListener('resize', measure)
    void document.fonts?.ready.then(measure)
    const settled = window.setTimeout(measure, 520)

    return () => {
      observer.disconnect()
      head?.removeEventListener('transitionend', measure)
      window.removeEventListener('resize', measure)
      window.clearTimeout(settled)
    }
  }, [active, measure, pathname])

  return active ? box : null
}

export function ImportStamp() {
  const landing = useImportLanding((state) => state.landing)
  const seat = useImportLanding((state) => state.seat)
  const { pathname } = useLocation()
  const box = useTabBox(landing !== null, pathname)

  const clear = useImportLanding((state) => state.clear)

  // Clear the pending navigation action once its destination becomes the
  // canonical Modulation seat.
  useEffect(() => {
    if (landing?.linked && isSeated(seat, landing)) clear(landing.key)
  }, [clear, landing, seat])

  if (!landing || !box) return null
  const host = mainPortal()
  if (!host) return null

  return createPortal(
    <StampFace key={landing.key} landing={landing} box={box} pathname={pathname} />,
    host,
  )
}

function StampFace({ landing, box, pathname }: { landing: ImportLanding; box: TabBox; pathname: string }) {
  const navX = useNavX()
  const clear = useImportLanding((state) => state.clear)
  const askSeat = useImportLanding((state) => state.askSeat)
  const contextId = useAppStore(selContextResonatorId)
  const [leaving, setLeaving] = useState(false)
  const [paused, setPaused] = useState(false)
  const clock = useRef({ left: landing.linked ? LIFE_LINKED : LIFE_SEEN, from: 0, timer: 0 })

  const seed = getResSeedBy(landing.resonatorId)
  const lead = landing.kind === 'team' ? getResSeedBy(landing.contextId) : null
  const name = seed?.name ?? 'Resonator'
  const ink = seed ? ATTR_COLORS[seed.attribute] : undefined
  const life = landing.linked ? LIFE_LINKED : LIFE_SEEN

  const here = onModulation(pathname)
  const cta = !here
    ? 'Open in Modulation'
    : contextId !== landing.contextId
      ? lead ? `View ${name} in ${lead.name}'s team` : `Switch to ${name}`
      : `View ${name}`
  const place = lead ? `Imported build applied to ${lead.name}'s team` : 'Imported build applied'

  const run = useCallback(() => {
    const state = clock.current
    state.from = performance.now()
    state.timer = window.setTimeout(() => {
      setLeaving(true)
      window.setTimeout(() => {
        clear(landing.key)
      }, EXIT_MS)
    }, state.left)
  }, [clear, landing.key])

  const hold = useCallback(() => {
    const state = clock.current
    window.clearTimeout(state.timer)
    state.left = Math.max(0, state.left - (performance.now() - state.from))
  }, [])

  useEffect(() => {
    run()
    const state = clock.current
    return () => window.clearTimeout(state.timer)
  }, [run])

  const go = useCallback(() => {
    const state = useAppStore.getState()
    if (selContextResonatorId(state) !== landing.contextId) {
      state.selectContextResonator(landing.contextId)
    }
    askSeat({ contextId: landing.contextId, memberId: landing.resonatorId })
    if (!onModulation(pathname)) navX(SIMULATION_ROUTES.modulation)
    clear(landing.key)
  }, [askSeat, clear, landing, navX, pathname])

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    go()
  }

  const style = {
    '--is-ink': ink,
    '--is-life': `${life}ms`,
    '--is-tab-l': `${box.left}px`,
    '--is-tab-w': `${box.right - box.left}px`,
    '--is-tab-b': `${box.bottom}px`,
    // Clamp the portal coordinate when the navigation target is near the edge.
    '--is-card-l': `${Math.max(8, box.left - 26)}px`,
  } as CSSProperties

  const face = seed?.profile
    ? <img className="is-face" src={seed.profile} alt="" onError={withDefResMg} />
    : <span className="is-face" aria-hidden="true" />

  const linked = landing.linked
  return (
    <div
      className={`import-stamp${leaving ? ' is-leaving' : ''}${paused ? ' is-paused' : ''}`}
      style={style}
      onPointerEnter={() => { if (!paused) { setPaused(true); hold() } }}
      onPointerLeave={() => { if (paused) { setPaused(false); run() } }}
    >
      <span className="is-tab" aria-hidden="true" />
      <span className="is-stem" aria-hidden="true" />
      <div
        className={`is-card${linked ? ' is-card--linked' : ''}`}
        role={linked ? 'button' : 'status'}
        tabIndex={linked ? 0 : undefined}
        aria-live="polite"
        aria-label={linked ? `${name}: ${place}. ${cta}` : undefined}
        onClick={linked ? go : undefined}
        onKeyDown={linked ? onKey : undefined}
      >
        {linked ? <span className="is-drain" aria-hidden="true" /> : null}
        {face}
        <span className="is-copy">
          <b className="is-name">{name}</b>
          <span className="is-place">{place}</span>
          {linked ? <span className="is-cta">{cta}<i aria-hidden="true" /></span> : null}
        </span>
      </div>
    </div>
  )
}
