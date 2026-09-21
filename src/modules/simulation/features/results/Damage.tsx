/*
  Author: Runor Ewhro
  Description: Groups prepared skill damage rows and coordinates skill, hit, and formula inspection.
*/

import { Fragment, useMemo, useState, type CSSProperties as CssProps } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { FeatureResult } from '@/domain/gameData/contracts.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { useAppStore } from '@/application/state'
import { getPrimarySkill, getSkillType } from '@/domain/gameData/skillTypes.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display.ts'
import { formatCompactNum } from '@/modules/simulation/model/statsView.ts'
import { Tooltip, DmgTltp } from '@/shared/ui/Tooltip.tsx'
import {
  breakdown,
  mkSubHitForm,
  fmtCntrPrcn,
  getTabTitle,
  grpSkllByTab,
  shldViewSubH,
} from '@/modules/simulation/features/results/lib/utils.ts'
import { skillFormula } from '@/modules/simulation/features/results/lib/damageFormula.ts'
import { DtrCnsl } from '@/shared/ui/EditorConsole.tsx'
import { useCtxBuilder } from '@/modules/simulation/shell/context-menu/useContextMenuBuilder.ts'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'

interface DamageProps {
  simulation: SimResult
  runtime: ResRuntime
  enemy: EnemyProfile
}

interface SmmrBrkdGrpP {
  rowLabel: string
  rowKey: string
  total: SimResult['rotation']['sequence']['total']
  breakdown: Array<{
    label: string
    percent: number
    normal: number
    crit: number
    avg: number
  }>
}

const SPPRROWSTYL: Record<'healing' | 'shield', { label: string; color: string }> = {
  healing: {
    label: 'Healing',
    color: 'var(--calc-support-healing-color)',
  },
  shield: {
    label: 'Shield',
    color: 'var(--calc-support-shield-color)',
  },
}

