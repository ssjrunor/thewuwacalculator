/*
  Author: Runor Ewhro
  Description: renders reusable echo cards and grids while preserving original
               inventory slot indices for selection, click handling, and score
               overlays.
*/

import type { HTMLAttributes as HtmlAttrs, MouseEventHandler as MsVntHnd, ReactNode } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/calculator/model/statsView.ts'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import '../../styles/EchoGrid.css'

export type EchoCardVar = 'full' | 'compact'

export interface EchoCardPrps {
  echo: EchoInstance | null
  variant?: EchoCardVar
  showSubstats?: boolean
  showImage?: boolean
  score?: number | null
  interactive?: boolean
  className?: string
  onClick?: MsVntHnd<HTMLDivElement>
}

export interface EchoGridPrps {
  selection: { surfaceProps?: HtmlAttrs<HTMLDivElement> }
  echoes: Array<EchoInstance | null>
  variant?: EchoCardVar
  showSubstats?: boolean
  showImage?: boolean
  scores?: Array<number | null> | null
  slotCount?: number
  interactive?: boolean
  className?: string
  onEchoClick?: (echo: EchoInstance | null, index: number) => void
  getCardClskn?: (item: EchoGridItem) => string
  wrapCard?: (card: ReactNode, item: EchoGridItem) => ReactNode
}

export interface EchoGridItem {
  key: string
  echo: EchoInstance | null
  rgnlIdx: number
  rndrIdx: number
  score: number | null
}

function getEchoCostF(echo: EchoInstance): number {
  return getEchoById(echo.id)?.cost ?? (echo.mainEcho ? 4 : 1)
}

// build the render list without losing inventory positions
// filled slot counts add null placeholders, then visible cards are sorted by
// echo cost while rgnlIdx keeps callbacks and selection tied to stored order
export function mkEchoGridTm(args: {
  echoes: Array<EchoInstance | null>
  scores?: Array<number | null> | null
  slotCount?: number
}): EchoGridItem[] {
  const slots: Array<{ echo: EchoInstance | null; rgnlIdx: number; score: number | null }> = (
    args.slotCount != null
      ? [
          ...args.echoes.map((echo, rgnlNdx) => ({
            echo,
            rgnlIdx: rgnlNdx,
            score: args.scores?.[rgnlNdx] ?? null,
          })),
          ...Array.from({ length: Math.max(0, args.slotCount - args.echoes.length) }, (_, offset) => ({
            echo: null,
            rgnlIdx: args.echoes.length + offset,
            score: null,
          })),
        ].slice(0, args.slotCount)
      : args.echoes.map((echo, rgnlNdx) => ({
          echo,
          rgnlIdx: rgnlNdx,
          score: args.scores?.[rgnlNdx] ?? null,
        }))
  )

  return [...slots]
    .sort((left, right) => {
      const costLeft = left.echo ? (getEchoById(left.echo.id)?.cost ?? (left.echo.mainEcho ? 4 : 1)) : -1
      const costRight = right.echo ? (getEchoById(right.echo.id)?.cost ?? (right.echo.mainEcho ? 4 : 1)) : -1
      if (costRight !== costLeft) {
        return costRight - costLeft
      }

      return left.rgnlIdx - right.rgnlIdx
    })
    .map((item, rndrNdx) => ({
      key: item.echo ? `${item.echo.uid}-${item.rgnlIdx}-${rndrNdx}` : `empty-${item.rgnlIdx}-${rndrNdx}`,
      echo: item.echo,
      rgnlIdx: item.rgnlIdx,
      rndrIdx: rndrNdx,
      score: item.score,
    }))
}

