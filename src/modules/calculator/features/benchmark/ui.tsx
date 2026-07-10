import type { CSSProperties, KeyboardEvent, MouseEvent, RefCallback } from 'react'
import type { SpinePlacement } from '@/shared/spine/SpinePortrait.tsx'
import type { AttributeKey } from '@/domain/entities/stats'
import type { EchoInstance } from '@/domain/entities/runtime'
import type {
  BenchmarkAlternative,
  BenchmarkBuildKey,
  BenchmarkEchoSlot,
  BenchmarkSetSummary,
} from '@/data/scoring/buildBenchmark.ts'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { ATTR_COLORS } from '@/modules/calculator/model/display'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'
import { makeEffectiveSetPlan } from '@/domain/gameData/sonataPlan'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { formatCompactNum, formatStatKeyLabel, formatStatKeyValue } from '@/modules/calculator/model/statsView.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'

export type CssVars = CSSProperties & Record<string, string | number>

export interface BenchmarkEchoSelection {
  selectionMode: boolean
  isSelected: (id: string) => boolean
  buildClickCapture: (id: string) => (event: MouseEvent<HTMLElement>) => void
  getId: (slotIndex: number) => string
  getItems: (id: string, echo: EchoInstance) => MenuEntry[]
  surfaceProps: {
    ref?: RefCallback<HTMLElement>
    tabIndex?: number
    onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
    'data-selection-focus-scope'?: string
    'data-selection-focus-active'?: string
    'data-selection-mode-active'?: string
  }
}

const DEFAULT_BENCHMARK_SPINE_PLACEMENT: SpinePlacement = {
  x: 2017.173,
  y: 1512.373,
  scale: 3,
}

const defaults = DEFAULT_BENCHMARK_SPINE_PLACEMENT

const BENCHMARK_SPINE_PLACEMENTS: Record<string, SpinePlacement> = {
  '1412': {
    x: 1907.173,
    y: defaults.y,
    scale: defaults.scale,
  },
  '1411': {
    x: 1907.173,
    y: defaults.y,
    scale: defaults.scale,
  },
  '1505': {
    x: 1907.173,
    y: defaults.y - 100,
    scale: defaults.scale,
  },
  '1208': {
    x: 1957.173,
    y: defaults.y,
    scale: defaults.scale,
  },
  '1506': {
    x: 1957.173,
    y: defaults.y + 88,
    scale: defaults.scale,
  },
  '1509': {
    x: 1957.173,
    y: defaults.y,
    scale: defaults.scale,
  },
  '1107': {
    x: 2087.173,
    y: defaults.y - 110,
    scale: defaults.scale,
  },
  '1108': {
    x: 2087.173,
    y: defaults.y + 148,
    scale: defaults.scale,
  },
  '1207': {
    x: defaults.x,
    y: defaults.y + 148,
    scale: defaults.scale,
  },
  '1510': {
    x: 2017.173,
    y: defaults.y + 150,
    scale: defaults.scale,
  }
}

export function getBenchmarkSpinePlacement(resId: string | null): SpinePlacement {
  return (resId && BENCHMARK_SPINE_PLACEMENTS[resId]) || DEFAULT_BENCHMARK_SPINE_PLACEMENT
}

export const BUILD_LABEL: Record<BenchmarkBuildKey, string> = {
  baseline0: 'Baseline 0%',
  active: 'Current Build',
  benchmark100: 'Benchmark 100%',
  benchmark200: 'Maximum 200%',
}

export type DetailBuildKey = 'active' | 'benchmark100' | 'benchmark200'

export const DETAIL_BUILD_ORDER: DetailBuildKey[] = ['active', 'benchmark100', 'benchmark200']

export const DETAIL_BUILD_LABEL: Record<DetailBuildKey, string> = {
  active: 'Current',
  benchmark100: '100%',
  benchmark200: '200%',
}

const STAT_KEY_ICON: Record<string, string> = {
  atk: 'atk',
  atkPercent: 'atk',
  atkFlat: 'atk',
  hp: 'hp',
  hpPercent: 'hp',
  hpFlat: 'hp',
  def: 'def',
  defPercent: 'def',
  defFlat: 'def',
  critRate: 'critrate',
  critDmg: 'critdmg',
  energyRegen: 'energyregen',
  healingBonus: 'healing',
  tuneBreakBoost: 'tune-break-boost',
  basicAtk: 'basic',
  heavyAtk: 'heavy',
  resonanceSkill: 'skill',
  resonanceLiberation: 'liberation',
  aero: 'aero',
  glacio: 'glacio',
  spectro: 'spectro',
  fusion: 'fusion',
  electro: 'electro',
  havoc: 'havoc',
}

