/*
  Author: Runor Ewhro
  Description: Projects baseline and evaluated stats and resolves source-level arithmetic for a selected row.
*/

import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  EvaluationBuildSnapshot,
  EvaluationOverviewStats,
  EvaluationOverviewStatRow,
  EvaluationStatContribution,
} from '@/engine/evaluation/buildEvaluation.ts'
import { isNoWeaponId, type ResRuntime } from '@/domain/entities/runtime.ts'
import { getSbstStepP } from '@/data/gameData/catalog/echoStats.ts'
import { aggregateSubstats } from '@/engine/evaluation/substatMath.ts'
import type { StateGroup, StatSourceTerm } from '@/modules/simulation/model/stateSummary.ts'
import type { StatTreeNode } from '@/modules/simulation/model/statsView.ts'
import { withDefIconM } from '@/shared/lib/imageFallback'
import { makeStatResidue, type ResidueRow, type ScopedAddend } from './lib/statResidue.ts'
import {
  ECHO_COST_MAX,
  makeBuiltOnFrame,
  type BuiltOnFrame,
} from './lib/builtOn.ts'
import {
  STAT_ICON_MAP,
  formatStatKeyLabel,
  formatStatKeyValue,
} from '@/modules/simulation/model/statsView.ts'
import { getBuildEvaluationTone } from '@/modules/simulation/model/buildEvaluationDisplay.ts'
import { getResSeedBy, resResBaseSt } from '@/data/catalog/resonatorSeedService.ts'
import { getWpnById } from '@/data/catalog/weaponCatalogService.ts'
import { wpnAtkAt } from '@/engine/runtime/weaponState.ts'
import { Expandable } from '@/shared/ui/Expandable.tsx'
import { Tooltip } from '@/shared/ui/Tooltip.tsx'

type CssVars = CSSProperties & Record<string, string | number>

/* the two anchors keep the report's own tones, so a reader who knows the
   evaluation's colours already knows what these two columns are */
const TONE_100 = getBuildEvaluationTone(100).color
const TONE_200 = getBuildEvaluationTone(200).color

const SAME_EPS = 0.005

const ASTERISK_GLYPH = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 4 16 16" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round">'
  + '<path d="M12 6v12"/><path d="M17.196 9 6.804 15"/><path d="m6.804 9 10.392 6"/></svg>',
)}")`

function near(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b))
  return scale === 0 || Math.abs(a - b) / scale < SAME_EPS
}

function signedStatValue(key: string, value: number): string {
  if (value === 0) return '–'
  return `${value > 0 ? '+' : '−'}${formatStatKeyValue(key, Math.abs(value))}`
}

/* Echo totals, counts, and roll quality are properties of the equipped Echoes
   themselves. Build them synchronously so the popup is useful before a
   evaluation exists; damage/share are overlaid later from the evaluation. */
function makeCurrentStatRows(runtime: ResRuntime): EvaluationStatContribution[] {
  const echoes = runtime.build.echoes.filter((echo) => echo != null)
  const mainTotals: Record<string, number> = {}
  const mainCounts: Record<string, number> = {}

  for (const echo of echoes) {
    for (const stat of [echo.mainStats.primary, echo.mainStats.secondary]) {
      mainTotals[stat.key] = (mainTotals[stat.key] ?? 0) + stat.value
      mainCounts[stat.key] = (mainCounts[stat.key] ?? 0) + 1
    }
  }

  const substats = aggregateSubstats(echoes)
  const keys = new Set([...Object.keys(mainTotals), ...Object.keys(substats.totals)])
  return [...keys].map((key) => {
    const mainTotal = mainTotals[key] ?? 0
    const substatTotal = substats.totals[key] ?? 0
    const substatCount = substats.counts[key] ?? 0
    const total = mainTotal + substatTotal
    const maxRoll = getSbstStepP(key).at(-1) ?? 0
    const qualityMax = mainTotal + substatCount * maxRoll
    return {
      key,
      mainTotal,
      mainCount: mainCounts[key] ?? 0,
      substatTotal,
      total,
      substatCount,
      qualityPct: qualityMax > 0 ? (total / qualityMax) * 100 : 0,
      damage: 0,
      sharePct: 0,
    }
  })
}

interface SheetGroup {
  id: string
  label: string
  glyph: string | undefined
  rows: EvaluationOverviewStatRow[]
}

/*
  The flat and the percentage form of one stat are two rows in the report's
  contribution table and one idea on the sheet, so they are paired here.

  The two vocabularies do not line up on their own: an overview row keys ATK as
  `atk`, while the contribution table keys the same stat's flat half `atkFlat`
  and its scaling half `atkPercent`. A stat with only one form, Crit DMG say,
  is keyed plainly and lands as the flat half.
*/
interface Contrib {
  flat?: EvaluationStatContribution
  pct?: EvaluationStatContribution
}

/* one stat, read in all three builds */
interface TriContrib {
  cur: Contrib
  b1: Contrib
  b2: Contrib
}

/* the three builds' contribution tables, which the rows read across */
interface TriRows {
  cur: EvaluationStatContribution[]
  b1: EvaluationStatContribution[]
  b2: EvaluationStatContribution[]
}

function contribFor(
  rows: EvaluationStatContribution[],
  key: string,
): Contrib {
  const flat = rows.find((row) => row.key === `${key}Flat`)
    ?? rows.find((row) => row.key === key)
  const pct = rows.find((row) => row.key === `${key}Percent`)
  return { flat, pct }
}

function StatMark({ label, statKey }: { label: string; statKey: string }) {
  const icon = STAT_ICON_MAP[label] ?? STAT_ICON_MAP[formatStatKeyLabel(statKey, 'bonus')]
  if (!icon) {
    return null
  }

  return (
    <span className="pst-mark"
      aria-hidden="true"
      style={{ '--g': `url(${icon})` } as CssVars}
    />
  )
}

