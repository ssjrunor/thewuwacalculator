/*
  Author: Runor Ewhro
  Description: Renders the stats surface for the calculator results flow.
*/

import type { CSSProperties as CssProps } from 'react'
import type { VrvwStatRow, VrvwSttsView } from '@/modules/calculator/features/overview/lib/stats.ts'
import {
  STATICONMAP,
  fmtDsplVl,
} from '@/modules/calculator/features/overview/lib/stats.ts'

interface CalcSttsSctn {
  statsView: VrvwSttsView | null
}

// surfaces the main and secondary stat breakdown from the simulation view.
function StatsGrid({
  stats,
}: {
  stats: VrvwStatRow[]
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
            {STATICONMAP[stat.label] ? (
              <div
                className="grid-stat-icon"
                style={{
                  '--stat-color': stat.color ?? '#999999',
                  WebkitMaskImage: `url(${STATICONMAP[stat.label]})`,
                  maskImage: `url(${STATICONMAP[stat.label]})`,
                } as CssProps}
              />
            ) : null}
            {stat.label}
          </div>
          <div className="stat-value">{fmtDsplVl(stat.label, stat.base)}</div>
          <div className="stat-bonus">
            {stat.bonus === 0 ? '' : `+${fmtDsplVl(stat.label, stat.bonus)}`}
          </div>
          <div className="stat-total">{fmtDsplVl(stat.label, stat.total)}</div>
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