const ELEMENT_KEYS = new Set(['aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc'])

export function statIconSrc(key: string): string | null {
  const file = STAT_KEY_ICON[key]
  return file ? `/assets/stat-icons/${file}.png` : null
}

// Stable id for a stat across the card so flat/percent variants of the same stat
// (atk/atkFlat/atkPercent, etc.) read as one family for the hover-focus feature.
// STAT_KEY_ICON already collapses those variants, so it is the single source.
export function statFamily(key: string): string {
  return STAT_KEY_ICON[key] ?? key
}

export function statTint(key: string): string {
  if (ELEMENT_KEYS.has(key)) {
    return ATTR_COLORS[key as AttributeKey] ?? 'var(--resonator-accent)'
  }
  return 'color-mix(in srgb, var(--muted) 50%, var(--text))'
}

export interface SonataPlanEntry {
  id: number
  count: number
  icon: string | null
}

export function buildSonataPlan(echoes: Parameters<typeof countEchoSets>[0]): SonataPlanEntry[] {
  return makeEffectiveSetPlan(
    Object.entries(countEchoSets(echoes)).map(([setId, count]) => [Number(setId), count] as const),
  ).map((entry) => ({ id: entry.setId, count: entry.pieces, icon: getSntSetIco(entry.setId) }))
}

export type SonataTokenSet = BenchmarkSetSummary & { icon?: string | null }

export function SonataTokens({
  sets,
  className,
  emptyLabel,
  emptyToken = false,
}: {
  sets: SonataTokenSet[]
  className: string
  emptyLabel: string
  emptyToken?: boolean
}) {
  if (sets.length === 0) {
    return emptyToken ? (
      <span className={className}>
        <span className="bench-sonata-set bench-sonata-set--empty" title="No sonata sets">
          <span className="bench-sonata-icon bench-sonata-icon--fallback" />
          <span className="bench-sonata-pc">{emptyLabel}</span>
        </span>
      </span>
    ) : <span className={`${className} bench-sonata-empty`}>{emptyLabel}</span>
  }

  return (
    <span className={className}>
      {sets.map((set) => {
        const icon = set.icon ?? getSntSetIco(set.setId)
        return (
          <span key={set.setId} className="bench-sonata-set" title={`${set.name} · ${set.pieces}pc`}>
            {icon ? (
              <img src={icon} alt="" className="bench-sonata-icon" loading="lazy" onError={withDefIconM} />
            ) : (
              <span className="bench-sonata-icon bench-sonata-icon--fallback" />
            )}
            <span className="bench-sonata-pc">{set.pieces}</span>
          </span>
        )
      })}
    </span>
  )
}

export function scheduleBenchmarkTargetWork(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    callback()
    return () => undefined
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (handle: number) => void
  }

  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 180 })
    return () => idleWindow.cancelIdleCallback?.(handle)
  }

  const handle = window.setTimeout(callback, 80)
  return () => window.clearTimeout(handle)
}

export const BENCH_RAIL_EXIT_MS = 120
export const BENCH_RAIL_ENTER_MS = 260
export const BENCH_SURFACE_EXIT_MS = 180
export const BENCH_SURFACE_ENTER_MS = 460
// Time the rail spends growing/shrinking between views. Must match the
// `.bench-rail { transition: width }` duration in rail.css so the incoming
// surface only fades in once the rail has finished resizing.
export const BENCH_RAIL_RESIZE_MS = 460
export const BENCH_RAIL_PRELOAD_TIMEOUT_MS = 260

export function preloadBenchmarkRailImages(urls: string[]): Promise<void> {
  if (typeof window === 'undefined' || urls.length === 0) {
    return Promise.resolve()
  }

  const uniqueUrls = Array.from(new Set(urls))
  const preload = Promise.all(
    uniqueUrls.map((url) => new Promise<void>((resolve) => {
      const image = new Image()
      let settled = false
      const finish = () => {
        if (!settled) {
          settled = true
          resolve()
        }
      }
      image.onload = finish
      image.onerror = finish
      image.decoding = 'async'
      image.src = url
      if (image.decode) {
        image.decode().then(finish, finish)
      }
    })),
  ).then(() => undefined)

  const timeout = new Promise<void>((resolve) => {
    window.setTimeout(resolve, BENCH_RAIL_PRELOAD_TIMEOUT_MS)
  })

  return Promise.race([preload, timeout])
}

