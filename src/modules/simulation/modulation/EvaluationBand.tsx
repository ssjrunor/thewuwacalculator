/*
  Author: Runor Ewhro
  Description: Shared evaluation score band used by every build-analysis page.
*/

import type { ReactNode } from 'react'
import { GRADE_LADDER } from '@/data/scoring/buildEvaluation.ts'
import type { BuildEvaluationReport } from '@/data/scoring/buildEvaluation.ts'
import {
  formatBuildEvaluationScore,
  getBuildEvaluationEmoji,
  getBuildEvaluationTone,
} from '@/modules/simulation/model/buildEvaluationDisplay.ts'
import { formatCompactNum } from '@/modules/simulation/model/statsView.ts'
import type { CssVars } from '@/modules/simulation/workspace/ui.tsx'

const GRADE_BLEND = 1.5

const GRADE_SCALE_GRADIENT = (() => {
  const asc = [...GRADE_LADDER].sort((a, b) => a[0] - b[0])
  const positions = asc.map(([threshold]) => Math.max(0, Math.min(100, threshold / 2)))
  const colors = asc.map(([threshold]) => getBuildEvaluationTone(threshold).color)
  const startColor = getBuildEvaluationTone(0).color

  const stops: string[] = [`${startColor} 0%`]
  for (let i = 0; i < positions.length; i += 1) {
    const pos = positions[i]
    const leftColor = i === 0 ? startColor : colors[i - 1]
    const prev = i === 0 ? 0 : positions[i - 1]
    const next = i + 1 < positions.length ? positions[i + 1] : 100
    const blend = Math.max(0, Math.min(GRADE_BLEND, (pos - prev) * 0.49, (next - pos) * 0.49))
    stops.push(`${leftColor} ${(pos - blend).toFixed(2)}%`)
    stops.push(`${colors[i]} ${(pos + blend).toFixed(2)}%`)
  }
  stops.push(`${colors[colors.length - 1]} 100%`)
  return `linear-gradient(90deg, ${stops.join(', ')})`
})()

const GRADE_MARKS = [...GRADE_LADDER]
  .sort((a, b) => a[0] - b[0])
  .map(([threshold, label]) => ({
    threshold,
    label,
    pos: Math.max(0, Math.min(100, threshold / 2)),
  }))

const MILESTONE_LABELS = new Set(['F', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS', 'SOLON?!'])
const MILESTONE_MARKS = GRADE_MARKS
  .filter((mark) => MILESTONE_LABELS.has(mark.label))
  .map((mark) => ({ ...mark, color: getBuildEvaluationTone(mark.threshold).color }))

const NO_READING = '--'

export function EvaluationBand({
  report,
  score,
  grade,
  tone,
  banner,
}: {
  report: BuildEvaluationReport | null
  score: number | null
  grade: string | null
  tone: string
  banner?: ReactNode
}) {
  const evaluation = report?.evaluation ?? null
  // The band remains mounted while a run is pending. Unknown readings go quiet
  // and the marker hunts until the shared evaluation report resolves.
  const reading = !evaluation || score == null || grade == null
  const pct = reading ? 0 : Math.max(0, Math.min(100, score / 2))

  return (
    <section className="workspace-band workspace-card workspace-span"
      data-state={reading ? 'reading' : undefined}
      data-emoji={reading ? undefined : getBuildEvaluationEmoji(grade)}
      data-score={reading ? undefined : Math.floor(score)}
      data-banner={banner ? 'true' : undefined}
      style={{
        ...(reading ? {} : { '--grade': tone, '--pos': `${pct}%` }),
        '--grade-scale': GRADE_SCALE_GRADIENT,
      } as CssVars}
    >
      {banner}
      <div className="workspace-band-core">
        <div className="workspace-band-score">
          <span className="workspace-eyebrow">Build Score</span>
          <strong className="workspace-band-figure">
            {reading ? null : formatBuildEvaluationScore(score)}
          </strong>
          <span className="workspace-band-score-sub">
            {reading ? 'scoring... hang tight!' : (
              <>
                <em>{formatCompactNum(evaluation.userDamage)}</em> avg dmg
              </>
            )}
          </span>
        </div>
      </div>

      <div className="workspace-band-gauge">
        <div className="workspace-ruler-top">
          <span className="workspace-ruler-dmg">
            <em>{evaluation ? formatCompactNum(evaluation.baselineDamage) : NO_READING}</em>
            <span>Baseline · 0%</span>
          </span>
          <span className="workspace-ruler-dmg workspace-ruler-dmg--mid">
            <em>{evaluation ? formatCompactNum(evaluation.referenceDamage) : NO_READING}</em>
            <span>Reference · 100%</span>
          </span>
          <span className="workspace-ruler-dmg workspace-ruler-dmg--end">
            <em>{evaluation ? formatCompactNum(evaluation.maximumDamage) : NO_READING}</em>
            <span>Maximum · 200%</span>
          </span>
        </div>

        <div className="workspace-track">
          <span className="workspace-track-bar">
            <span className="workspace-track-scale" />
            <span className="workspace-track-fill" />
            {GRADE_MARKS.map((mark) => (
              <span
                key={`${mark.threshold}:${mark.label}`} className="workspace-track-notch"
                style={{ '--at': `${mark.pos}%` } as CssVars}
              />
            ))}
          </span>
          <span className="workspace-track-tick workspace-track-tick--mid" style={{ '--at': '50%' } as CssVars} />
          <span className="workspace-track-marker">
            {reading ? null : <span className="workspace-track-marker-flag">{grade}</span>}
          </span>
        </div>

        <div className="workspace-ruler-tiers">
          <span className="workspace-ruler-cap workspace-ruler-cap--start">0%</span>
          {MILESTONE_MARKS.map((mark) => (
            <span
              key={`${mark.threshold}:${mark.label}`}
              className={`workspace-ruler-tier${mark.pos <= pct ? ' is-reached' : ''}`}
              style={{ '--at': `${mark.pos}%`, '--tier-color': mark.color } as CssVars}
            >
              <i className="workspace-ruler-tier-stem" aria-hidden="true" />
              <b>{mark.label}</b>
            </span>
          ))}
          <span className="workspace-ruler-cap workspace-ruler-cap--end">200%</span>
        </div>
      </div>
    </section>
  )
}
