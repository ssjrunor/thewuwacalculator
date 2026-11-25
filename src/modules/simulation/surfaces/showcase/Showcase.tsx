/*
  Author: Runor Ewhro
  description: renders the evaluation showcase build card, including stat
               ladders, echo scoring, sonata badges, and relevant-stat emphasis.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import { memo, useMemo, type KeyboardEvent } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import type { StatsColumnHighlight } from '@/domain/entities/preferences'
import { useAppStore } from '@/application/state'
import { groupUid } from '@/modules/simulation/features/echoes/lib/playerIdentity.ts'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { getSbstStepP } from '@/data/gameData/catalog/echoStats.ts'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets'
import { getWeightObj } from '@/data/scoring/charStatWeights'
import { cmptEchoCrit, cmptEchoCritAll, cmptBldCritGr, getCvToneColor, getScrTone } from '@/modules/simulation/features/echoes/lib/metric.ts'
import { useEchoScores } from '@/application/hooks/useEchoScoringRevision.ts'
import {
  formatCompactNum,
  formatStatKeyLabel,
  formatStatKeyValue,
} from '@/modules/simulation/model/statsView.ts'
import type { StatViewRow, StatsView } from '@/modules/simulation/model/statsView.ts'
import { buildTotalsByKey, showcaseSecondaryRows } from './lib/showcaseStats.ts'
import { formatBuildEvaluationScore } from '@/modules/simulation/model/buildEvaluationDisplay.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'
import { StatGlyph, statFamily, type EvaluationEchoSelection, type CssVars } from '@/modules/simulation/workspace/ui.tsx'

interface ShowcaseSonataEntry {
  setId: number
  pieces: number
  icon: string | null
  name: string
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value))
}

/** shared holder identity for both showcase layouts. */
export function ShowcaseHolder({ fallback }: { fallback: string }) {
  const playerId = useAppStore((state) => state.ui.preferences.playerId)
  const playerUid = useAppStore((state) => state.ui.preferences.playerUid)
  if (!playerId && !playerUid) {
    return <span className="sc-eyebrow">{fallback}</span>
  }
  return (
    <span className="sc-holder">
      {playerId ? <b>{playerId}</b> : null}
      {playerUid ? <span>{groupUid(playerUid)}</span> : null}
    </span>
  )
}

export interface RelStats {
  keys: Set<string>
  fams: Set<string>
}

export function makeRelStats(charId: string): RelStats {
  const rel: RelStats = { keys: new Set(), fams: new Set() }
  for (const [key, weight] of Object.entries(getWeightObj(charId))) {
    if (weight <= 0) continue
    rel.keys.add(key)
    rel.fams.add(statFamily(key))
  }
  return rel
}

// separate legal roll-step position from normalized quality tone.
function substatGauge(key: string, value: number): { steps: number; filled: number; tone: string } | null {
  const options = getSbstStepP(key)
  if (options.length < 2) return null
  let filled = 1
  let nearest = Math.abs(options[0] - value)
  for (let index = 1; index < options.length; index += 1) {
    const diff = Math.abs(options[index] - value)
    if (diff < nearest) {
      nearest = diff
      filled = index + 1
    }
  }
  const min = options[0]
  const max = options[options.length - 1]
  const pct = max > min ? clampPct(((value - min) / (max - min)) * 100) : 0
  return { steps: options.length, filled, tone: getScrTone(pct) }
}

export function ShowcaseStatRow({
  row,
  buildTotal,
  blank,
  relevant,
  raised,
}: {
  row: StatViewRow
  buildTotal: number | null
  blank?: boolean
  relevant: boolean
  /** whether combat state raised this value above its build value. */
  raised?: boolean
}) {
  const statKey = row.key
  return (
    <div className="sc-row"
      data-stat-family={statKey ? statFamily(statKey) : undefined}
      data-relevant={relevant ? 'true' : undefined}
    >
      <span className="sc-row-icon">
        {statKey ? <StatGlyph statKey={statKey} size={1.2} /> : null}
      </span>
      <span className="sc-row-label">{row.label}</span>
      <span className="sc-row-lead" aria-hidden="true" />
      <span className="sc-row-build">
        {blank || buildTotal == null ? '-' : formatStatKeyValue(row.key, buildTotal)}
      </span>
      <span className="sc-row-combat">
        {raised && !blank ? <i className="sc-row-up" aria-hidden="true" /> : null}
        {blank ? '-' : formatStatKeyValue(row.key, row.total)}
      </span>
    </div>
  )
}

