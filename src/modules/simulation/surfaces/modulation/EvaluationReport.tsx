/*
  Author: Runor Ewhro
  Description: Projects evaluation report trees from the scoring engine without
               recomputing damage or contribution math.
*/

import { Fragment, useMemo } from 'react'
import type { CSSProperties as CssProps } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type {
  EvaluationAlternative,
  EvaluationBuildSnapshot,
  EvaluationEchoSlot,
  EvaluationFeature,
  EvaluationFeatureGroup,
  EvaluationFeatureGroups,
  EvaluationOverviewStats,
  EvaluationSetSummary,
  EvaluationStatTreeNode,
  EvaluationStatContribution,
} from '@/engine/evaluation/buildEvaluation.ts'
import type { StatTreeNode } from '@/modules/simulation/model/statsView.ts'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { getSkillType } from '@/domain/gameData/skillTypes'
import { getSkillTabLabel } from '@/modules/simulation/model/skillTabs'
import {
  formatBuildEvaluationScore,
} from '@/modules/simulation/model/buildEvaluationDisplay.ts'
import {
  formatCompactNum,
  formatStatValue,
  formatStatKeyLabel,
  formatStatKeyValue,
} from '@/modules/simulation/model/statsView.ts'
import { toTitle } from '@/shared/lib/format'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { formatTruncCompact, truncTo } from '@/shared/lib/number.ts'
import {
  SonataTokens,
  StatGlyph,
  SwapToken,
  deltaSign,
  fmtSignedNumber,
  fmtSignedPct,
  groupAlternatives,
  type CssVars,
} from '@/modules/simulation/workspace/ui.tsx'

interface StatRelevanceRow {
  key: string
  label: string
  group: string
  base: number
  curTotal: number
  curBonus: number
  b100Total: number
  b100Bonus: number
  b200Total: number
  b200Bonus: number
}

function fmtOverviewBonus(label: string, value: number): string {
  if (!Number.isFinite(value)) return '--'
  if (Math.abs(value) < 0.0001) return '--'
  const raw = formatStatValue(label, Math.abs(value))
  return `${value > 0 ? '+' : '-'}${raw}`
}

const SREL_GROUP_LABEL: Record<string, string> = {
  Main: 'Main Stats',
  Secondary: 'Secondary',
  Modifier: 'Damage Modifiers',
}

function SrelCell({
  label,
  total,
  bonus,
}: {
  label: string
  total: number
  bonus: number
}) {
  return (
    <div className="workspace-srel-cell">
      <span className="workspace-srel-total">{formatStatValue(label, total)}</span>
      <span className={`workspace-srel-delta workspace-num--${deltaSign(bonus)}`}>{fmtOverviewBonus(label, bonus)}</span>
    </div>
  )
}

function SrelSetPlan({ sets }: { sets: EvaluationSetSummary[] }) {
  return <SonataTokens sets={sets} className="workspace-srel-set-plan" emptyLabel="--" />
}

function SrelMainEcho({ echoes }: { echoes: EvaluationEchoSlot[] }) {
  const mainEcho = echoes.find((echo) => echo.mainEcho) ?? null
  if (!mainEcho) {
    return <span className="workspace-srel-echo workspace-srel-echo--empty">--</span>
  }

  const echoDef = getEchoById(mainEcho.echoId)
  return (
    <span className="workspace-srel-echo" title={`${echoDef?.name ?? mainEcho.echoName} · ${mainEcho.cost} cost`}>
      <span className="workspace-srel-echo-frame">
        {echoDef?.icon ? (
          <img
            src={echoDef.icon}
            alt="" className="workspace-srel-echo-icon"
            loading="lazy"
            decoding="async"
            onError={withDefIconM}
          />
        ) : (
          <span className="workspace-srel-echo-icon workspace-srel-echo-icon--fallback" />
        )}
      </span>
      <span className="workspace-srel-echo-name">{echoDef?.name ?? mainEcho.echoName}</span>
      <span className="workspace-srel-echo-cost">{mainEcho.cost}C</span>
    </span>
  )
}

type ReportStatsTreeNode = EvaluationStatTreeNode | StatTreeNode
type ReportStatsTreeLeaf = ReportStatsTreeNode & { kind: 'leaf' }

