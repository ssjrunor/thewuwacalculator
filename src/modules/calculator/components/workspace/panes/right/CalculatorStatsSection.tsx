import type { CSSProperties } from 'react'
import type { OverviewStatRow, OverviewStatsView } from '@/modules/calculator/model/overviewStats'
import {
  STAT_ICON_MAP,
  formatDisplayValue,
} from '@/modules/calculator/model/overviewStats'

interface CalculatorStatsSectionProps {
  statsView: OverviewStatsView | null
}

// surfaces the main and secondary stat breakdown from the simulation view.
function StatsGrid({
  stats,
}: {
  stats: OverviewStatRow[]
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
                } as CSSProperties}
              />
            ) : null}
            {stat.label}
          </div>
          <div className="stat-value">{formatDisplayValue(stat.label, stat.base)}</div>
          <div className="stat-bonus">
            {stat.bonus === 0 ? '' : `+${formatDisplayValue(stat.label, stat.bonus)}`}
          </div>
          <div className="stat-total">{formatDisplayValue(stat.label, stat.total)}</div>
        </div>
      ))}
    </div>
  )
}

export function CalculatorStatsSection({ statsView }: CalculatorStatsSectionProps) {
  return (
    <div className="pane-section stats-box ui-surface-card ui-surface-card--section">
      <h2 className="panel-title">Stats</h2>
      <h3 className="stat-group-title">Main Stats</h3>
      {statsView ? <StatsGrid stats={statsView.mainStats} /> : null}
      <h3 className="stat-group-title">Secondary Stats</h3>
      {statsView ? <StatsGrid stats={statsView.secondaryStats} /> : null}
      <h3 className="stat-group-title">Damage Modifier Stats</h3>
      {statsView ? <StatsGrid stats={statsView.damageModifierStats} /> : null}
    </div>
  )
}
