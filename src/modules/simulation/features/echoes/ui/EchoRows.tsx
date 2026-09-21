/*
  Author: Runor Ewhro
  Description: renders an equipped loadout as rows built from the suggestions
               pane's own parts, in a wide "slice" and a compact "tray"
               density, while preserving inventory slot indices.
*/

import type { CSSProperties as CssProps, HTMLAttributes as HtmlAttrs, MouseEventHandler as MsVntHnd, ReactNode } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { getSntSetClr, getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { EchoStatGlyph } from '@/modules/simulation/features/echoes/lib/statGlyph.tsx'
import {
  cmptBldCritGr,
  cmptEchoCrit,
  cmptEchoCritAll,
  getCvToneColor,
} from '@/modules/simulation/features/echoes/lib/metric.ts'
import {
  EchoCardBand,
  EchoCardList,
  EchoCardRibbon,
  echoCardVars,
} from '@/modules/simulation/features/echoes/ui/EchoCard.tsx'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView.ts'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import '@/styles/modules/simulation/features/echoes/EchoRows.css'

// leaves the spare ones empty rather than letting a short echo reflow
const SUB_TRACKS = 5

export type EchoRowVariant = 'slice' | 'tray' | 'card'

export interface EchoRowProps {
  echo: EchoInstance | null
  variant?: EchoRowVariant
  score?: number | null
  interactive?: boolean
  className?: string
  actions?: ReactNode
  onClick?: MsVntHnd<HTMLDivElement>
}

export interface EchoRowsProps {
  selection: { surfaceProps?: HtmlAttrs<HTMLDivElement> }
  echoes: Array<EchoInstance | null>
  variant?: EchoRowVariant
  scores?: Array<number | null> | null
  slotCount?: number
  interactive?: boolean
  className?: string
  onEchoClick?: (echo: EchoInstance | null, index: number) => void
  getRowClskn?: (item: EchoRowItem) => string
  getRowActions?: (item: EchoRowItem) => ReactNode
  wrapRow?: (row: ReactNode, item: EchoRowItem) => ReactNode
}

export interface EchoRowItem {
  key: string
  echo: EchoInstance | null
  sourceIndex: number
  renderIndex: number
  score: number | null
}

// leads because it is the only real hierarchy in a loadout, then rows group by
// sonata so the tinted wedges sit together. cost is deliberately not an
// ordering key: it says nothing about an equipped echo.
export function makeEchoRows(args: {
  echoes: Array<EchoInstance | null>
  scores?: Array<number | null> | null
  slotCount?: number
}): EchoRowItem[] {
  const slots: Array<{ echo: EchoInstance | null; sourceIndex: number; score: number | null }> = (
    args.slotCount != null
      ? [
          ...args.echoes.map((echo, sourceIndex) => ({
            echo,
            sourceIndex: sourceIndex,
            score: args.scores?.[sourceIndex] ?? null,
          })),
          ...Array.from({ length: Math.max(0, args.slotCount - args.echoes.length) }, (_, offset) => ({
            echo: null,
            sourceIndex: args.echoes.length + offset,
            score: null,
          })),
        ].slice(0, args.slotCount)
      : args.echoes.map((echo, sourceIndex) => ({
          echo,
          sourceIndex: sourceIndex,
          score: args.scores?.[sourceIndex] ?? null,
        }))
  )

  const filled = slots.filter((slot) => slot.echo)
  const empty = slots.filter((slot) => !slot.echo)

  // the main echo's own sonata leads, so its group stays contiguous
  const leadFirst = [...filled].sort((left, right) => {
    if (left.echo!.mainEcho !== right.echo!.mainEcho) {
      return left.echo!.mainEcho ? -1 : 1
    }

    return left.sourceIndex - right.sourceIndex
  })

  const setOrder = new Map<number, number>()
  for (const slot of leadFirst) {
    if (!setOrder.has(slot.echo!.set)) {
      setOrder.set(slot.echo!.set, setOrder.size)
    }
  }

  const ordered = [
    ...leadFirst.sort((left, right) => {
      const setLeft = setOrder.get(left.echo!.set) ?? 0
      const setRight = setOrder.get(right.echo!.set) ?? 0
      if (setLeft !== setRight) {
        return setLeft - setRight
      }

      if (left.echo!.mainEcho !== right.echo!.mainEcho) {
        return left.echo!.mainEcho ? -1 : 1
      }

      return left.sourceIndex - right.sourceIndex
    }),
    ...empty,
  ]

  return ordered.map((item, renderIndex) => ({
    key: item.echo ? `${item.echo.uid}-${item.sourceIndex}-${renderIndex}` : `empty-${item.sourceIndex}-${renderIndex}`,
    echo: item.echo,
    sourceIndex: item.sourceIndex,
    renderIndex: renderIndex,
    score: item.score,
  }))
}

function subEntries(echo: EchoInstance): Array<[string, number] | null> {
  const entries = Object.entries(echo.substats) as Array<[string, number]>
  return Array.from({ length: SUB_TRACKS }, (_, index) => entries[index] ?? null)
}

function statTitle(key: string, value: number): string {
  return `${formatStatKeyLabel(key)} ${formatStatKeyValue(key, value)}`
}

export function EchoRow({
  echo,
  variant = 'slice',
  score = null,
  interactive = false,
  className = '',
  actions,
  onClick,
  ...domProps
}: EchoRowProps & HtmlAttrs<HTMLDivElement>) {
  if (!echo) {
    return (
      <div className={`ecr__row ecr__row--empty ${className}`.trim()}>
        <span className="ecr__void">Empty</span>
      </div>
    )
  }

  const definition = getEchoById(echo.id)
  const setIcon = echo.set ? getSntSetIco(echo.set) : null
  const setName = echo.set ? getSntSetNam(echo.set) : null
  const setClr = echo.set ? getSntSetClr(echo.set) : null
  const subs = subEntries(echo)
  // an echo is read on the crit it rolled, so its own mark counts substats only
  const cv = cmptEchoCrit(echo.substats)

  const classNames = [
    'ecr__row',
    echo.mainEcho && 'is-main',
    interactive && 'ecr__row--interactive',
    actions && 'has-gutter',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const rowStyle = setClr ? ({ '--snt': setClr } as CssProps) : undefined
  const gutter = actions ? (
    <div className="workspace-echo-gut" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      {actions}
    </div>
  ) : null

  const primary = (
    <>
      <EchoStatGlyph statKey={echo.mainStats.primary.key} size={1.05} />
      <b title={statTitle(echo.mainStats.primary.key, echo.mainStats.primary.value)}>
        {formatStatKeyValue(echo.mainStats.primary.key, echo.mainStats.primary.value)}
      </b>
    </>
  )

  const secondary = (
    <span className="ecr__sec">
      <EchoStatGlyph statKey={echo.mainStats.secondary.key} size={0.85} />
      <span title={statTitle(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}>
        {formatStatKeyValue(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}
      </span>
    </span>
  )

  const setCoin = setIcon
    ? <img src={setIcon} alt={setName ?? ''} className="ecr__setcoin" loading="lazy" onError={withDefIconM} />
    : null

  /* the card is the shared face, so a loadout reads the same in a modal as it
     does on the bench. only the wrapper and its selection chrome are local. */
  if (variant === 'card') {
    const scored = score != null && score > 0
    const cardClass = [
      classNames,
      'ecr-card',
      interactive ? 'ecr-card--live' : '',
      scored ? 'is-scored' : '',
    ].filter(Boolean).join(' ')

    return (
      <div
        className={cardClass}
        style={{ ...rowStyle, ...echoCardVars({ setColor: setClr, cv, score }) }}
        onClick={onClick}
        {...domProps}
      >
        {gutter}
        <EchoCardBand
          icon={definition?.icon}
          name={definition?.name ?? 'Echo'}
          setIcon={setIcon}
          setName={setName}
          mainEcho={echo.mainEcho}
          primary={echo.mainStats.primary}
          secondary={echo.mainStats.secondary}
        />
        <EchoCardList subs={Object.entries(echo.substats).map(([key, value]) => ({ key, value }))} />
        <EchoCardRibbon cv={cv} score={score} />
      </div>
    )
  }

  if (variant === 'tray') {
    return (
      <div className={classNames} style={rowStyle} onClick={onClick} {...domProps}>
        {gutter}
        <span className="ecr__pip" aria-hidden="true" />
        <span className="ecr__disc">
          {definition?.icon && (
            <img src={definition.icon} alt={definition.name ?? 'Echo'} loading="lazy" onError={withDefEchoMg} />
          )}
        </span>
        {setCoin}
        <span className="ecr__tray">
          {primary}
          {secondary}
        </span>
        {subs.map((sub, index) => (
          sub
            ? (
                <span className="ecr__pill" key={`${sub[0]}-${index}`} title={statTitle(sub[0], sub[1])}>
                  <EchoStatGlyph statKey={sub[0]} size={0.86} />
                  <b>{formatStatKeyValue(sub[0], sub[1])}</b>
                </span>
              )
            : <span key={`void-${index}`} aria-hidden="true" />
        ))}
        <span className="ecr__res">
          {score != null && score > 0 && (
            <span className="ecr__score">{formatTruncCompact(score, 1)}</span>
          )}
          <span className="ecr__cv" title={`Crit value ${cv.toFixed(1)}`}>{cv.toFixed(1)}</span>
        </span>
      </div>
    )
  }

  return (
    <div className={classNames} style={rowStyle} onClick={onClick} {...domProps}>
      {gutter}
      {/* the wedge runs wider than its track and dissolves, so the art bleeds
          into the row. the gradient carries the sonata, not a rarity. */}
      <div className="ecr__wedge">
        {definition?.icon && (
          <img
            src={definition.icon}
            alt={definition.name ?? 'Echo'} className="ecr__art"
            loading="lazy"
            onError={withDefEchoMg}
          />
        )}
        {setCoin}
        {echo.mainEcho && <span className="ecr__mark">Main</span>}
      </div>

      <div className="ecr__spec">
        <div className="ecr__info">
          <div className="ecr__lead">
            {primary}
            {secondary}
          </div>
          <div className="ecr__subs">
            {subs.map((sub, index) => (
              sub
                ? (
                    <span className="ecr__stat" key={`${sub[0]}-${index}`} title={statTitle(sub[0], sub[1])}>
                      <EchoStatGlyph statKey={sub[0]} size={1} />
                      <b>{formatStatKeyValue(sub[0], sub[1])}</b>
                    </span>
                  )
                : <span key={`void-${index}`} aria-hidden="true" />
            ))}
          </div>
        </div>

        <div className="ecr__gauge">
          <div className="ecr__hd">
            <span className="ecr__tag">{score != null && score > 0 ? 'Score' : 'CV'}</span>
            {score != null && score > 0 && (
              <span className="ecr__cv" title={`Crit value ${cv.toFixed(1)}`}>CV {cv.toFixed(1)}</span>
            )}
            <span className="ecr__score">
              {score != null && score > 0 ? formatTruncCompact(score, 1) : cv.toFixed(1)}
            </span>
          </div>
          {score != null && score > 0 && (
            <span className="ecr__track">
              <i className="ecr__fill" style={{ width: `${Math.max(2, Math.min(100, score))}%` }} />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export function EchoRowsFoot({
  echoes,
  className = '',
}: {
  echoes: Array<EchoInstance | null>
  className?: string
}) {
  const tally: Array<{ set: number; pieces: number }> = []
  let cv = 0
  for (const echo of echoes) {
    if (!echo) continue
    cv += cmptEchoCritAll(echo)
    const seen = tally.find((entry) => entry.set === echo.set)
    if (seen) {
      seen.pieces += 1
    } else {
      tally.push({ set: echo.set, pieces: 1 })
    }
  }

  if (tally.length === 0) {
    return null
  }

  return (
    <div className={`ecr-foot ${className}`.trim()}>
      <div className="ecr-foot__sets">
        {tally.map((entry) => {
          const icon = getSntSetIco(entry.set)
          const name = getSntSetNam(entry.set)
          const clr = getSntSetClr(entry.set)
          return (
            <span
              className={`ecr-foot__set${entry.pieces < 2 ? ' is-short' : ''}`}
              key={entry.set}
              style={clr ? ({ '--snt': clr } as CssProps) : undefined}
              title={`${name} ${entry.pieces}pc`}
            >
              <span className="ecr-foot__pc">{entry.pieces}<small>pc</small></span>
              {icon && <img src={icon} alt="" className="ecr__setcoin" loading="lazy" onError={withDefIconM} />}
              <span className="ecr-foot__name">{name}</span>
            </span>
          )
        })}
      </div>

      <div className="ecr-foot__figs">
        <span className="ecr-foot__fig">
          <span className="ecr-foot__k">CV</span>
          <span className="ecr-foot__v"
            style={{ '--ecr-grade': getCvToneColor(cmptBldCritGr(echoes)) } as CssProps}
          >
            {cv.toFixed(1)}
          </span>
        </span>
      </div>
    </div>
  )
}

export function EchoRows({
  echoes,
  variant = 'slice',
  scores = null,
  slotCount,
  interactive = false,
  className = '',
  onEchoClick,
  getRowClskn: getRowClssN,
  getRowActions,
  wrapRow,
  selection,
}: EchoRowsProps) {
  // row wrapping is intentionally last so selection layers can preserve the
  // normalized row props while adding drag, checkbox, or context-menu chrome
  const items = makeEchoRows({ echoes, scores, slotCount })

  const listClass = ['ecr', `ecr--${variant}`, className].filter(Boolean).join(' ')

  return (
    <div className={listClass} {...selection.surfaceProps}>
      {items.map((item) => {
        const row = (
          <EchoRow
            key={item.key}
            echo={item.echo}
            variant={variant}
            score={item.score}
            interactive={interactive || Boolean(onEchoClick)}
            className={getRowClssN?.(item) ?? ''}
            actions={item.echo ? getRowActions?.(item) : undefined}
            onClick={onEchoClick ? () => onEchoClick(item.echo, item.sourceIndex) : undefined}
          />
        )

        return wrapRow ? wrapRow(row, item) : row
      })}
    </div>
  )
}
