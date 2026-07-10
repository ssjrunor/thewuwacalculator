import { Fragment, useMemo } from 'react'
import type { CSSProperties as CssProps } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { GRADE_LADDER } from '@/data/scoring/buildBenchmark.ts'
import type {
  BenchmarkAlternative,
  BenchmarkBuildSnapshot,
  BenchmarkEchoSlot,
  BenchmarkFeature,
  BenchmarkFeatureGroup,
  BenchmarkFeatureGroups,
  BenchmarkOverviewStats,
  BenchmarkSetSummary,
  BenchmarkStatTreeNode,
  BenchmarkStatContribution,
  BuildBenchmarkReport,
} from '@/data/scoring/buildBenchmark.ts'
import type { StatTreeNode } from '@/modules/calculator/model/statsView.ts'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getSkillType } from '@/modules/calculator/model/skillTypes'
import { getSkillTabLabel } from '@/modules/calculator/model/skillTabs'
import {
  formatBuildBenchmarkScore,
  getBuildBenchmarkEmoji,
  getBuildBenchmarkTone,
} from '@/modules/calculator/model/buildBenchmarkDisplay.ts'
import {
  formatCompactNum,
  formatStatValue,
  formatStatKeyLabel,
  formatStatKeyValue,
} from '@/modules/calculator/model/statsView.ts'
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
} from './ui.tsx'

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
    <div className="bench-srel-cell">
      <span className="bench-srel-total">{formatStatValue(label, total)}</span>
      <span className={`bench-srel-delta bench-num--${deltaSign(bonus)}`}>{fmtOverviewBonus(label, bonus)}</span>
    </div>
  )
}

function SrelSetPlan({ sets }: { sets: BenchmarkSetSummary[] }) {
  return <SonataTokens sets={sets} className="bench-srel-set-plan" emptyLabel="--" />
}

function SrelMainEcho({ echoes }: { echoes: BenchmarkEchoSlot[] }) {
  const mainEcho = echoes.find((echo) => echo.mainEcho) ?? null
  if (!mainEcho) {
    return <span className="bench-srel-echo bench-srel-echo--empty">--</span>
  }

  const echoDef = getEchoById(mainEcho.echoId)
  return (
    <span className="bench-srel-echo" title={`${echoDef?.name ?? mainEcho.echoName} · ${mainEcho.cost} cost`}>
      <span className="bench-srel-echo-frame">
        {echoDef?.icon ? (
          <img
            src={echoDef.icon}
            alt=""
            className="bench-srel-echo-icon"
            loading="lazy"
            decoding="async"
            onError={withDefIconM}
          />
        ) : (
          <span className="bench-srel-echo-icon bench-srel-echo-icon--fallback" />
        )}
      </span>
      <span className="bench-srel-echo-name">{echoDef?.name ?? mainEcho.echoName}</span>
      <span className="bench-srel-echo-cost">{mainEcho.cost}C</span>
    </span>
  )
}

type ReportStatsTreeNode = BenchmarkStatTreeNode | StatTreeNode
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

