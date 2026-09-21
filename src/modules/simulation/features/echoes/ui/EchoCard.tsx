/*
  Author: Runor Ewhro
  Description: the parts an echo card is built from: a sonata band carrying the
               main stats, the substats it rolled, and a ribbon inked with its
               grade. surfaces bring their own wrapper, so a modal row and a
               bench slot can wear the same face with their own chrome on it.
*/

import type { CSSProperties as CssProps, ReactNode } from 'react'
import { EchoStatGlyph } from '@/modules/simulation/features/echoes/lib/statGlyph.tsx'
import {
  getCvGrdPrcn,
  getCvToneColor,
  getScrToneColor,
} from '@/modules/simulation/features/echoes/lib/metric.ts'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView.ts'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import '@/styles/modules/simulation/features/echoes/EchoCard.css'

export interface EchoCardStat {
  key: string
  value: number
}

// leaves the spare ones empty rather than letting a short echo reflow
const SUB_TRACKS = 5

export function echoStatTitle(key: string, value: number): string {
  return `${formatStatKeyLabel(key)} ${formatStatKeyValue(key, value)}`
}

/* the sonata paints the card and the grade inks the ribbon: the score where a
   surface has one, the crit value the echo rolled where it does not */
export function echoCardVars({
  setColor,
  cv,
  score = null,
}: {
  setColor?: string | null
  cv: number
  score?: number | null
}): CssProps {
  const scored = score != null && score > 0
  const grade = scored ? score : getCvGrdPrcn(cv)

  return {
    ...(setColor ? { '--snt': setColor } : null),
    '--ecr-grade': scored ? getScrToneColor(score) : getCvToneColor(cv),
    '--ecr-cv': getCvToneColor(cv),
    '--ecr-fill': `${Math.max(2, Math.min(100, grade))}%`,
  } as CssProps
}

export function EchoCardBand({
  icon,
  name,
  setIcon,
  setName,
  mainEcho,
  primary,
  secondary,
  overlay,
}: {
  icon?: string | null
  name: string
  setIcon?: string | null
  setName?: string | null
  mainEcho: boolean
  primary: EchoCardStat
  secondary: EchoCardStat
  // a surface can pin its own mark to the band without owning the band
  overlay?: ReactNode
}) {
  return (
    <div className="ecr-card__band">
      <span className="ecr-card__disc">
        {icon && <img src={icon} alt={name} loading="lazy" decoding="async" onError={withDefEchoMg} />}
      </span>
      {setIcon && (
        <img
          src={setIcon}
          alt={setName ?? ''} className="ecr-card__coin"
          loading="lazy"
          decoding="async"
          onError={withDefIconM}
        />
      )}
      <span className="ecr-card__head">
        <span className="ecr-card__lead">
          {mainEcho && <span className="ecr-card__pip" title="Main echo" aria-hidden="true" />}
          <EchoStatGlyph statKey={primary.key} size={1.05} />
          <b title={echoStatTitle(primary.key, primary.value)}>
            {formatStatKeyValue(primary.key, primary.value)}
          </b>
        </span>
        <span className="ecr-card__sec">
          <EchoStatGlyph statKey={secondary.key} size={0.85} />
          <span title={echoStatTitle(secondary.key, secondary.value)}>
            {formatStatKeyValue(secondary.key, secondary.value)}
          </span>
        </span>
      </span>
      {overlay}
    </div>
  )
}

export function EchoCardList({ subs }: { subs: EchoCardStat[] }) {
  const tracks = Array.from({ length: SUB_TRACKS }, (_, index) => subs[index] ?? null)

  return (
    <div className="ecr-card__list">
      {tracks.map((sub, index) => (
        sub
          ? (
              <span className="ecr-card__line"
                key={`${sub.key}-${index}`}
                title={echoStatTitle(sub.key, sub.value)}
              >
                <EchoStatGlyph statKey={sub.key} size={0.78} />
                <span className="ecr-card__k">{formatStatKeyLabel(sub.key)}</span>
                <b>{formatStatKeyValue(sub.key, sub.value)}</b>
              </span>
            )
          : <span className="ecr-card__line ecr-card__line--void" key={`void-${index}`} aria-hidden="true" />
      ))}
    </div>
  )
}

export function EchoCardRibbon({ cv, score = null }: { cv: number; score?: number | null }) {
  const scored = score != null && score > 0

  return (
    <div className="ecr-card__ribbon">
      <span className="ecr-card__cv" title={`Crit value ${cv.toFixed(1)}`}>
        {scored ? `CV ${cv.toFixed(1)}` : cv.toFixed(1)}
      </span>
      {scored && <span className="ecr-card__score">{formatTruncCompact(score, 1)}</span>}
    </div>
  )
}