/*
  The reading. It opens in the program editor's dropdown shell rather than a
  card of its own, and it holds the same three builds the row's columns hold, so
  a stat can be read against its ideals without leaving the label.

  A stat with both a flat and a scaling form keeps them side by side in one
  cell. They are two separate readings of the same stat, not terms of a sum:
  430 flat ATK and 71.5% ATK are not 501 of anything.
*/
function TipCell({
  contrib,
  pick,
  column,
  ready,
}: {
  contrib: Contrib
  pick: 'mainTotal' | 'substatTotal' | 'total'
  column: keyof TriContrib
  ready: boolean
}) {
  const { flat, pct } = contrib
  const flatValue = flat?.[pick] ?? 0
  const pctValue = pct?.[pick] ?? 0

  if (!flatValue && !pctValue) {
    return <span className={`pst-tip-nil is-${column}`} data-ready={ready ? 'true' : 'false'}>&ndash;</span>
  }

  return (
    <span className={`pst-tip-pair is-${column}`} data-ready={ready ? 'true' : 'false'}>
      {flatValue && flat ? <b>{formatStatKeyValue(flat.key, flatValue)}</b> : null}
      {pctValue && pct ? <b>{formatStatKeyValue(pct.key, pctValue)}</b> : null}
    </span>
  )
}

/* two rows of the same stat carry a quality each, so the reading takes the one
   that actually has rolls behind it */
function qualityOf({ flat, pct }: Contrib): number | null {
  if (!flat && !pct) return null
  return (pct?.total ?? 0) >= (flat?.total ?? 0)
    ? pct?.qualityPct ?? flat?.qualityPct ?? 0
    : flat?.qualityPct ?? 0
}

function damageOf({ flat, pct }: Contrib): number {
  return (flat?.damage ?? 0) + (pct?.damage ?? 0)
}

function shareOf({ flat, pct }: Contrib): number {
  return (flat?.sharePct ?? 0) + (pct?.sharePct ?? 0)
}

function StatTip({
  label,
  tri,
  ready,
  showDamageShare,
}: {
  label: string
  tri: TriContrib
  ready: Record<keyof TriContrib, boolean>
  showDamageShare: boolean
}) {
  const cols: ReadonlyArray<readonly [keyof TriContrib, string]> = [
    ['cur', 'Current'],
    ...(ready.b1 ? [['b1', '100%'] as const] : []),
    ...(ready.b2 ? [['b2', '200%'] as const] : []),
  ]

  const rolls = (contrib: Contrib) => {
    const mains = (contrib.flat?.mainCount ?? 0) + (contrib.pct?.mainCount ?? 0)
    const subs = Math.round(((contrib.flat?.substatCount ?? 0) + (contrib.pct?.substatCount ?? 0)) * 10) / 10
    /* a kind with nothing behind it is left out rather than read as "0 main" */
    return [mains > 0 ? `${mains} main` : '', subs > 0 ? `${subs} sub` : '']
      .filter(Boolean).join(' \u00b7 ') || '\u2013'
  }

  const num = (value: number) => (value > 0 ? `+${Math.round(value).toLocaleString()}` : '\u2013')

  return (
    <div className="pst-tip">
      <div className="app-popup__header">
        {label}
        <span className="app-popup__fill" />
        <span>echo stats</span>
      </div>

      <span className="pst-tip-grid"
        style={{ '--pst-tip-cols': cols.length } as CssVars}
      >
        <span className="pst-tip-key" />
        {cols.map(([key, head]) => (
          <span
            key={head}
            className={`pst-tip-head is-${key}`}
            data-ready={ready[key] ? 'true' : 'false'}
          >
            {head}
          </span>
        ))}

        {(['mainTotal', 'substatTotal', 'total'] as const).map((pick, index) => (
          <Fragment key={pick}>
            <span className="pst-tip-key">{['Mains', 'Subs', 'Total'][index]}</span>
            {cols.map(([key]) => (
              <TipCell
                key={key}
                contrib={tri[key]}
                pick={pick}
                column={key}
                ready={ready[key]}
              />
            ))}
          </Fragment>
        ))}

        <span className="pst-tip-key">Rolls</span>
        {cols.map(([key]) => (
          <span key={key} className={`pst-tip-soft is-${key}`} data-ready={ready[key] ? 'true' : 'false'}>
            {rolls(tri[key])}
          </span>
        ))}

        <span className="pst-tip-key">Quality</span>
        {cols.map(([key]) => {
          const quality = qualityOf(tri[key])
          return (
            <span key={key} className={`is-${key}`} data-ready={ready[key] ? 'true' : 'false'}>
              {quality === null ? '\u2013' : `${Math.round(quality)}%`}
            </span>
          )
        })}

        {showDamageShare ? (
          <>
            <span className="pst-tip-key pst-evaluation-value">Damage</span>
            {cols.map(([key]) => (
              <span key={key} className="pst-evaluation-value" data-ready={ready[key] ? 'true' : 'false'}>
                {num(damageOf(tri[key]))}
              </span>
            ))}

            <span className="pst-tip-key pst-evaluation-value">Share</span>
            {cols.map(([key]) => {
              const share = shareOf(tri[key])
              return (
                <span key={key} className="pst-evaluation-value" data-ready={ready[key] ? 'true' : 'false'}>
                  {share > 0 ? `${share.toFixed(1)}%` : '\u2013'}
                </span>
              )
            })}
          </>
        ) : null}
      </span>
    </div>
  )
}

const EMPTY_SCOPES: ScopedAddend[] = []