function InvariantStatsTree({ nodes }: { nodes: BenchmarkStatTreeNode[] }) {
  if (nodes.length === 0) return null

  return (
    <div className="overview-stats-tree bench-invariant-stats-tree">
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
    return <p className="bench-empty">No overview stats are available for this build.</p>
  }

  return (
    <div className="bench-stats-stack bench-stats-stack--overview-only">
      <div className="overview-stats-tree bench-invariant-stats-tree">
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
  benchmark100,
  benchmark200,
  invariantStats,
  activeSets,
  benchmark100Sets,
  benchmark200Sets,
  activeEchoes,
  benchmark100Echoes,
  benchmark200Echoes,
  currentTone,
  benchmark100Tone,
  benchmark200Tone,
  showBenchmarkTargets = true,
  overviewStatsTree = [],
}: {
  active: BenchmarkOverviewStats
  benchmark100: BenchmarkOverviewStats
  benchmark200: BenchmarkOverviewStats
  invariantStats: BenchmarkStatTreeNode[]
  activeSets: BenchmarkSetSummary[]
  benchmark100Sets: BenchmarkSetSummary[]
  benchmark200Sets: BenchmarkSetSummary[]
  activeEchoes: BenchmarkEchoSlot[]
  benchmark100Echoes: BenchmarkEchoSlot[]
  benchmark200Echoes: BenchmarkEchoSlot[]
  currentTone: string
  benchmark100Tone: string
  benchmark200Tone: string
  showBenchmarkTargets?: boolean
  overviewStatsTree?: StatTreeNode[]
}) {
  const rows = useMemo(() => {
    if (!showBenchmarkTargets) {
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
      stats: BenchmarkOverviewStats,
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
    addRows(benchmark100, (entry, _base, total, bonus) => {
      entry.b100Total = total
      entry.b100Bonus = bonus
    })
    addRows(benchmark200, (entry, _base, total, bonus) => {
      entry.b200Total = total
      entry.b200Bonus = bonus
    })

    const groupRank: Record<string, number> = { Main: 0, Secondary: 1, Modifier: 2 }
    return [...byKey.values()]
      .filter((entry) => entry.curTotal > 0 || entry.b100Total > 0 || entry.b200Total > 0)
      .sort((a, b) => (groupRank[a.group] ?? 99) - (groupRank[b.group] ?? 99))
  }, [active, benchmark100, benchmark200, showBenchmarkTargets])

  if (!showBenchmarkTargets) {
    return <OverviewStatsTreeOnly nodes={overviewStatsTree} />
  }

  const hasEchoes = (
    activeSets.length > 0
    || benchmark100Sets.length > 0
    || benchmark200Sets.length > 0
    || activeEchoes.length > 0
    || benchmark100Echoes.length > 0
    || benchmark200Echoes.length > 0
  )
  if (rows.length === 0 && !hasEchoes) {
    return <p className="bench-empty">No combat stats are available for this benchmark.</p>
  }

  return (
    <div className="bench-stats-stack">
      <div className="bench-srel">
        <div className="bench-srel-head">
          <span className="bench-srel-h-name">Stat</span>
          <span className="bench-srel-h-col" style={{ '--srel-col-color': currentTone } as CssVars}>Current</span>
          <span className="bench-srel-h-col" style={{ '--srel-col-color': benchmark100Tone } as CssVars}>100%</span>
          <span className="bench-srel-h-col" style={{ '--srel-col-color': benchmark200Tone } as CssVars}>200%</span>
        </div>
        <div className="bench-srel-body">
          {rows.map((row, index) => {
            const isGroupStart = index === 0 || rows[index - 1].group !== row.group
            const cleanLabel = row.label.replace(' DMG Bonus', '')
            return (
              <Fragment key={row.key}>
                {isGroupStart ? (
                  <div className="bench-srel-group">
                    <span>{SREL_GROUP_LABEL[row.group] ?? row.group}</span>
                  </div>
                ) : null}
                <div
                  className="bench-srel-row"
                  title={row.base > 0 ? `${cleanLabel} · base ${formatStatValue(row.label, row.base)}` : cleanLabel}
                >
                  <span className="bench-srel-name">
                    <StatGlyph statKey={row.key} />
                    <span className="bench-srel-label">{cleanLabel}</span>
                  </span>
                  <SrelCell label={row.label} total={row.curTotal} bonus={row.curBonus} />
                  <SrelCell label={row.label} total={row.b100Total} bonus={row.b100Bonus} />
                  <SrelCell label={row.label} total={row.b200Total} bonus={row.b200Bonus} />
                </div>
              </Fragment>
            )
          })}
          <div className="bench-srel-group bench-srel-group--sets">
            <span>Echoes</span>
          </div>
          <div className="bench-srel-row">
            <span className="bench-srel-name">
              <span className="bench-srel-label">Sonata</span>
            </span>
            <SrelSetPlan sets={activeSets} />
            <SrelSetPlan sets={benchmark100Sets} />
            <SrelSetPlan sets={benchmark200Sets} />
          </div>
          <div className="bench-srel-row">
            <span className="bench-srel-name">
              <span className="bench-srel-label">Main Echo</span>
            </span>
            <SrelMainEcho echoes={activeEchoes} />
            <SrelMainEcho echoes={benchmark100Echoes} />
            <SrelMainEcho echoes={benchmark200Echoes} />
          </div>
        </div>
      </div>
      <InvariantStatsTree nodes={invariantStats} />
    </div>
  )
}

const GRADE_BLEND = 1.5

const GRADE_SCALE_GRADIENT = (() => {
  const asc = [...GRADE_LADDER].sort((a, b) => a[0] - b[0])
  const positions = asc.map(([threshold]) => Math.max(0, Math.min(100, threshold / 2)))
  const colors = asc.map(([threshold]) => getBuildBenchmarkTone(threshold).color)
  const startColor = getBuildBenchmarkTone(0).color

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
  .map((mark) => ({ ...mark, color: getBuildBenchmarkTone(mark.threshold).color }))

export function BenchmarkMeter({
  report,
  score,
  grade,
  tone,
  banner,
}: {
  report: BuildBenchmarkReport
  score: number
  grade: string
  tone: string
  banner?: ReactNode
}) {
  const bench = report.benchmark
  const pct = Math.max(0, Math.min(100, score / 2))
  return (
    <section
      className="bench-band bench-card bench-span"
      data-emoji={getBuildBenchmarkEmoji(grade)}
      data-score={Math.floor(score)}
      data-banner={banner ? 'true' : undefined}
      style={{
        '--grade': tone,
        '--pos': `${pct}%`,
        '--grade-scale': GRADE_SCALE_GRADIENT,
      } as CssVars}
    >
      {banner}
      <div className="bench-band-core">
        <div className="bench-band-score">
          <span className="bench-eyebrow">Build Score</span>
          <strong className="bench-band-figure">{formatBuildBenchmarkScore(score)}</strong>
          <span className="bench-band-score-sub">
            <em>{formatCompactNum(bench.userDamage)}</em> avg dmg
          </span>
        </div>
      </div>

      <div className="bench-band-gauge">
        <div className="bench-ruler-top">
          <span className="bench-ruler-dmg">
            <em>{formatCompactNum(bench.baselineDamage)}</em>
            <span>Baseline · 0%</span>
          </span>
          <span className="bench-ruler-dmg bench-ruler-dmg--mid">
            <em>{formatCompactNum(bench.benchmarkDamage)}</em>
            <span>Benchmark · 100%</span>
          </span>
          <span className="bench-ruler-dmg bench-ruler-dmg--end">
            <em>{formatCompactNum(bench.perfectionDamage)}</em>
            <span>Maximum · 200%</span>
          </span>
        </div>

        <div className="bench-track">
          <span className="bench-track-bar">
            <span className="bench-track-scale" />
            <span className="bench-track-fill" />
            {GRADE_MARKS.map((mark) => (
              <span
                key={`${mark.threshold}:${mark.label}`}
                className="bench-track-notch"
                style={{ '--at': `${mark.pos}%` } as CssVars}
              />
            ))}
          </span>
          <span className="bench-track-tick bench-track-tick--mid" style={{ '--at': '50%' } as CssVars} />
          <span className="bench-track-marker">
            <span className="bench-track-marker-flag">{grade}</span>
          </span>
        </div>

        <div className="bench-ruler-tiers">
          <span className="bench-ruler-cap bench-ruler-cap--start">0%</span>
          {MILESTONE_MARKS.map((mark) => (
            <span
              key={`${mark.threshold}:${mark.label}`}
              className={`bench-ruler-tier${mark.pos <= pct ? ' is-reached' : ''}`}
              style={{ '--at': `${mark.pos}%`, '--tier-color': mark.color } as CssVars}
            >
              <i className="bench-ruler-tier-stem" aria-hidden="true" />
              <b>{mark.label}</b>
            </span>
          ))}
          <span className="bench-ruler-cap bench-ruler-cap--end">200%</span>
        </div>
      </div>
    </section>
  )
}

export function AlternativesTable({
  alternatives,
}: {
  alternatives: BenchmarkAlternative[]
}) {
  const groups = useMemo(() => groupAlternatives(alternatives), [alternatives])

  return (
    <div className="bench-table-wrap">
      <table className="bench-table bench-alts-table">
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
                  <span className="bench-alt-cell">
                    <span className="bench-alt-cell-swap">
                      <SwapToken side={group.from} />
                      <ChevronRight aria-hidden="true" size={12} />
                      <span className="bench-swap-dest-list">
                        {group.to.map((side, index) => (
                          <span key={`${side.glyph}:${index}`} className="bench-swap-dest-item">
                            {index > 0 ? <span className="bench-swap-divider">/</span> : null}
                            <SwapToken side={side} />
                          </span>
                        ))}
                        {group.hiddenCount > 0 ? (
                          <span className="bench-swap-more">+{group.hiddenCount}</span>
                        ) : null}
                      </span>
                    </span>
                  </span>
                </td>

                <td className="num">{alternative.kind === 'sonataSet' ? '--' : alternative.cost}</td>
                <td className="num">{formatCompactNum(alternative.damage)}</td>
                <td className={`num bench-num--${deltaSign(alternative.damageDelta)}`}>
                  {fmtSignedNumber(alternative.damageDelta)}
                </td>
                <td className="num">
                  <span className="bench-score-change">
                    <span className="bench-score-change__old">{formatBuildBenchmarkScore(oldScore)}</span>
                    <ChevronRight aria-hidden="true" size={12} />
                    <span className={`bench-score-change__new bench-num--${deltaSign(alternative.scoreDelta)}`}>
                      {formatBuildBenchmarkScore(alternative.score)}
                    </span>
                  </span>
                </td>
                <td className={`num bench-num--${deltaSign(alternative.damageDeltaPct)}`}>
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

const ROTATION_CHART_COLORS = [
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
    <section className="bench-spec-row">
      <header className="bench-spec-head">
        <span className="bench-spec-label">{label}</span>
        <span className="bench-spec-count">{segments.length} {countLabel}</span>
      </header>

      <div className="bench-spec-track" role="img" aria-label={`${label} damage share`}>
        {segments.length > 0 ? (
          segments.map((segment) => (
            <span
              key={segment.key}
              className={`bench-spec-seg${segment === lead ? ' bench-spec-seg--lead' : ''}`}
              style={{ flexGrow: Math.max(segment.pct, 0.6), '--c': segment.color } as CssVars}
              title={`${segment.label} · ${formatTruncCompact(segment.pct, 1)}%`}
            />
          ))
        ) : (
          <span className="bench-spec-seg bench-spec-seg--empty" style={{ flexGrow: 1 }} />
        )}
      </div>

      <ul className="bench-spec-legend">
        {segments.map((segment) => (
          <li key={segment.key} className={`bench-spec-chip${segment === lead ? ' bench-spec-chip--lead' : ''}`}>
            <span className="bench-spec-dot" style={{ background: segment.color }} />
            {segment.icon ? (
              <img src={segment.icon} alt="" className="bench-spec-chip-icon" loading="lazy" onError={withDefIconM} />
            ) : null}
            <span className="bench-spec-chip-label">{segment.label}</span>
            <span className="bench-spec-chip-pct">{formatTruncCompact(segment.pct, 1)}%</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function groupToSegment(
  group: BenchmarkFeatureGroup,
  index: number,
  resolveLabel: (group: BenchmarkFeatureGroup) => { label: string; icon?: string },
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

function getBenchmarkFeatureTabLabel(tab: string, fallback?: string): string {
  const sharedLabel = getSkillTabLabel(tab)
  if (sharedLabel !== tab) {
    return sharedLabel
  }
  if (fallback && fallback !== tab) {
    return fallback
  }
  return toTitle(tab || 'feature')
}

function RotationFeatures({
  rows,
  groups,
}: {
  rows: BenchmarkFeature[]
  groups: BenchmarkFeatureGroups
}) {
  const ranked = useMemo(
    () => rows.slice().sort((a, b) => b.weightedDamage - a.weightedDamage),
    [rows],
  )

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
      (entry) => ({ label: getBenchmarkFeatureTabLabel(entry.key, entry.label) }),
    )),
    [groups.tabs],
  )

  if (ranked.length === 0) {
    return <p className="bench-empty">No rotation features were simulated for this build.</p>
  }

  return (
    <div className="bench-rota-grid">
      <div className="bench-spectrum">
        <RotationSpectrumBar label="By skill type" countLabel="types" segments={typeSegments} />
        <RotationSpectrumBar label="By talent node" countLabel="nodes" segments={tabSegments} />
      </div>

      <div className="bench-table-wrap bench-rota-table">
        <table className="bench-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>Talent Node</th>
              <th>Skill Type</th>
              <th className="num">Damage</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => {
              const type = getSkillType(row.skillType)
              return (
                <tr key={`${row.skillId}:${row.label}`}>
                  <td>{row.label}</td>
                  <td>{getBenchmarkFeatureTabLabel(row.tab)}</td>
                  <td>
                    <span className="bench-table-stat">
                      {type.icon ? (
                        <img src={type.icon} alt="" className="bench-type-icon" loading="lazy" onError={withDefIconM} />
                      ) : null}
                      {type.short ?? type.label}
                    </span>
                  </td>
                  <td className="num">{formatCompactNum(row.damage)}</td>
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

function StatTable({ rows }: { rows: BenchmarkStatContribution[] }) {
  const ranked = rows
    .filter((row) => Math.abs(row.total) > 0.0001)
    .slice()
    .sort((a, b) => b.sharePct - a.sharePct)
  const fmtRollCount = (count: number) => {
    const truncated = truncTo(count, 1)
    return Number.isInteger(truncated) ? String(truncated) : truncated.toFixed(1)
  }
  const renderMainPart = (row: BenchmarkStatContribution) => {
    if (Math.abs(row.mainTotal) <= 0.0001) {
      return '--'
    }
    const count = row.mainCount > 0 ? String(row.mainCount) : null
    return (
      <span className="bench-table-stat-value">
        {formatStatKeyValue(row.key, row.mainTotal)}
        {count ? <sup title={`${count} main stat${count === '1' ? '' : 's'}`}>{count}</sup> : null}
      </span>
    )
  }
  const renderSubstatPart = (row: BenchmarkStatContribution) => {
    if (Math.abs(row.substatTotal) <= 0.0001) {
      return '--'
    }
    const rolls = row.substatCount > 0.0001 ? fmtRollCount(row.substatCount) : null
    return (
      <span className="bench-table-stat-value">
        {formatStatKeyValue(row.key, row.substatTotal)}
        {rolls ? <sup title={`${rolls} roll${rolls === '1' ? '' : 's'}`}>{rolls}</sup> : null}
      </span>
    )
  }
  return (
    <div className="bench-table-wrap">
      <table className="bench-table">
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
                  <span className="bench-table-stat">
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
  build: BenchmarkBuildSnapshot
  rotationAction?: ReactNode
  showEchoStats?: boolean
  showRotationFeatures?: boolean
}) {
  const metricCount = 2 + (showEchoStats ? 1 : 0) + (showRotationFeatures ? 1 : 0)

  return (
    <article className="bench-build-dossier bench-card">
      <header className="bench-build-dossier-head">
        <div className="bench-build-dossier-title-w">
          <span className="bench-eyebrow">{label}</span>
          <h4 className="bench-build-dossier-title">{build.label}</h4>
        </div>
        <span className={`bench-build-mode bench-build-mode--${build.substatMode}`}>
          {build.substatMode}
        </span>
      </header>

      <div className="bench-build-metrics" style={{ '--bench-build-metric-count': metricCount } as CssVars}>
        <div>
          <span>Score</span>
          <strong>{formatBuildBenchmarkScore(build.score)}</strong>
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
          <strong>{build.features.length}</strong>
        </div>
        ) : null}
      </div>

      {showEchoStats ? (
      <div className="bench-build-subsection">
        <span className="bench-eyebrow">Echo Stats</span>
        <StatTable rows={build.statRows} />
      </div>
      ) : null}

      {showRotationFeatures ? (
      <div className="bench-build-subsection">
        <div className="bench-build-subsection-head">
          <span className="bench-eyebrow">Rotation Features</span>
          {rotationAction}
        </div>
        <RotationFeatures rows={build.features} groups={build.featureGroups} />
      </div>
      ) : null}
    </article>
  )
}
