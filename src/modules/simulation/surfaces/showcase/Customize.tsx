/*
  Author: Runor Ewhro
  description: renders evaluation-card customization and imports and exports serialized style preferences.
*/

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useAppStore } from '@/application/state'
import { Clipboard, SlidersHorizontal, X } from 'lucide-react'
import type { ShowcaseCardHidden, ShowcaseCardStyle, ShowcaseLayout, StatsColumnHighlight, TextSlot, TextSlotStyle } from '@/domain/entities/preferences'
import { EMPTY_TEXT_SLOT, familyFromStack } from './cardStyleVars.ts'
import { isValidGoogleFont, loadGglFontStack } from '@/application/theme/typography.ts'
import type { CardExportTarget } from './cardTransfer.ts'
import type { CssVars } from '@/modules/simulation/workspace/ui.tsx'
import { getLoadedSpineManifest, loadSpineManifest, spineSetupUrl } from '@/shared/spine/spineManifest'
import { getEvaluationSpinePlacement } from '@/shared/spine/placement'
import { TbCameraDown } from 'react-icons/tb'

function TuneSlider({
  label,
  defaultValue = 50,
  suffix = '%',
  min = 0,
  max = 100,
  step = 1,
  value,
  onChange,
}: {
  label: string
  defaultValue?: number
  suffix?: string
  min?: number
  max?: number
  step?: number
  value?: number
  onChange?: (value: number) => void
}) {
  const [local, setLocal] = useState(defaultValue)
  const current = value ?? local
  const fill = ((current - min) / (max - min)) * 100
  return (
    <label className="ctz-sl">
      <span className="ctz-sl-name">{label}</span>
      <input
        type="range" className="ctz-range"
        min={min}
        max={max}
        step={step}
        value={current}
        style={{ '--fill': `${fill}%` } as CssVars}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (onChange) onChange(next)
          else setLocal(next)
        }}
        aria-label={label}
      />
      <output className="ctz-sl-val">{current}{suffix}</output>
    </label>
  )
}

function TuneSwatch({
  label,
  defaultColor,
  value,
  onChange,
}: {
  label: string
  defaultColor?: string
  value?: string
  onChange?: (value: string) => void
}) {
  const [local, setLocal] = useState(defaultColor ?? value ?? '#888888')
  const current = value ?? local
  return (
    <label className="ctz-cp">
      <input
        type="color" className="ctz-color"
        value={current}
        onChange={(event) => {
          const next = event.target.value
          if (onChange) onChange(next)
          else setLocal(next)
        }}
        aria-label={`${label} color`}
      />
      <span className="ctz-cp-name">{label}</span>
      <output className="ctz-cp-hex">{current.toUpperCase()}</output>
    </label>
  )
}

