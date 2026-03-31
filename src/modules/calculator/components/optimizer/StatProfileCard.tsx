import { useEffect, useMemo, useRef, useState } from 'react'
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
import { MOCK_RADAR_DATA } from './mockData'

function formatStatValue(statLabel: string, value: number | null | undefined): string {
  if (value == null) return '-'
  switch (statLabel) {
    case 'ATK':
    case 'HP':
    case 'DEF':
      return Math.floor(value).toLocaleString()
    case 'ER%':
    case 'CR%':
    case 'CD%':
    case 'BNS%':
      return (value ?? 0).toFixed(1)
    default:
      return typeof value === 'number' ? value.toFixed(1) : String(value)
  }
}

function StatProfileTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: Record<string, number> }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null

  const row = payload[0].payload

  return (
    <div className="analytics-tooltip">
      <div className="analytics-tooltip__header">
        <span className="analytics-tooltip__label">{label}</span>
      </div>
      <div className="analytics-tooltip__row">
        <span className="analytics-tooltip__tag analytics-tooltip__tag--current">Current</span>
        <span className="analytics-tooltip__value">{formatStatValue(label ?? '', row.current) || 'Unset'}</span>
      </div>
      <div className="analytics-tooltip__row">
        <span className="analytics-tooltip__tag analytics-tooltip__tag--candidate">Candidate</span>
        <span className="analytics-tooltip__value">{formatStatValue(label ?? '', row.candidate) || 'Unset'}</span>
      </div>
    </div>
  )
}

export function StatProfileCard() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentColor, setCurrentColor] = useState('crimson')
  const [candidateColor, setCandidateColor] = useState('#20bfb9')
  const [candidateFill, setCandidateFill] = useState('#60fffa')

  useEffect(() => {
    if (!containerRef.current) return
    const styles = getComputedStyle(containerRef.current)
    const current = styles.getPropertyValue('--optimizer-color-current').trim()
    const candidate = styles.getPropertyValue('--optimizer-color-candidate').trim()
    if (current) setCurrentColor(current)
    if (candidate) {
      setCandidateColor(candidate)
      setCandidateFill(candidate)
    }
  }, [])

  const normalizedData = useMemo(() => {
    return MOCK_RADAR_DATA.map((row) => {
      const maxVal = Math.max(row.current ?? 0, row.candidate ?? 0) || 1
      return {
        ...row,
        currentNorm: (row.current / maxVal) * 100,
        candidateNorm: (row.candidate / maxVal) * 100,
      }
    })
  }, [])

  return (
    <div ref={containerRef}>
      <div className="card-title">Stat Profile</div>
      <div className="analytics-card-header">
        <span className="analytics-subtitle">Current vs candidate</span>
      </div>
      <div className="analytics-body">
        <div className="analytics-chart-wrapper">
          <ResponsiveContainer width={200} height={190}>
            <RadarChart data={normalizedData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="stat" tick={{ fontSize: 13 }} />
              <PolarRadiusAxis tick={{ fontSize: 8 }} domain={[0, 100]} />
              <Radar
                name="Current"
                dataKey="currentNorm"
                fillOpacity={0.25}
                stroke={currentColor}
                fill={currentColor}
                isAnimationActive={false}
              />
              <Radar
                name="Candidate"
                dataKey="candidateNorm"
                fillOpacity={0.25}
                stroke={candidateColor}
                fill={candidateFill}
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
