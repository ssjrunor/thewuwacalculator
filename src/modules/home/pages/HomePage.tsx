/*
  Author: Runor Ewhro
  Description: Coordinates the home route's section model, catalog coverage,
               remote arrivals, stable artwork selection, deep links, and
               application-shell portal.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { AxLink } from '@/app/nav/useNavX'
import { useAppStore } from '@/domain/state/store'
import { SIMULATION_PAGES, creditFor } from '@/app/chrome/appIndex'
import { useAppSnapshot } from '@/app/chrome/useAppSnapshot'
import { useChromeIndex } from '@/app/chrome/chromeIndex'
import { STATE_LABELS, STATUS_DATA } from '@/data/content/appStatus'
import { getWhatsNewEntries } from '@/data/content/changelogEntries'
import { listResonators, listEchoes } from '@/domain/services/catalogService'
import { getWeapons } from '@/data/gameData/weapons/weaponDataStore'
import { SONATA_SETS } from '@/data/gameData/catalog/sonataSets'
import { loadEnemyCat } from '@/domain/services/enemyCatalogService'
import { APP_ROUTES, WHATS_NEW_ACT } from '@/shared/lib/appRoutes'
import { mainPortal } from '@/shared/lib/portalTarget'
import { ArrivalPlate } from '@/modules/home/features/ArrivalPlate'
import { WhatsNewIndex } from '@/modules/home/features/WhatsNewIndex'
import { loadArrivals } from '@/modules/home/model/arrivals'
import type { Arrivals } from '@/modules/home/model/arrivals'

const REPORT_ART = '/assets/home/cs-1.webp'
const ARRIVAL_ART = '/assets/home/cs-4.webp'
const WORK_ART = '/assets/home/sc-rotation.webp'
const RELEASE_ART = '/assets/home/cs-3.webp'
const ABOUT_ART = '/assets/home/cs-2.webp'

// Debounce artwork selection so transient sections crossed during scrolling do not trigger swaps.
const ROOM_WAIT = 420

type ActId = 'condition' | 'arrivals' | 'work' | 'whatsnew' | 'about'

interface Act {
  id: ActId
  label: string
  art: string
  wide?: boolean
}

// Reduced-motion preference overrides persisted animation state before document classes exist.
function osPrefersStill() {
  if (typeof window === 'undefined') return true
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

// Return a value only after it remains unchanged for the requested interval.
function useRested<T>(value: T, ms: number): T {
  const [rested, setRested] = useState(value)

  useEffect(() => {
    if (value === rested) return
    const timer = window.setTimeout(() => setRested(value), ms)
    return () => window.clearTimeout(timer)
  }, [ms, rested, value])

  return rested
}

// Derive counts directly from catalogs; enemy data resolves asynchronously.
function useCoverage() {
  const [enemies, setEnemies] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    void loadEnemyCat()
        .then((entries) => { if (live) setEnemies(entries.length) })
        .catch(() => { if (live) setEnemies(null) })
    return () => { live = false }
  }, [])

  return useMemo(() => {
    const size: Record<string, number | null> = {
      resonators: listResonators().length,
      weapons: getWeapons().length,
      echoes: listEchoes().length,
      enemies,
    }
    return STATUS_DATA.coverage.map((domain) => ({
      ...domain,
      count: size[domain.key] ?? null,
      extra: domain.key === 'echoes' ? `${SONATA_SETS.length} sets` : '',
    }))
  }, [enemies])
}

const HAS_RELEASES = getWhatsNewEntries().length > 0

export function HomePage() {
  const snapshot = useAppSnapshot()
  const coverage = useCoverage()
  const entrances = useAppStore((state) => state.ui.entranceAnimations)
  const still = !entrances || osPrefersStill()
  const { hash } = useLocation()
  const wanted = decodeURIComponent(hash.replace(/^#/, ''))
  // Deep links encode a release id after the whatsnew section prefix.
  const wantedRelease = wanted.startsWith(`${WHATS_NEW_ACT}-`) ? wanted.slice(WHATS_NEW_ACT.length + 1) : null

  const page = useRef<HTMLDivElement | null>(null)
  /* Resolve the portal host during render so route-transition capture includes
     the backdrop. The ref fallback handles a cold render before shell attachment. */
  const [shell, setShell] = useState<HTMLElement | null>(() => mainPortal())
  const holdPage = useCallback((node: HTMLDivElement | null) => {
    page.current = node
    if (!node) return
    setShell((known) => known ?? (node.closest('.app-shell') as HTMLElement | null))
  }, [])

  // Arm later artwork transitions one frame after initial mount.
  const [roomLive, setRoomLive] = useState(false)
  useEffect(() => {
    if (roomLive) return
    const frame = requestAnimationFrame(() => setRoomLive(true))
    return () => cancelAnimationFrame(frame)
  }, [roomLive])
  // Undefined means pending; null means unavailable. Neither changes section structure.
  const [arrivals, setArrivals] = useState<Arrivals | null | undefined>(undefined)
  const [reading, setReading] = useState(0)
  const [covOpen, setCovOpen] = useState(false)
  // The active resonator coordinates the plate and associated signature entry.
  const [litArrival, setLitArrival] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void loadArrivals().then((found) => { if (live) setArrivals(found) })
    return () => { live = false }
  }, [])

  // Keep section offsets and deep-link targets independent of remote arrival resolution.
  const acts = useMemo<Act[]>(() => [
    { id: 'condition', label: 'From the dev', art: REPORT_ART },
    { id: 'arrivals', label: 'Just arrived', art: ARRIVAL_ART, wide: true },
    { id: 'work', label: 'The work', art: WORK_ART },
    ...(HAS_RELEASES ? [{ id: 'whatsnew' as const, label: 'What’s new', art: RELEASE_ART }] : []),
    { id: 'about', label: 'About', art: ABOUT_ART },
  ], [])

  const arts = useMemo(() => [...new Set(acts.map((act) => act.art))], [acts])
  // Section state updates immediately; artwork selection uses the debounced index.
  const resting = useRested(reading, ROOM_WAIT)
  const backdrop = acts[Math.min(resting, acts.length - 1)]?.art ?? REPORT_ART
  const credit = creditFor(backdrop)

  // Select the last section whose top has crossed the scroll viewport midpoint.
  const scan = useCallback(() => {
    const root = page.current
    const aperture = root?.closest('.main-content') as HTMLElement | null
    if (!root || !aperture) return

    const middle = aperture.scrollTop + aperture.clientHeight * 0.5
    const sections = Array.from(root.querySelectorAll<HTMLElement>('.hm-act'))
    let at = 0
    sections.forEach((section, index) => { if (section.offsetTop <= middle) at = index })
    setReading(at)
  }, [])

  useEffect(() => {
    const root = page.current
    const aperture = root?.closest('.main-content') as HTMLElement | null
    if (!root || !aperture) return

    /* Section height follows the actual scroll aperture instead of viewport
       height. Debounce resize updates during header animation, then correct once
       active header animations settle to avoid reflow on every transition frame. */
    let live = true
    let settle = 0
    const fit = () => {
      if (live) root.style.setProperty('--hm-act-h', `${aperture.clientHeight}px`)
    }
    fit()

    const line = document.querySelector('.ax-head')
    const moving = line?.getAnimations() ?? []
    if (moving.length > 0) {
      void Promise.allSettled(moving.map((one) => one.finished)).then(fit)
    }

    const resize = new ResizeObserver(() => {
      window.clearTimeout(settle)
      settle = window.setTimeout(fit, 180)
    })
    resize.observe(aperture)

    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; scan() })
    }

    frame = requestAnimationFrame(() => { frame = 0; scan() })
    aperture.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      live = false
      window.clearTimeout(settle)
      resize.disconnect()
      aperture.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [acts.length, scan])

  const goTo = useCallback((index: number) => {
    const root = page.current
    const aperture = root?.closest('.main-content') as HTMLElement | null
    const section = root?.querySelectorAll<HTMLElement>('.hm-act')[index]
    if (!aperture || !section) return
    aperture.scrollTo({ top: section.offsetTop, behavior: still ? 'auto' : 'smooth' })
    // Synchronize section state because smooth-scroll reporting can lag behind the jump.
    requestAnimationFrame(scan)
  }, [scan, still])

  const goToAct = useCallback((id: ActId) => {
    const index = acts.findIndex((act) => act.id === id)
    if (index >= 0) goTo(index)
  }, [acts, goTo])

  // Redirect the global status stamp to the inline section and restore it on unmount.
  const { setStamp } = useChromeIndex()
  useEffect(() => {
    setStamp(() => goToAct('condition'))
    return () => setStamp(null)
  }, [goToAct, setStamp])

  // Resolve section and release hashes after the stable section model exists.
  useEffect(() => {
    const id = (wanted.startsWith(WHATS_NEW_ACT) ? WHATS_NEW_ACT : wanted) as ActId
    const index = acts.findIndex((act) => act.id === id)
    if (index > 0) goTo(index)
  }, [acts, goTo, wanted])

  const covered = coverage.filter((domain) => domain.status === 'ok').length

  return (
    <div className="hm" ref={holdPage}>
      {shell ? createPortal(
        <>
          <div className={`hm-room${roomLive ? ' is-live' : ''}`} aria-hidden="true">
            <div className="hm-art">
              {arts.map((art) => (
                <img className={art === backdrop ? 'is-on' : undefined} src={art} alt="" key={art} />
              ))}
            </div>
            <div className="hm-veil" />
          </div>

          <p className="hm-credit">
            {credit ? <span key={backdrop}><b>{credit.subject}</b> by <i>{credit.artist}</i></span> : null}
          </p>
        </>,
        shell,
      ) : null}

      <nav className="hm-index" aria-label="Sections">
        <ol>
          {acts.map((act, index) => (
            <li className={index === reading ? 'is-on' : undefined} key={act.id}>
              <button type="button" onClick={() => goTo(index)}>{act.label}</button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="hm-act" id="condition">
        <div className="hm-act__in">
          <p className="hm-state">
            {STATE_LABELS[STATUS_DATA.overallState]}
          </p>
          <p className="hm-from">
            <span className={`hm-dot${STATUS_DATA.overallState === 'stable' ? '' : ' is-warn'}`} />
            From the dev · {STATUS_DATA.lastUpdated}
          </p>

          <p className="hm-hey">{STATUS_DATA.notes[0]}</p>
          {STATUS_DATA.notes.slice(1).map((note) => <p className="hm-line" key={note}>{note}</p>)}

          {STATUS_DATA.recentChanges.length > 0 ? (
            <div className="hm-latest">
              <b>{STATUS_DATA.recentChanges.length === 1 ? 'Latest' : 'Lately'}</b>
              <ul>{STATUS_DATA.recentChanges.map((one) => <li key={one}>{one}</li>)}</ul>
            </div>
          ) : null}

          <p className="hm-stamp">
            <span>Patch <b>v{STATUS_DATA.patchVersion}</b></span>
            <span className="hm-stamp__sep">·</span>
            <button type="button" aria-expanded={covOpen} onClick={() => setCovOpen((open) => !open)}>
              Coverage <b>{covered}/{coverage.length}</b>
            </button>
            <span className="hm-stamp__sep">·</span>
            <span>Issues <b>{STATUS_DATA.knownIssues.length}</b></span>
            <span className="hm-stamp__sep">·</span>
            <span>
              Via {STATUS_DATA.dataSources.map((source, index) => (
                <span key={source.label}>
                  {index > 0 ? ', ' : ''}
                  <a href={source.href} target="_blank" rel="noopener noreferrer">{source.label}</a>
                </span>
              ))}
            </span>
          </p>

          {covOpen ? (
            <div className="hm-cov">
              {coverage.map((domain, index) => (
                <div className="hm-cov__row" style={{ '--d': `${0.1 + index * 0.1}s` } as never} key={domain.key}>
                  <span>{domain.title}{domain.status !== 'ok' && domain.note ? <em>{domain.note}</em> : null}</span>
                  <b className={domain.status === 'ok' ? undefined : 'is-down'}>
                    {domain.count === null ? '—' : domain.count.toLocaleString()}
                    {domain.extra ? <u>· {domain.extra}</u> : null}
                  </b>
                  <i />
                </div>
              ))}
              <p className="hm-cov__foot">
                Patch {STATUS_DATA.patchVersion} · last updated at {STATUS_DATA.lastUpdated}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="hm-act hm-act--wide" id="arrivals">
        <div className="hm-act__in">
          <p className="hm-kick">
            {arrivals
              ? `Live on ${arrivals.live}${arrivals.hotfix ? ` · hotfix ${arrivals.hotfix}` : ''}`
              : arrivals === null
                ? 'The patch feed is out of reach'
                : 'Reading the patch feed'}
          </p>
          <h2>
            Latest additions~ ( ˘͈ ᵕ ˘͈♡)
          </h2>

          {arrivals ? (
            <>
              <ArrivalPlate
                arrivals={arrivals}
                reading={acts[resting]?.id === 'arrivals'}
                onLit={setLitArrival}
                still={still}
              />

              <div className="hm-alsos">
                {arrivals.resonators.map((who) => (
                  who.signature ? (
                    <div
                      className={`hm-also${litArrival === who.id ? ' is-lit' : ''}`}
                      style={{ '--el': who.colour } as never}
                      key={who.signature.id}
                    >
                      {who.signature.icon ? <img src={who.signature.icon} alt="" /> : null}
                      <span>
                        <span className="hm-also__k">{who.name}&rsquo;s weapon</span>
                        <span className="hm-also__v">{who.signature.name}</span>
                      </span>
                    </div>
                  ) : null
                ))}
                {arrivals.echoes.map((echo) => (
                  <div className="hm-also" key={echo.id}>
                    {echo.icon ? <img src={echo.icon} alt="" /> : null}
                    <span>
                      <span className="hm-also__k">New echo</span>
                      <span className="hm-also__v">{echo.name}</span>
                    </span>
                  </div>
                ))}
                {arrivals.enemies > 0 ? (
                  <div className="hm-also">
                    <span className="hm-also__n">{arrivals.enemies}</span>
                    <span>
                      <span className="hm-also__k">New enemies</span>
                      <span className="hm-also__v is-quiet">all measurable</span>
                    </span>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="hm-split hm-split--bare">
              <p>
                {arrivals === null ? (
                  <>
                    Nanoka is not answering right now, so there is nothing to show here.
                    The <AxLink to={APP_ROUTES.changelog}>changelog</AxLink> has what landed.
                  </>
                ) : 'Checking what the game shipped last..'}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="hm-act" id="work">
        <div className="hm-act__in">
          <p className="hm-kick">The actual IMPORTANT stuff (˶˃ ᵕ ˂˶) .ᐟ.ᐟ</p>
          <h2>The stuff you're probably here for.. heh..</h2>

          <div className="hm-work">
            {SIMULATION_PAGES.map((surface, index) => {
              const read = snapshot.reading[surface.id]
              return (
                <div className={`hm-row${index === 0 ? ' is-open' : ''}`} key={surface.id}>
                  <div>
                    <h3>
                      <AxLink to={surface.to}>{surface.name}</AxLink>
                      <em>{surface.scope}</em>
                    </h3>
                    <p>{surface.says}</p>
                  </div>
                  {read ? (
                    <span className="hm-read">
                      <span className="hm-read__k">{read.label}</span>
                      <span className="hm-read__v">{read.value}</span>
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {HAS_RELEASES ? (
        <section className="hm-act hm-act--wn" id="whatsnew">
          <WhatsNewIndex still={still} openEntry={wantedRelease} />
        </section>
      ) : null}

      <section className="hm-act" id="about">
        <div className="hm-act__in">
          <p className="hm-kick">About</p>
          <h2>A fan-made reference calculator for Wuthering Waves.</h2>

          <div className="hm-about">
            <div>
              <h4>What it is</h4>
              <p>
                Build analysis, formula checking and stat comparison, in the browser. Not playable game
                content, not a client, and not an account service.
              </p>
            </div>
            <div>
              <h4>Who builds it</h4>
              <p>
                Designed, coded and maintained by{' '}
                <a href="https://ko-fi.com/ssjrunor" target="_blank" rel="noopener noreferrer">ssjrunor</a>.
                Unofficial, and not affiliated with Kuro Games.
              </p>
            </div>
            <div>
              <h4>Where the numbers come from</h4>
              <p>
                In-game inspection plus{' '}
                <a href="https://encore.moe/?lang=en" target="_blank" rel="noopener noreferrer">encore.moe</a>
                {' '}and{' '}
                <a href="https://nanoka.cc" target="_blank" rel="noopener noreferrer">nanoka.cc</a>, following
                the community damage model.
              </p>
            </div>
            <div>
              <h4>Community</h4>
              <p>
                Thanks to everyone in the{' '}
                <a href="https://discord.gg/wNaauhE4uH" target="_blank" rel="noopener noreferrer">Discord</a>
                {' '}for ideas, bug finds and damage arguments. It keeps the numbers honest.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="hm-foot">
        <p className="hm-legal">
          <AxLink to={APP_ROUTES.privacy}>Privacy Policy</AxLink>
          <AxLink to={APP_ROUTES.terms}>Terms of Service</AxLink>
          <AxLink to={APP_ROUTES.guides}>Guides</AxLink>
          <AxLink to={APP_ROUTES.docs}>Method notes</AxLink>
          <a href="https://discord.gg/wNaauhE4uH" target="_blank" rel="noopener noreferrer">Discord</a>
          <a href="https://ko-fi.com/ssjrunor" target="_blank" rel="noopener noreferrer">Ko-fi</a>
          <span>Wuthering Waves and all game assets are the property of Kuro Games.</span>
        </p>
        <p className="hm-arts">
          Key art:{' '}
          {arts.map((art) => creditFor(art)).filter(Boolean).map((one, index) => (
            <span key={one!.subject}>
              {index > 0 ? ' · ' : ''}
              <b>{one!.subject}</b> by <i>{one!.artist}</i>
            </span>
          ))}
        </p>
      </footer>
    </div>
  )
}