function StatsTreeLeaf({ node }: { node: ReportStatsTreeLeaf }) {
  const title = 'baseValue' in node && node.baseValue
    ? `${node.label} · Base ${node.baseValue}${node.diffValue ? ` · ${node.diffValue}` : ''}`
    : node.label

  return (
    <div className="overview-tree-leaf" title={title}>
      <span className="overview-tree-leaf-label">{node.label}</span>
      <span className="overview-tree-leaf-value" style={node.color ? ({ color: node.color } as CssProps) : undefined}>
        {node.displayValue}
      </span>
    </div>
  )
}

function StatsTreeNode({ node }: { node: ReportStatsTreeNode }) {
  if (node.kind === 'leaf') {
    return <StatsTreeLeaf node={node} />
  }

  const flow = node.flow === 'fixed-grid' ? 'grid' : node.flow
  const childrenClass = flow
    ? `overview-tree-children overview-tree-children--${flow}`
    : 'overview-tree-children'

  return (
    <div className="overview-tree-branch">
      <div className="overview-tree-branch-head" style={node.color ? ({ '--tree-accent': node.color } as CssProps) : undefined}>
        {node.label}
      </div>
      <div className={childrenClass}>
        {node.children.map((child) => (
          <StatsTreeNode key={child.key} node={child} />
        ))}
      </div>
    </div>
  )
}

function InvariantStatsTree({ nodes }: { nodes: EvaluationStatTreeNode[] }) {
  if (nodes.length === 0) return null

  return (
    <div className="overview-stats-tree workspace-invariant-stats-tree">
      <span className="overview-cell-label">More Stats</span>
      <div className="overview-tree-children">
        {nodes.map((node) => (
          <StatsTreeNode key={node.key} node={node} />
        ))}
      </div>
    </div>
  )
}

function OverviewStatsTreeOnly({ nodes }: { nodes: StatTreeNode[] }) {
  if (nodes.length === 0) {
    return <p className="workspace-empty">No overview stats are available for this build.</p>
  }

  return (
    <div className="workspace-stats-stack">
      <div className="overview-stats-tree workspace-invariant-stats-tree">
        <span className="overview-cell-label">Stat Breakdown</span>
        <div className="overview-tree-children">
          {nodes.map((node) => (
            <StatsTreeNode key={node.key} node={node} />
          ))}
        </div>
      </div>
    </div>
  )
}

