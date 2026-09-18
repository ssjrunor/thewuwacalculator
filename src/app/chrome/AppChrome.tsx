/*
  Author: Runor Ewhro
  Description: Keeps Simulation navigation on the header across every route,
               with reference pages in the drawer, shared controls, and status.
*/

import { useLayoutEffect as useLytFfct, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import Thewuwacalculator from '@/assets/thewuwacalculator.svg?react'
import { useAppStore } from '@/domain/state/store'
import { LINKS, SIMULATION_PAGES } from '@/app/chrome/appIndex'
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

// Resolve document-level theme classes so portaled content inherits the same tokens.
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

const SIMULATION_STOPS: GoStop[] = SIMULATION_PAGES.map((page) => ({
  key: page.id,
  name: page.name,
  to: page.to,
}))

// A single discriminator makes drawer and theme popups mutually exclusive.
type HeadPop = 'drawer' | 'theme' | null

interface AppChromeProps {
  // Null on routes outside Simulation.
  at: SimulationPageId | null
  // Optional route-registered action.
  stamp?: () => void
  tools?: ReactNode
  children?: ReactNode
}

export function AppChrome({ at, stamp, tools, children }: AppChromeProps) {
  const { pathname } = useLocation()
  // Provider consumers need the mounted portal target, including its initial null state.
  const [port, setPort] = useState<HTMLElement | null>(null)
  const [pop, setPop] = useState<HeadPop>(null)

  // Reconcile navigation state for direct loads and history changes as well as clicks.
  useLytFfct(() => setFrontDoor(pathname), [pathname])

  return (
    <ChromeToolsProv port={port}>
      <div className="ax-chrome">
        <header className="ax-head">
          <AxLink className="ax-mark" to="/">
            <Thewuwacalculator className="ax-mark-glyph" aria-hidden="true" />
            <span className="ax-mark-word"><i>the</i>wuwa<i>calculator</i></span>
          </AxLink>

          <span className="ax-sep" aria-hidden="true" />

          <AppGoRun stops={SIMULATION_STOPS} at={at} />

          <div className="ax-tail">
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
