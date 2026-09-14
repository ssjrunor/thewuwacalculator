/*
  Author: Runor Ewhro
  Description: Plots suggestion results as percentage deltas from the current
               build and applies the selected candidate through its owner.
*/

import { useLayoutEffect, useMemo, useState } from 'react'
import type { CSSProperties as CssProps } from 'react'
import type { WeaponPlanSet } from '@/domain/entities/suggestions.ts'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals.ts'
import { formatCompactNum } from '@/modules/simulation/model/statsView.ts'
import { LiquidSelect, type SelectGroup } from '@/shared/ui/LiquidSelect.tsx'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import {
  CLIMB_KINDS,
  CLIMB_KIND_NAME,
  type ClimbKind,
  type ClimbRow,
  type ClimbTray,
} from '@/modules/simulation/features/suggestions/climb/model.ts'

const NODE_FROM = 12
const NODE_SPAN = 80

const pct = (value: number, digits = 2) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}%`

const tone = (value: number) => (value > 0.004 ? 'up' : value < -0.004 ? 'dn' : 'zero')

/* Choose a rounded tick interval from the value spread, independent of result count. */
function axisTicks(low: number, high: number): number[] {
  const raw = (high - low) / 5
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 0.001)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((x) => x >= raw) ?? magnitude * 10
  const out: number[] = []
  for (let value = Math.ceil(low / step) * step; value <= high + 1e-9; value += step) {
    out.push(Number(value.toFixed(4)))
  }
  if (low <= 0 && high >= 0 && !out.some((value) => Math.abs(value) < 1e-9)) out.push(0)
  return out.sort((a, b) => a - b)
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
            {tray.primary.icon ? <span className="sst-icon" style={{ maskImage: `url(${tray.primary.icon})`, WebkitMaskImage: `url(${tray.primary.icon})` } as CssProps} /> : null}
            <span className="sst-val">{tray.primary.value}</span>
          </span>
          {tray.secondary ? (
            <span className="sst-line sst-line--sub">
              {tray.secondary.icon ? <span className="sst-icon" style={{ maskImage: `url(${tray.secondary.icon})`, WebkitMaskImage: `url(${tray.secondary.icon})` } as CssProps} /> : null}
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
  /* Callback state lets the observer follow a plot that mounts only when results exist. */
  const [plotEl, setPlotEl] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [lit, setLit] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!plotEl) return

    const measure = () => setSize({ width: plotEl.clientWidth, height: plotEl.clientHeight })
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(plotEl)
    return () => observer.disconnect()
  }, [plotEl])

  const scale = useMemo(() => {
    const deltas = rows.map((row) => row.delta).concat([0])
    const low = Math.min(...deltas)
    const high = Math.max(...deltas)
    const pad = Math.max((high - low) * 0.12, 0.6)
    const from = low - pad
    const to = high + pad
    return {
      low,
      high,
      y: (value: number) => 100 - ((value - from) / (to - from)) * 100,
    }
  }, [rows])

  const ticks = useMemo(
    () => [...new Set(axisTicks(scale.low, scale.high))],
    [scale.high, scale.low],
  )
  const baseY = scale.y(0)
  const heldRow = rows[held] ?? null

  const nodes = useMemo(() => rows.map((row, index) => ({
    row,
    index,
    x: NODE_FROM + (rows.length === 1 ? NODE_SPAN / 2 : (index / (rows.length - 1)) * NODE_SPAN),
    y: scale.y(row.delta),
  })), [rows, scale])

  const ropes = useMemo(() => {
    if (!size.width || !size.height) return []
    const originY = (baseY / 100) * size.height
    return nodes.map(({ x, y, row, index }) => {
      const px = (x / 100) * size.width
      const py = (y / 100) * size.height
      return {
        index,
        gain: row.delta >= 0,
        d: `M0 ${originY} C${px * 0.5} ${originY} ${px * 0.66} ${py} ${px} ${py}`,
      }
    })
  }, [baseY, nodes, size.height, size.width])

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
                  measured from <b>{formatCompactNum(base)}</b>
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
          <div className="clb__fan">
            <div
              ref={setPlotEl}
              className={`clb__plot${lit != null ? ' is-lit' : ''}`}
              data-running={running ? '' : undefined}
              style={{ '--clb-row-count': Math.max(rows.length, 1) } as CssProps}
            >
              <div className="clb__grid">
                {ticks.map((value) => {
                  const zero = Math.abs(value) < 1e-9
                  return (
                    <div key={value} className="clb__line" style={{ top: `${scale.y(value)}%` }}>
                      <i className={zero ? 'clb__rule is-zero' : 'clb__rule'} />
                      <em className={zero ? 'clb__tk is-zero' : 'clb__tk'}>
                        {zero ? 'base' : pct(value, Math.abs(value) % 1 ? 1 : 0)}
                      </em>
                    </div>
                  )
                })}
              </div>

              <svg className="clb__ropes" viewBox={`0 0 ${size.width || 1} ${size.height || 1}`} aria-hidden>
                {ropes.map((rope) => (
                  <path
                    key={rope.index}
                    d={rope.d}
                    className={`clb__rope ${rope.gain ? 'up' : 'dn'}${rope.index === held ? ' is-on' : ''}${rope.index === lit ? ' is-hi' : ''}`}
                    style={{ animationDelay: `${rope.index * 34}ms` }}
                  />
                ))}
              </svg>

              <div className="clb__origin" style={{ top: `${baseY}%` }}>
                <i />
                <b>{formatCompactNum(base)}</b>
              </div>

              {nodes.map(({ row, index, x, y }) => (
                <button
                  key={row.key}
                  type="button"
                  className={`clb__node${index === held ? ' is-on' : ''}${row.now ? ' is-now' : ''}${index === lit ? ' is-hi' : ''}${index % 2 ? ' is-under' : ''}`}
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    '--i': index,
                    '--clb-result-ink': row.color ?? 'var(--clb-ink)',
                  } as CssProps}
                  onMouseEnter={() => setLit(index)}
                  onMouseLeave={() => setLit(null)}
                  onFocus={() => setLit(index)}
                  onBlur={() => setLit(null)}
                  onClick={() => onHeld(index)}
                  title={row.now
                    ? `What you wear, ${pct(row.delta)}`
                    : `${row.rank}. ${row.marks.map((mark) => mark.text).join(', ')}, ${pct(row.delta)}`}
                >
                  {row.now && Math.abs(row.delta) < 0.05 ? (
                    <span className="clb__base">worn</span>
                  ) : (
                    <>
                      {row.marks.length > 0 ? (
                        <span className="clb__marks">
                          {row.marks.map((mark, markIndex) => (
                            <span
                              key={`${mark.key}:${markIndex}`} className="clb__mark"
                              style={mark.color ? { '--sc': mark.color } as CssProps : undefined}
                            >
                              {mark.icon ? (
                                mark.color
                                  ? <img src={mark.icon} alt="" onError={withDefIconM} />
                                  : <i style={{ maskImage: `url(${mark.icon})`, WebkitMaskImage: `url(${mark.icon})` } as CssProps} />
                              ) : null}
                              {mark.sup ? <sup>{mark.sup}</sup> : null}
                              {mark.cost ? <b>{mark.cost}</b> : null}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      <em className={`clb__d ${tone(row.delta)}`}>{pct(row.delta, 1)}</em>
                    </>
                  )}
                  <span className="clb__rk">{row.now ? '—' : row.rank}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {rows.length > 0 && heldRow ? (
        <div className="clb__bar"
          style={{ '--clb-result-ink': heldRow.color ?? 'var(--clb-ink)' } as CssProps}
        >
          <div className="clb__f clb__bar-rk"><span>{heldRow.now ? '\u2014' : heldRow.rank}</span></div>

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
              {heldRow.now && Math.abs(heldRow.delta) < 0.05 ? 'base' : pct(heldRow.delta)}
            </em>
          </div>

          {heldRow.weapon ? (
            <button
              type="button"
              className={`clb__apply${heldRow.now ? ' is-on' : ''}`}
              disabled={heldRow.now}
              onClick={() => onApply(heldRow)}
            >
              {heldRow.now ? 'Equipped' : 'Equip'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
