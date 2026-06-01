/*
  Author: Runor Ewhro
  Description: Renders the damage surface for the calculator results flow.
*/

import { Fragment, useMemo, useState, type CSSProperties as CssProps } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { FeatureResult } from '@/domain/gameData/contracts.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { getPrimarySkill, getSkillType } from '@/modules/calculator/model/skillTypes.ts'
import { ATTR_COLORS } from '@/modules/calculator/model/display.ts'
import { fmtCmpcNmbr } from '@/modules/calculator/features/overview/lib/stats.ts'
import { Tooltip, DmgTltp } from '@/shared/ui/Tooltip.tsx'
import {
  breakdown,
  mkSubHitForm,
  fmtCntrPrcn,
  getTabTitle,
  grpSkllByTab,
  shldViewSubH,
} from '@/modules/calculator/features/results/lib/utils.ts'
import { skillFormula } from '@/modules/calculator/features/results/lib/damageFormula.ts'
import { DtrCnsl } from '@/shared/ui/EditorConsole.tsx'
import { useCtxBuilder } from '@/shared/context-menu/useCtxBuilder.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'

interface CalcDmgSctnP {
  simulation: SimResult
  runtime: ResRuntime
  enemy: EnemyProfile
}

interface SmmrBrkdGrpP {
  rowLabel: string
  rowKey: string
  total: SimResult['rotations']['team']['total']
  breakdown: Array<{
    label: string
    percent: number
    normal: number
    crit: number
    avg: number
  }>
}

// builds the detailed damage grid that mirrors the live simulation output.
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

