/*
  Author: Runor Ewhro
  Description: Renders the row surface for the calculator optimizer flow.
*/

import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback.ts'

export interface OptDsplStts {
  atk: number
  hp: number
  def: number
  er: number
  cr: number
  cd: number
  bonus: number
  amp: number
}

export interface OptDsplSetEn {
  id: number
  icon: string | null
  count: number
}

export interface OptDisplayRow {
  damage: number
  stats: OptDsplStts | null
  // the per-echo cost combo is stored because every legal loadout already sums
  // to 12, making the total less useful than the chosen cost distribution.
  costs: number[] | null
  sets: OptDsplSetEn[]
  mainEchoIcon: string | null
}

interface OptRowPrps {
  result: OptDisplayRow
  baseDamage?: number
  base?: boolean
  rotationMode?: boolean
  selected?: boolean
  onClick?: () => void
}

function renderStat(value: number | null | undefined, formatter: (next: number) => string): string {
  if (value == null || !Number.isFinite(value)) {
    return '...'
  }

  return formatter(value)
}

export function Row({
  result,
  baseDamage,
  base = false,
  rotationMode = false,
  selected = false,
  onClick,
  }: OptRowPrps) {
  const { stats, costs, sets, mainEchoIcon, damage } = result
  const diff =
    base || !baseDamage || baseDamage <= 0
      ? '100.00'
      : ((damage / baseDamage) * 100).toFixed(2)

  function viewSetBdgs() {
    if (!sets || sets.length === 0) return <span className="empty-set">…</span>

    return (
      <span className="set-plan" title={sets.map((s) => `${s.count}pc`).join(' + ')}>
        {sets.map((entry, index) => (
          <span key={`${entry.id}-${entry.count}-${index}`} className="set-plan__entry">
            <span className="set-plan__frame">
              {entry.icon ? (
                <img src={entry.icon} alt="" className="set-plan__icon" loading="lazy" onError={withDefIconM} />
              ) : (
                <span className="set-plan__icon set-plan__icon--ghost" aria-hidden="true" />
              )}
            </span>
            <span className="set-plan__sup" aria-label={`${entry.count} piece`}>
              {entry.count}
            </span>
          </span>
        ))}
      </span>
    )
  }

  function viewCostCombo() {
    if (!costs || costs.length === 0) return <span className="cost-combo cost-combo--empty">…</span>
    const total = costs.reduce((sum, value) => sum + value, 0)
    return (
      <span className="cost-combo" title={`Total cost: ${total}`}>
        {costs.map((value, index) => (
          <span key={`${index}-${value}`} className="cost-combo__group">
            {index > 0 ? (
              <span className="cost-combo__sep" aria-hidden="true">⟡</span>
            ) : null}
            <span className={`cost-combo__digit cost-combo__digit--c${value}`}>
              {value}
            </span>
          </span>
        ))}
      </span>
    )
  }

  return (
    <div
      className={`opt-result-row${selected ? ' is-selected' : ''}${base ? ' is-base' : ''}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) {
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="opt-result-row__col opt-result-row__col--sets">{viewSetBdgs()}</div>
      <div className="opt-result-row__col opt-result-row__col--echo">
        {mainEchoIcon ? (
          <img src={mainEchoIcon} alt="main echo" className="opt-result-row__echo-icon" loading="lazy" onError={withDefEchoMg} />
        ) : (
          <span className="opt-result-row__placeholder">...</span>
        )}
      </div>
      <div className="opt-result-row__col opt-result-row__col--cost">{viewCostCombo()}</div>
      <div className="opt-result-row__col">{renderStat(stats?.atk, (value) => Math.floor(value).toString())}</div>
      <div className="opt-result-row__col">{renderStat(stats?.hp, (value) => Math.floor(value).toString())}</div>
      <div className="opt-result-row__col">{renderStat(stats?.def, (value) => Math.floor(value).toString())}</div>
      <div className="opt-result-row__col">{renderStat(stats?.er, (value) => value.toFixed(1))}</div>
      <div className="opt-result-row__col">{renderStat(stats?.cr, (value) => value.toFixed(1))}</div>
      <div className="opt-result-row__col">{renderStat(stats?.cd, (value) => value.toFixed(1))}</div>
      {!rotationMode ? (
        <div className="opt-result-row__col">{renderStat(stats?.bonus, (value) => value.toFixed(1))}</div>
      ) : null}
      {!rotationMode ? (
        <div className="opt-result-row__col">{renderStat(stats?.amp, (value) => value.toFixed(1))}</div>
      ) : null}
      <div className="opt-result-row__col opt-result-row__col--dmg avg">{Math.floor(damage || 0)}</div>
      <div className="opt-result-row__col opt-result-row__col--eff">{diff}%</div>
    </div>
  )
}