function ScopeDrawer({ addends, open }: { addends: ScopedAddend[]; open: boolean }) {
  return (
    <Expandable as="div" className="pgd-sub" contentOnly open={open} innerClass="pgd-sub-pad">
      {addends.map((addend, index) => (
        <div className="pgd-sub-row"
          key={addend.id}
          style={{ '--j': index, '--el': addend.color ?? 'var(--text)' } as CssVars}
        >
          <span className="pgd-sub-lb">{addend.scopeLabel}</span>
          <span />
          <span />
          <span className="pgd-sub-v pst-sub-v">{addend.displayValue}</span>
          <span />
        </div>
      ))}
    </Expandable>
  )
}

/* the count the caret is promising, said the way the damage row says its hits */
function ScopeCount({ addends }: { addends: ScopedAddend[] }) {
  return (
    <i className="pgd-hits pst-scopes">
      {addends.length} scope{addends.length > 1 ? 's' : ''}
    </i>
  )
}

function StatRow({
  row,
  displayBase,
  b100,
  b200,
  contrib,
  evaluationReady,
  picked,
  onPick,
  scoped,
  open,
  onOpen,
}: {
  row: EvaluationOverviewStatRow
  displayBase: number
  b100: EvaluationOverviewStatRow | undefined
  b200: EvaluationOverviewStatRow | undefined
  contrib: TriContrib
  evaluationReady: { current: boolean; b100: boolean; b200: boolean }
  picked: boolean
  onPick: () => void
  scoped: ScopedAddend[]
  open: boolean
  onOpen: () => void
}) {
  const displayBonus = row.total - displayBase
  const flat = near(row.total, displayBase)
  /* a stat no echo touches has nothing for the tooltip to say, so the label
     stays plain text rather than offering a reading it cannot give */
  const hasEcho = Boolean(contrib.cur.flat?.total || contrib.cur.pct?.total)
  const same100 = b100 ? near(b100.total, row.total) : true
  const same200 = b200 ? near(b200.total, row.total) : true
  const hasScopes = scoped.length > 0

  const classes = [
    'pgd-row pst-row',
    flat ? 'is-flat' : '',
    picked ? 'is-at' : '',
  ].filter(Boolean).join(' ')

  return (
    <>
    <div
      className={classes}
      data-row={row.key}
      data-open={hasScopes && open ? 'true' : 'false'}
      style={{ '--el': row.color ?? 'var(--text)' } as CssVars}
    >
      <button
        type="button" className="pgd-pick"
        aria-pressed={picked}
        aria-label={`Resolve ${row.label}`}
        tabIndex={-1}
        onClick={onPick}
      >
        <s />
      </button>

      <button
        type="button" className="pgd-face pst-face"
        aria-expanded={hasScopes ? open : undefined}
        onClick={hasScopes ? onOpen : onPick}
      >
        <span className="pst-st">
          <StatMark label={row.label} statKey={row.key} />
          {hasEcho ? (
            <Tooltip className="pst-name"
              content={(
                <StatTip
                  label={row.label}
                  tri={contrib}
                  ready={{ cur: true, b1: evaluationReady.b100, b2: evaluationReady.b200 }}
                  showDamageShare={evaluationReady.current}
                />
              )}
              placement="bottom"
            >
              <span className="pst-name-txt">{row.label}</span>
            </Tooltip>
          ) : (
            <span className="pst-name-txt">{row.label}</span>
          )}
          {hasScopes ? <ScopeCount addends={scoped} /> : null}
        </span>

        <span className="pgd-v pst-num pst-base">{formatStatKeyValue(row.key, displayBase)}</span>
        <span className={`pgd-v pst-num pst-gain${flat ? ' is-nil' : ''}`}>
          {flat ? '–' : signedStatValue(row.key, displayBonus)}
        </span>
        <span className="pgd-v pst-num pst-total">{formatStatKeyValue(row.key, row.total)}</span>
        {evaluationReady.b100 ? (
          <span className={`pgd-v pst-num pst-b100${same100 ? ' is-same' : ''}`}>
            {b100 ? formatStatKeyValue(row.key, b100.total) : '–'}
            {b100 && !near(b100.total, displayBase) ? (
              <sup className="pst-add">{signedStatValue(row.key, b100.total - displayBase)}</sup>
            ) : null}
          </span>
        ) : null}
        {evaluationReady.b200 ? (
          <span className={`pgd-v pst-num pst-b200${same200 ? ' is-same' : ''}`}>
            {b200 ? formatStatKeyValue(row.key, b200.total) : '–'}
            {b200 && !near(b200.total, displayBase) ? (
              <sup className="pst-add">{signedStatValue(row.key, b200.total - displayBase)}</sup>
            ) : null}
          </span>
        ) : null}
        <span className={hasScopes ? 'pgd-car' : 'pgd-car is-off'} aria-hidden="true" />
      </button>
    </div>
    {hasScopes ? <ScopeDrawer addends={scoped} open={open} /> : null}
    </>
  )
}

interface SourceLine {
  id: string
  label: string
  kind: StatSourceTerm['kind']
  key: string
  value: number
  terms?: Array<{ label: string; value: string }>
}

function effectSourceLines(groups: StateGroup[]): SourceLine[] {
  return groups.flatMap((group) => group.scopes.flatMap((scope) => scope.nodes.flatMap((node) => (
    node.statTerms ?? []
  ).map((term, index) => ({
    id: `${group.id}:${scope.id}:${node.id}:${index}`,
    label: group.sourceName === node.ownerLabel
      ? node.ownerLabel
      : `${group.sourceName} · ${node.ownerLabel}`,
    ...term,
  })))))
}