function TuneFont({
  label,
  fallback,
  currentFamily = null,
  onApply,
}: {
  label: string
  fallback: string
  currentFamily?: string | null
  onApply: (stack: string | null) => void
}) {
  const [url, setUrl] = useState('')
  const [family, setFamily] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const request = useRef(0)
  useEffect(() => () => { request.current += 1 }, [])
  const display = family ?? currentFamily

  const handle = (raw: string) => {
    const currentRequest = ++request.current
    setUrl(raw)
    const trimmed = raw.trim()
    if (!trimmed) {
      setInvalid(false)
      setFamily(null)
      onApply(null)
      return
    }
    if (!isValidGoogleFont(trimmed)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    void loadGglFontStack(trimmed, fallback).then((resolved) => {
      if (!resolved || request.current !== currentRequest) return
      setFamily(resolved.family)
      onApply(resolved.stack)
    })
  }

  return (
    <div className="ctz-fd">
      <span className="ctz-fd-head">
        <span>{label}</span>
        {display ? <span className="ctz-fd-val" style={{ fontFamily: `'${display}', ${fallback}` }}>{display}</span> : null}
      </span>
      <input
        type="text"
        inputMode="url"
        className={`ctz-in${invalid ? ' is-invalid' : ''}`}
        value={url}
        placeholder="Paste Google Fonts link"
        spellCheck={false}
        onChange={(event) => handle(event.target.value)}
        aria-label={`${label} font link`}
      />
      {invalid ? <span className="ctz-hint">Not a fonts.googleapis.com link</span> : null}
    </div>
  )
}

const TEXT_SLOT_META: Array<{ key: TextSlot; label: string; sample: string; weight: number; accentColor?: boolean }> = [
  { key: 'numbers', label: 'Numbers', sample: '1,234,567', weight: 800 },
  { key: 'names', label: 'Names', sample: 'Resonator', weight: 700 },
  { key: 'labels', label: 'Labels', sample: 'Crit DMG', weight: 600 },
  { key: 'muted', label: 'Muted', sample: 'Lv. 90', weight: 500 },
  { key: 'display', label: 'Display', sample: 'SSS', weight: 800, accentColor: true },
]

// one editor writes any semantic text role selected by the caller
function TextStyleEditor({
  slots,
  accent,
  surface,
  text,
  onChange,
}: {
  slots: Partial<Record<TextSlot, TextSlotStyle>>
  accent: string
  surface: string
  text: string
  onChange: (next: Partial<Record<TextSlot, TextSlotStyle>>) => void
}) {
  const [active, setActive] = useState<TextSlot>('numbers')
  const meta = TEXT_SLOT_META.find((entry) => entry.key === active) ?? TEXT_SLOT_META[0]
  const slot = slots[active] ?? EMPTY_TEXT_SLOT

  const patch = (next: Partial<TextSlotStyle>) => {
    onChange({ ...slots, [active]: { ...(slots[active] ?? EMPTY_TEXT_SLOT), ...next } })
  }
  const clear = () => {
    const next = { ...slots }
    delete next[active]
    onChange(next)
  }

  return (
    <div className="ctz-roles-w">
      <div className="ctz-roles" role="tablist" aria-label="Text type">
        {TEXT_SLOT_META.map((entry) => {
          const style = slots[entry.key]
          return (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={active === entry.key}
              data-on={active === entry.key ? 'true' : undefined}
              data-set={style ? 'true' : undefined} className="ctz-role"
              onClick={() => setActive(entry.key)}
            >
              <span className="ctz-role-name">{entry.label}</span>
              <span
                className="ctz-role-spec"
                style={{
                  background: surface,
                  color: style?.color ?? (entry.accentColor ? accent : text),
                  fontFamily: style?.font ?? undefined,
                  fontWeight: style?.weight ?? entry.weight,
                  fontSize: `${(style?.size ?? 100) / 100}em`,
                  letterSpacing: `${(style?.spacing ?? 0) / 100}em`,
                  textTransform: style?.transform ?? 'none',
                }}
              >
                {entry.sample}
              </span>
            </button>
          )
        })}
      </div>

      <TuneSwatch
        label="Color"
        value={slot.color ?? (meta.accentColor ? accent : text)}
        onChange={(value) => patch({ color: value })}
      />
      <TuneFont
        key={active}
        label="Font"
        fallback="sans-serif"
        currentFamily={familyFromStack(slot.font)}
        onApply={(stack) => patch({ font: stack })}
      />
      <TuneSlider label="Size" min={50} max={160} value={slot.size ?? 100} onChange={(value) => patch({ size: value })} />
      <TuneSlider
        label="Weight"
        min={100}
        max={900}
        step={100}
        suffix=""
        value={slot.weight ?? meta.weight}
        onChange={(value) => patch({ weight: value })}
      />
      <TuneSlider
        label="Spacing"
        min={-8}
        max={40}
        suffix=""
        value={slot.spacing ?? 0}
        onChange={(value) => patch({ spacing: value })}
      />
      <TuneSegment
        label="Case"
        value={slot.transform ?? 'none'}
        options={[
          { value: 'none', label: 'Aa' },
          { value: 'uppercase', label: 'AA' },
          { value: 'lowercase', label: 'aa' },
          { value: 'capitalize', label: 'Ab' },
        ]}
        onChange={(value) => patch({ transform: value })}
      />
      {slots[active] ? (
        <button type="button" className="ctz-chip ctz-chip--wide" onClick={clear}>
          Reset {meta.label.toLowerCase()}
        </button>
      ) : null}
    </div>
  )
}

function TuneTextarea({
  value,
  placeholder,
  onChange,
}: {
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <textarea className="ctz-code"
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      rows={5}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Custom CSS"
    />
  )
}

// holder identity is global, so local drafts reconcile when another writer, such as the echo parser, changes the
// persisted identity
function TuneIdentity() {
  const playerId = useAppStore((state) => state.ui.preferences.playerId)
  const playerUid = useAppStore((state) => state.ui.preferences.playerUid)
  const setIdentity = useAppStore((state) => state.setPlayerIdentity)
  return (
    <TuneIdentityDraft
      key={`${playerId}\u0000${playerUid}`}
      initialId={playerId}
      initialUid={playerUid}
      setIdentity={setIdentity}
    />
  )
}

function TuneIdentityDraft({
  initialId,
  initialUid,
  setIdentity,
}: {
  initialId: string
  initialUid: string
  setIdentity: (id: string, uid: string) => void
}) {
  const initial = { id: initialId, uid: initialUid }
  const [draft, setDraft] = useState(initial)
  const draftRef = useRef(draft)

  const updateDraft = (next: { id: string; uid: string }) => {
    draftRef.current = next
    setDraft(next)
  }

  const commit = () => {
    const next = draftRef.current
    if (next.id.trim() !== initialId || next.uid.trim() !== initialUid) {
      setIdentity(next.id, next.uid)
    }
  }

  useEffect(() => () => {
    const current = useAppStore.getState().ui.preferences
    if (current.playerId !== initialId || current.playerUid !== initialUid) return
    const next = draftRef.current
    if (next.id.trim() !== initialId || next.uid.trim() !== initialUid) {
      setIdentity(next.id, next.uid)
    }
  }, [initialId, initialUid, setIdentity])

  return (
    <div className="ctz-ident">
      <label className="ctz-fd">
        <span className="ctz-fd-head">Player</span>
        <input
          type="text" className="ctz-in"
          id="showcase-player-id"
          placeholder="Name"
          value={draft.id}
          onChange={(event) => updateDraft({ ...draft, id: event.target.value })}
          onBlur={commit}
        />
      </label>
      <label className="ctz-fd">
        <span className="ctz-fd-head">UID</span>
        <input
          type="text" className="ctz-in"
          id="showcase-player-uid"
          inputMode="numeric"
          placeholder="500295087"
          value={draft.uid}
          onChange={(event) => updateDraft({ ...draft, uid: event.target.value })}
          onBlur={commit}
        />
      </label>
    </div>
  )
}

function Chip({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children?: ReactNode }) {
  return (
    <button
      type="button" className="ctz-chip"
      aria-pressed={on}
      aria-label={children ? label : undefined}
      title={children ? label : undefined}
      onClick={onClick}
    >
      {children ?? label}
    </button>
  )
}

function TuneCreditField({
  label,
  on,
  value,
  onToggle,
  onChange,
}: {
  label: string
  on: boolean
  value: string
  onToggle: () => void
  onChange: (value: string) => void
}) {
  return (
    <div className="ctz-credit">
      <TuneToggle label={label} on={on} onChange={onToggle} />
      <input
        type="text" className="ctz-in"
        placeholder="@artist or source"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`${label} handle`}
      />
    </div>
  )
}


function TuneToggle({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <button
      type="button" className="ctz-tg"
      role="switch"
      aria-checked={on}
      onClick={onChange}
    >
      <span>{label}</span>
      <i aria-hidden="true" />
    </button>
  )
}