export function StatRelevance({
  active,
  reference,
  maximum,
  invariantStats,
  activeSets,
  referenceSets,
  maximumSets,
  activeEchoes,
  referenceEchoes,
  maximumEchoes,
  currentTone,
  referenceTone,
  maximumTone,
  showEvaluationTargets = true,
  overviewStatsTree = [],
}: {
  active: EvaluationOverviewStats
  reference: EvaluationOverviewStats
  maximum: EvaluationOverviewStats
  invariantStats: EvaluationStatTreeNode[]
  activeSets: EvaluationSetSummary[]
  referenceSets: EvaluationSetSummary[]
  maximumSets: EvaluationSetSummary[]
  activeEchoes: EvaluationEchoSlot[]
  referenceEchoes: EvaluationEchoSlot[]
  maximumEchoes: EvaluationEchoSlot[]
  currentTone: string
  referenceTone: string
  maximumTone: string
  showEvaluationTargets?: boolean
  overviewStatsTree?: StatTreeNode[]
}) {
  const rows = useMemo(() => {
    if (!showEvaluationTargets) {
      return []
    }
    const byKey = new Map<string, StatRelevanceRow>()
    const ensure = (key: string, label: string, group: string) => {
      let entry = byKey.get(key)
      if (!entry) {
        entry = {
          key,
          label,
          group,
          base: 0,
          curTotal: 0,
          curBonus: 0,
          b100Total: 0,
          b100Bonus: 0,
          b200Total: 0,
          b200Bonus: 0,
        }
        byKey.set(key, entry)
      }
      return entry
    }

    const addRows = (
      stats: EvaluationOverviewStats,
      assign: (entry: StatRelevanceRow, base: number, total: number, bonus: number) => void,
    ) => {
      const groups = [
        { label: 'Main', rows: stats.mainStats },
        { label: 'Secondary', rows: stats.secondaryStats },
        { label: 'Modifier', rows: stats.dmgMdfrStts },
      ]
      for (const group of groups) {
        for (const row of group.rows) {
          assign(ensure(row.key, row.label, group.label), row.base, row.total, row.bonus)
        }
      }
    }

    addRows(active, (entry, base, total, bonus) => {
      entry.base = base
      entry.curTotal = total
      entry.curBonus = bonus
    })
    addRows(reference, (entry, _base, total, bonus) => {
      entry.b100Total = total
      entry.b100Bonus = bonus
    })
    addRows(maximum, (entry, _base, total, bonus) => {
      entry.b200Total = total
      entry.b200Bonus = bonus
    })

    const groupRank: Record<string, number> = { Main: 0, Secondary: 1, Modifier: 2 }
    return [...byKey.values()]
      .filter((entry) => entry.curTotal > 0 || entry.b100Total > 0 || entry.b200Total > 0)
      .sort((a, b) => (groupRank[a.group] ?? 99) - (groupRank[b.group] ?? 99))
  }, [active, maximum, reference, showEvaluationTargets])

  if (!showEvaluationTargets) {
    return <OverviewStatsTreeOnly nodes={overviewStatsTree} />
  }

  const hasEchoes = (
    activeSets.length > 0
    || referenceSets.length > 0
    || maximumSets.length > 0
    || activeEchoes.length > 0
    || referenceEchoes.length > 0
    || maximumEchoes.length > 0
  )
  if (rows.length === 0 && !hasEchoes) {
    return <p className="workspace-empty">No combat stats are available for this evaluation.</p>
  }

  return (
    <div className="workspace-stats-stack">
      <div className="workspace-srel">
        <div className="workspace-srel-head">
          <span className="workspace-srel-h-name">Stat</span>
          <span className="workspace-srel-h-col" style={{ '--srel-col-color': currentTone } as CssVars}>Current</span>
          <span className="workspace-srel-h-col" style={{ '--srel-col-color': referenceTone } as CssVars}>100%</span>
          <span className="workspace-srel-h-col" style={{ '--srel-col-color': maximumTone } as CssVars}>200%</span>
        </div>
        <div className="workspace-srel-body">
          {rows.map((row, index) => {
            const isGroupStart = index === 0 || rows[index - 1].group !== row.group
            const cleanLabel = row.label.replace(' DMG Bonus', '')
            return (
              <Fragment key={row.key}>
                {isGroupStart ? (
                  <div className="workspace-srel-group">
                    <span>{SREL_GROUP_LABEL[row.group] ?? row.group}</span>
                  </div>
                ) : null}
                <div className="workspace-srel-row"
                  title={row.base > 0 ? `${cleanLabel} · base ${formatStatValue(row.label, row.base)}` : cleanLabel}
                >
                  <span className="workspace-srel-name">
                    <StatGlyph statKey={row.key} />
                    <span className="workspace-srel-label">{cleanLabel}</span>
                  </span>
                  <SrelCell label={row.label} total={row.curTotal} bonus={row.curBonus} />
                  <SrelCell label={row.label} total={row.b100Total} bonus={row.b100Bonus} />
                  <SrelCell label={row.label} total={row.b200Total} bonus={row.b200Bonus} />
                </div>
              </Fragment>
            )
          })}
          <div className="workspace-srel-group workspace-srel-group--sets">
            <span>Echoes</span>
          </div>
          <div className="workspace-srel-row">
            <span className="workspace-srel-name">
              <span className="workspace-srel-label">Sonata</span>
            </span>
            <SrelSetPlan sets={activeSets} />
            <SrelSetPlan sets={referenceSets} />
            <SrelSetPlan sets={maximumSets} />
          </div>
          <div className="workspace-srel-row">
            <span className="workspace-srel-name">
              <span className="workspace-srel-label">Main Echo</span>
            </span>
            <SrelMainEcho echoes={activeEchoes} />
            <SrelMainEcho echoes={referenceEchoes} />
            <SrelMainEcho echoes={maximumEchoes} />
          </div>
        </div>
      </div>
      <InvariantStatsTree nodes={invariantStats} />
    </div>
  )
}