export function Damage({ simulation, runtime, enemy }: CalcDmgSctnP) {
  const showSubHits = useAppStore((state) => state.ui.showSubHits)
  const setShowSubHi = useAppStore((state) => state.setSubHits)
  const menu = useCtxBuilder()
  const [expandedRows, setXpndRows] = useState<Record<string, boolean>>({})
  const [xpndSubHitRo, setXpndSubHi] = useState<Record<string, boolean>>({})

  const groupedByTab = useMemo(
      // tabs are derived from resolved simulation skills, not catalog definitions, so hidden or conditional skills stay
      // aligned with what actually produced output.
      () => grpSkllByTab(simulation.allSkills),
      [simulation.allSkills],
  )

  const persBrkd = useMemo(
      // personal summary groups by primary skill type so the active resonator can see where their own damage came from.
      () =>
          breakdown(
              simulation.rotations.personal.entries.filter((entry) => entry.aggregationType === 'damage'),
              (entry) => getPrimarySkill(entry.skill.skillType) ?? 'all',
              (entry) => getSkillType(entry.skill.skillType).label,
          ),
      [simulation.rotations.personal.entries],
  )
  const teamBrkd = useMemo(
      // team summary groups by resonator first, then a second table groups by skill type for cross-member rotations.
      () =>
          breakdown(
              simulation.rotations.team.entries.filter((entry) => entry.aggregationType === 'damage'),
              (entry) => entry.resonatorId,
              (entry) => entry.resonatorName,
          ),
      [simulation.rotations.team.entries],
  )
  const teamSkllType = useMemo(
      () =>
          breakdown(
              simulation.rotations.team.entries.filter((entry) => entry.aggregationType === 'damage'),
              (entry) => getPrimarySkill(entry.skill.skillType) ?? 'all',
              (entry) => getSkillType(entry.skill.skillType).label,
          ),
      [simulation.rotations.team.entries],
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
            <td>{fmtCmpcNmbr(total.normal)}</td>
            <td>{fmtCmpcNmbr(total.crit)}</td>
            <td>{fmtCmpcNmbr(total.avg)}</td>
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
            <td>{fmtCmpcNmbr(entry.normal)}</td>
            <td>{fmtCmpcNmbr(entry.crit)}</td>
            <td>{fmtCmpcNmbr(entry.avg)}</td>
          </tr>
        ))}
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
              {fmtCmpcNmbr(entry.avg)}
            </td>
          </tr>
          {isExpanded && (
            <tr data-damage-kind="formula-row">
              <td colSpan={4} className="damage-row-formula-cell">
                <DtrCnsl
                  language="formula"
                  className="damage-row-formula"
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
    const skllDataTgt = menu.calculator.actions.getSkillDataTarget(entry)
    const hasSubHitRow = shldViewSubH(entry.subHits)
    const subHitsVsbl = showSubHits || Boolean(xpndSubHitRo[rowId])

    return (
      <Fragment key={rowId}>
        <ContextTrigger
          asChild
          ariaLabel={`${entry.skill.label} actions`}
          items={menu.calculator.damage.row({
            rowId,
            subHitsVis: subHitsVsbl,
            hasSubHitReq: hasSubHitRow,
            onTgglFrml: () => toggleRow(rowId),
            onTgglSubHwm: () => tglSubHitRow(rowId),
            ...(skllDataTgt ? {
              onOpenSklleu: () => menu.calculator.actions.openSkillData(skllDataTgt),
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
              scope="row"
              className="damage-feature-label"
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
                <span className="damage-value-cell">
                  {fmtCmpcNmbr(entry.normal)}
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
                <span className="damage-value-cell">
                  {fmtCmpcNmbr(entry.crit)}
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
                <span className="damage-value-cell">
                  {fmtCmpcNmbr(entry.avg)}
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
              <td>{fmtCmpcNmbr(hit.normal)}</td>
              <td>{fmtCmpcNmbr(hit.crit)}</td>
              <td>{fmtCmpcNmbr(hit.avg)}</td>
            </tr>
          ))}
        {isExpanded && (
          <tr data-damage-kind="formula-row">
            <td colSpan={4} className="damage-row-formula-cell">
              <DtrCnsl
                language="formula"
                className="damage-row-formula"
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
                    <td>{fmtCmpcNmbr(simulation.rotations.personal.total.normal)}</td>
                    <td>{fmtCmpcNmbr(simulation.rotations.personal.total.crit)}</td>
                    <td>{fmtCmpcNmbr(simulation.rotations.personal.total.avg)}</td>
                  </tr>
                ) : (
                  <tr data-damage-kind="total">
                    <th scope="row">Damage</th>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                  </tr>
                )}
                {persBrkd.map((entry) => (
                  <tr key={`personal:${entry.label}`} data-damage-kind="subhit">
                    <th scope="row" className="pane-hint">
                      ↳ {entry.label} ({fmtCntrPrcn(entry.percent)})
                    </th>
                    <td>{fmtCmpcNmbr(entry.normal)}</td>
                    <td>{fmtCmpcNmbr(entry.crit)}</td>
                    <td>{fmtCmpcNmbr(entry.avg)}</td>
                  </tr>
                ))}
                {simulation.rotations.personal.totalsByGroup.healing.avg !== 0 && (
                  <tr data-damage-kind="support" data-support-kind="healing">
                    <th scope="row" className="damage-support-label" style={{ color: SPPRROWSTYL.healing.color }}>
                      Healing
                    </th>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-value" style={{ color: SPPRROWSTYL.healing.color }}>
                      {fmtCmpcNmbr(simulation.rotations.personal.totalsByGroup.healing.avg)}
                    </td>
                  </tr>
                )}
                {simulation.rotations.personal.totalsByGroup.shield.avg !== 0 && (
                  <tr data-damage-kind="support" data-support-kind="shield">
                    <th scope="row" className="damage-support-label" style={{ color: SPPRROWSTYL.shield.color }}>
                      Shield
                    </th>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-value" style={{ color: SPPRROWSTYL.shield.color }}>
                      {fmtCmpcNmbr(simulation.rotations.personal.totalsByGroup.shield.avg)}
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
                {viewSmmrBrkd({
                  rowLabel: 'Contributors',
                  rowKey: 'team-contributors',
                  total: simulation.rotations.team.total,
                  breakdown: teamBrkd,
                })}
                {viewSmmrBrkd({
                  rowLabel: 'Skill Types',
                  rowKey: 'team-skill-types',
                  total: simulation.rotations.team.total,
                  breakdown: teamSkllType,
                })}
                {simulation.rotations.team.totalsByGroup.healing.avg !== 0 && (
                  <tr data-damage-kind="support" data-support-kind="healing">
                    <th scope="row" className="damage-support-label" style={{ color: SPPRROWSTYL.healing.color }}>
                      Healing
                    </th>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-value" style={{ color: SPPRROWSTYL.healing.color }}>
                      {fmtCmpcNmbr(simulation.rotations.team.totalsByGroup.healing.avg)}
                    </td>
                  </tr>
                )}
                {simulation.rotations.team.totalsByGroup.shield.avg !== 0 && (
                  <tr data-damage-kind="support" data-support-kind="shield">
                    <th scope="row" className="damage-support-label" style={{ color: SPPRROWSTYL.shield.color }}>
                      Shield
                    </th>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-placeholder">-</td>
                    <td className="damage-support-value" style={{ color: SPPRROWSTYL.shield.color }}>
                      {fmtCmpcNmbr(simulation.rotations.team.totalsByGroup.shield.avg)}
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