function TuneSegment<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  label?: string
  ariaLabel?: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  const at = Math.max(0, options.findIndex((opt) => opt.value === value))
  return (
    <div className="ctz-sg-w">
      {label ? <span className="ctz-sg-name">{label}</span> : null}
      <div
        className="ctz-sg" role="radiogroup" aria-label={label ?? ariaLabel}
        style={{ '--n': options.length, '--i': at } as CssVars}
      >
        <i className="ctz-sg-pill" aria-hidden="true" />
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button" className="ctz-sg-opt"
            role="radio"
            aria-checked={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function TuneAsset({
  name,
  hint,
  imageUrl,
  editing,
  onPick,
  onEdit,
}: {
  name: string
  hint: string
  imageUrl: string | null
  editing: boolean
  onPick: () => void
  onEdit: () => void
}) {
  return (
    <div className="ctz-asset">
      <span className="ctz-thumb"
        style={imageUrl ? { backgroundImage: `url("${imageUrl}")` } : undefined}
        aria-hidden="true"
      />
      <span className="ctz-asset-copy">
        <strong>{name}</strong>
        <span>{imageUrl ? 'Custom' : hint}</span>
      </span>
      <Chip label={imageUrl ? 'Change' : 'Add'} onClick={onPick} />
      <Chip label={editing ? 'Done' : 'Edit on card'} on={editing} onClick={onEdit} />
    </div>
  )
}

type Layer = 'type' | 'marks' | 'glass' | 'portrait' | 'backdrop'
type Pane = Layer | 'css'

// top of the stack first, the card's compositing order
const LAYERS: Array<{ key: Layer; label: string }> = [
  { key: 'type', label: 'Type' },
  { key: 'marks', label: 'Marks' },
  { key: 'glass', label: 'Glass' },
  { key: 'portrait', label: 'Portrait' },
  { key: 'backdrop', label: 'Backdrop' },
]

const LAYOUTS: Array<{ value: ShowcaseLayout; label: string; hint: string }> = [
  { value: 'classic', label: 'Classic', hint: 'Some free marks' },
  { value: 'seal', label: 'Seal', hint: 'Less free marks' },
]

function LayoutGlyph({ layout }: { layout: ShowcaseLayout }) {
  return (
    <svg viewBox="0 0 32 22" width="25" height="17" fill="currentColor" aria-hidden="true">
      {layout === 'classic' ? (
        <>
          <rect x="1" y="1" width="10" height="20" rx="1.5" />
          <rect x="12.5" y="1" width="11.5" height="13" rx="1.5" />
          <rect x="25.5" y="1" width="5.5" height="6" rx="1" />
          <rect x="25.5" y="8" width="5.5" height="6" rx="1" />
          <rect x="12.5" y="15.5" width="5.5" height="5.5" rx="1" />
          <rect x="19" y="15.5" width="5.5" height="5.5" rx="1" />
          <rect x="25.5" y="15.5" width="5.5" height="5.5" rx="1" />
        </>
      ) : (
        <>
          <rect x="1" y="1" width="11" height="12" rx="1.5" />
          <rect x="14" y="1" width="17" height="12" rx="1.5" />
          <rect x="1" y="15" width="5" height="6" rx="1" />
          <rect x="7.2" y="15" width="5" height="6" rx="1" />
          <rect x="13.5" y="15" width="5" height="6" rx="1" />
          <rect x="19.8" y="15" width="5" height="6" rx="1" />
          <rect x="26" y="15" width="5" height="6" rx="1" />
        </>
      )}
    </svg>
  )
}

interface PlatePreview {
  art: string
  portraitCustom: boolean
  surface: string
  text: string
  accent: string
  opacity: number
  displayFont: string | null
  slots: Partial<Record<TextSlot, TextSlotStyle>>
  hidden: ShowcaseCardHidden
  classic: boolean
  maskBottom: number
  backdropX: number
  backdropY: number
  backdropScale: number
  backdropBlur: number
  backdropOpacity: number
}

type Box = [left: number, top: number, width: number, height: number]

const box = ([left, top, width, height]: Box) => ({
  left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`,
})

// part positions as percentages of the 992x720 card for each layout
const LAYOUT_GRID: Record<'classic' | 'detailed', {
  figure: Box
  panel: Box
  tiles: Box[]
  score: Box
  damage: Box
  cv: Box
  rail: Box
  team: Box[]
  brand: Box
  name: Box
  stats: Box
}> = {
  detailed: {
    figure: [0, 0, 46, 62],
    panel: [38.5, 9, 58, 48],
    tiles: [0, 1, 2, 3, 4].map((at): Box => [1.6 + at * 19.6, 64, 17.6, 33]),
    score: [39.5, 3, 23, 9],
    damage: [39.5, 14, 26, 6],
    cv: [67, 14.5, 7, 4],
    rail: [34.6, 11, 3.6, 46],
    team: [[75, 10, 21, 46]],
    brand: [83, 2.5, 14, 3.5],
    name: [5.5, 50, 23, 7.5],
    stats: [40, 24, 33, 31],
  },
  classic: {
    figure: [0, 0, 34, 100],
    panel: [34.5, 2.4, 42, 62.4],
    tiles: [[77.9, 2.4, 20.4, 30.4], [77.9, 34.5, 20.4, 30.2], [34.5, 66.5, 20.4, 30.2], [56.2, 66.5, 20.4, 30.2], [77.9, 66.5, 20.4, 30.2]],
    score: [36.7, 8, 22.6, 7],
    damage: [36.7, 19.6, 18, 7.6],
    cv: [56, 19.6, 18.4, 7.6],
    rail: [1.4, 4.5, 4, 48],
    team: [[1.6, 75, 31, 10.5], [1.6, 86.6, 31, 10.5]],
    brand: [79, 96.6, 19, 2.2],
    name: [1.6, 56.5, 16, 5],
    stats: [36.7, 32.7, 37.8, 29],
  },
}

// each plate is that card layer in miniature, placed on the card's own grid
function PlateArt({ layer, preview }: { layer: Layer; preview: PlatePreview }) {
  const { slots, hidden, classic } = preview
  const grid = LAYOUT_GRID[classic ? 'classic' : 'detailed']
  if (layer === 'type') {
    return (
      <>
        <span className="ctz-p-ty" style={{ color: slots.display?.color ?? preview.accent, fontFamily: slots.display?.font ?? preview.displayFont ?? undefined }}>Aa</span>
        <span className="ctz-p-ln" style={{ top: '14%', width: '34%', height: '9%', background: slots.numbers?.color ?? preview.text }} />
        <span className="ctz-p-ln" style={{ top: '31%', width: '26%', background: slots.names?.color ?? preview.text }} />
        <span className="ctz-p-ln" style={{ top: '42%', width: '30%', background: slots.labels?.color ?? preview.text }} />
        <span className="ctz-p-ln" style={{ top: '53%', width: '22%', background: slots.muted?.color ?? preview.text, opacity: slots.muted?.color ? 1 : 0.55 }} />
      </>
    )
  }
  if (layer === 'marks') {
    // the detailed layout always shows these, so only classic can drop them
    const off = (key: keyof ShowcaseCardHidden, locked = false) => (hidden[key] && (classic || !locked) ? 'true' : undefined)
    return (
      <>
        <span className="ctz-p-mk ctz-p-mk--score" data-off={off('score', true)} style={box(grid.score)} />
        <span className="ctz-p-mk" data-off={off('damage', true)} style={box(grid.damage)} />
        <span className="ctz-p-mk" data-off={off('cv', true)} style={box(grid.cv)} />
        <span className="ctz-p-mk ctz-p-mk--rail" data-off={off('seqRail', true)} style={box(grid.rail)} />
        {grid.team.map((at, index) => (
          <span key={index} className="ctz-p-mk" data-off={off('team', true)} style={box(at)} />
        ))}
        <span className="ctz-p-mk" data-off={off('brand')} style={box(grid.brand)} />
        <span className="ctz-p-mk" style={box(grid.name)} />
        <span className="ctz-p-mk ctz-p-mk--stats" data-hot={hidden.relStats ? undefined : 'true'} style={box(grid.stats)}>
          <i /><i /><i /><i /><i />
        </span>
        {grid.tiles.map(([left, top, width, height], index) => (
          <span
            key={index} className="ctz-p-mk ctz-p-mk--sub"
            data-off={off('subVal')}
            data-tint={hidden.subColor ? undefined : 'true'}
            style={box([left + 2, top + height - 5, width - 4, 2.5])}
          />
        ))}
      </>
    )
  }
  if (layer === 'glass') {
    const fill = { background: `color-mix(in srgb, ${preview.surface} ${preview.opacity}%, transparent)` }
    return (
      <>
        <span className="ctz-p-gl" style={{ ...box(grid.panel), ...fill }} />
        {grid.tiles.map((at, index) => (
          <span key={index} className="ctz-p-gl" style={{ ...box(at), ...fill }} />
        ))}
      </>
    )
  }
  if (layer === 'portrait') {
    const fade = `linear-gradient(to top, transparent, #000 ${Math.max(preview.maskBottom, 1)}%)`
    return (
      <span
        className="ctz-p-fig"
        data-custom={preview.portraitCustom ? 'true' : undefined}
        style={{ ...box(grid.figure), backgroundImage: `url("${preview.art}")`, maskImage: fade, WebkitMaskImage: fade }}
      />
    )
  }
  return (
    <span
      className="ctz-p-bg"
      style={{
        backgroundImage: `url("${preview.art}")`,
        backgroundSize: `${preview.backdropScale * 3}%`,
        backgroundPosition: `${preview.backdropX}% ${preview.backdropY}%`,
        opacity: preview.backdropOpacity / 100,
        filter: `blur(${((preview.backdropBlur / 100) * 3).toFixed(2)}px) saturate(1.3)`,
      }}
    />
  )
}

// the portrait's containing block on the card, in percent of the card
const FRAME_FIGURE: Box = [0, 0, 32.25, 51.1]
const SPINE_SPACE = 4096
const SPINE_REACH = 800
// the detailed layout raises the spine art by 7rem of the card's 45rem; an uploaded image stays at its position
const DETAIL_LIFT = (7 / 45) * 100

type FrameEdge = 'Top' | 'Right' | 'Bottom' | 'Left'
const FRAME_EDGES: FrameEdge[] = ['Top', 'Right', 'Bottom', 'Left']

const clampTo = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)))