export function AlternativesTable({
  alternatives,
}: {
  alternatives: EvaluationAlternative[]
}) {
  const groups = useMemo(() => groupAlternatives(alternatives), [alternatives])

  return (
    <div className="workspace-table-wrap">
      <table className="workspace-table workspace-alts-table">
        <thead>
          <tr>
            <th>Change</th>
            <th className="num">Cost</th>
            <th className="num">Damage</th>
            <th className="num">Δ Damage</th>
            <th className="num">Score</th>
            <th className="num">Δ Score%</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const alternative = group.representative
            const oldScore = alternative.score - alternative.scoreDelta
            return (
              <tr key={group.id}>
                <td>
                  <span className="workspace-alt-cell">
                    <span className="workspace-alt-cell-swap">
                      <SwapToken side={group.from} />
                      <ChevronRight aria-hidden="true" size="0.75rem" />
                      <span className="workspace-swap-dest-list">
                        {group.to.map((side, index) => (
                          <span key={`${side.glyph}:${index}`} className="workspace-swap-dest-item">
                            {index > 0 ? <span className="workspace-swap-divider">/</span> : null}
                            <SwapToken side={side} />
                          </span>
                        ))}
                        {group.hiddenCount > 0 ? (
                          <span className="workspace-swap-more">+{group.hiddenCount}</span>
                        ) : null}
                      </span>
                    </span>
                  </span>
                </td>

                <td className="num">{alternative.kind === 'sonataSet' ? '--' : alternative.cost}</td>
                <td className="num">{formatCompactNum(alternative.damage)}</td>
                <td className={`num workspace-num--${deltaSign(alternative.damageDelta)}`}>
                  {fmtSignedNumber(alternative.damageDelta)}
                </td>
                <td className="num">
                  <span className="workspace-score-change">
                    <span className="workspace-score-change__old">{formatBuildEvaluationScore(oldScore)}</span>
                    <ChevronRight aria-hidden="true" size="0.75rem" />
                    <span className={`workspace-score-change__new workspace-num--${deltaSign(alternative.scoreDelta)}`}>
                      {formatBuildEvaluationScore(alternative.score)}
                    </span>
                  </span>
                </td>
                <td className={`num workspace-num--${deltaSign(alternative.damageDeltaPct)}`}>
                  {fmtSignedPct(alternative.damageDeltaPct)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export const ROTATION_CHART_COLORS = [
  '#5ad1c4',
  '#f0a35e',
  '#7c9cf0',
  '#e07ab0',
  '#9bd45e',
  '#d6c25a',
  '#6ad0f0',
  '#c98cf0',
  '#e06d6d',
  '#8fb0c4',
]

interface RotationChartSegment {
  key: string
  label: string
  icon?: string
  pct: number
  color: string
}

function RotationSpectrumBar({
  label,
  countLabel,
  segments,
}: {
  label: string
  countLabel: string
  segments: RotationChartSegment[]
}) {
  const lead = segments.length > 0 ? segments.reduce((top, seg) => (seg.pct > top.pct ? seg : top), segments[0]) : null

  return (
    <section className="workspace-spec-row">
      <header className="workspace-spec-head">
        <span className="workspace-spec-label">{label}</span>
        <span className="workspace-spec-count">{segments.length} {countLabel}</span>
      </header>

      <div className="workspace-spec-track" role="img" aria-label={`${label} damage share`}>
        {segments.length > 0 ? (
          segments.map((segment) => (
            <span
              key={segment.key}
              className={`workspace-spec-seg${segment === lead ? ' workspace-spec-seg--lead' : ''}`}
              style={{ flexGrow: Math.max(segment.pct, 0.6), '--c': segment.color } as CssVars}
              title={`${segment.label} · ${formatTruncCompact(segment.pct, 1)}%`}
            />
          ))
        ) : (
          <span className="workspace-spec-seg workspace-spec-seg--empty" style={{ flexGrow: 1 }} />
        )}
      </div>

      <ul className="workspace-spec-legend">
        {segments.map((segment) => (
          <li key={segment.key} className={`workspace-spec-chip${segment === lead ? ' workspace-spec-chip--lead' : ''}`}>
            <span className="workspace-spec-dot" style={{ background: segment.color }} />
            {segment.icon ? (
              <img src={segment.icon} alt="" className="workspace-spec-chip-icon" loading="lazy" onError={withDefIconM} />
            ) : null}
            <span className="workspace-spec-chip-label">{segment.label}</span>
            <span className="workspace-spec-chip-pct">{formatTruncCompact(segment.pct, 1)}%</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function groupToSegment(
  group: EvaluationFeatureGroup,
  index: number,
  resolveLabel: (group: EvaluationFeatureGroup) => { label: string; icon?: string },
): RotationChartSegment {
  const display = resolveLabel(group)
  return {
    key: group.key,
    label: display.label,
    icon: display.icon,
    pct: group.sharePct,
    color: ROTATION_CHART_COLORS[index % ROTATION_CHART_COLORS.length],
  }
}

export function getEvaluationFeatureTabLabel(tab: string, fallback?: string): string {
  const sharedLabel = getSkillTabLabel(tab)
  if (sharedLabel !== tab) {
    return sharedLabel
  }
  if (fallback && fallback !== tab) {
    return fallback
  }
  return toTitle(tab || 'feature')
}

export function groupRotationFeatureRows(rows: EvaluationFeature[]): EvaluationFeature[] {
  const bySkillId = new Map<string, EvaluationFeature>()

  for (const row of rows) {
    const existing = bySkillId.get(row.skillId)
    if (existing) {
      existing.weightedDamage += row.weightedDamage
      existing.damage = existing.weightedDamage
      continue
    }

    bySkillId.set(row.skillId, {
      ...row,
      damage: row.weightedDamage,
      sharePct: 0,
    })
  }

  const grouped = [...bySkillId.values()]
  const total = grouped.reduce((sum, row) => sum + Math.max(0, row.weightedDamage), 0)

  return grouped
    .map((row) => ({
      ...row,
      sharePct: total > 0 ? (Math.max(0, row.weightedDamage) / total) * 100 : 0,
    }))
    .sort((a, b) => b.weightedDamage - a.weightedDamage)
}

function countRotationFeatureIds(rows: EvaluationFeature[]): number {
  return new Set(rows.map((row) => row.skillId)).size
}

function RotationFeatures({
  rows,
  groups,
}: {
  rows: EvaluationFeature[]
  groups: EvaluationFeatureGroups
}) {
  const ranked = useMemo(() => groupRotationFeatureRows(rows), [rows])

  const typeSegments = useMemo(
    () => groups.skillTypes.map((group, index) => groupToSegment(
      group,
      index,
      (entry) => getSkillType(entry.skillType ?? entry.key),
    )),
    [groups.skillTypes],
  )

  const tabSegments = useMemo(
    () => groups.tabs.map((group, index) => groupToSegment(
      group,
      index,
      (entry) => ({ label: getEvaluationFeatureTabLabel(entry.key, entry.label) }),
    )),
    [groups.tabs],
  )

  if (ranked.length === 0) {
    return <p className="workspace-empty">No rotation features were simulated for this build.</p>
  }

  return (
    <div className="workspace-rota-grid">
      <div className="workspace-spectrum">
        <RotationSpectrumBar label="By skill type" countLabel="types" segments={typeSegments} />
        <RotationSpectrumBar label="By talent node" countLabel="nodes" segments={tabSegments} />
      </div>

      <div className="workspace-table-wrap workspace-rota-table">
        <table className="workspace-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>Talent Node</th>
              <th>Skill Type</th>
              <th className="num">Total Damage</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => {
              const type = getSkillType(row.skillType)
              return (
                <tr key={row.skillId}>
                  <td>{row.label}</td>
                  <td>{getEvaluationFeatureTabLabel(row.tab)}</td>
                  <td>
                    <span className="workspace-table-stat">
                      {type.icon ? (
                        <img src={type.icon} alt="" className="workspace-type-icon" loading="lazy" onError={withDefIconM} />
                      ) : null}
                      {type.short ?? type.label}
                    </span>
                  </td>
                  <td className="num">{formatCompactNum(row.weightedDamage)}</td>
                  <td className="num">{formatTruncCompact(row.sharePct, 1)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatTable({ rows }: { rows: EvaluationStatContribution[] }) {
  const ranked = rows
    .filter((row) => Math.abs(row.total) > 0.0001)
    .slice()
    .sort((a, b) => b.sharePct - a.sharePct)
  const fmtRollCount = (count: number) => {
    const truncated = truncTo(count, 1)
    return Number.isInteger(truncated) ? String(truncated) : truncated.toFixed(1)
  }
  const renderMainPart = (row: EvaluationStatContribution) => {
    if (Math.abs(row.mainTotal) <= 0.0001) {
      return '--'
    }
    const count = row.mainCount > 0 ? String(row.mainCount) : null
    return (
      <span className="workspace-table-stat-value">
        {formatStatKeyValue(row.key, row.mainTotal)}
        {count ? <sup title={`${count} main stat${count === '1' ? '' : 's'}`}>{count}</sup> : null}
      </span>
    )
  }
  const renderSubstatPart = (row: EvaluationStatContribution) => {
    if (Math.abs(row.substatTotal) <= 0.0001) {
      return '--'
    }
    const rolls = row.substatCount > 0.0001 ? fmtRollCount(row.substatCount) : null
    return (
      <span className="workspace-table-stat-value">
        {formatStatKeyValue(row.key, row.substatTotal)}
        {rolls ? <sup title={`${rolls} roll${rolls === '1' ? '' : 's'}`}>{rolls}</sup> : null}
      </span>
    )
  }
  return (
    <div className="workspace-table-wrap">
      <table className="workspace-table">
        <thead>
          <tr>
            <th>Stat</th>
            <th className="num">Mains</th>
            <th className="num">Subs</th>
            <th className="num">Total</th>
            <th className="num">Quality</th>
            <th className="num">Damage</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {ranked.length > 0 ? (
            ranked.map((row) => (
              <tr key={row.key}>
                <td>
                  <span className="workspace-table-stat">
                    <StatGlyph statKey={row.key} />
                    {formatStatKeyLabel(row.key)}
                  </span>
                </td>
                <td className="num muted">{renderMainPart(row)}</td>
                <td className="num muted">{renderSubstatPart(row)}</td>
                <td className="num">{formatStatKeyValue(row.key, row.total)}</td>
                <td className="num">{row.qualityPct > 0 ? `${formatTruncCompact(row.qualityPct, 0)}%` : '--'}</td>
                <td className="num">{fmtSignedNumber(row.damage)}</td>
                <td className="num">{formatTruncCompact(row.sharePct, 1)}%</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={7} className="muted">No non-zero stats in this build.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export function BuildDossier({
  label,
  build,
  rotationAction,
  showEchoStats = true,
  showRotationFeatures = true,
}: {
  label: string
  build: EvaluationBuildSnapshot
  rotationAction?: ReactNode
  showEchoStats?: boolean
  showRotationFeatures?: boolean
}) {
  const metricCount = 2 + (showEchoStats ? 1 : 0) + (showRotationFeatures ? 1 : 0)

  return (
    <article className="workspace-build-dossier workspace-card">
      <header className="workspace-build-dossier-head">
        <div className="workspace-build-dossier-title-w">
          <span className="workspace-eyebrow">{label}</span>
          <h4 className="workspace-build-dossier-title">{build.label}</h4>
        </div>
        <span className={`workspace-build-mode workspace-build-mode--${build.substatMode}`}>
          {build.substatMode}
        </span>
      </header>

      <div className="workspace-build-metrics" style={{ '--workspace-build-metric-count': metricCount } as CssVars}>
        <div>
          <span>Score</span>
          <strong>{formatBuildEvaluationScore(build.score)}</strong>
        </div>
        <div>
          <span>Damage</span>
          <strong>{formatCompactNum(build.damage)}</strong>
        </div>
        {showEchoStats ? (
        <div>
          <span>Stats</span>
          <strong>{build.statRows.length}</strong>
        </div>
        ) : null}
        {showRotationFeatures ? (
        <div>
          <span>Features</span>
          <strong>{countRotationFeatureIds(build.features)}</strong>
        </div>
        ) : null}
      </div>

      {showEchoStats ? (
      <div className="workspace-build-subsection">
        <span className="workspace-eyebrow">Echo Stats</span>
        <StatTable rows={build.statRows} />
      </div>
      ) : null}

      {showRotationFeatures ? (
      <div className="workspace-build-subsection">
        <div className="workspace-build-subsection-head">
          <span className="workspace-eyebrow">Rotation Features</span>
          {rotationAction}
        </div>
        <RotationFeatures rows={build.features} groups={build.featureGroups} />
      </div>
      ) : null}
    </article>
  )
}
