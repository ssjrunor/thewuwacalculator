/*
  Author: Runor Ewhro
  Description: Selects a stable loading aside and portals scrim mode into the
               shared overlay host.
*/

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { mainPortal } from '@/shared/lib/portalTarget.ts'

interface AppLoaderOverlayProps {
  text?: string
  className?: string
  contentClass?: string
  mode?: 'overlay' | 'centered' | 'scrim'
}

const DUST = [0, 1, 2, 3, 4, 5, 6]

const ASIDES = [
  'beep boop~',
  'wanna count with me~?',
  'almost, almost~',
  'BWAHAHAH~!',
]

function pickAside() {
  return ASIDES[Math.floor(Math.random() * ASIDES.length)] ?? ASIDES[0]
}

function LoaderContent({ text, aside, className }: {
  text: string
  aside: string
  className: string
}) {
  return (
    <div className={`app-loader-grow ${className}`.trim()}>
      <span className="app-loader-stage" aria-hidden="true">
        <span className="app-loader-bloom" />
        <span className="app-loader-dust">
          {DUST.map((mark) => <i key={mark}><b /></i>)}
        </span>
        <span className="app-loader-figure">
          <span className="app-loader-mascot" />
          <span className="app-loader-pool" />
        </span>
        <span className="app-loader-seed" />
      </span>
      <span className="app-loader-line">
        <span className="app-loader-say">{text}</span>
        <span className="app-loader-aside" aria-hidden="true">{aside}</span>
      </span>
    </div>
  )
}

export default function AppLoaderOverlay({
  text = 'Loading...',
  className = '',
  contentClass = '',
  mode = 'overlay',
}: AppLoaderOverlayProps) {
  const [aside] = useState(pickAside)

  if (mode === 'scrim') {

    const scrim = (
      <div className={`app-loader-scrim ${className}`.trim()} aria-live="polite" aria-busy="true">
        <LoaderContent text={text} aside={aside} className={contentClass} />
      </div>
    )

    const host = mainPortal()
    return host ? createPortal(scrim, host) : scrim
  }

  if (mode === 'centered') {
    return (
      <div className={`app-loader-fallback ${className}`.trim()} aria-live="polite" aria-busy="true">
        <LoaderContent text={text} aside={aside} className={contentClass} />
      </div>
    )
  }

  return (
    <div className={`app-loader-overlay ${className}`.trim()} aria-live="polite" aria-busy="true">
      <LoaderContent text={text} aside={aside} className={contentClass} />
    </div>
  )
}
