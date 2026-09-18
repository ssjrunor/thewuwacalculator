/*
  Author: Runor Ewhro
  Description: Projects ranked suggestion candidates and baseline deltas,
               measures result connectors, and delegates candidate application.
*/

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties as CssProps, KeyboardEvent as ReactKeyEvt } from 'react'
import type { WeaponPlanSet } from '@/domain/entities/suggestions.ts'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals.ts'
import { formatCompactNum, formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView.ts'
import { statIconSrc } from '@/modules/simulation/workspace/ui.tsx'
import { LiquidSelect, type SelectGroup } from '@/shared/ui/LiquidSelect.tsx'
import { getDiffLabel, getDiffTone } from '../lib/suggestions.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import {
  CLIMB_KINDS,
  CLIMB_KIND_NAME,
  type ClimbKind,
  type ClimbRow,
  type ClimbTray,
} from '@/modules/simulation/features/suggestions/climb/model.ts'

const pct = (value: number) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${getDiffLabel(value, false)}`

const tone = (value: number) => {
  const result = getDiffTone(value)
  return result === 'positive' ? 'up' : result === 'negative' ? 'dn' : 'zero'
}

/* The pane identifies current results by recipe, concrete set plan, or weapon. */
const isBase = (row: ClimbRow) => row.now

interface Rope {
  index: number
  d: string
  gain: boolean
  width: number
}

function maskStyle(icon: string | null): CssProps | undefined {
  return icon ? { maskImage: `url(${icon})`, WebkitMaskImage: `url(${icon})` } as CssProps : undefined
}

function Tray({ tray, ink }: { tray: ClimbTray, ink: string }) {
  return (
    <div
      className={`spx-tray${tray.held ? ' is-held' : ''}`}
      style={{ '--spx-set-clr': tray.color ?? ink } as CssProps}
      title={tray.title}
    >
      <span className="spx-tray__pc">{tray.lead}{tray.leadUnit ? <small>{tray.leadUnit}</small> : null}</span>
      {tray.coins.length > 0 ? (
        <span className="spx-tray__coins">
          {tray.coins.map((coin, index) => (
            <img key={index} src={coin ?? undefined} alt="" className="spx-tray__coin" onError={withDefIconM} />
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

function Build({ kind, row }: { kind: ClimbKind, row: ClimbRow }) {
  if (row.weapon) {
    const weapon = row.weapon
    return (
      <span className="clb__build clb__build--wpn">
        <span className="clb__wicon">
          <img src={weapon.icon} alt="" onError={withDefIconM} />
        </span>
        <span className="clb__wtxt">
          <b>{weapon.name}</b>
          <span className="clb__wstats">
            <em>{weapon.rarity}★ R{weapon.rank}</em>
            <span className="clb__wstat" title={`ATK ${Math.round(weapon.baseAtk)}`}>
              <i className="sst-icon" style={maskStyle(statIconSrc('atk'))} />
              {Math.round(weapon.baseAtk)}
            </span>
            <span
              className="clb__wstat"
              title={`${formatStatKeyLabel(weapon.statKey)} ${formatStatKeyValue(weapon.statKey, weapon.statValue)}`}
            >
              <i className="sst-icon" style={maskStyle(statIconSrc(weapon.statKey))} />
              {formatStatKeyValue(weapon.statKey, weapon.statValue)}
            </span>
            {row.equipped ? <span className="clb__tag">Equipped</span> : null}
          </span>
        </span>
      </span>
    )
  }

  return (
    <span className="clb__build">
      <span className="spx-trays spx-trays--named clb__trays" data-mode={kind}>
        {row.trays.map((tray, index) => (
          <Tray key={`${tray.key}:${index}`} tray={tray} ink="var(--resonator-accent)" />
        ))}
      </span>
      {row.equipped && !isBase(row) ? <span className="clb__tag">Worn</span> : null}
    </span>
  )
}

function Out({ row, index }: { row: ClimbRow, index: number }) {
  const alt = row.variants[1] ?? null
  return (
    <span className="clb__out">
      <b>{formatCompactNum(row.damage)}</b>
      <em className={`clb__d clb__tip ${tone(row.delta)}`} data-rope={index}>
        {isBase(row) ? 'base' : pct(row.delta)}
      </em>
      {alt ? (
        <small>
          {alt.mode === 'max' ? 'stacked' : 'resting'} {formatCompactNum(alt.damage)}{' '}
          <span className={`clb__d ${tone(alt.delta)}`}>{pct(alt.delta)}</span>
        </small>
      ) : null}
    </span>
  )
}

export function Climb({
  kind,
  onKind,
  counts,
  rows,
  base,
  held,
  onHeld,
  onApply,
  running,
  targetValue,
  targetGroups,
  onTarget,
  wpnSets,
  setConds,
  onOpenConfig,
}: {
  kind: ClimbKind
  onKind: (kind: ClimbKind) => void
  counts: Record<ClimbKind, number>
  rows: ClimbRow[]
  base: number
  held: number
  onHeld: (index: number) => void
  onApply: (row: ClimbRow) => void
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
  const [ropes, setRopes] = useState<{ width: number, height: number, list: Rope[] }>({ width: 0, height: 0, list: [] })
  const [lit, setLit] = useState<number | null>(null)

  const originIndex = rows.findIndex(isBase)
  const originRow = originIndex >= 0 ? rows[originIndex] : null
  const heldRow = rows[held] ?? null

  // Derive connector endpoints from rendered rows after wrapping and layout.
  useLayoutEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return

    const measure = () => {
      // Convert viewport rectangles to content coordinates using both scroll offsets.
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

      const dot = sheet.querySelector('.clb__origin-dot') ?? baseRef.current
      if (!dot) return
      const origin = at(dot)
      const ox = Math.max(8, origin.x + origin.w / 2)
      const oy = Math.max(0, origin.y + origin.h / 2)
      const most = Math.max(1, ...rows.map((row) => Math.abs(row.delta)))

      const list: Rope[] = []
      sheet.querySelectorAll<HTMLElement>('[data-rope]').forEach((tip) => {
        const index = Number(tip.dataset.rope)
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

      // Exclude the SVG from height measurement: using scrollHeight would feed
      // the previous connector-layer height back into shorter result lists.
      let height = 0
      for (const child of sheet.children) {
        if (child instanceof SVGElement) continue
        const rect = at(child)
        height = Math.max(height, rect.y + rect.h)
      }

      setRopes({ width: sheet.clientWidth, height, list })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(sheet)
    return () => observer.disconnect()
  }, [originIndex, rows])

  /* each channel opens at its top */
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

  /* arrow keys walk the ledger in the order it is drawn */
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
        className={`clb__row${index === held ? ' is-on' : ''}${index === lit ? ' is-hi' : ''}`}
        style={{ '--clb-result-ink': row.color ?? 'var(--clb-ink)' } as CssProps}
        {...rowProps(index)}
      >
        <span className="clb__rk">{row.rank}</span>
        <Build kind={kind} row={row} />
        <Out row={row} index={index} />
      </button>
    )
  }

  const originBody = (
    <>
      <span className="clb__origin-dot" />
      <span className="clb__origin-name">
        <em>Current</em>
        {originRow ? <Build kind={kind} row={originRow} /> : null}
      </span>
      {originRow ? <Out row={originRow} index={originIndex} /> : null}
    </>
  )

  return (
    <div className="clb">
      <div className="clb__chn">
        {CLIMB_KINDS.map((entry) => {
          const at = entry === kind
          return (
            <button
              key={entry}
              type="button"
              className={`clb__ch${at ? ' is-at' : ''}`}
              onClick={() => onKind(entry)}
            >
              <i className="clb__ink" />
              <span className="clb__chn-name">{CLIMB_KIND_NAME[entry]}</span>
              <span className="clb__chn-n">{counts[entry]}</span>
              {at ? (
                <span className="clb__chn-base">
                  measured from <b ref={baseRef}>{formatCompactNum(base)}</b>
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="clb__main">
        <div className="clb__head">
          <LiquidSelect<string> className="clb__tgt"
            value={targetValue}
            options={[]}
            groups={targetGroups}
            onChange={onTarget}
            ariaLabel="Suggestion target"
          />
          <div className="clb__gates">
            {configSummary.map((entry) => (
              <span key={entry} className="clb__gate">{entry}</span>
            ))}
            {kind === 'mainStats' ? null : (
              <button type="button" className="clb__gate clb__gate--go" onClick={onOpenConfig}>
                Config
              </button>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="clb__empty">
            {running
              ? 'Searching...'
              : 'Pick a target above to see what this build could reach. Make sure echoes are equipped.'}
          </p>
        ) : (
          <div className="clb__ledger" data-running={running ? '' : undefined}>
            <div className="clb__cols" aria-hidden>
              <span>#</span>
              <span>{kind === 'weapons' ? 'Weapon' : 'Build'}</span>
              <span>Damage</span>
            </div>

            <div ref={sheetRef} className="clb__sheet" role="group" aria-label="Results" onKeyDown={onKeyDown}>
              <svg
                key={kind}
                className={`clb__ropes${lit != null ? ' is-lit' : ''}`}
                width={ropes.width}
                height={ropes.height}
                viewBox={`0 0 ${ropes.width || 1} ${ropes.height || 1}`}
                aria-hidden
              >
                {ropes.list.map((rope, order) => (
                  <path
                    key={rope.index}
                    d={rope.d}
                    pathLength={1}
                    strokeWidth={rope.width}
                    className={`clb__rope ${rope.gain ? 'up' : 'dn'}${rope.index === held ? ' is-on' : ''}${rope.index === lit ? ' is-hi' : ''}`}
                    style={{ animationDelay: `${order * 26}ms` }}
                  />
                ))}
              </svg>

              {rows.map((row, index) => index === originIndex ? (
                <button
                  key={row.key}
                  type="button"
                  className={`clb__origin${originIndex === held ? ' is-on' : ''}`}
                  {...rowProps(originIndex)}
                >
                  {originBody}
                </button>
              ) : renderRow(index))}
            </div>
          </div>
        )}
      </div>

      {rows.length > 0 && heldRow ? (
        <div className="clb__bar"
          style={{ '--clb-result-ink': heldRow.color ?? 'var(--clb-ink)' } as CssProps}
        >
          <div className="clb__f clb__bar-rk"><span>{heldRow.rank}</span></div>

          {heldRow.weapon ? (
            <div className="clb__f clb__bar-wpn">
              <span className="clb__wicon">
                <img src={heldRow.weapon.icon} alt="" onError={withDefIconM} />
              </span>
              <b>{heldRow.weapon.name}</b>
              <em>{heldRow.weapon.rarity}★ · R{heldRow.weapon.rank}</em>
            </div>
          ) : null}

          <div className="clb__f clb__bar-led">
            <div className="spx-trays spx-trays--named">
              {heldRow.trays.map((tray, index) => (
                <Tray key={`${tray.key}:${index}`} tray={tray} ink="var(--resonator-accent)" />
              ))}
            </div>
          </div>

          <div className="clb__f clb__bar-out">
            <b>{formatCompactNum(heldRow.damage)}</b>
            <em className={`clb__d ${tone(heldRow.delta)}`}>
              {isBase(heldRow) ? 'base' : pct(heldRow.delta)}
            </em>
          </div>

          <button
            type="button"
            className={`clb__apply${heldRow.now ? ' is-on' : ''}`}
            onClick={() => onApply(heldRow)}
          >
            {heldRow.weapon
              ? 'Equip'
              : 'Apply'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
