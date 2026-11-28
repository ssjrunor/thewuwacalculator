/*
  Author: Runor Ewhro
  description: projects ranked suggestion candidates and baseline deltas,
               measures result connectors, and delegates candidate application.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnchoredAppPopup, useAppPopup, useAppPopupDismiss } from '@/shared/ui/AppPopup.tsx'
import type { CSSProperties as CssProps, KeyboardEvent as ReactKeyEvt, ReactNode } from 'react'
import type { WeaponPlanSet } from '@/domain/entities/suggestions.ts'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals.ts'
import { formatCompactNum, formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView.ts'
import { statIconSrc } from '@/modules/simulation/workspace/ui.tsx'
import { Select, type SelectGroup } from '@/application/ui/Select'
import { getDiffLabel, getDiffTone } from '../lib/suggestions.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { getEchoById } from '@/data/catalog/echoCatalogService.ts'
import {
  KINDS,
  KIND_NAME,
  type Kind,
  type Row,
  type RowEcho,
  type EchoSlot,
} from '@/modules/simulation/surfaces/suggestions/results/model.ts'
import { truncTo } from '@/shared/lib/number'

const pct = (value: number) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${getDiffLabel(value, false)}`

const tone = (value: number) => {
  const result = getDiffTone(value)
  return result === 'positive' ? 'up' : result === 'negative' ? 'dn' : 'zero'
}

const isBase = (row: Row) => row.now

interface Connector {
  index: number
  d: string
  gain: boolean
  width: number
}

function maskStyle(icon: string | null): CssProps | undefined {
  return icon ? { maskImage: `url(${icon})`, WebkitMaskImage: `url(${icon})` } as CssProps : undefined
}

function Tray({ tray, ink, seat = false }: { tray: EchoSlot, ink: string, seat?: boolean }) {
  return (
    <div
      className={`spx-tray${tray.held ? ' is-held' : ''}`}
      style={{ '--spx-set-clr': tray.color ?? ink } as CssProps}
      title={tray.title}
      data-echo-seat={seat || undefined}
    >
      <span className="spx-tray__pc">{tray.lead}{tray.leadUnit ? <small>{tray.leadUnit}</small> : null}</span>
      {tray.coins.length > 0 ? (
        <span className="spx-tray__coins">
          {tray.coins.map((coin, index) => (
            <DisplayImage key={index} src={coin ?? undefined} alt="" className="spx-tray__coin" loading="lazy" decoding="async" onError={withDefIconM} />
          ))}
        </span>
      ) : null}
      {tray.primary ? (
        <span className="sst-stats">
          <span className="sst-line">
            {tray.primary.icon ? <span className="sst-icon" style={maskStyle(tray.primary.icon)} /> : null}
            <span className="sst-val">{tray.primary.value}</span>
          </span>
          {tray.secondary ? (
            <span className="sst-line sst-line--sub">
              {tray.secondary.icon ? <span className="sst-icon" style={maskStyle(tray.secondary.icon)} /> : null}
              <span className="sst-val">{tray.secondary.value}</span>
            </span>
          ) : null}
        </span>
      ) : null}
      {tray.name ? <span className="spx-tray__name">{tray.name}</span> : null}
      {tray.coins.length > 1 ? <span className="spx-tray__sup">{tray.coins.length}</span> : null}
    </div>
  )
}

function Build({ kind, row }: { kind: Kind, row: Row }) {
  if (row.weapon) {
    const weapon = row.weapon
    return (
      <span className="suggestion-results__build suggestion-results__build--wpn">
        <span className="suggestion-results__wicon">
          <DisplayImage src={weapon.icon} alt="" loading="lazy" decoding="async" onError={withDefIconM} />
        </span>
        <span className="suggestion-results__wtxt">
          <b>{weapon.name}</b>
          <span className="suggestion-results__wstats">
            <em>{weapon.rarity}★ R{weapon.rank}</em>
            <span className="suggestion-results__wstat" title={`ATK ${truncTo(weapon.baseAtk)}`}>
              <i className="sst-icon" style={maskStyle(statIconSrc('atk'))} />
              {truncTo(weapon.baseAtk)}
            </span>
            <span
              className="suggestion-results__wstat"
              title={`${formatStatKeyLabel(weapon.statKey)} ${formatStatKeyValue(weapon.statKey, weapon.statValue)}`}
            >
              <i className="sst-icon" style={maskStyle(statIconSrc(weapon.statKey))} />
              {formatStatKeyValue(weapon.statKey, weapon.statValue)}
            </span>
            {row.equipped ? <span className="suggestion-results__tag">Equipped</span> : null}
          </span>
        </span>
      </span>
    )
  }

  const echo = row.echo ?? null
  const worn = row.equipped && !isBase(row) ? <span className="suggestion-results__tag">Worn</span> : null
  if (!echo) {
    return (
      <span className="suggestion-results__build">
        <span className="spx-trays spx-trays--named suggestion-results__trays" data-mode={kind}>
          {row.trays.map((tray, index) => (
            <Tray key={`${tray.key}:${index}`} tray={tray} ink="var(--resonator-accent)" />
          ))}
        </span>
        {worn}
      </span>
    )
  }

  const trays = row.trays.map((tray, index) => ({ tray, index }))
  if (trays.length === 0) {
    return (
      <span className="suggestion-results__build">
        <span className="suggestion-results__solo" style={threadInk(echo)} title={`Main Echo: ${echo.name}`}>
          <Bust echo={echo} />
          <span className="suggestion-results__solo-txt">
            <b>{echo.name}</b>
            <small>no specific plan :(</small>
          </span>
        </span>
        {worn}
      </span>
    )
  }

  const seated = echo.seat >= 0
  return (
    <span className="suggestion-results__build suggestion-results__build--echo">
      <span className="suggestion-results__plan">
        <span className="spx-trays spx-trays--named suggestion-results__trays" data-mode={kind}>
          {trays.map(({ tray, index }) => (
            <Tray key={`${tray.key}:${index}`} tray={tray} ink="var(--resonator-accent)" seat={seated && index === echo.seat} />
          ))}
        </span>
        {worn}
      </span>
      <span
        className={`suggestion-results__thread${seated ? '' : ' is-loose'}${echo.worn ? ' is-worn' : ''}`}
        style={threadInk(echo)}
        title={`Main Echo: ${echo.name}`}
      >
        <Bust echo={echo} />
        <span className="suggestion-results__thread-with">with</span>
        <span className="suggestion-results__thread-name">{echo.name}</span>
      </span>
    </span>
  )
}

function threadInk(echo: RowEcho): CssProps {
  return {
    '--suggestion-results-thread': echo.color
      ? `color-mix(in srgb, ${echo.color} 55%, var(--text))`
      : 'var(--suggestion-results-ink)',
  } as CssProps
}

function Bust({ echo }: { echo: RowEcho }) {
  return (
    <span className={`suggestion-results__bust${echo.worn ? ' is-worn' : ''}`}>
      <DisplayImage src={echo.icon ?? undefined} alt="" loading="lazy" decoding="async" onError={withDefIconM} />
    </span>
  )
}

function Out({ row, index }: { row: Row, index: number }) {
  const alt = row.variants[1] ?? null
  return (
    <span className="suggestion-results__out">
      <b>{formatCompactNum(row.damage, false)}</b>
      <em className={`suggestion-results__d suggestion-results__tip ${tone(row.delta)}`} data-connector={index}>
        {isBase(row) ? 'base' : pct(row.delta)}
      </em>
      {alt ? (
        <small>
          {alt.mode === 'max' ? 'stacked' : 'resting'} {formatCompactNum(alt.damage)}{' '}
          <span className={`suggestion-results__d ${tone(alt.delta)}`}>{pct(alt.delta)}</span>
        </small>
      ) : null}
    </span>
  )
}

// a plan can offer one set group twice; each piece takes a different set from it
function pickSetOptions(trays: EchoSlot[]) {
  const used = new Set<string>()
  return trays.map((tray) => {
    const options = tray.names.map((name, index) => ({ name, icon: tray.coins[index] ?? null }))
    const pick = options.find((option) => !used.has(option.name))
      ?? options[0]
      ?? { name: tray.name ?? '', icon: tray.coins[0] ?? null }
    used.add(pick.name)
    return { tray, pick, alts: options.filter((option) => option !== pick) }
  })
}

const Star = () => <i className="suggestion-results__star" aria-hidden />

function SelectedResult({ row, comparison, onApply }: { row: Row, comparison: ReactNode, onApply: (row: Row) => void }) {
  const weapon = row.weapon
  const detail = useAppPopup()
  const barRef = useRef<HTMLDivElement>(null)
  const idRef = useRef<HTMLDivElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  useAppPopupDismiss({
    open: detail.visible,
    onDismiss: detail.hide,
    hostRef: barRef,
    popupRef: detailRef,
    returnFocusRef: openRef,
  })
  let art: ReactNode
  let name: string
  let band: ReactNode

  if (weapon) {
    const alt = row.variants[1] ?? null
    art = (
      <DisplayImage src={weapon.icon} alt="" className="suggestion-results__bar-wpn" decoding="async" onError={withDefIconM} />
    )
    name = weapon.name
    band = (
      <>
        <span className="suggestion-results__bar-stars" title={`${weapon.rarity}★`}>
          {Array.from({ length: weapon.rarity }, (_, index) => <Star key={index} />)}
        </span>
        <span>R{weapon.rank}</span>
        <span title={`ATK ${truncTo(weapon.baseAtk)}`}>
          <i className="suggestion-results__bar-glyph" style={maskStyle(statIconSrc('atk'))} />
          {truncTo(weapon.baseAtk)}
        </span>
        <span title={formatStatKeyLabel(weapon.statKey)}>
          <i className="suggestion-results__bar-glyph" style={maskStyle(statIconSrc(weapon.statKey))} />
          {formatStatKeyValue(weapon.statKey, weapon.statValue)}
        </span>
        {alt ? (
          <span className="suggestion-results__bar-alt">
            {alt.mode === 'max' ? 'stacked' : 'resting'} {formatCompactNum(alt.damage)}
            <span className={`suggestion-results__d ${tone(alt.delta)}`}>{pct(alt.delta)}</span>
          </span>
        ) : null}
      </>
    )
  } else if (row.setPlan) {
    const pieces = pickSetOptions(row.trays)
    const mainEcho = row.mainEchoId ? getEchoById(row.mainEchoId) : null
    art = (
      <span className="suggestion-results__bar-sets">
        {pieces.length ? pieces.map((piece, index) => (
          <DisplayImage key={index} src={piece.pick.icon ?? undefined} alt="" decoding="async" onError={withDefIconM} />
        )) : mainEcho && <DisplayImage src={mainEcho.icon} alt="" decoding="async" onError={withDefIconM} />}
      </span>
    )
    name = [pieces.map((piece) => piece.pick.name).join(' + '), mainEcho?.name].filter(Boolean).join(' · ')
    band = (
      <>
        {pieces.map(({ tray, pick, alts }, index) => (
          <span
            key={`${tray.key}:${index}`}
            title={`${tray.lead}pc ${pick.name}${alts.length ? ` (or ${alts.map((entry) => entry.name).join(', ')})` : ''}`}
          >
            <DisplayImage src={pick.icon ?? undefined} alt="" className="suggestion-results__bar-coin" decoding="async" onError={withDefIconM} />
            {tray.lead}pc
            {alts.length ? (
              <span className="suggestion-results__bar-alts">
                <em>or</em>
                {alts.map((entry, at) => (
                  <DisplayImage key={at} src={entry.icon ?? undefined} alt="" decoding="async" onError={withDefIconM} />
                ))}
              </span>
            ) : null}
          </span>
        ))}
        {mainEcho ? (
          <span title={`Main Echo: ${mainEcho.name}`}>
            <DisplayImage src={mainEcho.icon} alt="" className="suggestion-results__bar-coin" decoding="async" onError={withDefIconM} />
            {mainEcho.name}
          </span>
        ) : null}
      </>
    )
  } else {
    const changed = row.trays.filter((tray) => !tray.held)
    const lead = changed[0] ?? row.trays[0]
    art = <span className="suggestion-results__bar-glyph suggestion-results__bar-glyph--art" style={maskStyle(lead?.primary?.icon ?? null)} />
    name = changed.length > 0 ? changed.map((tray) => tray.names[0]).join(', ') : 'Current'
    band = row.trays.map((tray, index) => (
      <span key={`${tray.key}:${index}`} className={`suggestion-results__bar-slot${tray.held ? '' : ' is-new'}`} title={tray.title}>
        <small>{tray.lead}c</small>
        <i className="suggestion-results__bar-glyph" style={maskStyle(tray.primary?.icon ?? null)} />
        {tray.primary?.value}
      </span>
    ))
  }

  const kind = weapon ? 'weapon' : row.setPlan ? 'sets' : 'stats'

  return (
    <div
      ref={barRef}
      className={`suggestion-results__bar${detail.visible ? ' is-open' : ''}`}
      data-kind={kind}
      style={{ '--suggestion-results-result-ink': row.color ?? 'var(--suggestion-results-ink)' } as CssProps}
    >
      <button
        ref={openRef}
        type="button"
        className="suggestion-results__bar-open"
        aria-label={`Compare ${name} with what is equipped`}
        aria-haspopup="dialog"
        aria-expanded={detail.visible}
        onClick={detail.toggle}
      />
      <div key={row.key} className="suggestion-results__bar-art">{art}</div>
      <div ref={idRef} className="suggestion-results__bar-id">
        <div className="suggestion-results__bar-name">
          <b title={name}>{name}</b>
          <small>No. {row.rank}</small>
        </div>
        <div className="suggestion-results__bar-band">{band}</div>
      </div>
      <div className="suggestion-results__bar-fig">
        <span className="suggestion-results__bar-n"><Star /><b>{formatCompactNum(row.damage)}</b></span>
        <span className={`suggestion-results__bar-tag ${isBase(row) ? 'zero' : tone(row.delta)}`}>{isBase(row) ? 'base' : pct(row.delta)}</span>
      </div>
      <button
        type="button"
        className="suggestion-results__bar-go"
        disabled={row.equipped}
        onClick={() => onApply(row)}
      >
        <Star />
        {row.equipped ? (weapon ? 'Equipped' : 'Current') : (weapon ? 'Equip' : 'Apply')}
      </button>

      <AnchoredAppPopup
        visible={detail.visible}
        open={detail.open}
        closing={detail.closing}
        anchorRef={idRef}
        popupRef={detailRef}
        preferredPlacement="up"
        maxHeight={620}
        offset={10}
        className="lho-fx suggestion-results-comparison"
        role="dialog"
        aria-label={`${name} compared with what is equipped`}
      >
        {comparison}
      </AnchoredAppPopup>
    </div>
  )
}

export function List({
  kind,
  onKind,
  counts,
  rows,
  base,
  held,
  onHeld,
  onApply,
  comparison,
  running,
  targetValue,
  targetGroups,
  onTarget,
  wpnSets,
  setConds,
  onOpenConfig,
}: {
  kind: Kind
  onKind: (kind: Kind) => void
  counts: Record<Kind, number>
  rows: Row[]
  base: number
  held: number
  onHeld: (index: number) => void
  onApply: (row: Row) => void
  // materialized comparison for the currently held result
  comparison: ReactNode
  running: boolean
  targetValue: string
  targetGroups: SelectGroup<string>[]
  onTarget: (value: string) => void
  wpnSets: WeaponPlanSet
  setConds: SntSetConds
  onOpenConfig: () => void
}) {
  const baseRef = useRef<HTMLElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const [connectors, setConnectors] = useState<{ width: number, height: number, list: Connector[] }>({ width: 0, height: 0, list: [] })
  const [lit, setLit] = useState<number | null>(null)

  const originIndex = rows.findIndex(isBase)
  const originRow = originIndex >= 0 ? rows[originIndex] : null
  const heldRow = rows[held] ?? null

  // measure connector endpoints after wrapping because row geometry is data-dependent
  useLayoutEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    let frame = 0

    // anchor each Echo connector to the tray identified by its scored seat index
    const placeThreads = () => {
      sheet.querySelectorAll<HTMLElement>('.suggestion-results__thread').forEach((thread) => {
        const build = thread.parentElement
        const seat = build?.querySelector('[data-echo-seat]')
        if (!build || !seat) {
          thread.style.removeProperty('--suggestion-results-thread-x')
          return
        }
        const x = seat.getBoundingClientRect().left - build.getBoundingClientRect().left
        thread.style.setProperty('--suggestion-results-thread-x', `${Math.round(x)}px`)
      })
    }

    const measure = () => {
      placeThreads()
      // convert viewport rectangles to content coordinates using both scroll offsets
      const box = sheet.getBoundingClientRect()
      const at = (element: Element) => {
        const rect = element.getBoundingClientRect()
        return {
          x: rect.left - box.left + sheet.scrollLeft,
          y: rect.top - box.top + sheet.scrollTop,
          w: rect.width,
          h: rect.height,
        }
      }

      const dot = sheet.querySelector('.suggestion-results__origin-dot') ?? baseRef.current
      if (!dot) return
      const origin = at(dot)
      const ox = Math.max(8, origin.x + origin.w / 2)
      const oy = Math.max(0, origin.y + origin.h / 2)
      const most = Math.max(1, ...rows.map((row) => Math.abs(row.delta)))

      const list: Connector[] = []
      sheet.querySelectorAll<HTMLElement>('[data-connector]').forEach((tip) => {
        const index = Number(tip.dataset.connector)
        const row = rows[index]
        if (!row || index === originIndex) return
        const end = at(tip)
        const ex = end.x - 4
        const ey = end.y + end.h / 2
        const span = ex - ox
        list.push({
          index,
          gain: row.delta >= 0,
          width: 1 + (Math.abs(row.delta) / most) * 2.4,
          d: `M${ox} ${oy} C${ox + span * 0.32} ${oy} ${ox + span * 0.42} ${ey} ${ox + span * 0.7} ${ey} L${ex} ${ey}`,
        })
      })

      // exclude the svg from height measurement, because scrollHeight would include the previous connector-layer
      // height for shorter result lists
      let height = 0
      for (const child of sheet.children) {
        if (child instanceof SVGElement) continue
        const rect = at(child)
        height = Math.max(height, rect.y + rect.h)
      }

      const width = sheet.clientWidth
      setConnectors((previous) => previous.width === width && previous.height === height
        && previous.list.length === list.length
        && previous.list.every((entry, index) => entry.index === list[index].index
          && entry.d === list[index].d && entry.gain === list[index].gain
          && entry.width === list[index].width)
        ? previous : { width, height, list })
    }

    const scheduleMeasure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    placeThreads()
    scheduleMeasure()
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(sheet)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [originIndex, rows])

  // each channel opens at its top
  useLayoutEffect(() => {
    sheetRef.current?.scrollTo({ top: 0 })
  }, [kind])

  const configSummary = useMemo(() => {
    if (kind === 'weapons') {
      const rarities = [5, 4, 3, 2, 1].filter((rarity) => wpnSets.visible?.[rarity])
      const ranks = rarities.map((rarity) => `${rarity}★ R${wpnSets.ranks?.[rarity] ?? wpnSets.stdRank}`)
      const shown = wpnSets.mode === 'both'
        ? `resting and stacked, ranked on ${wpnSets.target === 'max' ? 'stacked' : 'resting'}`
        : wpnSets.mode === 'max' ? 'stacked only' : 'resting only'
      return [ranks.join('  '), shown].filter(Boolean)
    }
    if (kind === 'setPlans') {
      const off = Object.values(setConds.off ?? {}).reduce((total, list) => total + list.length, 0)
      return off > 0 ? [`${off} set effect${off === 1 ? '' : 's'} off`] : []
    }
    return []
  }, [kind, setConds, wpnSets])

  // arrow keys move through the ledger in its rendered order
  const onKeyDown = (event: ReactKeyEvt<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const sheet = sheetRef.current
    if (!sheet) return
    const order = [...sheet.querySelectorAll<HTMLElement>('[data-row]')]
    const at = order.indexOf(document.activeElement as HTMLElement)
    const next = order[at + (event.key === 'ArrowDown' ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    next.focus()
    onHeld(Number(next.dataset.row))
  }

  const rowProps = (index: number) => ({
    'data-row': index,
    'aria-pressed': index === held,
    onMouseEnter: () => setLit(index),
    onMouseLeave: () => setLit(null),
    onFocus: () => setLit(index),
    onBlur: () => setLit(null),
    onClick: () => onHeld(index),
  })

  const renderRow = (index: number) => {
    const row = rows[index]
    return (
      <button
        key={row.key}
        type="button"
        className={`suggestion-results__row${index === held ? ' is-on' : ''}${index === lit ? ' is-hi' : ''}`}
        style={{ '--suggestion-results-result-ink': row.color ?? 'var(--suggestion-results-ink)' } as CssProps}
        {...rowProps(index)}
      >
        <span className="suggestion-results__rk">{row.rank}</span>
        <Build kind={kind} row={row} />
        <Out row={row} index={index} />
      </button>
    )
  }

  const originBody = (
    <>
      <span className="suggestion-results__origin-dot" />
      <span className="suggestion-results__origin-name">
        <em>Current</em>
        {originRow ? <Build kind={kind} row={originRow} /> : null}
      </span>
      {originRow ? <Out row={originRow} index={originIndex} /> : null}
    </>
  )

  return (
    <div className="suggestion-results">
      <div className="suggestion-results__chn">
        {KINDS.map((entry) => {
          const at = entry === kind
          return (
            <button
              key={entry}
              type="button"
              className={`suggestion-results__ch${at ? ' is-at' : ''}`}
              onClick={() => onKind(entry)}
            >
              <i className="suggestion-results__ink" />
              <span className="suggestion-results__chn-name">{KIND_NAME[entry]}</span>
              <span className="suggestion-results__chn-n">{counts[entry]}</span>
              {at ? (
                <span className="suggestion-results__chn-base">
                  measured from <b ref={baseRef}>{formatCompactNum(base)}</b>
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="suggestion-results__main">
        <div className="suggestion-results__head">
          <Select<string> className="suggestion-results__tgt"
            value={targetValue}
            options={[]}
            groups={targetGroups}
            onChange={onTarget}
            ariaLabel="Suggestion target"
          />
          <div className="suggestion-results__gates">
            {configSummary.map((entry) => (
              <span key={entry} className="suggestion-results__gate">{entry}</span>
            ))}
            {kind === 'mainStats' ? null : (
              <button type="button" className="suggestion-results__gate suggestion-results__gate--go" onClick={onOpenConfig}>
                Config
              </button>
            )}
          </div>
        </div>

        <div className={`suggestion-results__results app-loader-host${running ? ' running' : ''}`}>
          {running ? <AppLoaderOverlay text="Searching suggestions..." /> : null}

          {rows.length === 0 ? (
            running ? null : (
              <p className="suggestion-results__empty">
                Pick a target above to see what this build could reach. Equip Echoes to calculate the result.
              </p>
            )
          ) : (
            <div className="suggestion-results__ledger">
              <div className="suggestion-results__cols" aria-hidden>
                <span>#</span>
                <span>{kind === 'weapons' ? 'Weapon' : 'Build'}</span>
                <span>Damage</span>
              </div>

              <div ref={sheetRef} className="suggestion-results__sheet" role="group" aria-label="Results" onKeyDown={onKeyDown}>
                <svg
                  key={kind}
                  className={`suggestion-results__connectors${lit != null ? ' is-lit' : ''}`}
                  width={connectors.width}
                  height={connectors.height}
                  viewBox={`0 0 ${connectors.width || 1} ${connectors.height || 1}`}
                  aria-hidden
                >
                  {connectors.list.map((connector, order) => (
                    <path
                      key={connector.index}
                      d={connector.d}
                      pathLength={1}
                      strokeWidth={connector.width}
                      className={`suggestion-results__connector ${connector.gain ? 'up' : 'dn'}`}
                      style={{ animationDelay: `${order * 26}ms` }}
                    />
                  ))}
                </svg>
                <svg
                  className="suggestion-results__connectors suggestion-results__connectors--top"
                  width={connectors.width}
                  height={connectors.height}
                  viewBox={`0 0 ${connectors.width || 1} ${connectors.height || 1}`}
                  aria-hidden
                >
                  {connectors.list.filter((connector) => connector.index === held || connector.index === lit).map((connector) => (
                    <path
                      key={connector.index}
                      d={connector.d}
                      strokeWidth={connector.width}
                      className={`suggestion-results__connector ${connector.gain ? 'up' : 'dn'}${connector.index === held ? ' is-on' : ' is-hi'}`}
                    />
                  ))}
                </svg>

                {rows.map((row, index) => index === originIndex ? (
                  <button
                    key={row.key}
                    type="button"
                    className={`suggestion-results__origin${originIndex === held ? ' is-on' : ''}`}
                    {...rowProps(originIndex)}
                  >
                    {originBody}
                  </button>
                ) : renderRow(index))}
              </div>
            </div>
          )}
        </div>
      </div>

      {rows.length > 0 && heldRow ? <SelectedResult row={heldRow} comparison={comparison} onApply={onApply} /> : null}
    </div>
  )
}