function echoContributionLines(rows: EvaluationStatContribution[], statKey: string): SourceLine[] {
  const contribution = contribFor(rows, statKey)
  return [contribution.flat, contribution.pct].flatMap((entry) => {
    if (!entry?.total) return []
    const terms = [
      entry.mainTotal
        ? { label: 'Mains', value: formatStatKeyValue(entry.key, entry.mainTotal) }
        : null,
      entry.substatTotal
        ? { label: 'Subs', value: formatStatKeyValue(entry.key, entry.substatTotal) }
        : null,
    ].filter((term): term is { label: string; value: string } => term !== null)

    return [{
      id: `echo:${entry.key}`,
      label: 'Echoes',
      kind: entry.key.endsWith('Percent') ? 'percent' as const : 'add' as const,
      key: entry.key,
      value: entry.total,
      terms,
    }]
  })
}

function manualSourceLines(runtime: ResRuntime, statKey: string): SourceLine[] {
  const { quick, modifiers } = runtime.state.manualBuffs
  const lines: SourceLine[] = []
  const push = (label: string, kind: SourceLine['kind'], key: string, value: number, id: string) => {
    if (value) lines.push({ id, label, kind, key, value })
  }

  if (statKey === 'atk' || statKey === 'hp' || statKey === 'def') {
    push('Manual quick buff', 'percent', `${statKey}Percent`, quick[statKey].percent, `quick:${statKey}:percent`)
    push('Manual quick buff', 'add', `${statKey}Flat`, quick[statKey].flat, `quick:${statKey}:flat`)
  } else if (statKey === 'critRate' || statKey === 'critDmg' || statKey === 'energyRegen' || statKey === 'healingBonus') {
    push('Manual quick buff', 'add', statKey, quick[statKey], `quick:${statKey}`)
  }

  for (const modifier of modifiers) {
    if (!modifier.enabled || !Number.isFinite(modifier.value) || modifier.value === 0) continue
    const label = modifier.label?.trim() || 'Manual modifier'
    if (modifier.scope === 'baseStat' && modifier.stat === statKey) {
      push(label, modifier.field === 'percent' ? 'percent' : 'add', `${statKey}${modifier.field === 'percent' ? 'Percent' : 'Flat'}`, modifier.value, modifier.id)
    } else if (modifier.scope === 'topStat' && modifier.stat === statKey) {
      push(label, 'add', statKey, modifier.value, modifier.id)
    } else if (modifier.scope === 'attribute' && modifier.mod === 'dmgBonus' && (modifier.attribute === 'all' || modifier.attribute === statKey)) {
      push(label, 'add', statKey, modifier.value, modifier.id)
    } else if (modifier.scope === 'skillType' && modifier.mod === 'dmgBonus' && (modifier.skillType === 'all' || modifier.skillType === statKey)) {
      push(label, 'add', statKey, modifier.value, modifier.id)
    }
  }

  return lines
}

function staticSourceLines(runtime: ResRuntime, statKey: string): SourceLine[] {
  const seed = getResSeedBy(runtime.id)
  if (!seed) return []
  const base = resResBaseSt(seed, runtime.base.level)
  const trace = runtime.base.traceNodes
  const weapon = isNoWeaponId(runtime.build.weapon.id) ? null : getWpnById(runtime.build.weapon.id)
  const weaponLevel = runtime.build.weapon.level
  const weaponSecondary = weapon
    ? weapon.statsByLevel[weaponLevel]?.secondaryStatValue ?? weapon.statValue
    : 0
  const lines: SourceLine[] = []
  const push = (label: string, kind: SourceLine['kind'], key: string, value: number, id: string) => {
    if (value) lines.push({ id, label, kind, key, value })
  }

  if (statKey === 'atk' || statKey === 'hp' || statKey === 'def') {
    push(`${seed.name} base ${statKey.toUpperCase()}`, 'add', `${statKey}Flat`, base[statKey], `base:${statKey}`)
    if (statKey === 'atk' && weapon) {
      push(`${weapon.name} base ATK`, 'add', 'atkFlat', wpnAtkAt(weapon.id, weaponLevel), 'weapon:base')
    }
    push(`${statKey.toUpperCase()} trace nodes`, 'percent', `${statKey}Percent`, trace[statKey].percent, `trace:${statKey}:percent`)
    push(`${statKey.toUpperCase()} trace nodes`, 'add', `${statKey}Flat`, trace[statKey].flat, `trace:${statKey}:flat`)
    if (weapon?.statKey === `${statKey}Percent`) {
      push(`${weapon.name} secondary`, 'percent', weapon.statKey, weaponSecondary, 'weapon:secondary')
    } else if (weapon?.statKey === `${statKey}Flat`) {
      push(`${weapon.name} secondary`, 'add', weapon.statKey, weaponSecondary, 'weapon:secondary')
    }
  } else {
    const baseKey = statKey as keyof typeof base
    if (typeof base[baseKey] === 'number') {
      push(`${seed.name} base`, 'add', statKey, base[baseKey], `base:${statKey}`)
    }
    const traceValue = statKey === 'critRate' || statKey === 'critDmg' || statKey === 'healingBonus'
      ? trace[statKey]
      : (statKey in trace.attribute ? trace.attribute[statKey as keyof typeof trace.attribute].dmgBonus : 0)
    push(`${formatStatKeyLabel(statKey)} trace nodes`, 'add', statKey, traceValue, `trace:${statKey}`)
    if (weapon?.statKey === statKey) {
      push(`${weapon.name} secondary`, 'add', statKey, weaponSecondary, 'weapon:secondary')
    }
  }

  return [...lines, ...manualSourceLines(runtime, statKey)]
}

