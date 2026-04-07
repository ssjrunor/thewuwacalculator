import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { CSSProperties } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import { getNegativeEffectEffectiveStacks, resolveNegativeEffectsForRuntime } from '@/domain/gameData/negativeEffects'
import type { SimulationResult } from '@/engine/pipeline/types'
import {
  buildOverviewStatsView,
  formatCompactNumber,
} from '@/modules/calculator/model/overviewStats'
import { getPrimarySkillType } from '@/modules/calculator/model/skillTypes'
import { CalculatorDamageSection } from '@/modules/calculator/components/workspace/panes/right/CalculatorDamageSection'
import { CalculatorStatsSection } from '@/modules/calculator/components/workspace/panes/right/CalculatorStatsSection'
import { getEnemyTuneStrain } from '@/domain/services/enemyProfileService'

interface CalculatorRightPaneProps {
  simulation: SimulationResult | null
  runtime: ResonatorRuntimeState | null
  enemy: EnemyProfile
}

interface OverviewItem {
  label: string
  value: string
  detail?: string
  body?: ReactNode
}

const NEGATIVE_EFFECT_ABBREVIATIONS: Record<string, string> = {
  spectroFrazzle: 'SF',
  aeroErosion: 'AE',
  fusionBurst: 'FB',
  havocBane: 'HB',
  glacioChafe: 'GC',
  electroFlare: 'EF',
  electroRage: 'ER',
}

// renders the right-hand telemetry surface once a simulation and runtime are available.
export function CalculatorRightPane({ simulation, runtime, enemy }: CalculatorRightPaneProps) {
  const statsView = useMemo(
    () => (simulation && runtime ? buildOverviewStatsView(runtime, simulation.finalStats) : null),
    [runtime, simulation],
  )
  const visibleNegativeEffects = useMemo(
    () => (runtime ? resolveNegativeEffectsForRuntime(runtime) : []),
    [runtime],
  )

  if (!simulation || !runtime) {
    return (
      <section className="calc-pane calculator-results-pane">
        <div className="panel-head compact results-pane-head">
          <div>
            <div className="panel-overline">Live Output</div>
            <h2 className="panel-heading-title">Damage Telemetry</h2>
          </div>
          <p className="panel-copy">Waiting for an active resonator runtime before rendering result telemetry.</p>
        </div>
        <div className="soft-empty">Simulation results will appear here once a resonator and runtime are active.</div>
      </section>
    )
  }

  const personalRotCount = simulation.rotations.personal.entries.length
  const personalSkillTypeCount = new Set(
    simulation.rotations.personal.entries.map((entry) => getPrimarySkillType(entry.skill.skillType)),
  ).size
  const teamRotCount = simulation.rotations.team.entries.length
  const teamMemberCount = new Set(
    simulation.rotations.team.entries.map((entry) => entry.resonatorId),
  ).size
  const tuneStrain = getEnemyTuneStrain(enemy)
  const enemyStatuses = [
    ...(tuneStrain > 0
      ? [
          {
            key: 'tuneStrain',
            abbreviation: 'TS',
            accent: 'var(--calc-muted)',
            value: tuneStrain,
            max: 10,
          },
        ]
      : []),
    ...visibleNegativeEffects
      .map((effect) => ({
        key: effect.key,
        abbreviation: effect.label === 'Glacio Bite'
          ? 'GB'
          : (NEGATIVE_EFFECT_ABBREVIATIONS[effect.key] ?? effect.label),
        accent: effect.accent,
        value: getNegativeEffectEffectiveStacks(runtime, effect.key),
        max: effect.max,
      }))
      .filter((effect) => effect.value > 0),
  ]

  const overviewItems: OverviewItem[] = [
    {
      label: 'Personal Damage',
      value: formatCompactNumber(simulation.rotations.personal.total.avg),
      detail:
        personalRotCount > 0
          ? `${personalRotCount} feature${personalSkillTypeCount === 1 ? '' : 's'}${simulation.rotations.personal.totalsByAggregation.healing.avg > 0 ? `, ${formatCompactNumber(simulation.rotations.personal.totalsByAggregation.healing.avg)} heal` : ''}${simulation.rotations.personal.totalsByAggregation.healing.avg > 0 ? `, ${formatCompactNumber(simulation.rotations.personal.totalsByAggregation.shield.avg)} shield` : ''}`
          : 'No personal rotation entries',
    },
    {
      label: 'Team Damage',
      value: formatCompactNumber(simulation.rotations.team.total.avg),
      detail:
        teamRotCount > 0
          ? `${teamMemberCount} member${teamMemberCount === 1 ? '' : 's'}${simulation.rotations.team.totalsByAggregation.healing.avg > 0 ? `, ${formatCompactNumber(simulation.rotations.team.totalsByAggregation.healing.avg)} heal` : ''}${simulation.rotations.team.totalsByAggregation.healing.avg > 0 ? `, ${formatCompactNumber(simulation.rotations.team.totalsByAggregation.shield.avg)} shield` : ''}`
          : 'No team rotation entries',
    },
    {
      label: 'Enemy Pressure',
      value: `Lv ${enemy.level}`,
      detail: `${enemy.toa ? 'ToA' : 'Standard'} · Class ${enemy.class}`,
    },
    {
      label: 'Enemy Statuses',
      value: `${enemyStatuses.length} Active`,
      detail: ``,
      body:
        enemyStatuses.length > 0 ? (
          <div
            className="enemy-status-card-body"
            style={{ '--enemy-status-count': enemyStatuses.length } as CSSProperties}
          >
            {enemyStatuses.map((status) => (
              <div key={status.key} className="resonator-snapshot-detail enemy-status-row">
                <span className="enemy-status-row__abbr" style={{ color: status.accent }}>
                  {status.abbreviation}
                </span>
                <span className="enemy-status-row__middle">·</span>
                <span className="enemy-status-row__value">
                  {status.value}/{status.max}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="enemy-status-card-body enemy-status-card-body--empty">
            No tracked enemy statuses are active.
          </div>
        ),
    },
  ]

  return (
    <section className="calc-pane calculator-results-pane">
      <div className="panel-head compact results-pane-head">
        <div>
          <div className="panel-overline">Live Output</div>
          <h2 className="panel-heading-title">Damage Telemetry</h2>
        </div>
      </div>

      <section className="analysis-overview-grid">
        {overviewItems.map((item) => (
          <article key={item.label} className="resonator-snapshot-card ui-surface-card ui-surface-card--section">
            <span className="resonator-snapshot-label">{item.label}</span>
            <strong className="resonator-snapshot-value">{item.value}</strong>
            {item.body ? item.body : <span className="resonator-snapshot-detail">{item.detail}</span>}
          </article>
        ))}
      </section>

      <div className="results-section-stack">
        <CalculatorStatsSection statsView={statsView} />
        <CalculatorDamageSection simulation={simulation} runtime={runtime} enemy={enemy} />
      </div>
    </section>
  )
}
