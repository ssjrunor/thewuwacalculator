import { useMemo } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import type { StatsColumnHighlight } from '@/domain/entities/preferences'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getSbstStepP } from '@/data/gameData/catalog/echoStats.ts'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets'
import { getWeightObj } from '@/data/scoring/charStatWeights'
import { cmptEchoCrit, cmptEchoCritAll, getCvToneColor, getScrTone } from '@/modules/calculator/features/echoes/lib/metric.ts'
import { getEchoScrPr } from '@/data/scoring/echoScoring.ts'
import {
  formatCompactNum,
  formatStatValue,
  formatStatKeyLabel,
  formatStatKeyValue,
} from '@/modules/calculator/model/statsView.ts'
import type { StatViewRow, StatsView } from '@/modules/calculator/model/statsView.ts'
import { formatBuildBenchmarkScore } from '@/modules/calculator/model/buildBenchmarkDisplay.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { StatGlyph, statFamily, type BenchmarkEchoSelection, type CssVars } from './ui.tsx'

interface ShowcaseSonataEntry {
  setId: number
  pieces: number
  icon: string | null
  name: string
}

const SHOWCASE_STAT_KEY: Record<string, string> = {
  ATK: 'atk',
  HP: 'hp',
  DEF: 'def',
  'Energy Regen': 'energyRegen',
  'Crit Rate': 'critRate',
  'Crit DMG': 'critDmg',
  'Healing Bonus': 'healingBonus',
  'Tune Break Boost': 'tuneBreakBoost',
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value))
}

interface RelStats {
  keys: Set<string>
  fams: Set<string>
}

function makeRelStats(charId: string): RelStats {
  const rel: RelStats = { keys: new Set(), fams: new Set() }
  for (const [key, weight] of Object.entries(getWeightObj(charId))) {
    if (weight <= 0) continue
    rel.keys.add(key)
    rel.fams.add(statFamily(key))
  }
  return rel
}

// One gauge segment per legal step the substat can roll. The filled count still
// shows the snapped roll step, while tone comes from the stat's normalized value.
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

function ShowcaseStatRow({
  row,
  buildTotal,
  blank,
  relevant,
}: {
  row: StatViewRow
  buildTotal: number | null
  blank?: boolean
  relevant: boolean
}) {
  const statKey = SHOWCASE_STAT_KEY[row.label]
  return (
    <div
      className="showcase-row"
      data-stat-family={statKey ? statFamily(statKey) : undefined}
      data-relevant={relevant ? 'true' : undefined}
    >
      <span className="showcase-row-icon">
        {statKey ? <StatGlyph statKey={statKey} size={1.2} /> : null}
      </span>
      <span className="showcase-row-label">{row.label}</span>
      <span className="showcase-row-lead" aria-hidden="true" />
      <span className="showcase-row-build">
        {blank || buildTotal == null ? '-' : formatStatValue(row.label, buildTotal)}
      </span>
      <span className="showcase-row-combat">{blank ? '-' : formatStatValue(row.label, row.total)}</span>
    </div>
  )
}

