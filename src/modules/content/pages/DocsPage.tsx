/*
  Author: Runor Ewhro
  Description: docs surface rendered as a bench of method instruments.
*/

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties as CssProps,
  type KeyboardEvent as RctKybrVnt,
  type PointerEvent as RctPntrVnt,
} from 'react'
import { useLocation } from 'react-router-dom'
import { Search } from 'lucide-react'
import {
  docTopics,
  type DocBlock,
  type DocSection,
  type DocTopic,
} from '@/data/content/docsContent'
import { resDocTopic } from '@/modules/content/model/docs'
import { GRADE_LADDER } from '@/data/scoring/buildBenchmark'
import { getNegBase, type NegFfctArch } from '@/engine/formulas/negativeEffects'
import { getTuneLevel } from '@/engine/formulas/tuneRupture'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay'
import { CllpPageHeyf } from '@/shared/ui/CollapsiblePageHero'

const pad2 = (n: number) => String(n).padStart(2, '0')
const secAnchorId = (sectionId: string) => `doc-s-${sectionId}`
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function scorePct(score: number, baseline: number, benchmark: number, perfection: number): number {
  const ceiling = Math.max(perfection, benchmark)
  let percent: number
  if (score >= benchmark) {
    const range = ceiling - benchmark
    percent = range > 0 ? 1 + (score - benchmark) / range : 1
  } else {
    const range = benchmark - baseline
    percent = range > 0 ? (score - baseline) / range : 0
  }
  return Math.max(0, percent) * 100
}

function gradeFor(percentX100: number): string {
  for (const [threshold, grade] of GRADE_LADDER) {
    if (percentX100 >= threshold) return grade
  }
  return '🥀'
}

function negResistMult(enemyResPct: number): number {
  if (enemyResPct < 0) return 1 - enemyResPct / 200
  if (enemyResPct < 75) return 1 - enemyResPct / 100
  return 1 / (1 + 5 * (enemyResPct / 100))
}

function negDefenseMult(level: number, enemyLevel: number): number {
  const enemyDefense = (8 * enemyLevel) + 792
  return (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))
}

function fmtDec(value: number): string {
  return value.toFixed(3)
}

const SCALE_ANCHORS = { baseline: 161.7, benchmark: 906.2, perfection: 1325.6 }

