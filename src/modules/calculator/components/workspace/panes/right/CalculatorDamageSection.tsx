import { Fragment, useMemo, useState, type CSSProperties } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { SimulationResult } from '@/engine/pipeline/types'
import { useAppStore } from '@/domain/state/store'
import { getPrimarySkillType, getSkillTypeDisplay } from '@/modules/calculator/model/skillTypes'
import { ATTRIBUTE_COLORS } from '@/modules/calculator/model/display'
import { formatCompactNumber } from '@/modules/calculator/model/overviewStats'
import { Tooltip, DamageTooltip } from '@/shared/ui/Tooltip'
import {
  buildContributionBreakdown,
  buildSubHitFormula,
  formatContributionPercent,
  getTabTitle,
  groupSkillsByTab,
  shouldRenderSubHitRows,
} from '@/modules/calculator/components/workspace/panes/right/rightPaneUtils'
import { buildSkillFormulaConsoleText } from '@/modules/calculator/model/damageFormulaConsole'
import { EditorConsole } from '@/shared/ui/EditorConsole.tsx'

interface CalculatorDamageSectionProps {
  simulation: SimulationResult
  runtime: ResonatorRuntimeState
  enemy: EnemyProfile
}

// builds the detailed damage grid that mirrors the live simulation output.
const SUPPORT_ROW_STYLE: Record<'healing' | 'shield', { label: string; color: string }> = {
  healing: {
    label: 'Healing',
    color: 'var(--calc-support-healing-color)',
  },
  shield: {
    label: 'Shield',
    color: 'var(--calc-support-shield-color)',
  },
}