export function fmtSignedPct(value: number): string {
  if (!Number.isFinite(value)) return '--'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${formatTruncCompact(value, 1)}%`
}

export function fmtSignedNumber(value: number): string {
  if (!Number.isFinite(value)) return '--'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${formatCompactNum(value)}`
}

export function deltaSign(value: number): 'up' | 'down' | 'flat' {
  if (value > 0.0001) return 'up'
  if (value < -0.0001) return 'down'
  return 'flat'
}

export function StatGlyph({ statKey, size }: { statKey: string; size?: number }) {
  const icon = statIconSrc(statKey)
  if (!icon) return null
  return (
    <span
      className="bench-stat-glyph"
      style={{
        '--stat-color': statTint(statKey),
        ...(size ? { width: `${size}rem`, height: `${size}rem` } : {}),
        WebkitMaskImage: `url("${icon}")`,
        maskImage: `url("${icon}")`,
      } as CssVars}
    />
  )
}

export interface SwapSide {
  label: string
  glyph?: string
  empty?: boolean
  sets?: BenchmarkSetSummary[]
}

export interface AlternativePathGroup {
  id: string
  from: SwapSide
  to: SwapSide[]
  hiddenCount: number
  representative: BenchmarkAlternative
}

export function describeSwap(
  alt: BenchmarkAlternative,
): { from: SwapSide; to: SwapSide } {
  if (alt.kind === 'sonataSet') {
    return {
      from: { label: 'No set', sets: alt.fromSets ?? [] },
      to: { label: 'No set', sets: alt.toSets ?? [] },
    }
  }
  return {
    from: alt.fromPrimary
      ? { label: formatStatKeyLabel(alt.fromPrimary.key), glyph: alt.fromPrimary.key }
      : { label: 'Empty', empty: true },
    to: alt.toPrimary
      ? { label: formatStatKeyLabel(alt.toPrimary.key), glyph: alt.toPrimary.key }
      : { label: 'Empty', empty: true },
  }
}

export function SwapToken({ side }: { side: SwapSide }) {
  if (side.sets) {
    return (
      <span className="bench-swap-token bench-swap-token--sets">
        <SonataTokens sets={side.sets} className="bench-swap-sets" emptyLabel={side.label} />
      </span>
    )
  }
  return (
    <span className="bench-swap-token">
      {side.empty ? (
        <span className="bench-swap-img bench-swap-img--empty" />
      ) : null}
      {side.glyph ? <StatGlyph statKey={side.glyph} size={0.95} /> : null}
      <span className="bench-swap-label">{side.label}</span>
    </span>
  )
}

export function groupAlternatives(alternatives: BenchmarkAlternative[]): AlternativePathGroup[] {
  const groups = new Map<string, {
    from: SwapSide
    to: SwapSide[]
    representative: BenchmarkAlternative
  }>()

  for (const alternative of alternatives) {
    const swap = describeSwap(alternative)
    const keyParts: Array<string | number> = [
      alternative.operation,
      alternative.cost,
      alternative.fromPrimary?.key ?? 'none',
      alternative.fromSecondaryKey ?? 'none',
      alternative.score,
      alternative.scoreDelta,
      alternative.damage,
      alternative.damageDelta,
      alternative.damageDeltaPct,
    ]
    if (alternative.kind === 'sonataSet') {
      keyParts.push(alternative.from ?? 'none', alternative.to ?? 'none')
    }
    const key = keyParts.join('|')
    const group = groups.get(key)
    if (group) {
      group.to.push(swap.to)
    } else {
      groups.set(key, {
        from: swap.from,
        to: [swap.to],
        representative: alternative,
      })
    }
  }

  return [...groups.entries()].map(([id, group]) => {
    const sortedTo = group.to.slice().sort((left, right) => (
      left.label.localeCompare(right.label)
    ))
    return {
      id,
      from: group.from,
      to: sortedTo.slice(0, 1),
      hiddenCount: Math.max(0, sortedTo.length - 1),
      representative: group.representative,
    }
  })
}