function AnchorScale() {
  const { baseline, benchmark, perfection } = SCALE_ANCHORS
  const domainMin = baseline
  const domainMax = perfection
  const span = domainMax - domainMin
  const fracOf = useCallback((dmg: number) => clamp01((dmg - domainMin) / span), [domainMin, span])

  const [t, setT] = useState(() => fracOf(benchmark))
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)

  const damage = lerp(domainMin, domainMax, t)
  const percent = scorePct(damage, baseline, benchmark, perfection)
  const grade = gradeFor(percent)
  // the 0/100/200 scale is piecewise; the flattened read is damage as a plain
  // fraction of the perfection anchor, so 100% and 200% expose how compressed
  // real damage is against the score.
  const flatPct = (damage / perfection) * 100

  const setFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    setT(clamp01((clientX - rect.left) / rect.width))
  }, [])

  const onPointerDown = useCallback((event: RctPntrVnt<HTMLDivElement>) => {
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    setFromClientX(event.clientX)
  }, [setFromClientX])

  const onPointerMove = useCallback((event: RctPntrVnt<HTMLDivElement>) => {
    if (dragging.current) setFromClientX(event.clientX)
  }, [setFromClientX])

  const onPointerUp = useCallback((event: RctPntrVnt<HTMLDivElement>) => {
    dragging.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  const onKeyDown = useCallback((event: RctKybrVnt<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault(); setT((v) => clamp01(v + step))
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault(); setT((v) => clamp01(v - step))
    } else if (event.key === 'Home') {
      event.preventDefault(); setT(0)
    } else if (event.key === 'End') {
      event.preventDefault(); setT(1)
    }
  }, [])

  const ticks = [
    { key: 'baseline', label: 'Baseline', pct: '0', frac: fracOf(baseline) },
    { key: 'benchmark', label: 'Benchmark', pct: '100', frac: fracOf(benchmark) },
    { key: 'perfection', label: 'Perfection', pct: '200', frac: fracOf(perfection) },
  ]
  const zone = percent >= 100 ? 'over' : 'under'

  return (
    <div className="docs-scale" data-zone={zone}>
      <div className="docs-scale__readout" aria-hidden="true">
        <div className="docs-scale__readout-main">
          <span className="docs-scale__pct">{Math.round(percent)}</span>
          <span className="docs-scale__pct-unit">%</span>
        </div>
        <div className="docs-scale__readout-meta">
          <span className="docs-scale__grade">{grade}</span>
          <span className="docs-scale__dmg">
            <span className="docs-scale__flat">{Math.round(flatPct)}% of perfection dmg</span>, {Math.round(damage)}k dmg</span>
        </div>
      </div>

      <div className="docs-scale__instrument">
        <div
          ref={trackRef}
          className="docs-scale__track"
          role="slider"
          tabIndex={0}
          aria-label="Build damage, illustrative"
          aria-valuemin={0}
          aria-valuemax={Math.round(scorePct(domainMax, baseline, benchmark, perfection))}
          aria-valuenow={Math.round(percent)}
          aria-valuetext={`${Math.round(percent)} percent, grade ${grade}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <div className="docs-scale__fill" style={{ width: `${t * 100}%` }} />
          {ticks.map((tick) => (
            <div key={tick.key} className="docs-scale__tick" data-anchor={tick.key} style={{ left: `${tick.frac * 100}%` }}>
              <span className="docs-scale__tick-mark" aria-hidden="true" />
            </div>
          ))}
          <div className="docs-scale__marker" style={{ left: `${t * 100}%` }}>
            <span className="docs-scale__marker-stem" aria-hidden="true" />
            <span className="docs-scale__marker-head" aria-hidden="true" />
          </div>
        </div>

        <div className="docs-scale__legend" aria-hidden="true">
          {ticks.map((tick) => (
            <button
              key={tick.key}
              type="button"
              className="docs-scale__legend-item"
              data-anchor={tick.key}
              style={{ left: `${tick.frac * 100}%` }}
              onClick={() => setT(tick.frac)}
            >
              <span className="docs-scale__legend-pct">{tick.pct}%</span>
              <span className="docs-scale__legend-label">{tick.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const RAMP_LEVEL = 90
const RAMP_ENEMY_LEVEL = 100
const RAMP_ENEMY_RES = 20

const RAMP_EFFECTS: Array<{
  key: NegFfctArch
  short: string
  full: string
  element: keyof typeof ATTR_COLORS
  defaultCap: number
  cap: number
  overflowKey?: 'electroRage'
}> = [
  { key: 'spectroFrazzle', short: 'Frazzle', full: 'Spectro Frazzle', element: 'spectro', defaultCap: 10, cap: 66 },
  { key: 'aeroErosion', short: 'Erosion', full: 'Aero Erosion', element: 'aero', defaultCap: 3, cap: 12 },
  { key: 'fusionBurst', short: 'Burst', full: 'Fusion Burst', element: 'fusion', defaultCap: 10, cap: 19 },
  { key: 'glacioChafe', short: 'Chafe', full: 'Glacio Chafe', element: 'glacio', defaultCap: 10, cap: 19 },
  { key: 'electroFlare', short: 'Flare', full: 'Electro Flare', element: 'electro', defaultCap: 10, cap: 19, overflowKey: 'electroRage' },
]

function StackRamp() {
  const [effectIdx, setEffectIdx] = useState(0)
  const effect = RAMP_EFFECTS[effectIdx]
  const [stacks, setStacks] = useState(effect.cap)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)

  const pickEffect = useCallback((idx: number) => {
    const next = RAMP_EFFECTS[idx]
    setEffectIdx(idx)
    setStacks((prev) => Math.min(prev, next.cap))
  }, [])
  const resolvedStacks = Math.max(1, Math.min(stacks, effect.cap))

  const bars = useMemo(() => {
    const out: number[] = []
    for (let i = 1; i <= effect.cap; i += 1) out.push(getNegBase(effect.key, RAMP_LEVEL, i))
    return out
  }, [effect])
  const maxBase = bars[bars.length - 1] || 1
  const primaryBase = getNegBase(effect.key, RAMP_LEVEL, resolvedStacks)
  const overflowStacks = effect.overflowKey && resolvedStacks > effect.defaultCap
    ? resolvedStacks - effect.defaultCap
    : 0
  const extraBase = overflowStacks > 0 ? getNegBase(effect.key, RAMP_LEVEL, overflowStacks) : 0
  const totalBase = primaryBase + extraBase
  const resMult = negResistMult(RAMP_ENEMY_RES)
  const defMult = negDefenseMult(RAMP_LEVEL, RAMP_ENEMY_LEVEL)
  const postEnemy = Math.floor(totalBase * defMult * resMult)
  const color = ATTR_COLORS[effect.element]

  const setFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const frac = clamp01((clientX - rect.left) / rect.width)
    setStacks(Math.max(1, Math.min(effect.cap, Math.round(frac * (effect.cap - 1)) + 1)))
  }, [effect.cap])

  const onPointerDown = useCallback((event: RctPntrVnt<HTMLDivElement>) => {
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    setFromClientX(event.clientX)
  }, [setFromClientX])

  const onPointerMove = useCallback((event: RctPntrVnt<HTMLDivElement>) => {
    if (dragging.current) setFromClientX(event.clientX)
  }, [setFromClientX])

  const onPointerUp = useCallback((event: RctPntrVnt<HTMLDivElement>) => {
    dragging.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  const onKeyDown = useCallback((event: RctKybrVnt<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault(); setStacks((v) => Math.min(effect.cap, v + 1))
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault(); setStacks((v) => Math.max(1, v - 1))
    } else if (event.key === 'Home') {
      event.preventDefault(); setStacks(1)
    } else if (event.key === 'End') {
      event.preventDefault(); setStacks(effect.cap)
    }
  }, [effect.cap])

  return (
    <div className="docs-ramp" style={{ '--fx': color } as CssProps}>
      <div className="docs-ramp__chips" role="tablist" aria-label="Negative effect">
        {RAMP_EFFECTS.map((fx, idx) => (
          <button
            key={fx.key}
            type="button"
            role="tab"
            aria-selected={idx === effectIdx}
            className="docs-ramp__chip"
            data-active={idx === effectIdx || undefined}
            style={{ '--fx': ATTR_COLORS[fx.element] } as CssProps}
            onClick={() => pickEffect(idx)}
          >
            {fx.short}
          </button>
        ))}
      </div>

      <div className="docs-ramp__readout" aria-hidden="true">
        <div className="docs-ramp__readout-main">
          <span className="docs-ramp__base">{postEnemy.toLocaleString()}</span>
          <span className="docs-ramp__base-unit">post enemy</span>
        </div>
        <div className="docs-ramp__readout-meta">
          <span className="docs-ramp__stackcount">
            base {Math.round(totalBase).toLocaleString()} · def {fmtDec(defMult)} · res {fmtDec(resMult)}
          </span>
          <span className="docs-ramp__stackcount">
            stack {resolvedStacks} / {effect.cap}{overflowStacks > 0 ? ` · rage ${overflowStacks}` : ''}
          </span>
        </div>
      </div>

      <div
        ref={trackRef}
        className="docs-ramp__track"
        role="slider"
        tabIndex={0}
        aria-label={`${effect.full} stacks`}
        aria-valuemin={1}
        aria-valuemax={effect.cap}
        aria-valuenow={resolvedStacks}
        aria-valuetext={`${resolvedStacks} stacks, ${postEnemy.toLocaleString()} post-enemy damage`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {bars.map((base, i) => {
          const stack = i + 1
          return (
            <span
              key={stack}
              className="docs-ramp__bar"
              data-on={stack <= resolvedStacks || undefined}
              data-current={stack === resolvedStacks || undefined}
              style={{ height: `${Math.max(4, (base / maxBase) * 100)}%` }}
            />
          )
        })}
      </div>
      <div className="docs-ramp__axis" aria-hidden="true">
        <span>1</span>
        <span>lv {RAMP_LEVEL} · enemy lv {RAMP_ENEMY_LEVEL} · {RAMP_ENEMY_RES}% RES · {effect.cap} stack cap</span>
      </div>
    </div>
  )
}

const SPACE_DATA = {
  inventory: {
    off: { gpu: 6_455_750_175, cpu: 3_323_340_720 },
    on: { gpu: 734_016_360, cpu: 437_950_380 },
  },
  theory: { single: 1_095_846, rotation: 1_300_059 },
} as const

const SUGGESTION_SPACE = {
  direct: {
    mainStats: {
      evalCalls: 9_280,
      recipeEvaluations: 9_280,
      poolSize: 18,
      detail: '18 legal main stats: 3 one-cost, 10 three-cost, 5 four-cost',
    },
    setPlans: {
      evalCalls: 1_026,
      candidatePlans: 991,
      partialBaselines: 34,
      totalDamageCalls: 1_026,
      detail: '991 legal plans plus 34 partial baselines and 1 base run',
    },
    contextCount: 1,
  },
  rotation: {
    mainStats: {
      evalCalls: 83_520,
      recipeEvaluations: 9_280,
      poolSize: 18,
      detail: 'same 9,280 recipes, rescored across 9 stored rotation contexts',
    },
    setPlans: {
      evalCalls: 9_234,
      candidatePlans: 991,
      partialBaselines: 34,
      totalDamageCalls: 1_026,
      detail: 'same 1,026 plan evaluations, rescored across 9 stored rotation contexts',
    },
    contextCount: 9,
  },
} as const

// the widest reachable count is the unfiltered inventory GPU estimate
const SPACE_MAX = SPACE_DATA.inventory.off.gpu
const SUGGEST_SPACE_MAX = SUGGESTION_SPACE.rotation.mainStats.evalCalls

const SPACE_DEC_MIN = 6
const SPACE_DEC_MAX = 10
const SPACE_TICKS = [6, 7, 8, 9, 10]
const SUGGEST_DEC_MIN = 3
const SUGGEST_DEC_MAX = 5
const SUGGEST_TICKS = [3, 4, 5]

const logFrac = (
  value: number,
  decMin = SPACE_DEC_MIN,
  decMax = SPACE_DEC_MAX,
) => clamp01((Math.log10(value) - decMin) / (decMax - decMin))

function magParts(value: number): { mant: string, exp: number } {
  const exp = Math.floor(Math.log10(value))
  return { mant: (value / 10 ** exp).toFixed(2), exp }
}

type SpaceMode = 'inventory' | 'theory'
type SpaceEngine = 'gpu' | 'cpu'
type SpaceFilter = 'off' | 'on'
type SpaceRoute = 'optimizer' | 'suggestions'
type SuggestObjective = 'direct' | 'rotation'
type SuggestMode = 'mainStats' | 'setPlans'

function SearchSpace() {
  const [route, setRoute] = useState<SpaceRoute>('optimizer')
  const [mode, setMode] = useState<SpaceMode>('inventory')
  const [engine, setEngine] = useState<SpaceEngine>('gpu')
  const [filter, setFilter] = useState<SpaceFilter>('off')
  const [objective, setObjective] = useState<SuggestObjective>('direct')
  const [suggestMode, setSuggestMode] = useState<SuggestMode>('mainStats')
  const [optObjective, setOptObjective] = useState<'single' | 'rotation'>('single')

  const isSuggestions = route === 'suggestions'
  const isTheory = mode === 'theory'
  const suggEntry = SUGGESTION_SPACE[objective][suggestMode]
  const suggestMainEntry = SUGGESTION_SPACE[objective].mainStats
  const suggestSetEntry = SUGGESTION_SPACE[objective].setPlans
  const count = isSuggestions
    ? suggEntry.evalCalls
    : (
      isTheory
        ? SPACE_DATA.theory[optObjective]
        : SPACE_DATA.inventory[filter][engine]
    )

  const { mant, exp } = magParts(count)
  const decMin = isSuggestions ? SUGGEST_DEC_MIN : SPACE_DEC_MIN
  const decMax = isSuggestions ? SUGGEST_DEC_MAX : SPACE_DEC_MAX
  const ticks = isSuggestions ? SUGGEST_TICKS : SPACE_TICKS
  const routeMax = isSuggestions ? SUGGEST_SPACE_MAX : SPACE_MAX
  const fill = logFrac(count, decMin, decMax) * 100
  const ghost = logFrac(routeMax, decMin, decMax) * 100
  const factor = routeMax / count
  const reduction = factor < 1.05
    ? (isSuggestions ? 'widest suggestion workload' : 'widest search space')
    : `${factor >= 10 ? Math.round(factor) : factor.toFixed(1)}× smaller than the widest`
  const ctxN = SUGGESTION_SPACE[objective].contextCount
  const acrossRot = ctxN > 1 ? `, rescored across ${ctxN} rotation steps` : ''
  const suggestionMeta = suggestMode === 'mainStats'
    ? `${suggestMainEntry.recipeEvaluations.toLocaleString()} main-stat mixes${acrossRot}`
    : `${suggestSetEntry.totalDamageCalls.toLocaleString()} set splits${acrossRot}`
  const meta = isSuggestions
    ? suggestionMeta
    : (
      isTheory
        ? 'distinct builds, duplicates removed'
        : engine === 'gpu'
          ? 'quick estimate, ignores the cost budget'
          : 'exact, within the 12 cost budget'
    )

  const [showFull, setShowFull] = useState(false)

  const Lever = ({ label, options, value, onPick, disabled, note }: {
    label: string
    options: ReadonlyArray<{ id: string, text: string }>
    value: string
    onPick: (id: string) => void
    disabled?: boolean
    note?: string
  }) => (
    <div className="docs-space__lever" data-disabled={disabled || undefined}>
      <span className="docs-space__lever-label">{label}</span>
      <div className="docs-space__seg" role="group" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className="docs-space__seg-btn"
            data-on={value === opt.id || undefined}
            aria-pressed={value === opt.id}
            disabled={disabled}
            onClick={() => onPick(opt.id)}
          >
            {opt.text}
          </button>
        ))}
      </div>
      {note ? <span className="docs-space__lever-note">{note}</span> : null}
    </div>
  )

  return (
    <div className="docs-space">
      <div className="docs-space__levers">
        <Lever
          label="Route"
          options={[{ id: 'optimizer', text: 'Optimizer' }, { id: 'suggestions', text: 'Suggestions' }]}
          value={route}
          onPick={(id) => setRoute(id as SpaceRoute)}
        />
        {isSuggestions ? (
          <>
            <Lever
              label="Objective"
              options={[{ id: 'direct', text: 'Direct' }, { id: 'rotation', text: 'Rotation' }]}
              value={objective}
              onPick={(id) => setObjective(id as SuggestObjective)}
            />
            <Lever
              label="Pass"
              options={[{ id: 'mainStats', text: 'Main Stats' }, { id: 'setPlans', text: 'Set Plans' }]}
              value={suggestMode}
              onPick={(id) => setSuggestMode(id as SuggestMode)}
            />
          </>
        ) : (
          <>
        <Lever
          label="Search"
          options={[{ id: 'inventory', text: 'Inventory' }, { id: 'theory', text: 'Theory' }]}
          value={mode}
          onPick={(id) => setMode(id as SpaceMode)}
        />
        <Lever
          label="Objective"
          options={[{ id: 'single', text: 'Single skill' }, { id: 'rotation', text: 'Rotation' }]}
          value={optObjective}
          onPick={(id) => setOptObjective(id as 'single' | 'rotation')}
          disabled={!isTheory}
          note={!isTheory ? 'same' : undefined}
        />
        <Lever
          label="Engine"
          options={[{ id: 'gpu', text: 'GPU' }, { id: 'cpu', text: 'CPU' }]}
          value={engine}
          onPick={(id) => setEngine(id as SpaceEngine)}
          disabled={isTheory}
          note={isTheory ? 'same' : undefined}
        />
        <Lever
          label="Main-stat filter"
          options={[{ id: 'off', text: 'Off' }, { id: 'on', text: 'On' }]}
          value={isTheory ? 'on' : filter}
          onPick={(id) => setFilter(id as SpaceFilter)}
          disabled={isTheory}
          note={isTheory ? 'uses optimal filter' : undefined}
        />
          </>
        )}
      </div>

      <div className="docs-space__readout" aria-hidden="true">
        <div className="docs-space__readout-main" onClick={() => setShowFull(!showFull)}>
          <span className={`docs-space__mant ${showFull ? 'full' : ''}`}>{showFull ? count.toLocaleString() : mant}</span>
          <span className={`docs-space__exp ${showFull ? 'full' : ''}`}>&times;10<sup>{showFull ? 0 : exp}</sup></span>
        </div>
        <div className="docs-space__readout-meta">
          <span className="docs-space__label">
            {count.toLocaleString()} {isSuggestions ? 'damage checks' : 'builds checked'} &middot; {reduction}
          </span>
          <span className="docs-space__sub">{meta}</span>
        </div>
      </div>

      <div
        className="docs-space__meter"
        role="img"
        aria-label={`${count.toLocaleString()} candidates, ${reduction}`}
        >
        <div className="docs-space__ghost" style={{ width: `${ghost}%` }} />
        <div className="docs-space__fill" style={{ width: `${fill}%` }} />
        {ticks.map((p) => (
          <span
            key={p}
            className="docs-space__grid"
            style={{ left: `${((p - decMin) / (decMax - decMin)) * 100}%` }}
          />
        ))}
        <span className="docs-space__needle" style={{ left: `${fill}%` }} />
      </div>
      <div className="docs-space__axis" aria-hidden="true">
        {ticks.map((p) => (
          <span
            key={p}
            className="docs-space__tick"
            style={{ left: `${((p - decMin) / (decMax - decMin)) * 100}%` }}
          >
            10<sup>{p}</sup>
          </span>
        ))}
      </div>
    </div>
  )
}

const INSTRUMENT_META: Record<Exclude<DocTopic['instrument'], 'none'>, { title: string, hint: string }> = {
  anchorScale: { title: 'Anchor scale', hint: 'Drag to read damage → percent → grade' },
  stackRamp: { title: 'Stack ramp', hint: 'Pick an effect, drag to add stacks' },
  searchSpace: { title: 'Decade meter', hint: 'Flip the levers, watch the space carve down' },
}

function Instrument({ topic }: { topic: DocTopic }) {
  if (topic.instrument === 'none') return null
  const { title, hint } = INSTRUMENT_META[topic.instrument]
  return (
    <figure className="docs-instrument">
      <figcaption className="docs-instrument__head">
        <span className="docs-instrument__live" aria-hidden="true">Live</span>
        <span className="docs-instrument__title">{title}</span>
        <span className="docs-instrument__hint">{hint}</span>
      </figcaption>
      <div className="docs-instrument__body">
        {topic.instrument === 'anchorScale' ? <AnchorScale /> : null}
        {topic.instrument === 'stackRamp' ? <StackRamp /> : null}
        {topic.instrument === 'searchSpace' ? <SearchSpace /> : null}
      </div>
      {topic.instrumentNote && topic.instrumentNote.length > 0 ? (
        <div className="docs-instrument__note" role="note">
          <span className="docs-instrument__note-mark" aria-hidden="true">!</span>
          <div className="docs-instrument__note-body">
            {topic.instrumentNote.map((line, i) => (
              <p key={i} className="docs-instrument__note-line">{line}</p>
            ))}
          </div>
        </div>
      ) : null}
    </figure>
  )
}

// micro preview drawn on the rack cards
function MicroGauge({ instrument }: { instrument: DocTopic['instrument'] }) {
  if (instrument === 'anchorScale') {
    return (
      <svg className="docs-micro" viewBox="0 0 60 22" aria-hidden="true">
        <polyline points="2,20 30,9 58,2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="30" cy="9" r="2" fill="currentColor" />
      </svg>
    )
  }
  if (instrument === 'stackRamp') {
    const heights = [4, 7, 10, 13, 17, 21]
    return (
      <svg className="docs-micro" viewBox="0 0 60 22" aria-hidden="true">
        {heights.map((h, i) => (
          <rect key={i} x={2 + i * 10} y={22 - h} width="6" height={h} fill="currentColor" />
        ))}
      </svg>
    )
  }
  if (instrument === 'searchSpace') {
    // descending log staircase: each step an order of magnitude carved away
    const widths = [56, 34, 20, 12]
    return (
      <svg className="docs-micro" viewBox="0 0 60 22" aria-hidden="true">
        {widths.map((w, i) => (
          <rect key={i} x={2} y={2 + i * 5} width={w} height="3" fill="currentColor" opacity={1 - i * 0.18} />
        ))}
      </svg>
    )
  }
  return null
}

function GradeLadder() {
  return (
    <div className="docs-ladder" role="table" aria-label="Grade thresholds">
      <div className="docs-ladder__row docs-ladder__row--head" role="row">
        <span className="docs-ladder__cell docs-ladder__cell--head" role="columnheader">Score</span>
        <span className="docs-ladder__cell docs-ladder__cell--head" role="columnheader">Grade</span>
      </div>
      {GRADE_LADDER.map(([threshold, grade]) => (
        <div key={`${threshold}-${grade}`} className="docs-ladder__row" role="row">
          <span className="docs-ladder__cell docs-ladder__cell--range" role="cell">
            <span className="docs-ladder__to">≥</span>
            <span className="docs-ladder__num">{threshold}</span>
          </span>
          <span className="docs-ladder__cell docs-ladder__grade" role="cell">{grade}</span>
        </div>
      ))}
      <div className="docs-ladder__row" role="row">
        <span className="docs-ladder__cell docs-ladder__cell--range" role="cell">
          <span className="docs-ladder__to">&lt;</span>
          <span className="docs-ladder__num">{GRADE_LADDER[GRADE_LADDER.length - 1][0]}</span>
        </span>
        <span className="docs-ladder__cell docs-ladder__grade" role="cell">🥀</span>
      </div>
    </div>
  )
}

const TUNE_KEY_LEVELS = [1, 20, 40, 50, 60, 70, 80, 90]
const TUNE_ALL_LEVELS = Array.from({ length: 90 }, (_, i) => i + 1)

function LevelTable({ caption, title }: { caption: string, title: string }) {
  const [expanded, setExpanded] = useState(false)
  const levels = expanded ? TUNE_ALL_LEVELS : TUNE_KEY_LEVELS
  return (
    <figure className="docs-figure">
      <figcaption className="docs-figure__head">
        <span className="docs-figure__caption" aria-hidden="true">{caption}</span>
        <span className="docs-figure__title">{title}</span>
      </figcaption>
      <div className="docs-leveltable__scroll" data-expanded={expanded || undefined}>
        <div className="docs-table" role="table" style={{ '--cols': 2 } as CssProps}>
          <div className="docs-table__row docs-table__row--head" role="row">
            <span className="docs-table__cell docs-table__cell--head" role="columnheader">Level</span>
            <span className="docs-table__cell docs-table__cell--head" role="columnheader">Tune level value</span>
          </div>
          {levels.map((lvl) => (
            <div key={lvl} className="docs-table__row" role="row">
              <span className="docs-table__cell docs-table__cell--rowhead" role="rowheader">{lvl}</span>
              <span className="docs-table__cell" role="cell">{getTuneLevel(lvl).toFixed(4)}</span>
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="docs-leveltable__toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? 'Show key levels' : 'Show all 90 levels'}
      </button>
    </figure>
  )
}

function Block({ block }: { block: DocBlock }) {
  switch (block.type) {
    case 'prose':
      return <>{block.text.map((p, i) => <p key={i} className="docs-p">{p}</p>)}</>

    case 'formula':
      return (
        <figure className="docs-eq">
          <figcaption className="docs-eq__head">
            <span className="docs-eq__caption" aria-hidden="true">{block.caption}</span>
            <span className="docs-eq__title">{block.title}</span>
          </figcaption>
          <pre className="docs-eq__pre"><code>{block.lines.join('\n')}</code></pre>
        </figure>
      )

    case 'table':
      return (
        <div className="docs-table" role="table" style={{ '--cols': block.columns.length } as CssProps}>
          <div className="docs-table__row docs-table__row--head" role="row">
            {block.columns.map((col, i) => (
              <span key={i} className="docs-table__cell docs-table__cell--head" role="columnheader">{col}</span>
            ))}
          </div>
          {block.rows.map((row, r) => (
            <div key={r} className="docs-table__row" role="row">
              {row.map((cell, c) => (
                <span key={c} className={c === 0 ? 'docs-table__cell docs-table__cell--rowhead' : 'docs-table__cell'} role={c === 0 ? 'rowheader' : 'cell'}>{cell}</span>
              ))}
            </div>
          ))}
        </div>
      )

    case 'ladder':
      return (
        <figure className="docs-figure">
          <figcaption className="docs-figure__head">
            <span className="docs-figure__caption" aria-hidden="true">{block.caption}</span>
            <span className="docs-figure__title">{block.title}</span>
          </figcaption>
          <GradeLadder />
        </figure>
      )

    case 'levelTable':
      return <LevelTable caption={block.caption} title={block.title} />

    default:
      return null
  }
}

function SectionView({ section }: { section: DocSection }) {
  return (
    <section id={secAnchorId(section.id)} className="docs-section" data-doc-anchor={secAnchorId(section.id)}>
      <h2 className="docs-section__title">
        <span className="docs-section__marker" aria-hidden="true">//</span>
        {section.title}
      </h2>
      <div className="docs-flow">
        {section.blocks.map((block, i) => (
          <Block key={`${block.type}-${i}`} block={block} />
        ))}
      </div>
    </section>
  )
}

type DocHit = {
  topicId: string
  sectionId: string | null
  kind: 'method' | 'section' | 'detail'
  display: string
  crumb: string
  matchStart: number
  matchEnd: number
}

function blockText(block: DocBlock): string {
  switch (block.type) {
    case 'prose': return block.text.join(' ')
    case 'formula': return block.title
    case 'table': return block.rows.flat().join(' ')
    case 'ladder': return block.title
    case 'levelTable': return block.title
    default: return ''
  }
}

type IndexEntry = { topic: DocTopic, section: DocSection | null, kind: DocHit['kind'], title: string, haystack: string, score: number }

function buildIndex(): IndexEntry[] {
  const out: IndexEntry[] = []
  for (const topic of docTopics) {
    out.push({
      topic, section: null, kind: 'method',
      title: topic.title,
      haystack: `${topic.code} ${topic.title} ${topic.abstract} ${topic.summary ?? ''} ${(topic.aliases ?? []).join(' ')}`.toLowerCase(),
      score: 100,
    })
    for (const section of topic.sections) {
      out.push({ topic, section, kind: 'section', title: section.title, haystack: section.title.toLowerCase(), score: 70 })
      out.push({
        topic, section, kind: 'detail', title: section.title,
        haystack: section.blocks.map(blockText).join(' ').toLowerCase(),
        score: 40,
      })
    }
  }
  return out
}

function runSearch(index: IndexEntry[], query: string, limit = 8): DocHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: Array<{ entry: IndexEntry, score: number }> = []
  for (const entry of index) {
    const idx = entry.haystack.indexOf(q)
    if (idx === -1) continue
    scored.push({ entry, score: entry.score - Math.min(idx, 80) * 0.1 + (idx === 0 ? 15 : 0) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(({ entry }) => {
    const titleIdx = entry.title.toLowerCase().indexOf(q)
    return {
      topicId: entry.topic.id,
      sectionId: entry.section?.id ?? null,
      kind: entry.kind,
      display: entry.title,
      crumb: entry.kind === 'method' ? entry.topic.code : `${entry.topic.code} · ${entry.section?.title ?? ''}`,
      matchStart: titleIdx === -1 ? 0 : titleIdx,
      matchEnd: titleIdx === -1 ? 0 : titleIdx + q.length,
    }
  })
}


function useActiveSection(topicId: string): string | null {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    const anchors = Array.from(document.querySelectorAll<HTMLElement>('[data-doc-anchor]'))
    if (anchors.length === 0) return
    const scroller = anchors[0].closest<HTMLElement>('.page')
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) setActive(visible[0].target.getAttribute('data-doc-anchor'))
      },
      { root: scroller ?? null, rootMargin: '-22% 0px -68% 0px', threshold: 0 },
    )
    for (const anchor of anchors) observer.observe(anchor)
    return () => observer.disconnect()
  }, [topicId])
  return active
}

export function DocsPage() {
  const location = useLocation()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const pendingScroll = useRef<string | null>(null)

  const requested = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('topic') ?? location.hash?.replace('#', '') ?? null
  }, [location.search, location.hash])

  const initial = resDocTopic(docTopics, requested)?.id ?? docTopics[0].id
  const [activeId, setActiveId] = useState(initial)
  const activeIdx = Math.max(0, docTopics.findIndex((t) => t.id === activeId))
  const topic = docTopics[activeIdx]

  const observed = useActiveSection(topic.id)
  const activeSection = observed ?? secAnchorId(topic.sections[0].id)

  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [selNdx, setActiveIndex] = useState(0)
  const searchRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const index = useMemo(() => buildIndex(), [])
  const hits = useMemo(() => runSearch(index, query), [index, query])
  const popoverOpen = searchOpen && query.trim().length > 0
  const safeSelNdx = hits.length === 0 ? 0 : Math.min(selNdx, hits.length - 1)

  const scrollTopSmooth = useCallback(() => {
    const page = rootRef.current?.closest<HTMLElement>('.page') ?? rootRef.current
    page?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const jumpTo = useCallback((anchorId: string) => {
    const root = rootRef.current
    const page = root?.closest<HTMLElement>('.page') ?? root
    const target = root?.querySelector<HTMLElement>(`#${CSS.escape(anchorId)}`)
    if (!page || !target) return
    const top = target.getBoundingClientRect().top - page.getBoundingClientRect().top
    page.scrollTo({ top: page.scrollTop + top - 96, behavior: 'smooth' })
  }, [])

  const selectTopic = useCallback((id: string) => {
    if (id === activeId) { scrollTopSmooth(); return }
    setActiveId(id)
    scrollTopSmooth()
  }, [activeId, scrollTopSmooth])

  const cycle = useCallback((dir: -1 | 1) => {
    const next = docTopics[Math.min(docTopics.length - 1, Math.max(0, activeIdx + dir))]
    if (next) selectTopic(next.id)
  }, [activeIdx, selectTopic])

  // after a cross-topic jump, scroll to the requested section once it renders.
  useEffect(() => {
    if (!pendingScroll.current) return
    const id = pendingScroll.current
    pendingScroll.current = null
    const frame = requestAnimationFrame(() => jumpTo(id))
    return () => cancelAnimationFrame(frame)
  }, [activeId, jumpTo])

  // close the search popover on outside click
  useEffect(() => {
    if (!searchOpen) return
    const onDown = (event: PointerEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [searchOpen])

  const selectHit = useCallback((hit: DocHit) => {
    setQuery('')
    setSearchOpen(false)
    if (hit.sectionId) pendingScroll.current = secAnchorId(hit.sectionId)
    if (hit.topicId !== activeId) {
      setActiveId(hit.topicId)
    } else if (hit.sectionId) {
      jumpTo(secAnchorId(hit.sectionId))
    } else {
      scrollTopSmooth()
    }
  }, [activeId, jumpTo, scrollTopSmooth])

  const onRackKey = useCallback((event: RctKybrVnt<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); cycle(1) }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); cycle(-1) }
  }, [cycle])

  // "/" focuses the search field, matching the guides shortcut.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = document.activeElement as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      const input = inputRef.current
      if (!input) return
      input.focus({ preventScroll: true })
      input.select()
      ;(searchRef.current ?? input).scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const onSearchKey = useCallback((event: RctKybrVnt<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (query.trim().length > 0 || searchOpen) { event.preventDefault(); setQuery(''); setSearchOpen(false) }
      return
    }
    if (!popoverOpen || hits.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((idx) => (Math.min(idx, hits.length - 1) + 1) % hits.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((idx) => (Math.min(idx, hits.length - 1) - 1 + hits.length) % hits.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[safeSelNdx]
      if (hit) selectHit(hit)
    }
  }, [query, searchOpen, popoverOpen, hits, safeSelNdx, selectHit])

  return (
    <div ref={rootRef} className="page docs-page">
      <CllpPageHeyf
        eyebrow="Boring Stuff"
        title="Methods"
        subtitle="Some obscure details... explained :P"
        layoutKey="docs-hero"
      />

      <div className="docs-console">
        <div ref={searchRef} className="guide-search" role="search">
          <div className="guide-search__field" data-open={popoverOpen || undefined}>
            <Search size={16} className="guide-search__icon" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              className="guide-search__input"
              value={query}
              placeholder="search methods"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); setActiveIndex(0) }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={onSearchKey}
              aria-expanded={popoverOpen}
              aria-controls="docs-search-popover"
              aria-autocomplete="list"
            />
            <span className="guide-search__shortcut" aria-hidden="true">/</span>
          </div>
          {popoverOpen ? (
            <div id="docs-search-popover" className="guide-search__popover" role="listbox">
              {hits.length === 0 ? (
                <div className="guide-search__empty">no matches for &quot;{query.trim()}&quot;</div>
              ) : hits.map((hit, i) => {
                const isActive = i === safeSelNdx
                const before = hit.display.slice(0, hit.matchStart)
                const match = hit.display.slice(hit.matchStart, hit.matchEnd)
                const after = hit.display.slice(hit.matchEnd)
                return (
                  <button
                    key={`${hit.topicId}-${hit.sectionId ?? ''}-${hit.kind}-${i}`}
                    type="button"
                    className="guide-search__hit"
                    data-active={isActive || undefined}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectHit(hit)}
                  >
                    <span className="guide-search__badge">{hit.kind}</span>
                    <span className="guide-search__title">
                      {before}{match ? <mark className="guide-search__mark">{match}</mark> : null}{after}
                    </span>
                    <span className="guide-search__crumb">{hit.crumb}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        <div className="docs-cycler" aria-label="Cycle methods">
          <button type="button" className="docs-cycler__btn" onClick={() => cycle(-1)} disabled={activeIdx === 0} aria-label="Previous method">‹</button>
          <span className="docs-cycler__pos" aria-hidden="true">{pad2(activeIdx + 1)} <span className="docs-cycler__total">/ {pad2(docTopics.length)}</span></span>
          <button type="button" className="docs-cycler__btn" onClick={() => cycle(1)} disabled={activeIdx === docTopics.length - 1} aria-label="Next method">›</button>
        </div>
      </div>

      <div className="docs-shell">
        <article className="docs-method" role="tabpanel" aria-label={topic.title}>
          <header className="docs-method__head">
            <span className="docs-method__kicker">
              <span className="docs-method__code">{topic.code}</span>
              <span className="docs-method__eyebrow">{topic.eyebrow}</span>
            </span>
            <h1 className="docs-method__title">{topic.title}</h1>
            {topic.summary && (<p className="docs-method__summary">{topic.summary}</p>)}
          </header>

          <Instrument topic={topic} />

          <div className="docs-method__body">
            {topic.sections.map((section) => <SectionView key={section.id} section={section} />)}
            <footer className="docs-method__foot">
              <span className="docs-method__foot-mark" aria-hidden="true">/// ⋆.˚ {topic.code} ♡ The End~ (˶˃𐃷˂˶) ‧˚₊⊹</span>
            </footer>
          </div>
        </article>

        <aside className="docs-side">
          <div className="docs-side__sticky">
            <div className="docs-side__group">
              <span className="docs-side__label">Methods</span>
              <div className="docs-side__methods" role="tablist" aria-label="Methods" onKeyDown={onRackKey}>
                {docTopics.map((t, i) => {
                  const isActive = t.id === activeId
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      tabIndex={isActive ? 0 : -1}
                      className="docs-mcard"
                      data-active={isActive || undefined}
                      onClick={() => selectTopic(t.id)}
                    >
                      <span className="docs-mcard__no" aria-hidden="true">{pad2(i + 1)}</span>
                      <span className="docs-mcard__text">
                        <span className="docs-mcard__code">{t.code}</span>
                        <span className="docs-mcard__name">{t.title}</span>
                      </span>
                      <MicroGauge instrument={t.instrument} />
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="docs-side__group">
              <span className="docs-side__label">On this page</span>
              <nav className="docs-snav" aria-label="Sections in this method">
                {topic.sections.map((section) => {
                  const anchor = secAnchorId(section.id)
                  return (
                    <button
                      key={section.id}
                      type="button"
                      className="docs-snav__item"
                      data-active={anchor === activeSection || undefined}
                      aria-current={anchor === activeSection ? 'location' : undefined}
                      onClick={() => jumpTo(anchor)}
                    >
                      <span className="docs-snav__tick" aria-hidden="true" />
                      {section.title}
                    </button>
                  )
                })}
              </nav>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