export function Damage({ simulation, runtime, enemy }: DamageProps) {
  const showSubHits = useAppStore((state) => state.ui.showSubHits)
  const setShowSubHi = useAppStore((state) => state.setSubHits)
  const menu = useCtxBuilder()
  const [expandedRows, setXpndRows] = useState<Record<string, boolean>>({})
  const [xpndSubHitRo, setXpndSubHi] = useState<Record<string, boolean>>({})

  const groupedByTab = useMemo(
      // Group resolved simulation skills so unavailable catalog entries stay excluded.
      () => grpSkllByTab(simulation.allSkills),
      [simulation.allSkills],
  )

  const sequenceSkillTypeBreakdown = useMemo(
      () =>
          breakdown(
              simulation.rotation.sequence.entries.filter((entry) => entry.aggregationType === 'damage'),
              (entry) => getPrimarySkill(entry.skill.skillType) ?? 'all',
              (entry) => getSkillType(entry.skill.skillType).label,
          ),
      [simulation.rotation.sequence.entries],
  )
  const programContributorBreakdown = useMemo(
      () =>
          breakdown(
              simulation.rotation.program.entries.filter((entry) => entry.aggregationType === 'damage'),
              (entry) => entry.resonatorId,
              (entry) => entry.resonatorName,
          ),
      [simulation.rotation.program.entries],
  )
  const programSkillTypeBreakdown = useMemo(
      () =>
          breakdown(
              simulation.rotation.program.entries.filter((entry) => entry.aggregationType === 'damage'),
              (entry) => getPrimarySkill(entry.skill.skillType) ?? 'all',
              (entry) => getSkillType(entry.skill.skillType).label,
          ),
      [simulation.rotation.program.entries],
  )

  const toggleRow = (rowId: string) => {
    setXpndRows((prev) => ({
      ...prev,
      [rowId]: !prev[rowId],
    }))
  }

  const tglSubHitRow = (rowId: string) => {
    setXpndSubHi((prev) => ({
      ...prev,
      [rowId]: !prev[rowId],
    }))
  }

  const viewSmmrBrkd = ({
    rowLabel,
    rowKey,
    total,
    breakdown,
  }: SmmrBrkdGrpP) => (
      <>
        {total.normal !== 0 ? (
          <tr data-damage-kind="total">
            <th scope="row">{rowLabel}</th>
            <td>{formatCompactNum(total.normal)}</td>
            <td>{formatCompactNum(total.crit)}</td>
            <td>{formatCompactNum(total.avg)}</td>
          </tr>
        ) : (
          <tr data-damage-kind="total">
            <th scope="row">{rowLabel}</th>
            <td>-</td>
            <td>-</td>
            <td>-</td>
          </tr>
        )}
        {breakdown.map((entry) => (
          <tr key={`${rowKey}:${entry.label}`} data-damage-kind="subhit">
            <th scope="row" className="pane-hint">
              ↳ {entry.label} ({fmtCntrPrcn(entry.percent)})
            </th>
            <td>{formatCompactNum(entry.normal)}</td>
            <td>{formatCompactNum(entry.crit)}</td>
            <td>{formatCompactNum(entry.avg)}</td>
          </tr>
        ))}
      </>
  )

  const viewSupportRows = (summary: SimResult['rotation']['sequence']) => (
      <>
        {summary.totalsByGroup.healing.avg !== 0 && (
          <tr data-damage-kind="support" data-support-kind="healing">
            <th scope="row" className="damage-support-label" style={{ color: SPPRROWSTYL.healing.color }}>
              Healing
            </th>
            <td className="damage-support-placeholder">-</td>
            <td className="damage-support-placeholder">-</td>
            <td className="damage-support-value" style={{ color: SPPRROWSTYL.healing.color }}>
              {formatCompactNum(summary.totalsByGroup.healing.avg)}
            </td>
          </tr>
        )}
        {summary.totalsByGroup.shield.avg !== 0 && (
          <tr data-damage-kind="support" data-support-kind="shield">
            <th scope="row" className="damage-support-label" style={{ color: SPPRROWSTYL.shield.color }}>
              Shield
            </th>
            <td className="damage-support-placeholder">-</td>
            <td className="damage-support-placeholder">-</td>
            <td className="damage-support-value" style={{ color: SPPRROWSTYL.shield.color }}>
              {formatCompactNum(summary.totalsByGroup.shield.avg)}
            </td>
          </tr>
        )}
      </>
  )

  const viewFeatRow = (entry: FeatureResult) => {
    const rowId = entry.id
    // healing and shield rows use the avg column as their primary output while preserving formula expansion behavior.
    const supportMeta =
        entry.aggregationType === 'healing'
            ? SPPRROWSTYL.healing
            : entry.aggregationType === 'shield'
                ? SPPRROWSTYL.shield
                : null
    const isExpanded = Boolean(expandedRows[rowId])
    const formulaText = isExpanded
      ? skillFormula(
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
              {formatCompactNum(entry.avg)}
            </td>
          </tr>
          {isExpanded && (
            <tr data-damage-kind="formula-row">
              <td colSpan={4} className="damage-row-formula-cell">
                <DtrCnsl
                  language="formula" className="damage-row-formula"
                  text={formulaText}
                  showLineNmbr={false}
                />
              </td>
            </tr>
          )}
        </Fragment>
      )
    }

    const damageColor = ATTR_COLORS[entry.skill.element] ?? 'var(--calc-text)'
    const skllDataTgt = menu.simulation.actions.getSkillDataTarget(entry)
    const hasSubHitRow = shldViewSubH(entry.subHits)
    const subHitsVsbl = showSubHits || Boolean(xpndSubHitRo[rowId])

    return (
      <Fragment key={rowId}>
        <ContextTrigger
          asChild
          ariaLabel={`${entry.skill.label} actions`}
          items={menu.simulation.damage.row({
            rowId,
            subHitsVis: subHitsVsbl,
            hasSubHitReq: hasSubHitRow,
            onTgglFrml: () => toggleRow(rowId),
            onTgglSubHwm: () => tglSubHitRow(rowId),
            ...(skllDataTgt ? {
              onOpenSklleu: () => menu.simulation.actions.openSkillData(skllDataTgt),
            } : {}),
          })}
        >
          <tr
            data-damage-kind="feature"
            data-expanded={isExpanded ? 'true' : 'false'}
            style={{ '--damage-row-accent': damageColor, cursor: 'pointer' } as CssProps}
            onClick={() => toggleRow(rowId)}
            aria-expanded={isExpanded}
          >
            <th
              scope="row" className="damage-feature-label"
            >
              {entry.skill.label}
            </th>
            <td>
              <Tooltip
                content={
                  <DmgTltp
                    label={entry.skill.label}
                    metric="normal"
                    formula={mkSubHitForm(entry.subHits, 'normal')}
                  />
                }
              >
                <span>
                  {formatCompactNum(entry.normal)}
                </span>
              </Tooltip>
            </td>
            <td>
              <Tooltip
                content={
                  <DmgTltp
                    label={entry.skill.label}
                    metric="crit"
                    formula={mkSubHitForm(entry.subHits, 'crit')}
                  />
                }
              >
                <span>
                  {formatCompactNum(entry.crit)}
                </span>
              </Tooltip>
            </td>
            <td>
              <Tooltip
                content={
                  <DmgTltp
                    label={entry.skill.label}
                    metric="avg"
                    formula={mkSubHitForm(entry.subHits, 'avg')}
                  />
                }
              >
                <span>
                  {formatCompactNum(entry.avg)}
                </span>
              </Tooltip>
            </td>
          </tr>
        </ContextTrigger>
        {subHitsVsbl &&
          hasSubHitRow &&
          entry.subHits.map((hit, index) => (
            <tr key={`${rowId}:subhit:${index}`} data-damage-kind="subhit">
              <th scope="row" className="pane-hint">
                ↳ {entry.skill.label}-{index + 1}
                {hit.label ? ` (${hit.label})` : ''}
                {hit.count > 1 ? ` (${hit.count} Hits)` : ''}
              </th>
              <td>{formatCompactNum(hit.normal)}</td>
              <td>{formatCompactNum(hit.crit)}</td>
              <td>{formatCompactNum(hit.avg)}</td>
            </tr>
          ))}
        {isExpanded && (
          <tr data-damage-kind="formula-row">
            <td colSpan={4} className="damage-row-formula-cell">
              <DtrCnsl
                language="formula" className="damage-row-formula"
                text={formulaText}
                showLineNmbr={false}
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
                onChange={(event) => setShowSubHi(event.target.checked)}
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
                    {entries.map(viewFeatRow)}
                    </tbody>
                  </table>
                </article>
              </div>
          ))}

          <div className="box-wrapper">
            <article className="control-panel-box damage-inner-box">
              <h3 className="damage-box-title">Rotation</h3>
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
                {viewSmmrBrkd({
                  rowLabel: 'Damage',
                  rowKey: 'rotation-skill-types',
                  total: simulation.rotation.sequence.total,
                  breakdown: sequenceSkillTypeBreakdown,
                })}
                {viewSupportRows(simulation.rotation.sequence)}
                </tbody>
              </table>
            </article>
          </div>

          <div className="box-wrapper">
            <article className="control-panel-box damage-inner-box">
              <h3 className="damage-box-title">Advanced Rotation</h3>
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
                {viewSmmrBrkd({
                  rowLabel: 'Contributors',
                  rowKey: 'program-contributors',
                  total: simulation.rotation.program.total,
                  breakdown: programContributorBreakdown,
                })}
                {viewSmmrBrkd({
                  rowLabel: 'Skill Types',
                  rowKey: 'program-skill-types',
                  total: simulation.rotation.program.total,
                  breakdown: programSkillTypeBreakdown,
                })}
                {viewSupportRows(simulation.rotation.program)}
                </tbody>
              </table>
            </article>
          </div>

        </div>
      </div>
  )
}
