/*
  Author: Runor Ewhro
  Description: The app chrome, on one line and with nothing drawn around it: no
               bar, no panel, no fill and no dividing line. It carries who we
               are, the half of the app you are standing in, the switches, and
               the app's own condition, and the route's content starts directly
               underneath.

               One rule keeps that line short while it carries everything: the
               line stands the family you are in and the drawer holds the other.
               On a Simulation tool that is the four tools on the line and Read
               in the drawer; on a page you read it is the other way
               round. Either way the run is four words wide, so nothing grew
               when navigation came up out of the rail.

               Both families are set in the same face at the same size, because
               with only one of them ever on the line there is nothing to
               compare a second rank against, and rank is carried by ink instead:
               full ink for where you are, one step down for the rest of your
               family, a whisper for everything you only reach for.
*/

import { useLayoutEffect as useLytFfct, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import Thewuwacalculator from '@/assets/thewuwacalculator.svg?react'
import { useAppStore } from '@/domain/state/store'
import { LINKS, READ_PAGES, SIMULATION_PAGES } from '@/app/chrome/appIndex'
import type { SimulationPageId } from '@/app/chrome/appIndex'
import { AppGoRun } from '@/app/chrome/AppGoRun'
import type { GoStop } from '@/app/chrome/AppGoRun'
import { AppStamp } from '@/app/chrome/AppStamp'
import { ThemeDrop } from '@/app/chrome/ThemeDrop'
import { AxLink } from '@/app/nav/useNavX'
import { ChromeToolsProv } from '@/app/chrome/toolsPort'
import { LinkGlyph } from '@/app/chrome/linkGlyphs'
import { AppDrawer } from '@/app/chrome/AppDrawer'
import { setFrontDoor } from '@/app/nav/navMotion'
import { Tooltip } from '@/shared/ui/Tooltip'

// the chrome reads the stored theme the same way the shell does; both put the
// variant on the document element so a card opened in a portal is painted by
// the same tokens as the page that opened it
export function useThemeClass() {
  const theme = useAppStore((state) => state.ui.theme)
  const darkVariant = useAppStore((state) => state.ui.darkVariant)
  const lightVariant = useAppStore((state) => state.ui.lightVariant)
  const bgVariant = useAppStore((state) => state.ui.backgroundVariant)
  const bgTextMode = useAppStore((state) => state.ui.backgroundTextMode)
  const entrances = useAppStore((state) => state.ui.entranceAnimations)

  return useMemo(() => {
    const variant = theme === 'background'
      ? bgVariant
      : theme === 'dark' ? darkVariant : lightVariant
    const textMode = theme === 'background'
      ? bgTextMode
      : theme === 'dark' ? 'dark' : 'light'

    return [variant, `${textMode}-text`, entrances ? '' : 'no-entrance-anim reduce-animation']
      .filter(Boolean)
      .join(' ')
  }, [bgTextMode, bgVariant, darkVariant, entrances, lightVariant, theme])
}

/*
  Whether the mark belongs on this reference. A page inside a reference is still
  that reference; the segment boundary is what stops /guides from also claiming
  /guidelines.
*/
function atReference(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

const SIMULATION_STOPS: GoStop[] = SIMULATION_PAGES.map((page) => ({
  key: page.id,
  name: page.name,
  to: page.to,
}))

const READ_STOPS: GoStop[] = READ_PAGES.map((reference) => ({
  key: reference.name,
  name: reference.name,
  to: reference.to,
}))

// only one of the head's two drawers is ever open, so which one is open is the
// head's own state rather than each drawer's
type HeadPop = 'drawer' | 'theme' | null

interface AppChromeProps {
  // the page of the work you are on, or null when the route is not one
  at: SimulationPageId | null
  // whether this route belongs to the work rather than the reading, which is
  // what decides which family stands on the line
  simulating: boolean
  // what the head's stamp does on this route, when the route has taken it
  stamp?: () => void
  // what the simulating surfaces reach for: the target and the inventory
  tools?: ReactNode
  children?: ReactNode
}

export function AppChrome({ at, simulating, stamp, tools, children }: AppChromeProps) {
  const { pathname } = useLocation()
  // the line keeps a node open for the page under it; the page fills it through
  // the provider below, which is why the node is held rather than looked up
  const [port, setPort] = useState<HTMLElement | null>(null)
  const [pop, setPop] = useState<HeadPop>(null)

  // a click arms the line's own move before it navigates; this is the same
  // state reconciled for the ways in that never pass through a link, being a
  // load, a back and a forward
  useLytFfct(() => setFrontDoor(pathname), [pathname])

  const stops = simulating ? SIMULATION_STOPS : READ_STOPS
  const standing = simulating
    ? at
    : READ_PAGES.find((reference) => atReference(pathname, reference.to))?.name ?? null

  return (
    <ChromeToolsProv port={port}>
      <div className="ax-chrome">
        <header className="ax-head">
          <AxLink className="ax-mark" to="/">
            <Thewuwacalculator className="ax-mark-glyph" aria-hidden="true" />
            <span className="ax-mark-word"><i>the</i>wuwa<i>calculator</i></span>
          </AxLink>

          <span className="ax-sep" aria-hidden="true" />

          <AppGoRun stops={stops} at={standing} simulation={simulating} />

          <div className="ax-tail">
            {/* the node the head keeps open for the page under it: a route with
                controls of its own stands them on the line rather than on a bar
                above the page. it is not a box, so an empty one costs nothing. */}
            <div className="ax-port" ref={setPort} />

            <div className="ax-ctl">
              {tools}

              <ThemeDrop
                open={pop === 'theme'}
                onToggle={() => setPop((prev) => (prev === 'theme' ? null : 'theme'))}
                onClose={() => setPop(null)}
              />

              {LINKS.map((link) => (
                <Tooltip key={link.name} content={link.name} placement="bottom">
                  <a className="ax-g"
                    href={link.to}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={link.name}
                  >
                    <LinkGlyph name={link.name} />
                  </a>
                </Tooltip>
              ))}
            </div>

            <AppDrawer
              onLine={simulating ? 'simulation' : 'read'}
              open={pop === 'drawer'}
              onToggle={() => setPop((prev) => (prev === 'drawer' ? null : 'drawer'))}
              onClose={() => setPop(null)}
            />

            <span className="ax-sep" aria-hidden="true" />

            <AppStamp go={stamp} />
          </div>
        </header>

        {children}
      </div>
    </ChromeToolsProv>
  )
}