export function EchoCard({
  echo,
  sourceEcho,
  index,
  selection,
}: {
  echo: BenchmarkEchoSlot | null
  sourceEcho?: EchoInstance | null
  index: number
  selection?: BenchmarkEchoSelection
}) {
  if (!echo) {
    return (
      <article className="bench-echo bench-echo--empty" style={{ '--i': index } as CssVars}>
        <span className="bench-echo-empty-mark">{index + 1}</span>
        <span className="bench-echo-empty-label">Empty</span>
      </article>
    )
  }

  const echoDef = getEchoById(echo.echoId)
  const setIcon = getSntSetIco(echo.setId)
  const itemId = selection?.getId(index) ?? null
  const selected = itemId ? selection?.isSelected(itemId) ?? false : false
  const card = (
    <article
      className={[
        'bench-echo',
        echo.mainEcho ? 'bench-echo--main' : '',
        selection?.selectionMode ? 'selection-mode' : '',
        selected ? 'focus-selected' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--i': index } as CssVars}
      data-selection-focus-item={sourceEcho ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      onClickCapture={itemId && sourceEcho ? selection?.buildClickCapture(itemId) : undefined}
    >
      <header className="bench-echo-head">
        <span className="bench-echo-frame">
          {echoDef?.icon ? (
            <img
              src={echoDef.icon}
              alt={echo.echoName}
              className="bench-echo-icon"
              loading="lazy"
              decoding="async"
              onError={withDefIconM}
            />
          ) : (
            <span className="bench-echo-icon bench-echo-icon--fallback" />
          )}
          {setIcon ? (
            <img
              src={setIcon}
              alt={echo.setName}
              className="bench-echo-set"
              loading="lazy"
              decoding="async"
              onError={withDefIconM}
            />
          ) : null}
        </span>
        <span className="bench-echo-titles">
          <strong className="bench-echo-name">{echoDef?.name ?? echo.echoName}</strong>
          <span className="bench-echo-tags">
            <span className="bench-echo-cost">{echo.cost}C</span>
            {echo.mainEcho ? <span className="bench-echo-flag">MAIN</span> : null}
          </span>
        </span>
      </header>

      <div className="bench-echo-mains">
        <div className="bench-echo-main">
          <StatGlyph statKey={echo.primary.key} />
          <span className="bench-echo-main-k">{formatStatKeyLabel(echo.primary.key)}</span>
          <span className="bench-echo-main-v">{formatStatKeyValue(echo.primary.key, echo.primary.value)}</span>
        </div>
        <div className="bench-echo-main bench-echo-main--secondary">
          <StatGlyph statKey={echo.secondary.key} />
          <span className="bench-echo-main-k">{formatStatKeyLabel(echo.secondary.key)}</span>
          <span className="bench-echo-main-v">{formatStatKeyValue(echo.secondary.key, echo.secondary.value)}</span>
        </div>
      </div>

      {echo.equippedSubstats.length > 0 ? (
        <ul className="bench-echo-subs">
          {echo.equippedSubstats.map((stat) => (
            <li key={stat.key} className="bench-echo-sub">
              <StatGlyph statKey={stat.key} size={0.82} />
              <span className="bench-echo-sub-k">{formatStatKeyLabel(stat.key)}</span>
              <span className="bench-echo-sub-v">{formatStatKeyValue(stat.key, stat.value)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bench-echo-subs-empty">No tuned substats</p>
      )}
    </article>
  )

  if (!selection || !sourceEcho || !itemId) {
    return card
  }

  return (
    <ContextTrigger
      asChild
      ariaLabel={`${echoDef?.name ?? echo.echoName} actions`}
      items={selection.getItems(itemId, sourceEcho)}
    >
      {card}
    </ContextTrigger>
  )
}

export function BenchSeqRail({ resId, sequence, hidden }: { resId: string; sequence: number; hidden: boolean }) {
  const fill = sequence > 1 ? ((sequence - 1) / 5) * 100 : 0
  return (
    <div
      className="bench-seq-rail"
      data-hidden={hidden ? 'true' : undefined}
      style={{ '--seq-fill': `${fill}%` } as CssVars}
      aria-hidden={hidden ? 'true' : undefined}
      aria-label={hidden ? undefined : `Resonance chain ${sequence} of 6`}
    >
      {Array.from({ length: 6 }, (_, i) => {
        const node = i + 1
        return (
          <span
            key={node}
            className="bench-seq-node"
            data-on={node <= sequence ? 'true' : undefined}
            data-current={node === sequence && sequence > 0 ? 'true' : undefined}
          >
            <span
              className="bench-seq-glyph"
              style={{ '--seq-mask': `url("/assets/resonators/skills/${resId}/sequence/${node}.webp")` } as CssVars}
            />
          </span>
        )
      })}
    </div>
  )
}
