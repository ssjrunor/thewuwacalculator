/*
  Author: Runor Ewhro
  Description: Renders the right surface for the calculator main flow.
*/

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { CSSProperties as CssProps } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResRuntime } from '@/domain/entities/runtime'
import { getNegFfctFf, negEffectsFor } from '@/domain/gameData/negativeEffects'
import type { SimResult } from '@/engine/pipeline/types'
import {
  mkVrvwSttsVi,
  fmtCmpcNmbr,
} from '@/modules/calculator/features/overview/lib/stats.ts'
import { getPrimarySkill } from '@/modules/calculator/model/skillTypes'
import { Damage } from '@/modules/calculator/features/results/Damage.tsx'
import { Stats } from '@/modules/calculator/features/results/Stats.tsx'
import { getEnemyTune } from '@/domain/services/enemyProfileService'

interface CalcRghtPane {
  simulation: SimResult | null
  runtime: ResRuntime | null
  enemy: EnemyProfile
}

interface OverviewItem {
  label: string
  value: string
  detail?: string
  body?: ReactNode
}

const NEG_EFFECT_ABBR: Record<string, string> = {
  spectroFrazzle: 'SF',
  aeroErosion: 'AE',
  fusionBurst: 'FB',
  havocBane: 'HB',
  glacioChafe: 'GC',
  electroFlare: 'EF',
  electroRage: 'ER',
}

// renders the results-hand telemetry surface once a simulation and runtime are available.
export function Right({ simulation, runtime, enemy }: CalcRghtPane) {
  const statsView = useMemo(
    () => (simulation && runtime ? mkVrvwSttsVi(runtime, simulation.finalStats) : null),
    [runtime, simulation],
  )
  const vsblNegFfct = useMemo(
    () => (runtime ? negEffectsFor(runtime) : []),
    [runtime],
  )

  if (!simulation || !runtime) {
    return (
      <section className="calc-pane calculator-results-pane">
        <div className="panel-head compact results-pane-head">
          <div className="weapon-effect__bar">
            <span className="weapon-effect__sigil" aria-hidden="true" />
            <span className="weapon-effect__titles">
                  <span className="weapon-effect__tag">Live Output</span>
                  <span className="weapon-effect__name">Damage Telemetry</span>
                </span>
          </div>
          <p className="panel-copy">Waiting for an active resonator runtime before rendering result telemetry.</p>
        </div>
        <div className="soft-empty">Simulation results will appear here once a resonator and runtime are active.</div>
      </section>
    )
  }

  const persRotCnt = simulation.rotations.personal.entries.length
  const persSkllType = new Set(
    simulation.rotations.personal.entries.map((entry) => getPrimarySkill(entry.skill.skillType)),
  ).size
  const teamRotCount = simulation.rotations.team.entries.length
  const teamMemCnt = new Set(
    simulation.rotations.team.entries.map((entry) => entry.resonatorId),
  ).size
  const tuneStrain = getEnemyTune(enemy)
  const enemyStts = [
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
    ...vsblNegFfct
      .map((effect) => ({
        key: effect.key,
        abbreviation: effect.label === 'Glacio Bite'
          ? 'GB'
          : (NEG_EFFECT_ABBR[effect.key] ?? effect.label),
        accent: effect.accent,
        value: getNegFfctFf(runtime, effect.key),
        max: effect.max,
      }))
      .filter((effect) => effect.value > 0),
  ]

  const vrvwTms: OverviewItem[] = [
    {
      label: 'Personal Damage',
      value: fmtCmpcNmbr(simulation.rotations.personal.total.avg),
      detail:
        persRotCnt > 0
          ? `${persRotCnt} feature${persSkllType === 1 ? '' : 's'}${simulation.rotations.personal.totalsByGroup.healing.avg > 0 ? `, ${fmtCmpcNmbr(simulation.rotations.personal.totalsByGroup.healing.avg)} heal` : ''}${simulation.rotations.personal.totalsByGroup.healing.avg > 0 ? `, ${fmtCmpcNmbr(simulation.rotations.personal.totalsByGroup.shield.avg)} shield` : ''}`
          : 'No personal rotation entries',
    },
    {
      label: 'Team Damage',
      value: fmtCmpcNmbr(simulation.rotations.team.total.avg),
      detail:
        teamRotCount > 0
          ? `${teamMemCnt} member${teamMemCnt === 1 ? '' : 's'}${simulation.rotations.team.totalsByGroup.healing.avg > 0 ? `, ${fmtCmpcNmbr(simulation.rotations.team.totalsByGroup.healing.avg)} heal` : ''}${simulation.rotations.team.totalsByGroup.healing.avg > 0 ? `, ${fmtCmpcNmbr(simulation.rotations.team.totalsByGroup.shield.avg)} shield` : ''}`
          : 'No team rotation entries',
    },
    {
      label: 'Enemy Pressure',
      value: `Lv ${enemy.level}`,
      detail: `${enemy.toa ? 'ToA' : 'Standard'} · Class ${enemy.class}`,
    },
    {
      label: 'Enemy Statuses',
      value: `${enemyStts.length} Active`,
      detail: ``,
      body:
        enemyStts.length > 0 ? (
          <div
            className="enemy-status-card-body"
            style={{ '--enemy-status-count': enemyStts.length } as CssProps}
          >
            {enemyStts.map((status) => (
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
      <div className="weapon-effect__bar">
        <span className="weapon-effect__sigil" aria-hidden="true" />
        <span className="weapon-effect__titles">
                  <span className="weapon-effect__tag">Live Output</span>
                  <span className="weapon-effect__name">Damage Telemetry</span>
                </span>
      </div>

      <section className="analysis-overview-grid">
        {vrvwTms.map((item) => (
          <article key={item.label} className="resonator-snapshot-card ui-surface-card ui-surface-card--section">
            <span className="resonator-snapshot-label">{item.label}</span>
            <strong className="resonator-snapshot-value">{item.value}</strong>
            {item.body ? item.body : <span className="resonator-snapshot-detail">{item.detail}</span>}
          </article>
        ))}
      </section>

      <div className="results-section-stack">
        <Stats statsView={statsView} />
        <Damage simulation={simulation} runtime={runtime} enemy={enemy} />
      </div>
    </section>
  )
}