function useFrameDrag<T>(
  snapshot: () => T,
  onDrag: (dx: number, dy: number, from: T, event: ReactPointerEvent<HTMLElement>) => void,
) {
  const origin = useRef<{ x: number; y: number; from: T } | null>(null)
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      origin.current = { x: event.clientX, y: event.clientY, from: snapshot() }
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const start = origin.current
      if (start) onDrag(event.clientX - start.x, event.clientY - start.y, start.from, event)
    },
    onPointerUp: () => { origin.current = null },
    onPointerCancel: () => { origin.current = null },
  }
}

// a miniature of the card: the art is placed with the card's own arithmetic, so dragging it here moves it the same
// distance on the card
function PortraitFrame({
  art,
  resId,
  x,
  y,
  scale,
  lift,
  fade,
  sharp,
  onChange,
}: {
  art: string
  resId: string | null
  lift: number
  x: number
  y: number
  scale: number
  fade: Record<FrameEdge, number>
  sharp: Record<FrameEdge, number>
  onChange: (patch: Partial<ShowcaseCardStyle>) => void
}) {
  const win = useRef<HTMLDivElement>(null)
  const base = getEvaluationSpinePlacement(resId)
  const [figLeft, figTop, figWidth, figHeight] = FRAME_FIGURE
  const zoom = base.scale * (0.5 + scale / 100)
  const width = zoom * figWidth
  const height = zoom * figHeight
  const left = figLeft + figWidth / 2 - ((base.x - ((x - 50) / 50) * SPINE_REACH) / SPINE_SPACE) * width
  const top = figTop + figHeight / 2 - lift - ((base.y - ((y - 50) / 50) * SPINE_REACH) / SPINE_SPACE) * height
  const perUnit = SPINE_SPACE / SPINE_REACH * 50

  const move = useFrameDrag(() => ({ x, y }), (dx, dy, from) => {
    const rect = win.current?.getBoundingClientRect()
    if (!rect) return
    onChange({
      portraitX: clampTo(from.x + ((dx / rect.width) * 100 * perUnit) / width, -100, 200),
      portraitY: clampTo(from.y + ((dy / rect.height) * 100 * perUnit) / height, -100, 200),
    })
  })
  const pull = useFrameDrag(() => null, (_dx, _dy, _from, event) => {
    const rect = win.current?.getBoundingClientRect()
    const edge = event.currentTarget.dataset.edge as FrameEdge | undefined
    if (!rect || !edge) return
    const px = ((event.clientX - rect.left) / rect.width) * 100
    const py = ((event.clientY - rect.top) / rect.height) * 100
    const value = edge === 'Top' ? (py - top) / height
      : edge === 'Bottom' ? (top + height - py) / height
      : edge === 'Left' ? (px - left) / width
      : (left + width - px) / width
    onChange({ [`mask${edge}`]: clampTo(value * 100, 0, 100) })
  })

  const stop = (edge: FrameEdge, to: string) =>
    `linear-gradient(to ${to}, transparent ${fade[edge] * (sharp[edge] / 100)}%, #000 ${fade[edge]}%)`
  const mask = [stop('Top', 'bottom'), stop('Right', 'left'), stop('Bottom', 'top'), stop('Left', 'right')].join(', ')
  const line: Record<FrameEdge, CSSProperties> = {
    Top: { top: `${Math.min(100, Math.max(0, top + (fade.Top / 100) * height))}%` },
    Bottom: { top: `${Math.min(100, Math.max(0, top + height - (fade.Bottom / 100) * height))}%` },
    Left: { left: `${Math.min(100, Math.max(0, left + (fade.Left / 100) * width))}%` },
    Right: { left: `${Math.min(100, Math.max(0, left + width - (fade.Right / 100) * width))}%` },
  }

  return (
    <div ref={win} className="ctz-win" {...move} aria-hidden="true">
      <span
        className="ctz-win-fig"
        style={{
          left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`,
          backgroundImage: `url("${art}")`, maskImage: mask, WebkitMaskImage: mask,
        }}
      />
      {FRAME_EDGES.map((edge) => (
        <i key={edge} className="ctz-win-edge" data-edge={edge} style={line[edge]} {...pull} />
      ))}
    </div>
  )
}

function BackdropFrame({
  art,
  x,
  y,
  scale,
  blur,
  opacity,
  onChange,
}: {
  art: string
  x: number
  y: number
  scale: number
  blur: number
  opacity: number
  onChange: (patch: Partial<ShowcaseCardStyle>) => void
}) {
  const win = useRef<HTMLDivElement>(null)
  const ratio = useRef(16 / 9)
  useEffect(() => {
    const probe = new Image()
    probe.onload = () => { if (probe.naturalHeight) ratio.current = probe.naturalWidth / probe.naturalHeight }
    probe.src = art
    return () => { probe.onload = null }
  }, [art])

  // background-position percentages move across the slack between box and image
  const move = useFrameDrag(() => ({ x, y }), (dx, dy, from) => {
    const rect = win.current?.getBoundingClientRect()
    if (!rect) return
    const artWidth = rect.width * ((scale * 3) / 100)
    const slackX = rect.width - artWidth
    const slackY = rect.height - artWidth / ratio.current
    onChange({
      ...(Math.abs(slackX) > 1 ? { backdropX: clampTo(from.x + (dx / slackX) * 100, -100, 200) } : {}),
      ...(Math.abs(slackY) > 1 ? { backdropY: clampTo(from.y + (dy / slackY) * 100, -100, 200) } : {}),
    })
  })

  return (
    <div ref={win} className="ctz-win" {...move} aria-hidden="true">
      <span
        className="ctz-win-bg"
        style={{
          backgroundImage: `url("${art}")`,
          backgroundSize: `${scale * 3}%`,
          backgroundPosition: `${x}% ${y}%`,
          opacity: opacity / 100,
          filter: `blur(${((blur / 100) * 2.6).toFixed(2)}px) saturate(1.3)`,
        }}
      />
    </div>
  )
}

export function ShowcaseCustomizePanel({
  layout,
  onLayoutChange,
  accent,
  surface,
  text,
  cardOpacity,
  portraitX,
  portraitY,
  portraitScale,
  maskTop,
  maskRight,
  maskBottom,
  maskLeft,
  maskTopSharp,
  maskRightSharp,
  maskBottomSharp,
  maskLeftSharp,
  portraitImage,
  backdropImage,
  resId,
  fallbackArt,
  displayFont,
  backdropX,
  backdropY,
  backdropScale,
  backdropBlur,
  backdropOpacity,
  statsColumn,
  portraitCredit,
  backdropCredit,
  textSlots,
  customCss,
  editMode,
  onEdit,
  hidden,
  onToggleHidden,
  onStyleChange,
  onResetSection,
  onPickImage,
  onResetGroup,
  onReset,
  onCapture,
  captureAction,
  capturing,
  onExport,
  onImportFile,
  docked,
  drawerOpen,
  onToggleDrawer,
  onExpandCss,
  board,
}: {
  layout: ShowcaseLayout
  onLayoutChange: (layout: ShowcaseLayout) => void
  accent: string
  surface: string
  text: string
  cardOpacity: number
  portraitX: number
  portraitY: number
  portraitScale: number
  maskTop: number
  maskRight: number
  maskBottom: number
  maskLeft: number
  maskTopSharp: number
  maskRightSharp: number
  maskBottomSharp: number
  maskLeftSharp: number
  portraitImage: string | null
  backdropImage: string | null
  resId: string | null
  fallbackArt: string
  displayFont: string | null
  backdropX: number
  backdropY: number
  backdropScale: number
  backdropBlur: number
  backdropOpacity: number
  statsColumn: StatsColumnHighlight
  portraitCredit: string
  backdropCredit: string
  textSlots: Partial<Record<TextSlot, TextSlotStyle>>
  customCss: string
  editMode: 'portrait' | 'backdrop' | null
  onEdit: (group: 'portrait' | 'backdrop') => void
  hidden: ShowcaseCardHidden
  onToggleHidden: (key: keyof ShowcaseCardHidden) => void
  onStyleChange: (patch: Partial<ShowcaseCardStyle>) => void
  onResetSection: (section: 'show' | 'color' | 'type') => void
  onPickImage: (target: 'portrait' | 'backdrop') => void
  onResetGroup: (group: 'portrait' | 'backdrop') => void
  onReset: () => void
  onCapture: (action: 'download' | 'clipboard') => void
  captureAction: 'download' | 'clipboard' | null
  capturing: boolean
  onExport: (target: CardExportTarget) => void
  onImportFile: (file: File) => void
  docked: boolean
  drawerOpen: boolean
  onToggleDrawer: () => void
  onExpandCss: () => void
  // a leaderboard card look: this footer replaces capture, and the showcase-only parts (layout, import, export, css,
  // identity) are left out
  board?: ReactNode
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [baseTypeResetKey, setBaseTypeResetKey] = useState(0)
  const [pane, setPane] = useState<Pane | null>(null)
  // the inspector's last layer stays mounted while it folds shut
  const [shown, setShown] = useState<Pane>('marks')
  const [hot, setHot] = useState<Layer | null>(null)
  const openImport = () => fileInputRef.current?.click()
  // the card's default art is the resonator's spine setup frame when it has one
  const [spineManifest, setSpineManifest] = useState(() => getLoadedSpineManifest())
  useEffect(() => {
    if (spineManifest) return undefined
    let live = true
    void loadSpineManifest().then((loaded) => {
      if (live) setSpineManifest(loaded)
    })
    return () => {
      live = false
    }
  }, [spineManifest])
  const spineArt = resId && spineManifest?.[resId]?.luckdraw ? spineSetupUrl(resId, 'luckdraw') : fallbackArt
  const preview = {
    surface, text, accent, displayFont, hidden, maskBottom,
    opacity: cardOpacity,
    slots: textSlots,
    classic: layout === 'classic',
    backdropX, backdropY, backdropScale, backdropBlur, backdropOpacity,
  }

  const pick = (next: Pane | null) => {
    const target = next === pane ? null : next
    if (editMode && target !== editMode) onEdit(editMode)
    if (target) setShown(target)
    setPane(target)
  }

  const picked = LAYERS.findIndex((entry) => entry.key === pane)
  const markKeys: Array<keyof ShowcaseCardHidden> = layout === 'classic'
    ? ['score', 'damage', 'cv', 'subVal', 'subColor', 'relStats', 'seqRail', 'team', 'brand']
    : ['subVal', 'subColor', 'relStats', 'brand']
  const marksOn = markKeys.filter((key) => !hidden[key]).length
  const styledRoles = Object.keys(textSlots).length
  const readout: Record<Layer, string> = {
    type: styledRoles ? `${styledRoles} styled` : 'Defaults',
    marks: `${marksOn} of ${markKeys.length} shown`,
    glass: `${cardOpacity}% opaque`,
    portrait: portraitImage ? 'Custom' : 'Spine',
    backdrop: backdropImage ? 'Custom' : 'Splash art',
  }
  const shownLabel = shown === 'css' ? 'Custom CSS' : LAYERS.find((entry) => entry.key === shown)?.label

  const resetShown = () => {
    if (shown === 'type') {
      onResetSection('type')
      setBaseTypeResetKey((key) => key + 1)
    } else if (shown === 'marks') onResetSection('show')
    else if (shown === 'glass') onResetSection('color')
    else if (shown === 'portrait' || shown === 'backdrop') onResetGroup(shown)
  }
  const exportShown = () => {
    onExport(shown === 'marks' ? 'show' : shown === 'glass' ? 'color' : shown)
  }

  return (
    <aside className="wk-tune ctz"
      data-docked={docked ? 'true' : undefined}
      data-open={docked && drawerOpen ? 'true' : undefined}
      data-pane={pane ?? undefined}
      style={{ '--resonator-accent': accent, '--ctz-card': surface, '--ctz-ink': text } as CssVars}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && pane) pick(null)
      }}
    >
      {docked ? (
        <button
          type="button" className="wk-tune-handle"
          onClick={onToggleDrawer}
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? 'Hide controls' : 'Show controls'}
        >
          <SlidersHorizontal size="1em" aria-hidden="true" />
        </button>
      ) : null}
      <header className="ctz-head">
        <div className="ctz-line">
          <span className="ctz-title">Customize</span>
          <span className="ctz-tools">
            {board ? null : <>
              <button type="button" className="ctz-tool" onClick={openImport} title="Import card or group file">Import</button>
              <button type="button" className="ctz-tool" onClick={() => onExport('all')} title="Export everything to JSON">Export</button>
              <button type="button" className="ctz-tool" aria-pressed={pane === 'css'} onClick={() => pick('css')}>CSS</button>
            </>}
            <button type="button" className="ctz-tool" onClick={onReset}>Reset</button>
          </span>
        </div>
        <div className="ctz-rule">Layers</div>
      </header>

      {board ? null : <div className="ctz-lay">
        <div
          className="ctz-sg ctz-sg--tile" role="radiogroup" aria-label="Card layout"
          style={{ '--n': LAYOUTS.length, '--i': LAYOUTS.findIndex((entry) => entry.value === layout) } as CssVars}
        >
          <i className="ctz-sg-pill" aria-hidden="true" />
          {LAYOUTS.map((entry) => (
            <button
              key={entry.value}
              type="button" className="ctz-sg-opt"
              role="radio"
              aria-checked={layout === entry.value}
              onClick={() => onLayoutChange(entry.value)}
            >
              <span className="ctz-tile-well"><LayoutGlyph layout={entry.value} /></span>
              <em>{entry.label}</em>
              <small>{entry.hint}</small>
            </button>
          ))}
        </div>
      </div>}

      <div className="ctz-well">
        {LAYERS.map((entry, at) => {
          const on = pane === entry.key
          const nudge = picked < 0 || at === picked ? 0 : at < picked ? -1 : 1
          const vars = { '--i': at, '--nudge': nudge, zIndex: 9 - at } as CssVars
          return (
            <span key={entry.key} className="ctz-layer">
              <button
                type="button" className="ctz-plt"
                data-layer={entry.key}
                data-on={on ? 'true' : undefined}
                data-hot={hot === entry.key ? 'true' : undefined}
                style={vars}
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => pick(entry.key)}
              >
                <PlateArt
                  layer={entry.key}
                  preview={{
                    ...preview,
                    art: (entry.key === 'portrait' ? portraitImage : backdropImage) ?? spineArt,
                    portraitCustom: portraitImage != null,
                  }}
                />
              </button>
              <button
                type="button" className="ctz-row"
                aria-pressed={on}
                aria-expanded={on}
                style={vars}
                onClick={() => pick(entry.key)}
                onPointerEnter={() => setHot(entry.key)}
                onPointerLeave={() => setHot(null)}
              >
                <b>{entry.label}</b>
                <small>{readout[entry.key]}</small>
              </button>
            </span>
          )
        })}
      </div>

      <div className="ctz-ins" inert={pane == null}>
        <div className="ctz-ins-head">
          <b>{shownLabel}</b>
          {shown === 'css' ? (
            <>
              <Chip label="Import" onClick={openImport} />
              <Chip label={docked ? 'Collapse' : 'Expand'} onClick={onExpandCss} />
            </>
          ) : (
            <Chip label="Reset" onClick={resetShown} />
          )}
          {board ? null : <Chip label="Export" onClick={exportShown} />}
          <Chip label="Close" onClick={() => pick(null)}><X size="0.75rem" aria-hidden="true" /></Chip>
        </div>
        <div className="ctz-ins-scroll">
          <div className="ctz-body" key={shown}>
            {shown === 'type' ? (
              <>
                <TuneFont key={`display-${baseTypeResetKey}`} label="Display font" fallback="sans-serif" onApply={(stack) => onStyleChange({ displayFont: stack })} />
                <TuneFont key={`mono-${baseTypeResetKey}`} label="Mono font" fallback="monospace" onApply={(stack) => onStyleChange({ monoFont: stack })} />
                <TuneSwatch label="Text color" value={text} onChange={(v) => onStyleChange({ text: v })} />
                <span className="ctz-sub">
                  Per-text styles
                  {board ? null : <Chip label="Export" onClick={() => onExport('text')} />}
                </span>
                <TextStyleEditor
                  slots={textSlots}
                  accent={accent}
                  surface={surface}
                  text={text}
                  onChange={(next) => onStyleChange({ textSlots: next })}
                />
              </>
            ) : null}

            {shown === 'marks' ? (
              <>
                {board ? null : <TuneIdentity />}
                {layout === 'classic' ? (
                  <>
                    <TuneToggle label="Build score" on={!hidden.score} onChange={() => onToggleHidden('score')} />
                    <TuneToggle label="Average DMG" on={!hidden.damage} onChange={() => onToggleHidden('damage')} />
                    <TuneToggle label="Crit value" on={!hidden.cv} onChange={() => onToggleHidden('cv')} />
                  </>
                ) : null}
                <TuneToggle label="Sub stat value" on={!hidden.subVal} onChange={() => onToggleHidden('subVal')} />
                <TuneToggle label="Sub stat value colors" on={!hidden.subColor} onChange={() => onToggleHidden('subColor')} />
                <TuneToggle label="Relevant stat highlight" on={!hidden.relStats} onChange={() => onToggleHidden('relStats')} />
                {layout === 'classic' ? (
                  <>
                    <TuneToggle label="Resonance Chains" on={!hidden.seqRail} onChange={() => onToggleHidden('seqRail')} />
                    <TuneToggle label="Team" on={!hidden.team} onChange={() => onToggleHidden('team')} />
                  </>
                ) : null}
                <TuneToggle label="Site credit" on={!hidden.brand} onChange={() => onToggleHidden('brand')} />
                {layout === 'seal' ? (
                  <span className="ctz-note">Detailed layout always shows the build score, damage, crit value, chains and team.</span>
                ) : null}
                <TuneSegment
                  label="Stat values"
                  value={statsColumn}
                  options={[
                    { value: 'build', label: 'Build' },
                    { value: 'combat', label: 'Combat' },
                    { value: 'both', label: 'Both' },
                  ]}
                  onChange={(value) => onStyleChange({ statsColumn: value })}
                />
                <span className="ctz-sub">Artist credits</span>
                <TuneCreditField
                  label="Portrait artist"
                  on={!hidden.portraitCredit}
                  value={portraitCredit}
                  onToggle={() => onToggleHidden('portraitCredit')}
                  onChange={(value) => onStyleChange({ portraitCredit: value || null })}
                />
                <TuneCreditField
                  label="Backdrop artist"
                  on={!hidden.backdropCredit}
                  value={backdropCredit}
                  onToggle={() => onToggleHidden('backdropCredit')}
                  onChange={(value) => onStyleChange({ backdropCredit: value || null })}
                />
              </>
            ) : null}

            {shown === 'glass' ? (
              <>
                <TuneSwatch label="Accent" value={accent} onChange={(v) => onStyleChange({ accent: v })} />
                <TuneSwatch label="Surface" value={surface} onChange={(value) => onStyleChange({ surface: value })} />
                <TuneSlider label="Card opacity" value={cardOpacity} onChange={(v) => onStyleChange({ opacity: v })} />
              </>
            ) : null}

            {shown === 'portrait' ? (
              <>
                <TuneAsset
                  name="Main image" hint="Spine" imageUrl={portraitImage}
                  editing={editMode === 'portrait'}
                  onPick={() => onPickImage('portrait')}
                  onEdit={() => onEdit('portrait')}
                />
                <div className="ctz-pad">
                  <PortraitFrame
                    art={portraitImage ?? spineArt} resId={resId}
                    x={portraitX} y={portraitY} scale={portraitScale}
                    lift={layout === 'seal' && !portraitImage ? DETAIL_LIFT : 0}
                    fade={{ Top: maskTop, Right: maskRight, Bottom: maskBottom, Left: maskLeft }}
                    sharp={{ Top: maskTopSharp, Right: maskRightSharp, Bottom: maskBottomSharp, Left: maskLeftSharp }}
                    onChange={onStyleChange}
                  />
                  <div className="ctz-pad-set">
                    <TuneSlider label="X" min={-100} max={200} value={portraitX} onChange={(v) => onStyleChange({ portraitX: v })} />
                    <TuneSlider label="Y" min={-100} max={200} value={portraitY} onChange={(v) => onStyleChange({ portraitY: v })} />
                    <TuneSlider label="Scale" value={portraitScale} onChange={(v) => onStyleChange({ portraitScale: v })} />
                  </div>
                </div>
                <span className="ctz-note">Drag the art to place it. Pull a line to fade that edge.</span>
                <span className="ctz-sub">Edge fade</span>
                <TuneSlider label="Top" value={maskTop} onChange={(v) => onStyleChange({ maskTop: v })} />
                <TuneSlider label="Right" value={maskRight} onChange={(v) => onStyleChange({ maskRight: v })} />
                <TuneSlider label="Bottom" value={maskBottom} onChange={(v) => onStyleChange({ maskBottom: v })} />
                <TuneSlider label="Left" value={maskLeft} onChange={(v) => onStyleChange({ maskLeft: v })} />
                <span className="ctz-sub">Edge sharpness</span>
                <TuneSlider label="Top" value={maskTopSharp} onChange={(v) => onStyleChange({ maskTopSharp: v })} />
                <TuneSlider label="Right" value={maskRightSharp} onChange={(v) => onStyleChange({ maskRightSharp: v })} />
                <TuneSlider label="Bottom" value={maskBottomSharp} onChange={(v) => onStyleChange({ maskBottomSharp: v })} />
                <TuneSlider label="Left" value={maskLeftSharp} onChange={(v) => onStyleChange({ maskLeftSharp: v })} />
              </>
            ) : null}

            {shown === 'backdrop' ? (
              <>
                <TuneAsset
                  name="Background" hint="Splash art" imageUrl={backdropImage}
                  editing={editMode === 'backdrop'}
                  onPick={() => onPickImage('backdrop')}
                  onEdit={() => onEdit('backdrop')}
                />
                <div className="ctz-pad">
                  <BackdropFrame
                    art={backdropImage ?? spineArt}
                    x={backdropX} y={backdropY} scale={backdropScale}
                    blur={backdropBlur} opacity={backdropOpacity}
                    onChange={onStyleChange}
                  />
                  <div className="ctz-pad-set">
                    <TuneSlider label="X" min={-100} max={200} value={backdropX} onChange={(v) => onStyleChange({ backdropX: v, backdropY })} />
                    <TuneSlider label="Y" min={-100} max={200} value={backdropY} onChange={(v) => onStyleChange({ backdropX, backdropY: v })} />
                    <TuneSlider label="Scale" value={backdropScale} onChange={(v) => onStyleChange({ backdropScale: v })} />
                    <TuneSlider label="Blur" value={backdropBlur} onChange={(v) => onStyleChange({ backdropBlur: v })} />
                    <TuneSlider label="Opacity" value={backdropOpacity} onChange={(v) => onStyleChange({ backdropOpacity: v })} />
                  </div>
                </div>
              </>
            ) : null}

            {shown === 'css' ? (
              docked ? (
                <span className="ctz-note">Editing in the side panel; collapse to bring it back here.</span>
              ) : (
                <>
                  <TuneTextarea
                    value={customCss}
                    placeholder={'.sc-grade-score {\n  color: gold;\n}'}
                    onChange={(value) => onStyleChange({ customCss: value || null })}
                  />
                  <span className="ctz-note">You know what to do..</span>
                </>
              )
            ) : null}
          </div>
        </div>
      </div>

      {board ? <div className="ctz-foot">{board}</div> : <div className="ctz-foot">
        <button
          type="button" className="ctz-key"
          disabled={capturing || editMode != null}
          onClick={() => onCapture('download')}
          title={captureAction === 'download' ? 'Capturing' : 'Capture'}
          aria-label="Capture card"
        >
          <TbCameraDown aria-hidden="true" size="1.15em" />
          Capture
        </button>
        <button
          type="button" className="ctz-tag"
          disabled={capturing || editMode != null}
          onClick={() => onCapture('clipboard')}
          title="Copy to clipboard"
        >
          <Clipboard aria-hidden="true" size="1em" />
          Copy
        </button>
      </div>}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.wwcalc,.css,application/json,text/css"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onImportFile(file)
          event.target.value = ''
        }}
      />
    </aside>
  )
}