function ShowcaseEcho({
  echo,
  index,
  score,
  hideScore,
  hideCv,
  hideSubVal,
  hideSubColor,
  hideRelStats,
  relStats,
  selection,
  onOpen,
}: {
  echo: EchoInstance | null
  index: number
  score: number | null
  hideScore: boolean
  hideCv: boolean
  hideSubVal: boolean
  hideSubColor: boolean
  hideRelStats: boolean
  relStats: RelStats
  selection?: EvaluationEchoSelection
  onOpen?: () => void
}) {
  const openProps = onOpen ? {
    role: 'button',
    tabIndex: 0,
    onClick: () => {
      if (!selection?.selectionMode) onOpen()
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (selection?.selectionMode) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.click()
    },
  } : undefined

  if (!echo) {
    return (
      <article
        className="sc-echo sc-echo--empty"
        style={{ '--i': index } as CssVars}
        aria-label={onOpen ? `Slot ${index}, empty. Choose an Echo` : undefined}
        {...openProps}
      >
        <span className="sc-echo-vacant">0{index}</span>
        <span className="sc-echo-vacant-label">Empty slot</span>
      </article>
    )
  }

  const echoDef = getEchoById(echo.id)
  const setIcon = getSntSetIco(echo.set)
  const primary = echo.mainStats.primary
  const cv = cmptEchoCrit(echo.substats)
  const tone = score != null ? getScrTone(score) : null
  const slotIndex = index - 1
  const itemId = selection?.getId(slotIndex) ?? null
  const selected = itemId ? selection?.isSelected(itemId) ?? false : false
  const showRel = !hideRelStats

  const card = (
    <article
      className={[
        'sc-echo',
        echo.mainEcho ? 'sc-echo--lead' : '',
        selection?.selectionMode ? 'selection-mode' : '',
        selected ? 'focus-selected' : '',
      ].filter(Boolean).join(' ')}
      data-tone={!hideScore && tone ? tone : undefined}
      data-selection-focus-item="true"
      data-selected={selected ? 'true' : undefined}
      style={{ '--i': index } as CssVars}
      aria-label={onOpen ? `Slot ${index}. Edit ${echoDef?.name ?? 'Echo'}` : undefined}
      {...openProps}
      onClickCapture={itemId ? selection?.buildClickCapture(itemId) : undefined}
    >
      <span className="sc-echo-cost" aria-label={`${echoDef?.cost ?? 0} cost`}>{echoDef?.cost ?? 0}</span>
      <header className="sc-echo-head">
        <span className="sc-echo-frame">
          {echoDef?.icon ? (
            <DisplayImage src={echoDef.icon} alt="" className="sc-echo-icon" loading="lazy" decoding="async" onError={withDefIconM} />
          ) : (
            <span className="sc-echo-icon sc-echo-icon--fallback" />
          )}
          {setIcon ? <DisplayImage src={setIcon} alt="" className="sc-echo-set" loading="lazy" onError={withDefIconM} /> : null}
        </span>
        <span className="sc-echo-titles">
          <strong className="sc-echo-name">{echoDef?.name ?? 'Echo'}</strong>
          {echo.mainEcho || !hideCv ? (
            <span className="sc-echo-meta">
              {echo.mainEcho ? <span className="sc-echo-tag">main</span> : null}
              {!hideCv ? (
                <span className="sc-echo-cv" style={{ '--cv-tone': getCvToneColor(cv) } as CssVars}>
                  CV {formatTruncCompact(cv, 1)}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        {!hideScore && score != null ? (
          <span className="sc-echo-score">
            <b>{formatTruncCompact(score, 0)}</b>
            <i>%</i>
          </span>
        ) : null}
      </header>

      <ShowcaseEchoMains echo={echo} relevant={showRel && relStats.keys.has(primary.key)} />
      <ShowcaseEchoSubs
        echo={echo}
        relStats={relStats}
        showRel={showRel}
        hideSubVal={hideSubVal}
        hideSubColor={hideSubColor}
      />
    </article>
  )

  if (!selection || !itemId) {
    return card
  }

  return (
    <ContextTrigger
      asChild
      ariaLabel={`${echoDef?.name ?? 'Echo'} actions`}
      items={selection.getItems(itemId, echo)}
    >
      {card}
    </ContextTrigger>
  )
}
/** shared echo main-stat projection used by both showcase layouts. */
export function ShowcaseEchoMains({ echo, relevant }: { echo: EchoInstance; relevant: boolean }) {
  const primary = echo.mainStats.primary
  const secondary = echo.mainStats.secondary
  return (
    <div className="sc-echo-mains" data-relevant={relevant ? 'true' : undefined}>
      <div className="sc-echo-main" data-stat-family={statFamily(primary.key)}>
        <StatGlyph statKey={primary.key} size={0.82} />
        <span className="sc-echo-main-k">{formatStatKeyLabel(primary.key)}</span>
        <span className="sc-echo-main-v">{formatStatKeyValue(primary.key, primary.value)}</span>
      </div>
      {secondary?.key ? (
        <div className="sc-echo-main sc-echo-main--sec" data-stat-family={statFamily(secondary.key)}>
          <StatGlyph statKey={secondary.key} size={0.74} />
          <span className="sc-echo-main-k">{formatStatKeyLabel(secondary.key)}</span>
          <span className="sc-echo-main-v">{formatStatKeyValue(secondary.key, secondary.value)}</span>
        </div>
      ) : null}
    </div>
  )
}

/** shared echo substat projection keeps both showcase layouts aligned. */
export function ShowcaseEchoSubs({
  echo,
  relStats,
  showRel,
  hideSubVal,
  hideSubColor,
}: {
  echo: EchoInstance
  relStats: RelStats
  showRel: boolean
  hideSubVal: boolean
  hideSubColor: boolean
}) {
  const subs = Object.entries(echo.substats).filter(([, value]) => value > 0)
  return (
    <ul className="sc-echo-subs">
      {subs.map(([key, value]) => {
        const gauge = substatGauge(key, value)
        return (
          <li
            key={key} className="sc-echo-sub"
            data-stat-family={statFamily(key)}
            data-relevant={showRel && relStats.keys.has(key) ? 'true' : undefined}
          >
            <StatGlyph statKey={key} size={0.74} />
            <span className="sc-echo-sub-k">{formatStatKeyLabel(key)}</span>
            <span className="sc-echo-sub-v">{formatStatKeyValue(key, value)}</span>
            {gauge ? (
              <span className="sc-echo-sub-meter"
                data-hidden={hideSubVal ? 'true' : undefined}
                data-tone={!hideSubColor ? gauge.tone : undefined}
                aria-hidden={hideSubVal ? 'true' : undefined}
              >
                {Array.from({ length: gauge.steps }, (_, seg) => (
                  <span
                    key={seg}
                    className={`sc-echo-sub-seg${seg < gauge.filled ? ' is-filled' : ''}`}
                  />
                ))}
              </span>
            ) : null}
          </li>
        )
      })}
      {subs.length === 0 ? (
        <li className="sc-echo-sub sc-echo-sub--empty">No tuned substats</li>
      ) : null}
    </ul>
  )
}

// grade aggregate crit value against the canonical two-main-stat ceiling.
export function loadoutCv(slots: Array<EchoInstance | null>, blank?: boolean): { total: number; tone: string | undefined } {
  const total = slots.reduce((sum, echo) => sum + (echo ? cmptEchoCritAll(echo) : 0), 0)
  return { total, tone: !blank && total > 0 ? getCvToneColor(cmptBldCritGr(slots)) : undefined }
}

export const ShowcaseBuild = memo(function ShowcaseBuild({
  echoes,
  combatStatsView,
  buildStatsView,
  sonataSets,
  score,
  grade,
  tone,
  avgDamage,
  charId,
  hideScore,
  hideDamage,
  hideCv,
  hideSubVal,
  hideSubColor,
  hideRelStats,
  statsColumn,
  onEchoOpen,
  echoSelection,
  blank,
}: {
  echoes: Array<EchoInstance | null>
  combatStatsView: StatsView | null
  buildStatsView: StatsView | null
  sonataSets: ShowcaseSonataEntry[]
  score: number | null
  grade: string | null
  tone: string
  avgDamage: number | null
  charId: string
  hasWeights: boolean
  hideScore: boolean
  hideDamage: boolean
  hideCv: boolean
  hideSubVal: boolean
  hideSubColor: boolean
  hideRelStats: boolean
  statsColumn: StatsColumnHighlight
  onEchoOpen?: (slotIndex: number) => void
  echoSelection?: EvaluationEchoSelection
  blank?: boolean
}) {
  const slots = useMemo(() => Array.from({ length: 5 }, (_, slot) => echoes[slot] ?? null), [echoes])
  const fill = score != null ? Math.max(2, Math.min(100, score / 2)) : 0
  const { total: totalCv, tone: totalCvTone } = loadoutCv(slots, blank)
  const relStats = useMemo(() => makeRelStats(charId), [charId])
  const echoScores = useEchoScores(charId, slots)
  const showRel = !hideRelStats
  const buildByKey = buildTotalsByKey(buildStatsView)
  const secondaryRows = combatStatsView ? showcaseSecondaryRows(combatStatsView, buildStatsView) : []

  return (
    <>
      <section className="sc-stats" style={{ '--i': 0, '--grade': tone } as CssVars}>
        <header className="sc-verdict">
          <span className="sc-verdict-body">
            <ShowcaseHolder fallback="The Build" />
            {!hideScore ? (
              <>
                <span className="sc-verdict-figure">
                  <b className="sc-grade-mark">{grade || '-'}</b>
                  <span className="sc-grade-score">
                    {score != null ? formatBuildEvaluationScore(score) : '-'}
                  </span>
                </span>
                <span className="sc-ruler">
                  <i style={{ width: `${fill}%` }} />
                </span>
              </>
            ) : null}
          </span>
          {sonataSets.length > 0 ? (
            <ul className="sc-sonata">
              {sonataSets.map((set) => (
                <li key={set.setId} className="sc-sonata-set" title={`${set.name} · ${set.pieces}pc`}>
                  {set.icon ? (
                    <DisplayImage src={set.icon} alt="" className="sc-sonata-icon" loading="lazy" onError={withDefIconM} />
                  ) : (
                    <span className="sc-sonata-icon sc-sonata-icon--fallback" />
                  )}
                  <span className="sc-sonata-pc">{set.pieces}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </header>

        {!hideDamage || !hideCv ? (
          <div className="sc-metrics">
            {!hideDamage ? (
              <div className="sc-metric">
                <b className="sc-metric-v">{avgDamage != null ? formatCompactNum(avgDamage) : '-'}</b>
                <span className="sc-metric-k">Avg DMG</span>
              </div>
            ) : null}
            {!hideCv ? (
              <div className="sc-metric">
                <b className="sc-metric-v sc-metric-v--cv"
                  style={totalCvTone ? { '--cv-tone': totalCvTone } as CssVars : undefined}
                >
                  {blank ? '-' : formatTruncCompact(totalCv, 1)}
                </b>
                <span className="sc-metric-k">Crit Value</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {combatStatsView ? (
          <div className="sc-ladder" data-highlight={statsColumn}>
            <div className="sc-ladder-head" aria-hidden="true">
              <span className="sc-ladder-head-lead" />
              <span className="sc-ladder-col sc-ladder-col--build">Build</span>
              <span className="sc-ladder-col sc-ladder-col--combat">Combat</span>
            </div>
            <div className="sc-ladder-group" style={{ '--rows': combatStatsView.mainStats.length } as CssVars}>
              {combatStatsView.mainStats.map((row) => (
                <ShowcaseStatRow
                  key={row.key}
                  row={row}
                  buildTotal={buildByKey.get(row.key) ?? null}
                  blank={blank}
                  relevant={showRel && relStats.fams.has(statFamily(row.key))}
                />
              ))}
            </div>
            <div className="sc-ladder-group" style={{ '--rows': secondaryRows.length } as CssVars}>
              {secondaryRows.map((row) => (
                <ShowcaseStatRow
                  key={row.key}
                  row={row}
                  buildTotal={buildByKey.get(row.key) ?? null}
                  blank={blank}
                  relevant={showRel && relStats.fams.has(statFamily(row.key))}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="sc-ladder sc-ladder--empty">No stats</div>
        )}
      </section>

      {slots.map((echo, slot) => (
        <ShowcaseEcho
          key={echo?.uid ?? `empty:${slot}`}
          echo={echo}
          index={slot + 1}
          score={echoScores?.[slot] ?? null}
          hideScore={hideScore}
          hideSubVal={hideSubVal}
          hideSubColor={hideSubColor}
          hideCv={hideCv}
          hideRelStats={hideRelStats}
          relStats={relStats}
          onOpen={onEchoOpen ? () => onEchoOpen(slot) : undefined}
          selection={echoSelection}
        />
      ))}
    </>
  )
})