export function CalculatorDamageSection({ simulation, runtime, enemy }: CalculatorDamageSectionProps) {
  const showSubHits = useAppStore((state) => state.ui.showSubHits)
  const setShowSubHits = useAppStore((state) => state.setShowSubHits)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})

  const groupedByTab = useMemo(
      () => groupSkillsByTab(simulation.allSkills),
      [simulation.allSkills],
  )

  const personalBreakdown = useMemo(
      () =>
          buildContributionBreakdown(
              simulation.rotations.personal.entries.filter((entry) => entry.aggregationType === 'damage'),
              (entry) => getPrimarySkillType(entry.skill.skillType) ?? 'all',
              (entry) => getSkillTypeDisplay(entry.skill.skillType).label,
          ),
      [simulation.rotations.personal.entries],
  )
  const teamBreakdown = useMemo(
      () =>
          buildContributionBreakdown(
              simulation.rotations.team.entries.filter((entry) => entry.aggregationType === 'damage'),
              (entry) => entry.resonatorId,
              (entry) => entry.resonatorName,
          ),
      [simulation.rotations.team.entries],
  )

  const toggleRow = (rowId: string) => {
    setExpandedRows((prev) => ({
      ...prev,
      [rowId]: !prev[rowId],
    }))
  }

  const renderFeatureRow = (entry: SimulationResult['allSkills'][number]) => {
    const rowId = entry.id
    const supportMeta =
        entry.aggregationType === 'healing'
            ? SUPPORT_ROW_STYLE.healing
            : entry.aggregationType === 'shield'
                ? SUPPORT_ROW_STYLE.shield
                : null
    const isExpanded = Boolean(expandedRows[rowId])
    const formulaText = isExpanded
      ? buildSkillFormulaConsoleText(
          entry,
          simulation.finalStats,
          enemy,
          runtime.base.level,
          runtime.state.combat,
        )
      : ''

    if (supportMeta) {
      return (
        <Fragment key={rowId}>
          <tr
            data-damage-kind="support"
            data-support-kind={entry.aggregationType}
            data-expanded={isExpanded ? 'true' : 'false'}
            style={{ cursor: 'pointer' }}
            onClick={() => toggleRow(rowId)}
            aria-expanded={isExpanded}
          >
            <th scope="row" className="damage-support-label" style={{ color: supportMeta.color }}>
              {entry.skill.label}
            </th>
            <td className="damage-support-placeholder">-</td>
            <td className="damage-support-placeholder">-</td>
            <td className="damage-support-value" style={{ color: supportMeta.color }}>
              {formatCompactNumber(entry.avg)}
            </td>
          </tr>
          {isExpanded && (
            <tr data-damage-kind="formula-row">
              <td colSpan={4} className="damage-row-formula-cell">
                <EditorConsole
                  language="formula"
                  className="damage-row-formula"
                  text={formulaText}
                  showLineNumbers={false}
                />
              </td>
            </tr>
          )}
        </Fragment>
      )
    }

    const damageColor = ATTRIBUTE_COLORS[entry.skill.element] ?? 'var(--calc-text)'

    return (
      <Fragment key={rowId}>
        <tr
            data-damage-kind="feature"
            data-expanded={isExpanded ? 'true' : 'false'}
            style={{ '--damage-row-accent': damageColor, cursor: 'pointer' } as CSSProperties}
            onClick={() => toggleRow(rowId)}
            aria-expanded={isExpanded}
        >
          <th
              scope="row"
              className="damage-feature-label"
          >
            {entry.skill.label}
          </th>
          <td>
            <Tooltip
                content={
                  <DamageTooltip
                      label={`${entry.skill.label} (Normal)`}
                      formula={buildSubHitFormula(entry.subHits, 'normal')}
                  />
                }
            >
            <span className="damage-value-cell">
              {formatCompactNumber(entry.normal)}
            </span>
            </Tooltip>
          </td>
          <td>
            <Tooltip
                content={
                  <DamageTooltip
                      label={`${entry.skill.label} (CRIT)`}
                      formula={buildSubHitFormula(entry.subHits, 'crit')}
                  />
                }
            >
            <span className="damage-value-cell">
              {formatCompactNumber(entry.crit)}
            </span>
            </Tooltip>
          </td>
          <td>
            <Tooltip
                content={
                  <DamageTooltip
                      label={`${entry.skill.label} (AVG)`}
                      formula={buildSubHitFormula(entry.subHits, 'avg')}
                  />
                }
            >
            <span className="damage-value-cell">
              {formatCompactNumber(entry.avg)}
            </span>
            </Tooltip>
          </td>
        </tr>
        {showSubHits &&
          shouldRenderSubHitRows(entry.subHits) &&
          entry.subHits.map((hit, index) => (
            <tr key={`${rowId}:subhit:${index}`} data-damage-kind="subhit">
              <th scope="row" className="pane-hint">
                ↳ {entry.skill.label}-{index + 1}
                {hit.label ? ` (${hit.label})` : ''}
                {hit.count > 1 ? ` (${hit.count} Hits)` : ''}
              </th>
              <td>{formatCompactNumber(hit.normal)}</td>
              <td>{formatCompactNumber(hit.crit)}</td>
              <td>{formatCompactNumber(hit.avg)}</td>
            </tr>
        ))}
        {isExpanded && (
            <tr data-damage-kind="formula-row">
              <td colSpan={4} className="damage-row-formula-cell">
                <EditorConsole
                    language="formula"
                    className="damage-row-formula"
                    text={formulaText}
                    showLineNumbers={false}
                />
              </td>
            </tr>
        )}
      </Fragment>
    )
  }

  return (
      <div className="pane-section damage-box ui-surface-card ui-surface-card--section">
        <h2 className="panel-title damage-panel-title">
          <span>Damage</span>
          <label className="toggle-row compact">
            <span>Show Sub-Hits</span>
            <input
                type="checkbox"
                checked={showSubHits}
                onChange={(event) => setShowSubHits(event.target.checked)}
            />
          </label>
        </h2>

        <div className="damage-section">
          {groupedByTab.map(([tab, entries]) => (
              <div key={tab} className="box-wrapper">
                <article className="control-panel-box damage-inner-box">
                  <h3 className="damage-box-title">{getTabTitle(entries[0].skill)}</h3>
                  <table className="damage-grid">
                    <thead>
                    <tr>
                      <th scope="col" className="panel-overline">Skill</th>
                      <th scope="col">Normal</th>
                      <th scope="col">CRIT</th>
                      <th scope="col">AVG</th>
                    </tr>
                    </thead>
                    <tbody>
                    {entries.map(renderFeatureRow)}
                    </tbody>
                  </table>
                </article>
              </div>
          ))}

          <div className="box-wrapper">
            <article className="control-panel-box damage-inner-box">
              <h3 className="damage-box-title">Personal Rotation</h3>
              <table className="damage-grid">
                <thead>
                <tr>
                  <th scope="col" className="panel-overline">Summary</th>
                  <th scope="col">Normal</th>
                  <th scope="col">CRIT</th>
                  <th scope="col">AVG</th>
                </tr>
                </thead>
                <tbody>
                {simulation.rotations.personal.total.normal !== 0 ? (
                  <tr data-damage-kind="total">
                    <th scope="row">Damage</th>
                    <td>{formatCompactNumber(simulation.rotations.personal.total.normal)}</td>
                    <td>{formatCompactNumber(simulation.rotations.personal.total.crit)}</td>
                    <td>{formatCompactNumber(simulation.rotations.personal.total.avg)}</td>
                  </tr>
                ) : (
                  <tr data-damage-kind="total">
                    <th scope="row">Damage</th>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                  </tr>
                )}
                {personalBreakdown.map((entry) => (
                  <tr key={`personal:${entry.label}`} data-damage-kind="subhit">
                    <th scope="row" className="pane-hint">
                      ↳ {entry.label} ({formatContributionPercent(entry.percent)})
                    </th>
                    <td>{formatCompactNumber(entry.normal)}</td>
                    <td>{formatCompactNumber(entry.crit)}</td>
                    <td>{formatCompactNumber(entry.avg)}</td>
                  </tr>
                ))}
                {simulation.rotations.personal.totalsByAggregation.healing.avg !== 0 && (
                  <tr data-damage-kind="support" data-support-kind="healing">
                    <th scope="row" className="damage-support-label" style={{ color: SUPPORT_ROW_STYLE.healing.color }}>
                      Healing
                    </th>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-value" style={{ color: SUPPORT_ROW_STYLE.healing.color }}>
                      {formatCompactNumber(simulation.rotations.personal.totalsByAggregation.healing.avg)}
                    </td>
                  </tr>
                )}
                {simulation.rotations.personal.totalsByAggregation.shield.avg !== 0 && (
                  <tr data-damage-kind="support" data-support-kind="shield">
                    <th scope="row" className="damage-support-label" style={{ color: SUPPORT_ROW_STYLE.shield.color }}>
                      Shield
                    </th>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-value" style={{ color: SUPPORT_ROW_STYLE.shield.color }}>
                      {formatCompactNumber(simulation.rotations.personal.totalsByAggregation.shield.avg)}
                    </td>
                  </tr>
                )}
                </tbody>
              </table>
            </article>
          </div>

          <div className="box-wrapper">
            <article className="control-panel-box damage-inner-box">
              <h3 className="damage-box-title">Team Rotation</h3>
              <table className="damage-grid">
                <thead>
                <tr>
                  <th scope="col" className="panel-overline">Summary</th>
                  <th scope="col">Normal</th>
                  <th scope="col">CRIT</th>
                  <th scope="col">AVG</th>
                </tr>
                </thead>
                <tbody>
                {simulation.rotations.team.total.normal !== 0 ? (
                  <tr data-damage-kind="total">
                    <th scope="row">Damage</th>
                    <td>{formatCompactNumber(simulation.rotations.team.total.normal)}</td>
                    <td>{formatCompactNumber(simulation.rotations.team.total.crit)}</td>
                    <td>{formatCompactNumber(simulation.rotations.team.total.avg)}</td>
                  </tr>
                ) : (
                  <tr data-damage-kind="total">
                    <th scope="row">Damage</th>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                  </tr>
                )}
                {teamBreakdown.map((entry) => (
                  <tr key={`team:${entry.label}`} data-damage-kind="subhit">
                    <th scope="row" className="pane-hint">
                      ↳ {entry.label} ({formatContributionPercent(entry.percent)})
                    </th>
                    <td>{formatCompactNumber(entry.normal)}</td>
                    <td>{formatCompactNumber(entry.crit)}</td>
                    <td>{formatCompactNumber(entry.avg)}</td>
                  </tr>
                ))}
                {simulation.rotations.team.totalsByAggregation.healing.avg !== 0 && (
                  <tr data-damage-kind="support" data-support-kind="healing">
                    <th scope="row" className="damage-support-label" style={{ color: SUPPORT_ROW_STYLE.healing.color }}>
                      Healing
                    </th>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-value" style={{ color: SUPPORT_ROW_STYLE.healing.color }}>
                      {formatCompactNumber(simulation.rotations.team.totalsByAggregation.healing.avg)}
                    </td>
                  </tr>
                )}
                {simulation.rotations.team.totalsByAggregation.shield.avg !== 0 && (
                  <tr data-damage-kind="support" data-support-kind="shield">
                    <th scope="row" className="damage-support-label" style={{ color: SUPPORT_ROW_STYLE.shield.color }}>
                      Shield
                    </th>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-value" style={{ color: SUPPORT_ROW_STYLE.shield.color }}>
                      {formatCompactNumber(simulation.rotations.team.totalsByAggregation.shield.avg)}
                    </td>
                  </tr>
                )}
                </tbody>
              </table>
            </article>
          </div>
        </div>
      </div>
  )
}
