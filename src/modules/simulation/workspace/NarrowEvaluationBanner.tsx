/*
  Author: Runor Ewhro
  Description: Maps resolved backdrop, portrait, and placement inputs into the
               reduced workspace identity component.
*/

import type { CSSProperties } from 'react'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

export function NarrowEvaluationBanner({
  portraitSrc,
  spriteCss,
  backdropSrc,
}: {
  portraitSrc: string
  spriteCss: CSSProperties
  backdropSrc: string
}) {
  return (
    <>
      <span className="workspace-band-art" aria-hidden="true">
        <span className="workspace-band-bg" style={{ backgroundImage: `url("${backdropSrc}")` }} />
      </span>
      <img className="workspace-band-portrait"
        src={portraitSrc}
        alt=""
        aria-hidden="true"
        style={spriteCss}
        loading="lazy"
        decoding="async"
        onError={withDefIconM}
      />
    </>
  )
}
