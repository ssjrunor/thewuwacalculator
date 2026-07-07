import type { CSSProperties } from 'react'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

export function NarrowBenchmarkBanner({
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
      <span className="bench-band-art" aria-hidden="true">
        <span className="bench-band-bg" style={{ backgroundImage: `url("${backdropSrc}")` }} />
      </span>
      <img
        className="bench-band-portrait"
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