export function EchoCard({
  echo,
  variant = 'full',
  showSubstats,
  showImage = true,
  score = null,
  interactive = false,
  className = '',
  onClick,
  ...domProps
}: EchoCardPrps & HtmlAttrs<HTMLDivElement>) {
  // compact cards inherit their substat visibility from the variant unless a
  // caller overrides it for inventory or comparison surfaces
  const rslvShowSbst = showSubstats ?? variant === 'full'

  if (!echo) {
    return (
      <div className={`echo-card echo-card--${variant} echo-card--empty ${className}`.trim()}>
        <span className="echo-card__empty-label">Empty</span>
      </div>
    )
  }

  const definition = getEchoById(echo.id)
  const cost = definition?.cost ?? getEchoCostF(echo)
  const setIcon = echo.set ? getSntSetIco(echo.set) : null
  const setName = echo.set ? getSntSetNam(echo.set) : null
  const sbstEnts = Object.entries(echo.substats)
  const hasImage = showImage && Boolean(definition?.icon)

  const classNames = [
    'echo-card',
    `echo-card--${variant}`,
    interactive && 'echo-card--interactive',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classNames}
      onClick={onClick}
      {...domProps}
    >
      <div className="echo-card__top">
        {hasImage && (
          <div className="echo-card__icon">
            <img
              src={definition!.icon}
              alt={definition!.name ?? 'Echo'}
              className="echo-card__icon-img"
              loading="lazy"
              onError={withDefEchoMg}
            />
          </div>
        )}

        <div className="echo-card__identity">
          {definition?.name && (
            <span className="echo-card__name">{definition.name}</span>
          )}
          <div className="echo-card__meta">
            {setIcon && (
              <img src={setIcon} alt={setName ?? ''} className="echo-card__set-icon" onError={withDefIconM} />
            )}
            <span className="echo-card__cost-badge">{cost}C</span>
            {echo.mainEcho && (
              <span className="echo-card__main-badge">Main</span>
            )}
            {score != null && score > 0 && (
              <span className="echo-score-badge">{formatTruncCompact(score, 1)}%</span>
            )}
          </div>
        </div>
      </div>

      <div className="echo-card__stat-card">
        <div className="echo-card__stat-accent" />
        <div className="echo-card__stat-section echo-card__stat-section--main">
          <div className="echo-card__stat">
            <span className="echo-card__stat-label">
              {formatStatKeyLabel(echo.mainStats.primary.key)}
            </span>
            <span className="echo-card__stat-value echo-card__stat-value--primary">
              {formatStatKeyValue(echo.mainStats.primary.key, echo.mainStats.primary.value)}
            </span>
          </div>
          <div className="echo-card__stat echo-card__stat--secondary">
            <span className="echo-card__stat-label">
              {formatStatKeyLabel(echo.mainStats.secondary.key)}
            </span>
            <span className="echo-card__stat-value">
              {formatStatKeyValue(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}
            </span>
          </div>
        </div>

        {rslvShowSbst && sbstEnts.length > 0 && (
          <div className="echo-card__stat-section echo-card__stat-section--subs">
            <div className="echo-card__subs-header">
              <span className="echo-card__subs-title">Substats</span>
            </div>
            {sbstEnts.map(([key, value]) => (
              <div key={key} className="echo-card__stat echo-card__stat--sub">
                <span className="echo-card__stat-label">{formatStatKeyLabel(key)}</span>
                <span className="echo-card__stat-value echo-card__stat-value--sub">
                  {formatStatKeyValue(key, value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function EchoGrid({
  echoes,
  variant = 'full',
  showSubstats,
  showImage = true,
  scores = null,
  slotCount,
  interactive = false,
  className = '',
  onEchoClick,
  getCardClskn: getCardClssN,
  wrapCard,
  selection,
}: EchoGridPrps) {
  // card wrapping is intentionally last so selection layers can preserve the
  // normalized card props while adding drag, checkbox, or context-menu chrome
  const items = mkEchoGridTm({
    echoes,
    scores,
    slotCount,
  })

  const gridClass = ['echo-grid', `echo-grid--${variant}`, className]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={gridClass} {...selection.surfaceProps}>
      {items.map((item) => {
        const card = (
          <EchoCard
            key={item.key}
            echo={item.echo}
            variant={variant}
            showSubstats={showSubstats}
            showImage={showImage}
            score={item.score}
            interactive={interactive || Boolean(onEchoClick)}
            className={getCardClssN?.(item) ?? ''}
            onClick={onEchoClick ? () => onEchoClick(item.echo, item.rgnlIdx) : undefined}
          />
        )

        return wrapCard ? wrapCard(card, item) : card
      })}
    </div>
  )
}
