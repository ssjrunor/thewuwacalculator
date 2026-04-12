import { useMemo } from 'react'
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import type { OptimizerDisplayStats } from './OptimizerRow'

interface StatProfileRow {
  stat: string
  current: number
  candidate: number
  currentNorm: number
  candidateNorm: number
}

function formatStatValue(statLabel: string, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '-'
  }

  switch (statLabel) {
    case 'ATK':
    case 'HP':
    case 'DEF':
      return Math.floor(value).toLocaleString()
    case 'ER%':
    case 'CR%':
    case 'CD%':
    case 'BNS%':
      return value.toFixed(1)
    default:
      return value.toFixed(1)
  }
}

function StatProfileTooltip(props: {
  active?: boolean
  payload?: Array<{ payload: StatProfileRow }>
  label?: string
}) {
  if (!props.active || !props.payload?.length) {
    return null
  }

  const row = props.payload[0]?.payload
  if (!row) {
    return null
  }

  return (
    <div className="analytics-tooltip">
      <div className="analytics-tooltip__header">
        <span className="analytics-tooltip__label">{props.label}</span>
      </div>
      <div className="analytics-tooltip__row">
        <span className="analytics-tooltip__tag analytics-tooltip__tag--current">Current</span>
        <span className="analytics-tooltip__value">{formatStatValue(row.stat, row.current)}</span>
      </div>
      <div className="analytics-tooltip__row">
        <span className="analytics-tooltip__tag analytics-tooltip__tag--candidate">Candidate</span>
        <span className="analytics-tooltip__value">{formatStatValue(row.stat, row.candidate)}</span>
      </div>
    </div>
  )
}

function buildProfileRows(
  currentStats: OptimizerDisplayStats,
  candidateStats: OptimizerDisplayStats,
  rotationMode: boolean,
): StatProfileRow[] {
  const baseRows = [
    { stat: 'ATK', current: currentStats.atk, candidate: candidateStats.atk },
    { stat: 'HP', current: currentStats.hp, candidate: candidateStats.hp },
    { stat: 'DEF', current: currentStats.def, candidate: candidateStats.def },
    { stat: 'ER%', current: currentStats.er, candidate: candidateStats.er },
    { stat: 'CR%', current: currentStats.cr, candidate: candidateStats.cr },
    { stat: 'CD%', current: currentStats.cd, candidate: candidateStats.cd },
  ]

  if (!rotationMode) {
    baseRows.push({
      stat: 'BNS%',
      current: currentStats.bonus,
      candidate: candidateStats.bonus,
    })
  }

  return baseRows.map((row) => {
    const maxValue = Math.max(row.current, row.candidate, 1)
    return {
      ...row,
      currentNorm: (row.current / maxValue) * 100,
      candidateNorm: (row.candidate / maxValue) * 100,
    }
  })
}

export function StatProfileCard({
  currentStats,
  candidateStats,
  rotationMode,
}: {
  currentStats: OptimizerDisplayStats | null
  candidateStats: OptimizerDisplayStats | null
  rotationMode: boolean
}) {
  const chartData = useMemo(() => {
    if (!currentStats || !candidateStats) {
      return []
    }

    return buildProfileRows(currentStats, candidateStats, rotationMode)
  }, [candidateStats, currentStats, rotationMode])

  if (!currentStats || !candidateStats) {
    return (
      <div className="co-profile-card co-profile-card--empty">
        Run the optimizer and select a result to compare it against your current build.
      </div>
    )
  }

  return (
    <div className="co-profile-graph">
      <div className="analytics-card-header">
        <span className="analytics-subtitle">Current vs candidate</span>
      </div>
      <div className="analytics-body">
        <div className="analytics-chart-wrapper">
          <ResponsiveContainer width="100%" height={190}>
            <RadarChart data={chartData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="stat" tick={{ fontSize: 13 }} />
              <PolarRadiusAxis tick={{ fontSize: 8 }} domain={[0, 100]} />
              <Radar
                name="Current"
                dataKey="currentNorm"
                fillOpacity={0.25}
                stroke="var(--optimizer-color-current)"
                fill="var(--optimizer-color-current)"
                isAnimationActive={false}
              />
              <Radar
                name="Candidate"
                dataKey="candidateNorm"
                fillOpacity={0.25}
                stroke="var(--optimizer-color-candidate)"
                fill="var(--optimizer-color-candidate)"
                isAnimationActive={false}
              />
              <Legend />
              <Tooltip content={<StatProfileTooltip />} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
