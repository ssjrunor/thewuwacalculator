/*
  Author: Runor Ewhro
  Description: renders the stats surface for the calculator results flow.
*/

import type { CSSProperties as CssProps } from 'react'
import type { StatViewRow, StatsView } from '@/modules/calculator/model/statsView.ts'
import {
  STAT_ICON_MAP,
  formatStatValue,
} from '@/modules/calculator/model/statsView.ts'

interface CalcSttsSctn {
  statsView: StatsView | null
}

// surfaces the main and secondary stat breakdown from the simulation view.
function StatsGrid({
  stats,
}: {
  stats: StatViewRow[]
}) {
  return (
    <div className="stats-grid">
      {stats.map((stat) => (
        <div key={stat.label} className="stat-row">
          <div
            className="stat-label"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              ...(stat.color ? { color: stat.color } : {}),
            }}
          >
            {STAT_ICON_MAP[stat.label] ? (
              <div
                className="grid-stat-icon"
                style={{
                  '--stat-color': stat.color ?? '#999999',
                  WebkitMaskImage: `url(${STAT_ICON_MAP[stat.label]})`,
                  maskImage: `url(${STAT_ICON_MAP[stat.label]})`,
                } as CssProps}
              />
            ) : null}
            {stat.label}
          </div>
          <div className="stat-value">{formatStatValue(stat.label, stat.base)}</div>
          <div className="stat-bonus">
            {stat.bonus === 0 ? '' : `+${formatStatValue(stat.label, stat.bonus)}`}
          </div>
          <div className="stat-total">{formatStatValue(stat.label, stat.total)}</div>
        </div>
      ))}
    </div>
  )
}

export function Stats({ statsView }: CalcSttsSctn) {
  return (
    <div className="pane-section stats-box ui-surface-card ui-surface-card--section">
      <h2 className="panel-title">Stats</h2>
      <h3 className="stat-group-title">Main Stats</h3>
      {statsView ? <StatsGrid stats={statsView.mainStats} /> : null}
      <h3 className="stat-group-title">Secondary Stats</h3>
      {statsView ? <StatsGrid stats={statsView.secondaryStats} /> : null}
      <h3 className="stat-group-title">Damage Modifier Stats</h3>
      {statsView ? <StatsGrid stats={statsView.dmgMdfrStts} /> : null}
    </div>
  )
}