function ShowcaseEcho({
  echo,
  index,
  charId,
  hasWeights,
  hideScore,
  hideCv,
  hideSubVal,
  hideSubColor,
  hideRelStats,
  relStats,
  selection,
}: {
  echo: EchoInstance | null
  index: number
  charId: string
  hasWeights: boolean
  hideScore: boolean
  hideCv: boolean
  hideSubVal: boolean
  hideSubColor: boolean
  hideRelStats: boolean
  relStats: RelStats
  selection?: BenchmarkEchoSelection
}) {
  if (!echo) {
    return (
      <article className="showcase-echo showcase-echo--empty" style={{ '--i': index } as CssVars}>
        <span className="showcase-echo-vacant">0{index}</span>
        <span className="showcase-echo-vacant-label">Empty slot</span>
      </article>
    )
  }

  const echoDef = getEchoById(echo.id)
  const setIcon = getSntSetIco(echo.set)
  const primary = echo.mainStats.primary
  const secondary = echo.mainStats.secondary
  const subs = Object.entries(echo.substats).filter(([, value]) => value > 0)
  const cv = cmptEchoCrit(echo.substats)
  const score = hasWeights ? getEchoScrPr(charId, echo) : null
  const tone = score != null ? getScrTone(score) : null
  const slotIndex = index - 1
  const itemId = selection?.getId(slotIndex) ?? null
  const selected = itemId ? selection?.isSelected(itemId) ?? false : false
  const showRel = !hideRelStats

  const card = (
    <article
      className={[
        'showcase-echo',
        echo.mainEcho ? 'showcase-echo--lead' : '',
        selection?.selectionMode ? 'selection-mode' : '',
        selected ? 'focus-selected' : '',
      ].filter(Boolean).join(' ')}
      data-tone={!hideScore && tone ? tone : undefined}
      data-selection-focus-item="true"
      data-selected={selected ? 'true' : undefined}
      style={{ '--i': index } as CssVars}
      onClickCapture={itemId ? selection?.buildClickCapture(itemId) : undefined}
    >
      <span className="showcase-echo-cost" aria-label={`${echoDef?.cost ?? 0} cost`}>{echoDef?.cost ?? 0}</span>
      <header className="showcase-echo-head">
        <span className="showcase-echo-frame">
          {echoDef?.icon ? (
            <img src={echoDef.icon} alt="" className="showcase-echo-icon" loading="lazy" decoding="async" onError={withDefIconM} />
          ) : (
            <span className="showcase-echo-icon showcase-echo-icon--fallback" />
          )}
          {setIcon ? <img src={setIcon} alt="" className="showcase-echo-set" loading="lazy" onError={withDefIconM} /> : null}
        </span>
        <span className="showcase-echo-titles">
          <strong className="showcase-echo-name">{echoDef?.name ?? 'Echo'}</strong>
          {echo.mainEcho || !hideCv ? (
            <span className="showcase-echo-meta">
              {echo.mainEcho ? <span className="showcase-echo-tag">main</span> : null}
              {!hideCv ? (
                <span className="showcase-echo-cv" style={{ '--cv-tone': getCvToneColor(cv) } as CssVars}>
                  CV {cv.toFixed(1)}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        {!hideScore && score != null ? (
          <span className="showcase-echo-score">
            <b>{Math.round(score)}</b>
            <i>%</i>
          </span>
        ) : null}
      </header>

      <div className="showcase-echo-mains" data-relevant={showRel && relStats.keys.has(primary.key) ? 'true' : undefined}>
        <div className="showcase-echo-main" data-stat-family={statFamily(primary.key)}>
          <StatGlyph statKey={primary.key} size={0.82} />
          <span className="showcase-echo-main-k">{formatStatKeyLabel(primary.key)}</span>
          <span className="showcase-echo-main-v">{formatStatKeyValue(primary.key, primary.value)}</span>
        </div>
        {secondary?.key ? (
          <div className="showcase-echo-main showcase-echo-main--sec" data-stat-family={statFamily(secondary.key)}>
            <StatGlyph statKey={secondary.key} size={0.74} />
            <span className="showcase-echo-main-k">{formatStatKeyLabel(secondary.key)}</span>
            <span className="showcase-echo-main-v">{formatStatKeyValue(secondary.key, secondary.value)}</span>
          </div>
        ) : null}
      </div>

      <ul className="showcase-echo-subs">
        {subs.map(([key, value]) => {
          const gauge = substatGauge(key, value)
          return (
            <li
              key={key}
              className="showcase-echo-sub"
              data-stat-family={statFamily(key)}
              data-relevant={showRel && relStats.keys.has(key) ? 'true' : undefined}
            >
              <StatGlyph statKey={key} size={0.74} />
              <span className="showcase-echo-sub-k">{formatStatKeyLabel(key)}</span>
              <span className="showcase-echo-sub-v">{formatStatKeyValue(key, value)}</span>
              {gauge ? (
                <span
                  className="showcase-echo-sub-meter"
                  data-hidden={hideSubVal ? 'true' : undefined}
                  data-tone={!hideSubColor ? gauge.tone : undefined}
                  aria-hidden={hideSubVal ? 'true' : undefined}
                >
                  {Array.from({ length: gauge.steps }, (_, seg) => (
                    <span
                      key={seg}
                      className={`showcase-echo-sub-seg${seg < gauge.filled ? ' is-filled' : ''}`}
                    />
                  ))}
                </span>
              ) : null}
            </li>
          )
        })}
        {subs.length === 0 ? (
          <li className="showcase-echo-sub showcase-echo-sub--empty">No tuned substats</li>
        ) : null}
      </ul>
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
export function ShowcaseBuild({
  echoes,
  statsView,
  buildStatsView,
  sonataSets,
  score,
  grade,
  tone,
  avgDamage,
  charId,
  hasWeights,
  hideScore,
  hideDamage,
  hideCv,
  hideSubVal,
  hideSubColor,
  hideRelStats,
  statsColumn,
  echoSelection,
  blank,
}: {
  echoes: Array<EchoInstance | null>
  statsView: StatsView | null
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
  echoSelection?: BenchmarkEchoSelection
  blank?: boolean
}) {
  const slots = Array.from({ length: 5 }, (_, slot) => echoes[slot] ?? null)
  const fill = score != null ? Math.max(2, Math.min(100, score / 2)) : 0
  const totalCv = slots.reduce((sum, echo) => sum + (echo ? cmptEchoCritAll(echo) : 0), 0)
  const cv4Cost = Math.min(slots.filter((echo) => getEchoById(echo?.id ?? '')?.cost === 4).length, 2)
  const totalCvTone = !blank && totalCv > 0 ? getCvToneColor((totalCv - (44 * cv4Cost)) / 5) : undefined
  const relStats = useMemo(() => makeRelStats(charId), [charId])
  const showRel = !hideRelStats
  const buildByLabel = new Map<string, number>()
  for (const row of [...(buildStatsView?.mainStats ?? []), ...(buildStatsView?.secondaryStats ?? [])]) {
    buildByLabel.set(row.label, row.total)
  }

  return (
    <>
      <section className="showcase-stats showcase-plate" style={{ '--i': 0, '--grade': tone } as CssVars}>
        <header className="showcase-verdict">
          <span className="showcase-verdict-body">
            <span className="showcase-eyebrow">The Build</span>
            {!hideScore ? (
              <>
                <span className="showcase-verdict-figure">
                  <b className="showcase-grade-mark">{grade || '-'}</b>
                  <span className="showcase-grade-score">
                    {score != null ? formatBuildBenchmarkScore(score) : '-'}
                  </span>
                </span>
                <span className="showcase-ruler">
                  <i style={{ width: `${fill}%` }} />
                </span>
              </>
            ) : null}
          </span>
          {sonataSets.length > 0 ? (
            <ul className="showcase-sonata">
              {sonataSets.map((set) => (
                <li key={set.setId} className="showcase-sonata-set" title={`${set.name} · ${set.pieces}pc`}>
                  {set.icon ? (
                    <img src={set.icon} alt="" className="showcase-sonata-icon" loading="lazy" onError={withDefIconM} />
                  ) : (
                    <span className="showcase-sonata-icon showcase-sonata-icon--fallback" />
                  )}
                  <span className="showcase-sonata-pc">{set.pieces}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </header>

        {!hideDamage || !hideCv ? (
          <div className="showcase-metrics">
            {!hideDamage ? (
              <div className="showcase-metric">
                <b className="showcase-metric-v">{avgDamage != null ? formatCompactNum(avgDamage) : '-'}</b>
                <span className="showcase-metric-k">Avg DMG</span>
              </div>
            ) : null}
            {!hideCv ? (
              <div className="showcase-metric">
                <b
                  className="showcase-metric-v showcase-metric-v--cv"
                  style={totalCvTone ? { '--cv-tone': totalCvTone } as CssVars : undefined}
                >
                  {blank ? '-' : totalCv.toFixed(1)}
                </b>
                <span className="showcase-metric-k">Crit Value</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {statsView ? (
          <div className="showcase-ladder" data-highlight={statsColumn}>
            <div className="showcase-ladder-head" aria-hidden="true">
              <span className="showcase-ladder-head-lead" />
              <span className="showcase-ladder-col showcase-ladder-col--build">Build</span>
              <span className="showcase-ladder-col showcase-ladder-col--combat">Combat</span>
            </div>
            <div className="showcase-ladder-group" style={{ '--rows': statsView.mainStats.length } as CssVars}>
              {statsView.mainStats.map((row) => (
                <ShowcaseStatRow
                  key={row.label}
                  row={row}
                  buildTotal={buildByLabel.get(row.label) ?? null}
                  blank={blank}
                  relevant={showRel && relStats.fams.has(statFamily(SHOWCASE_STAT_KEY[row.label] ?? row.label))}
                />
              ))}
            </div>
            <div className="showcase-ladder-group" style={{ '--rows': statsView.secondaryStats.length } as CssVars}>
              {statsView.secondaryStats.map((row) => (
                <ShowcaseStatRow
                  key={row.label}
                  row={row}
                  buildTotal={buildByLabel.get(row.label) ?? null}
                  blank={blank}
                  relevant={showRel && relStats.fams.has(statFamily(SHOWCASE_STAT_KEY[row.label] ?? row.label))}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="showcase-ladder showcase-ladder--empty">No stats</div>
        )}
      </section>

      {slots.map((echo, slot) => (
        <ShowcaseEcho
          key={echo?.uid ?? `empty:${slot}`}
          echo={echo}
          index={slot + 1}
          charId={charId}
          hasWeights={hasWeights}
          hideScore={hideScore}
          hideSubVal={hideSubVal}
          hideSubColor={hideSubColor}
          hideCv={hideCv}
          hideRelStats={hideRelStats}
          relStats={relStats}
          selection={echoSelection}
        />
      ))}
    </>
  )
}
