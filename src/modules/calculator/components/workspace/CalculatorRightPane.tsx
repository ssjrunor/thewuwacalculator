import { useMemo } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { SimulationResult } from '@/engine/pipeline/types'
import {
  buildOverviewStatsView,
  formatCompactNumber,
} from '@/modules/calculator/model/overviewStats'
import { getPrimarySkillType } from '@/modules/calculator/model/skillTypes'
import { CalculatorDamageSection } from '@/modules/calculator/components/workspace/panes/right/CalculatorDamageSection'
import { CalculatorStatsSection } from '@/modules/calculator/components/workspace/panes/right/CalculatorStatsSection'

interface CalculatorRightPaneProps {
  simulation: SimulationResult | null
  runtime: ResonatorRuntimeState | null
  enemy: EnemyProfile
}

// renders the right-hand telemetry surface once a simulation and runtime are available.
export function CalculatorRightPane({ simulation, runtime, enemy }: CalculatorRightPaneProps) {
  const statsView = useMemo(
    () => (simulation && runtime ? buildOverviewStatsView(runtime, simulation.finalStats) : null),
    [runtime, simulation],
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

  const overviewItems = [
    {
      label: 'Personal Damage',
      value: formatCompactNumber(simulation.rotations.personal.total.avg),
      detail:
        personalRotCount > 0
          ? `${personalRotCount} feature${personalSkillTypeCount === 1 ? '' : 's'}, ${formatCompactNumber(simulation.rotations.personal.totalsByAggregation.healing.avg)} heal, ${formatCompactNumber(simulation.rotations.personal.totalsByAggregation.shield.avg)} shield`
          : 'No personal rotation entries',
    },
    {
      label: 'Team Damage',
      value: formatCompactNumber(simulation.rotations.team.total.avg),
      detail:
        teamRotCount > 0
          ? `${teamMemberCount} member${teamMemberCount === 1 ? '' : 's'} contributing, ${formatCompactNumber(simulation.rotations.team.totalsByAggregation.healing.avg)} heal, ${formatCompactNumber(simulation.rotations.team.totalsByAggregation.shield.avg)} shield`
          : 'No team rotation entries',
    },
    {
      label: 'Enemy Pressure',
      value: `Lv ${enemy.level}`,
      detail: `${enemy.toa ? 'ToA' : 'Standard'} · Class ${enemy.class}`,
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
            <span className="resonator-snapshot-detail">{item.detail}</span>
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