function actualBaseFor(runtime: ResRuntime, statKey: string): number {
  return staticSourceLines(runtime, statKey)
    .filter((line) => line.id.startsWith('base:') || line.id === 'weapon:base')
    .reduce((total, line) => total + line.value, 0)
}

function StatSourceRow({ line, operator = '+' }: { line: SourceLine; operator?: string }) {
  const signedOperator = operator === '+' && line.value < 0 ? '−' : operator
  const displayValue = operator === '+' || signedOperator === '−' ? Math.abs(line.value) : line.value
  return (
    <div className="pgd-ws-r">
      <span className="pgd-ws-op">{signedOperator}</span>
      <span className="pgd-ws-lb">{line.label}</span>
      <span className="pgd-ws-vl">{formatStatKeyValue(line.key, displayValue)}</span>
      {line.terms?.length ? (
        <span className="pgd-ws-terms">
          {line.terms.map((term) => (
            <span key={term.label}><b>{term.label}</b> {term.value}</span>
          ))}
        </span>
      ) : null}
    </div>
  )
}

function StatWorksheet({
  row,
  statRows,
  stateGroups,
  runtime,
  footer,
}: {
  row: EvaluationOverviewStatRow
  statRows: EvaluationStatContribution[]
  stateGroups: StateGroup[]
  runtime: ResRuntime
  footer?: ReactNode
}) {
  const lines = [
    ...staticSourceLines(runtime, row.key),
    ...effectSourceLines(stateGroups),
    ...echoContributionLines(statRows, row.key),
  ]
  const baseLines = lines.filter((line) => line.id.startsWith('base:') || line.id === 'weapon:base')
  const percentLines = lines.filter((line) => line.kind === 'percent')
  const addLines = lines.filter((line) => line.kind === 'add' && !baseLines.includes(line))
  const setLines = lines.filter((line) => line.kind === 'set')
  const percentTotal = percentLines.reduce((total, line) => total + line.value, 0)
  const baseTotal = baseLines.reduce((total, line) => total + line.value, 0)

  return (
    <aside className="pgd-aside rte-scope"
      style={{ '--el': row.color ?? 'var(--text)' } as CssVars}
    >
      <div className="pgd-card">
        <header className="pgd-card-head pst-card-head">
          <span className="pgd-card-eyebrow">
            <StatMark label={row.label} statKey={row.key} />
            Stat breakdown
          </span>
          <b className="pgd-card-name">{row.label}</b>
          <span className="pgd-card-grp">Current build</span>
        </header>

        <div className="pgd-trip">
          <div>
            <span>BASE</span>
            <b>{formatStatKeyValue(row.key, baseTotal)}</b>
          </div>
          <div className="pst-trip-gain">
            <span>GAIN</span>
            <b>{signedStatValue(row.key, row.total - baseTotal)}</b>
          </div>
          <div className="is-hot">
            <span>TOTAL</span>
            <b>{formatStatKeyValue(row.key, row.total)}</b>
          </div>
        </div>

        <div className="pgd-ws">
          <div className="pgd-ws-band">Base</div>
          {baseLines.length > 0 ? baseLines.map((line, index) => (
            <StatSourceRow key={line.id} line={line} operator={index === 0 ? '=' : '+'} />
          )) : (
            <StatSourceRow
              line={{ id: 'base', label: `${formatStatKeyLabel(row.key)} base`, kind: 'add', key: row.key, value: 0 }}
              operator="="
            />
          )}

          {percentLines.length > 0 ? (
            <>
              <div className="pgd-ws-band">Multiplier · 1 + bonuses</div>
              {percentLines.map((line) => <StatSourceRow key={line.id} line={line} />)}
              <div className="pgd-ws-r pst-factor">
                <span className="pgd-ws-op">×</span>
                <span className="pgd-ws-lb">Combined multiplier</span>
                <span className="pgd-ws-vl">×{(1 + percentTotal / 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}</span>
              </div>
            </>
          ) : null}

          {addLines.length > 0 ? (
            <>
              <div className="pgd-ws-band">Additions</div>
              {addLines.map((line) => <StatSourceRow key={line.id} line={line} />)}
            </>
          ) : null}

          {setLines.map((line) => <StatSourceRow key={line.id} line={line} operator="=" />)}

          <div className="pgd-ws-rule" />
          <div className="pgd-ws-r pgd-ws-total">
            <span className="pgd-ws-op" />
            <span className="pgd-ws-lb">{row.label}</span>
            <span className="pgd-ws-vl">{formatStatKeyValue(row.key, row.total)}</span>
          </div>
        </div>
      </div>
      {footer}
    </aside>
  )
}

/*
  The other half of the residue: a modifier with no row anywhere in the sheet.
  It reads in the sheet's own row shape so the same disclosure reaches it --
  without a row, "Heavy Attack DEF Ignore" has nothing to open under.

  The two anchor cells stay empty on purpose. EvaluationOverviewStats carries the
  same three groups the sheet does, so the search never states a DEF Ignore, and
  a number invented for those columns would be a lie rather than a gap.
*/
function ResidueStatRow({
  row,
  evaluationReady,
  open,
  onOpen,
}: {
  row: ResidueRow
  evaluationReady: { current: boolean; b100: boolean; b200: boolean }
  open: boolean
  onOpen: () => void
}) {
  const hasScopes = row.scoped.length > 0
  const dormant = row.value === 0 && !hasScopes
  const reading = row.displayValue ?? '\u2013'
  const classes = [
    'pgd-row pst-row pst-res-row',
    dormant ? 'is-flat' : '',
    hasScopes ? '' : 'is-inert',
  ].filter(Boolean).join(' ')

  return (
    <>
    <div
      className={classes}
      data-row={`residue:${row.key}`}
      data-open={hasScopes && open ? 'true' : 'false'}
      style={{ '--el': 'var(--text)' } as CssVars}
    >
      <span className="pgd-pick" aria-hidden="true" />

      <button
        type="button" className="pgd-face pst-face"
        aria-expanded={hasScopes ? open : undefined}
        disabled={!hasScopes}
        onClick={onOpen}
      >
        <span className="pst-st">
          <span className="pst-name-txt">{row.label}</span>
          {/* one mark, not two: a modifier with no unconditional value is
              entirely scoped, so the count would be saying it again. The name
              column is narrow and the pills would eat the label. */}
          {row.displayValue === null ? (
            <i className="pst-only" title={`Only where a scope reaches it · ${row.scoped.length} scope${row.scoped.length > 1 ? 's' : ''}`}>
              scoped only
            </i>
          ) : hasScopes ? (
            <ScopeCount addends={row.scoped} />
          ) : null}
        </span>

        <span className="pgd-v pst-num pst-base">{reading}</span>
        <span className="pgd-v pst-num pst-gain is-nil">&ndash;</span>
        <span className="pgd-v pst-num pst-total">{reading}</span>
        {evaluationReady.b100 ? (
          <span className="pgd-v pst-num pst-b100 pst-unstated" title="The evaluation anchors do not state this stat">
            &middot;
          </span>
        ) : null}
        {evaluationReady.b200 ? (
          <span className="pgd-v pst-num pst-b200 pst-unstated" title="The evaluation anchors do not state this stat">
            &middot;
          </span>
        ) : null}
        <span className={hasScopes ? 'pgd-car' : 'pgd-car is-off'} aria-hidden="true" />
      </button>
    </div>
    {hasScopes ? <ScopeDrawer addends={row.scoped} open={open} /> : null}
    </>
  )
}

function ResidueGroup({
  rows,
  scopedCount,
  shut,
  onShut,
  opened,
  onOpen,
  evaluationReady,
}: {
  rows: ResidueRow[]
  scopedCount: number
  shut: boolean
  onShut: () => void
  opened: Record<string, boolean>
  onOpen: (key: string) => void
  evaluationReady: { current: boolean; b100: boolean; b200: boolean }
}) {
  const live = rows.filter((row) => row.value !== 0 || row.scoped.length > 0).length

  return (
    <section className="pgd-grp pst-grp" data-shut={shut ? 'true' : 'false'} style={{ '--el': 'var(--text)' } as CssVars}>
      <header className="pgd-ghead">
        <button
          type="button" className="pgd-gwell"
          aria-expanded={!shut}
          title={shut ? 'Show other modifiers' : 'Hide other modifiers'}
          onClick={onShut}
        >
          <i style={{ '--g': ASTERISK_GLYPH } as CssVars} />
        </button>
        <span className="pgd-gname"><b>Other modifiers</b></span>
        {shut ? (
          <span className="pgd-gcount pst-gcount">
            <u>{live} live</u> &middot; {scopedCount} scoped
          </span>
        ) : (
          <>
            <span className="pgd-gkey pst-gkey">Base</span>
            <span className="pgd-gkey pst-gkey">Gain</span>
            <span className="pgd-gkey pst-gkey is-total">Total</span>
            {evaluationReady.b100 ? <span className="pgd-gkey pst-gkey is-b100">100%</span> : null}
            {evaluationReady.b200 ? <span className="pgd-gkey pst-gkey is-b200">200%</span> : null}
          </>
        )}
      </header>

      <Expandable as="div" className="pgd-gbody" contentOnly open={!shut} innerClass="pgd-gbody-in">
        {rows.map((row) => (
          <ResidueStatRow
            key={row.key}
            row={row}
            evaluationReady={evaluationReady}
            open={Boolean(opened[`residue:${row.key}`])}
            onOpen={() => onOpen(`residue:${row.key}`)}
          />
        ))}
      </Expandable>
    </section>
  )
}

function SonataPlan({ sets }: { sets: BuiltOnFrame['sets'] }) {
  if (sets.length === 0) return <span className="pst-bo-none">&ndash;</span>

  return (
    <span className="pst-son">
      {sets.map((set, index) => (
        <Fragment key={`${set.setId}:${index}`}>
          {index > 0 ? <i className="pst-son-plus" aria-hidden="true">+</i> : null}
          <span
            className={set.pieces === 1 ? 'pst-son-pc is-lone' : 'pst-son-pc'}
            title={`${set.name} · ${set.pieces}pc`}
          >
            {set.icon ? <img src={set.icon} alt="" loading="lazy" onError={withDefIconM} /> : <s />}
            <b>{set.pieces}</b>
          </span>
        </Fragment>
      ))}
    </span>
  )
}

function BuiltOnRow({ frame }: { frame: BuiltOnFrame }) {
  return (
    <div className="pst-bo-row">
      <span className={`pst-bo-key is-${frame.key}`}>{frame.label}</span>
      <span className="pst-bo-body">
        <span className="pst-bo-line">
          <SonataPlan sets={frame.sets} />
          <span className="pst-bo-cost" title={`Cost ${frame.cost} of ${ECHO_COST_MAX}`}>
            {frame.cost}/{ECHO_COST_MAX}
          </span>
        </span>
        <span className="pst-bo-line">
          {frame.main ? (
            <span className="pst-bo-echo" title={`${frame.main.name} · ${frame.main.cost} cost`}>
              <figure>
                {frame.main.icon
                  ? <img src={frame.main.icon} alt="" loading="lazy" onError={withDefIconM} />
                  : <s />}
              </figure>
              <span className="pst-bo-nm">{frame.main.name}</span>
              <span className="pst-bo-c">{frame.main.cost}C</span>
            </span>
          ) : (
            <span className="pst-bo-none">No main Echo</span>
          )}
        </span>
      </span>
    </div>
  )
}

function BuiltOn({ frames }: { frames: BuiltOnFrame[] }) {
  if (frames.length === 0) return null

  return (
    <div className="pgd-card pst-bo">
      <header className="pgd-card-head pst-card-head">
        <span className="pgd-card-eyebrow">Echoes</span>
      </header>
      {frames.map((frame) => <BuiltOnRow key={frame.key} frame={frame} />)}
    </div>
  )
}

function StatGroup({
  group,
  shut,
  onShut,
  picked,
  onPick,
  by100,
  by200,
  statRows,
  evaluationReady,
  actualBaseByKey,
  scopedByStat,
  opened,
  onOpen,
}: {
  group: SheetGroup
  shut: boolean
  onShut: () => void
  picked: string | null
  onPick: (key: string) => void
  by100: Map<string, EvaluationOverviewStatRow>
  by200: Map<string, EvaluationOverviewStatRow>
  statRows: TriRows
  evaluationReady: { current: boolean; b100: boolean; b200: boolean }
  actualBaseByKey: Map<string, number>
  scopedByStat: Map<string, ScopedAddend[]>
  opened: Record<string, boolean>
  onOpen: (key: string) => void
}) {
  const moved = group.rows.filter((row) => !near(row.total, actualBaseByKey.get(row.key) ?? row.base)).length
  /* a shut group still reports: the count stands where the column names were */
  const differs = group.rows.filter((row) => {
    const a = by100.get(row.key)
    const b = by200.get(row.key)
    return (a && !near(a.total, row.total)) || (b && !near(b.total, row.total))
  }).length
  const bodyId = `pst-${group.id}`

  return (
    <section className="pgd-grp pst-grp"
      data-shut={shut ? 'true' : 'false'}
      style={{ '--el': 'var(--text)' } as CssVars}
    >
      <header className="pgd-ghead">
        <button
          type="button" className="pgd-gwell"
          aria-expanded={!shut}
          aria-controls={bodyId}
          title={shut ? `Show ${group.label}` : `Hide ${group.label}`}
          onClick={onShut}
        >
          <span className="pgd-gwell-lbl">{shut ? `Show ${group.label}` : `Hide ${group.label}`}</span>
          {group.glyph ? <i style={{ '--g': `url(${group.glyph})` } as CssVars} /> : null}
        </button>
        <span className="pgd-gname"><b>{group.label}</b></span>
        {shut ? (
          <span className="pgd-gcount pst-gcount">
            <u>{moved} moved</u> &middot; {differs} differ
          </span>
        ) : (
          <>
            <span className="pgd-gkey pst-gkey">Base</span>
            <span className="pgd-gkey pst-gkey">Gain</span>
            <span className="pgd-gkey pst-gkey is-total">Total</span>
            {evaluationReady.b100 ? (
              <span className="pgd-gkey pst-gkey is-b100">100%</span>
            ) : null}
            {evaluationReady.b200 ? (
              <span className="pgd-gkey pst-gkey is-b200">200%</span>
            ) : null}
          </>
        )}
      </header>

      <Expandable
        as="div" className="pgd-gbody"
        id={bodyId}
        contentOnly
        open={!shut}
        innerClass="pgd-gbody-in"
      >
        {group.rows.map((row) => (
          <StatRow
            key={row.key}
            row={row}
            displayBase={actualBaseByKey.get(row.key) ?? row.base}
            b100={by100.get(row.key)}
            b200={by200.get(row.key)}
            contrib={{
              cur: contribFor(statRows.cur, row.key),
              b1: contribFor(statRows.b1, row.key),
              b2: contribFor(statRows.b2, row.key),
            }}
            evaluationReady={evaluationReady}
            picked={picked === row.key}
            onPick={() => onPick(row.key)}
            scoped={scopedByStat.get(row.key) ?? EMPTY_SCOPES}
            open={Boolean(opened[row.key])}
            onOpen={() => onOpen(row.key)}
          />
        ))}
      </Expandable>
    </section>
  )
}

export function ModulationStats({
  active,
  evaluationActive,
  referenceBuild,
  maximumBuild,
  stateGroupsForStat,
  runtime,
  statsTree,
}: {
  active: EvaluationOverviewStats | null
  evaluationActive: EvaluationBuildSnapshot | null
  referenceBuild: EvaluationBuildSnapshot | null
  maximumBuild: EvaluationBuildSnapshot | null
  stateGroupsForStat: (statKey: string) => StateGroup[]
  runtime: ResRuntime
  statsTree: StatTreeNode[]
}) {
  const [shut, setShut] = useState<Record<string, boolean>>({})
  const [picked, setPicked] = useState<string | null>(null)
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const toggleOpen = (key: string) => setOpened((prev) => ({ ...prev, [key]: !prev[key] }))

  /* what the tree holds and the sheet never prints, split by what it is */
  const residue = useMemo(() => makeStatResidue(statsTree), [statsTree])

  const builtOn = useMemo(() => [
    makeBuiltOnFrame('active', 'Yours', evaluationActive),
    makeBuiltOnFrame('b100', '100%', referenceBuild),
    makeBuiltOnFrame('b200', '200%', maximumBuild),
  ].filter((frame): frame is BuiltOnFrame => frame !== null), [evaluationActive, maximumBuild, referenceBuild])

  const groups = useMemo<SheetGroup[]>(() => {
    if (!active) return []
    const { mainStats, secondaryStats, dmgMdfrStts } = active
    return [
      { id: 'main', label: 'Main stats', glyph: STAT_ICON_MAP.ATK, rows: mainStats },
      { id: 'secondary', label: 'Secondary', glyph: STAT_ICON_MAP['Crit Rate'], rows: secondaryStats },
      { id: 'modifiers', label: 'Damage modifiers', glyph: STAT_ICON_MAP['Basic Attack DMG Bonus'], rows: dmgMdfrStts },
    ].filter((group) => group.rows.length > 0)
  }, [active])

  const indexOf = (build: EvaluationBuildSnapshot | null) => {
    const map = new Map<string, EvaluationOverviewStatRow>()
    if (!build) return map
    const { mainStats, secondaryStats, dmgMdfrStts } = build.overviewStats
    for (const row of [...mainStats, ...secondaryStats, ...dmgMdfrStts]) {
      map.set(row.key, row)
    }
    return map
  }

  const by100 = useMemo(() => indexOf(referenceBuild), [referenceBuild])
  const by200 = useMemo(() => indexOf(maximumBuild), [maximumBuild])

  const currentStatRows = useMemo(() => makeCurrentStatRows(runtime), [runtime])
  const triRows = useMemo<TriRows>(() => {
    const evaluationByKey = new Map(
      (evaluationActive?.statRows ?? []).map((row) => [row.key, row]),
    )
    return {
      cur: currentStatRows.map((row) => {
        const metric = evaluationByKey.get(row.key)
        return metric ? { ...row, damage: metric.damage, sharePct: metric.sharePct } : row
      }),
      b1: referenceBuild?.statRows ?? [],
      b2: maximumBuild?.statRows ?? [],
    }
  }, [currentStatRows, evaluationActive, maximumBuild, referenceBuild])
  const evaluationReady = useMemo(() => ({
    current: evaluationActive !== null,
    b100: referenceBuild !== null,
    b200: maximumBuild !== null,
  }), [evaluationActive, maximumBuild, referenceBuild])

  const allRows = useMemo(() => groups.flatMap((group) => group.rows), [groups])
  const actualBaseByKey = useMemo(() => new Map(
    allRows.map((row) => [row.key, actualBaseFor(runtime, row.key)]),
  ), [allRows, runtime])
  /* the card opens on whatever earns the most, so the view says something
     before it is asked anything */
  const pickedRow = useMemo(() => {
    if (picked) return allRows.find((row) => row.key === picked) ?? null
    const best = [...triRows.cur].sort((a, b) => b.damage - a.damage)[0]
    const byDamage = best
      ? allRows.find((row) => row.key === best.key || `${row.key}Percent` === best.key)
      : null
    return byDamage ?? allRows[0] ?? null
  }, [picked, allRows, triRows.cur])
  const at = pickedRow?.key ?? null
  const pickedStateGroups = useMemo(
    () => pickedRow ? stateGroupsForStat(pickedRow.key) : [],
    [pickedRow, stateGroupsForStat],
  )

  const bay = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const pip = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const wrap = bay.current
    const mark = pip.current
    const rows = list.current
    if (!wrap || !mark || !rows) return

    const place = () => {
      const row = at ? wrap.querySelector<HTMLElement>(`[data-row="${CSS.escape(at)}"]`) : null
      if (!row) {
        mark.classList.remove('is-on')
        return
      }

      const wrapBox = wrap.getBoundingClientRect()
      const rowBox = row.getBoundingClientRect()
      const card = wrap.querySelector<HTMLElement>('.pgd-aside')
      const channel = card
        ? (rows.getBoundingClientRect().right + card.getBoundingClientRect().left) / 2
        : rows.getBoundingClientRect().right

      mark.style.setProperty('--pgd-pip-top', `${Math.round(rowBox.top + rowBox.height / 2 - wrapBox.top)}px`)
      mark.style.setProperty('--pgd-pip-x', `${Math.round(channel - wrapBox.left)}px`)
      mark.style.setProperty('--pgd-pip-e', getComputedStyle(row).getPropertyValue('--pgd-ink'))
      mark.classList.add('is-on')
    }

    place()
    const watch = new ResizeObserver(place)
    watch.observe(rows)
    return () => watch.disconnect()
  }, [at, groups, shut])

  if (!active || groups.length === 0) {
    return <p className="pgs-empty">No stats are available for this build yet.</p>
  }

  return (
    <div className="pgd pst"
      ref={bay}
      data-evaluation-columns={Number(evaluationReady.b100) + Number(evaluationReady.b200)}
      style={{ '--pst-b100': TONE_100, '--pst-b200': TONE_200 } as CssVars}
    >
      <i className="pgd-pip" ref={pip} aria-hidden="true" />
      <div className="pgd-list" ref={list}>
        {groups.map((group) => (
          <StatGroup
            key={group.id}
            group={group}
            shut={Boolean(shut[group.id])}
            onShut={() => setShut((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
            picked={pickedRow?.key ?? null}
            onPick={setPicked}
            by100={by100}
            by200={by200}
            statRows={triRows}
            evaluationReady={evaluationReady}
            actualBaseByKey={actualBaseByKey}
            scopedByStat={residue.scopedByStat}
            opened={opened}
            onOpen={toggleOpen}
          />
        ))}

        {residue.rows.length > 0 ? (
          <ResidueGroup
            rows={residue.rows}
            scopedCount={residue.scopedCount}
            shut={shut.residue !== false}
            onShut={() => setShut((prev) => ({ ...prev, residue: prev.residue === false }))}
            opened={opened}
            onOpen={toggleOpen}
            evaluationReady={evaluationReady}
          />
        ) : null}
      </div>

      {pickedRow ? (
        <StatWorksheet
          row={pickedRow}
          statRows={triRows.cur}
          stateGroups={pickedStateGroups}
          runtime={runtime}
          footer={<BuiltOn frames={builtOn} />}
        />
      ) : null}
    </div>
  )
}
