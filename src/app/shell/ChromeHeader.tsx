/*
  Author: Runor Ewhro
  Description: Renders the persistent application header. Route behavior and
               the surrounding layout are owned by AppLayout.
*/

import { useState } from 'react'
import type { ReactNode } from 'react'
import Thewuwacalculator from '@/assets/thewuwacalculator.svg?react'
import { LINKS, SIMULATION_PAGES } from '@/application/navigation/appIndex'
import type { SimulationPageId } from '@/application/navigation/appIndex'
import { AppGoRun } from '@/app/shell/AppGoRun'
import type { GoStop } from '@/app/shell/AppGoRun'
import { AppStamp } from '@/app/shell/AppStamp'
import { ThemeDrop } from '@/app/shell/ThemeDrop'
import { AxLink } from '@/shared/navigation/useNavX'
import { LinkGlyph } from '@/app/shell/linkGlyphs'
import { AppDrawer } from '@/app/shell/AppDrawer'
import { Tooltip } from '@/shared/ui/Tooltip'

const SIMULATION_STOPS: GoStop[] = SIMULATION_PAGES.map((page) => ({
  key: page.id,
  name: page.name,
  to: page.to,
}))

// A single discriminator makes drawer and theme popups mutually exclusive.
type HeadPop = 'drawer' | 'theme' | null

interface ChromeHeaderProps {
  at: SimulationPageId | null
  stamp?: () => void
  tools?: ReactNode
  onPort: (node: HTMLElement | null) => void
}

export function ChromeHeader({ at, stamp, tools, onPort }: ChromeHeaderProps) {
  const [pop, setPop] = useState<HeadPop>(null)

  return (
    <header className="ax-head">
      <AxLink className="ax-mark" to="/">
        <Thewuwacalculator className="ax-mark-glyph" aria-hidden="true" />
        <span className="ax-mark-word"><i>the</i>wuwa<i>calculator</i></span>
      </AxLink>

      <span className="ax-sep" aria-hidden="true" />

      <AppGoRun stops={SIMULATION_STOPS} at={at} />

      <div className="ax-tail">
        <div className="ax-port" ref={onPort} />

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
  )
}
