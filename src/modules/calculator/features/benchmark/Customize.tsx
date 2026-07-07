import { useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { Expandable } from '@/shared/ui/Expandable'
import { Check, Clipboard, Download, Maximize2, Pipette, RotateCcw, SlidersHorizontal, Upload, X } from 'lucide-react'
import type { BenchmarkCardHidden, StatsColumnHighlight, TextSlot, TextSlotStyle } from '@/domain/entities/preferences'
import { EMPTY_TEXT_SLOT, familyFromStack } from './cardStyleVars.ts'
import { isVldGglFont, loadGglFontStack } from '@/modules/settings/model/typography.ts'
import CodeMirror from '@uiw/react-codemirror'
import { css } from '@codemirror/lang-css'
import type { CardExportTarget } from './cardTransfer.ts'
import type { CssVars } from './ui.tsx'
import {TbCameraDown} from "react-icons/tb";

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
    <label className="bench-tune-ctl">
      <span className="bench-tune-ctl-head">
        <span className="bench-tune-ctl-label">{label}</span>
        <span className="bench-tune-ctl-val">{current}{suffix}</span>
      </span>
      <input
        type="range"
        className="bench-tune-range"
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
    <div className="bench-tune-ctl bench-tune-ctl--row">
      <span className="bench-tune-ctl-label">{label}</span>
      <span className="bench-tune-swatch">
        <span className="bench-tune-hex">{current.toUpperCase()}</span>
        <input
          type="color"
          className="bench-tune-color"
          value={current}
          onChange={(event) => {
            const next = event.target.value
            if (onChange) onChange(next)
            else setLocal(next)
          }}
          aria-label={`${label} color`}
        />
      </span>
    </div>
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
  const display = family ?? currentFamily

  const handle = (raw: string) => {
    setUrl(raw)
    const trimmed = raw.trim()
    if (!trimmed) {
      setInvalid(false)
      setFamily(null)
      onApply(null)
      return
    }
    if (!isVldGglFont(trimmed)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    void loadGglFontStack(trimmed, fallback).then((resolved) => {
      if (!resolved) return
      setFamily(resolved.family)
      onApply(resolved.stack)
    })
  }

  return (
    <div className="bench-tune-ctl">
      <span className="bench-tune-ctl-head">
        <span className="bench-tune-ctl-label">{label}</span>
        {display ? <span className="bench-tune-ctl-val" style={{ fontFamily: `'${display}', ${fallback}` }}>{display}</span> : null}
      </span>
      <input
        type="text"
        inputMode="url"
        className={`bench-tune-input${invalid ? ' is-invalid' : ''}`}
        value={url}
        placeholder="Paste Google Fonts link"
        spellCheck={false}
        onChange={(event) => handle(event.target.value)}
        aria-label={`${label} font link`}
      />
      {invalid ? <span className="bench-tune-hint">Not a fonts.googleapis.com link</span> : null}
    </div>
  )
}

const TEXT_SLOT_META: Array<{ key: TextSlot; label: string; weight: number; accentColor?: boolean }> = [
  { key: 'numbers', label: 'Numbers', weight: 800 },
  { key: 'names', label: 'Names', weight: 700 },
  { key: 'labels', label: 'Labels', weight: 600 },
  { key: 'muted', label: 'Muted', weight: 500 },
  { key: 'display', label: 'Display', weight: 800, accentColor: true },
]

// One reusable control set retargeted by a slot picker, rather than five stacked
// groups, keeping the panel compact while covering every text type.
function TextStyleEditor({
  slots,
  accent,
  text,
  onChange,
}: {
  slots: Partial<Record<TextSlot, TextSlotStyle>>
  accent: string
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
    <div className="bench-tune-slots-w">
      <div className="bench-tune-slots" role="tablist" aria-label="Text type">
        {TEXT_SLOT_META.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={active === entry.key}
            data-on={active === entry.key ? 'true' : undefined}
            data-set={slots[entry.key] ? 'true' : undefined}
            className="bench-tune-slot"
            onClick={() => setActive(entry.key)}
          >
            {entry.label}
          </button>
        ))}
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
        <button type="button" className="bench-tune-slot-clear" onClick={clear}>
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
    <textarea
      className="bench-tune-textarea"
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      rows={5}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Custom CSS"
    />
  )
}

function TuneGroup({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Expandable
      as="section"
      className="bench-tune-group"
      triggerClass="bench-tune-grouptoggle"
      chevronClass="bench-tune-caret"
      chevronSize={13}
      innerClass="bench-tune-groupbody"
      noHeaderWrap
      header={<span className="bench-tune-eyebrow">{title}</span>}
    >
      {actions ? <div className="bench-tune-groupactions">{actions}</div> : null}
      {children}
    </Expandable>
  )
}

// Reuses the image-group Edit button look for the group-level transfer actions.
function GroupActionBtn({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className="bench-tune-edit" onClick={onClick} title={label} aria-label={label}>
      {icon}
      <span className="bench-tune-edit-text">{label}</span>
    </button>
  )
}

// A visibility toggle paired with the artist-handle input for one image.
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
    <div className="bench-tune-credit">
      <TuneToggle label={label} on={on} onChange={onToggle} />
      <input
        type="text"
        className="bench-tune-input"
        placeholder="@artist or source"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`${label} handle`}
      />
    </div>
  )
}

// The expanded editor: a full-height dock that takes the roster-rail slot so the
// card stays visible and updates live as you type. Collapsing returns the rail.
export function BenchCssEditorDock({
  value,
  isDark,
  onChange,
  onClose,
}: {
  value: string
  isDark: boolean
  onChange: (value: string) => void
  onClose: () => void
}) {
  const colorInputRef = useRef<HTMLInputElement>(null)
  const [pickedColor, setPickedColor] = useState('#5b8cff')
  const [copied, setCopied] = useState(false)

  const handlePickColor = (event: ChangeEvent<HTMLInputElement>) => {
    const hex = event.target.value
    setPickedColor(hex)
    setCopied(false)
    void navigator.clipboard?.writeText(hex).then(() => setCopied(true)).catch(() => {})
  }

  return (
    <div className="bench-css-dock" data-phase="in">
      <header className="bench-css-dock-head">
        <span className="bench-css-dock-eyebrow">
          Custom CSS
        </span>
        <div className="bench-css-dock-actions">
          <button
            type="button"
            className="bench-css-dock-pick"
            onClick={() => colorInputRef.current?.click()}
            aria-label={copied ? `Copied ${pickedColor}` : 'Pick a color and copy its hex'}
          >
            <span className="bench-css-dock-swatch" style={{ background: pickedColor }} aria-hidden="true" />
            <span className="bench-css-dock-pick-label">{copied ? `${pickedColor} copied` : 'Pick color'}</span>
            {copied
              ? <Check size={13} aria-hidden="true" />
              : <Pipette size={13} aria-hidden="true" />}
          </button>
          <input
            ref={colorInputRef}
            type="color"
            className="bench-css-dock-color-input"
            value={pickedColor}
            onChange={handlePickColor}
            tabIndex={-1}
            aria-hidden="true"
          />
          <button type="button" className="bench-css-dock-close" onClick={onClose} aria-label="Collapse editor">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </header>
      <CodeMirror
        value={value}
        height="100%"
        extensions={[css()]}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
        }}
        theme={isDark ? 'dark' : 'light'}
        onChange={onChange}
        className="bench-css-dock-editor"
      />
      <p className="bench-css-dock-note">
        Live, scoped to this card. Frame with <code>.bench-rail</code>; reach any inner class like <code>.showcase-echo-name</code>.
      </p>
    </div>
  )
}

function TuneToggle({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      className="bench-tune-toggle"
      role="switch"
      aria-checked={on}
      data-on={on ? 'true' : undefined}
      onClick={onChange}
    >
      <span className="bench-tune-toggle-label">{label}</span>
      <span className="bench-tune-switch" aria-hidden="true"><i /></span>
    </button>
  )
}

function TuneSegment<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="bench-tune-segment">
      <span className="bench-tune-segment-label">{label}</span>
      <div className="bench-tune-segment-track" role="radiogroup" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className="bench-tune-segment-opt"
            role="radio"
            aria-checked={value === opt.value}
            data-on={value === opt.value ? 'true' : undefined}
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
  onPick,
}: {
  name: string
  hint: string
  imageUrl: string | null
  onPick: () => void
}) {
  return (
    <div className="bench-tune-asset">
      <span
        className="bench-tune-thumb"
        style={imageUrl ? { backgroundImage: `url("${imageUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        aria-hidden="true"
      />
      <span className="bench-tune-asset-copy">
        <strong className="bench-tune-asset-name">{name}</strong>
        <span className="bench-tune-asset-hint">{imageUrl ? 'Custom' : hint}</span>
      </span>
      <button type="button" className="bench-tune-asset-btn" onClick={onPick}>
        {imageUrl ? 'Change' : 'Add'}
      </button>
    </div>
  )
}

export function BenchCustomizePanel({
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
  surfacePhase,
}: {
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
  hidden: BenchmarkCardHidden
  onToggleHidden: (key: keyof BenchmarkCardHidden) => void
  onStyleChange: (patch: { accent?: string; surface?: string; text?: string; opacity?: number; displayFont?: string | null; monoFont?: string | null; portraitX?: number; portraitY?: number; portraitScale?: number; maskTop?: number; maskRight?: number; maskBottom?: number; maskLeft?: number; maskTopSharp?: number; maskRightSharp?: number; maskBottomSharp?: number; maskLeftSharp?: number; portraitImage?: string; backdropImage?: string; backdropX?: number; backdropY?: number; backdropScale?: number; backdropBlur?: number; backdropOpacity?: number; statsColumn?: StatsColumnHighlight; portraitCredit?: string | null; backdropCredit?: string | null; textSlots?: Partial<Record<TextSlot, TextSlotStyle>>; customCss?: string | null }) => void
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
  surfacePhase: 'idle' | 'out' | 'in'
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const openImport = () => fileInputRef.current?.click()
  return (
    <aside
      className="bench-card bench-card--mod bench-tune"
      data-docked={docked ? 'true' : undefined}
      data-open={docked && drawerOpen ? 'true' : undefined}
      data-phase={surfacePhase === 'idle' ? undefined : surfacePhase}
      style={{ '--resonator-accent': accent } as CssVars}
    >
      {docked ? (
        <button
          type="button"
          className="bench-tune-handle"
          onClick={onToggleDrawer}
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? 'Hide controls' : 'Show controls'}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
        </button>
      ) : null}
      <header className="bench-tune-head">
        <span className="bench-tune-headline">
          <span className="bench-tune-title">Customize</span>
          <span className="bench-tune-sub">Do what you gotta do.</span>
        </span>
        <button type="button" className="bench-tune-reset" onClick={onReset}>
          <RotateCcw aria-hidden="true" size={12} />
          Reset
        </button>
      </header>

      <div className="bench-tune-body">
        <TuneGroup
          title="Show"
          actions={<GroupActionBtn icon={<Download size={12} aria-hidden="true" />} label="Export" onClick={() => onExport('show')} />}
        >
          <TuneToggle label="Build score" on={!hidden.score} onChange={() => onToggleHidden('score')} />
          <TuneToggle label="Average DMG" on={!hidden.damage} onChange={() => onToggleHidden('damage')} />
          <TuneToggle label="Crit value" on={!hidden.cv} onChange={() => onToggleHidden('cv')} />
          <TuneToggle label="Sub stat value" on={!hidden.subVal} onChange={() => onToggleHidden('subVal')} />
          <TuneToggle label="Sub stat value colors" on={!hidden.subColor} onChange={() => onToggleHidden('subColor')} />
          <TuneToggle label="Relevant stat highlight" on={!hidden.relStats} onChange={() => onToggleHidden('relStats')} />
          <TuneToggle label="Resonance Chains" on={!hidden.seqRail} onChange={() => onToggleHidden('seqRail')} />
          <TuneToggle label="Team" on={!hidden.team} onChange={() => onToggleHidden('team')} />
          <TuneToggle label="Site credit" on={!hidden.brand} onChange={() => onToggleHidden('brand')} />
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
          <span className="bench-tune-subhead">Artist credits</span>
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
        </TuneGroup>

        <TuneGroup
          title="Portrait"
          actions={
            <>
              <button
                type="button"
                className="bench-tune-edit"
                data-on={editMode === 'portrait' ? 'true' : undefined}
                onClick={() => onEdit('portrait')}
              >
                {editMode === 'portrait' ? 'Done' : 'Edit'}
              </button>
              <GroupActionBtn icon={<RotateCcw size={12} aria-hidden="true" />} label="Reset" onClick={() => onResetGroup('portrait')} />
              <GroupActionBtn icon={<Download size={12} aria-hidden="true" />} label="Export" onClick={() => onExport('portrait')} />
            </>
          }
        >
          <TuneAsset name="Main image" hint="Spine · 2048px" imageUrl={portraitImage} onPick={() => onPickImage('portrait')} />
          {editMode === 'portrait' ? (
            <>
              <TuneSlider label="Offset X" min={-100} max={200} value={portraitX} onChange={(v) => onStyleChange({ portraitX: v })} />
              <TuneSlider label="Offset Y" min={-100} max={200} value={portraitY} onChange={(v) => onStyleChange({ portraitY: v })} />
              <TuneSlider label="Scale" value={portraitScale} onChange={(v) => onStyleChange({ portraitScale: v })} />
              <span className="bench-tune-subhead">Edge fade</span>
              <TuneSlider label="Fade top" value={maskTop} onChange={(v) => onStyleChange({ maskTop: v })} />
              <TuneSlider label="Fade right" value={maskRight} onChange={(v) => onStyleChange({ maskRight: v })} />
              <TuneSlider label="Fade bottom" value={maskBottom} onChange={(v) => onStyleChange({ maskBottom: v })} />
              <TuneSlider label="Fade left" value={maskLeft} onChange={(v) => onStyleChange({ maskLeft: v })} />
              <span className="bench-tune-subhead">Edge sharpness</span>
              <TuneSlider label="Sharp top" value={maskTopSharp} onChange={(v) => onStyleChange({ maskTopSharp: v })} />
              <TuneSlider label="Sharp right" value={maskRightSharp} onChange={(v) => onStyleChange({ maskRightSharp: v })} />
              <TuneSlider label="Sharp bottom" value={maskBottomSharp} onChange={(v) => onStyleChange({ maskBottomSharp: v })} />
              <TuneSlider label="Sharp left" value={maskLeftSharp} onChange={(v) => onStyleChange({ maskLeftSharp: v })} />
            </>
          ) : null}
        </TuneGroup>

        <TuneGroup
          title="Backdrop"
          actions={
            <>
              <button
                type="button"
                className="bench-tune-edit"
                data-on={editMode === 'backdrop' ? 'true' : undefined}
                onClick={() => onEdit('backdrop')}
              >
                {editMode === 'backdrop' ? 'Done' : 'Edit'}
              </button>
              <GroupActionBtn icon={<RotateCcw size={12} aria-hidden="true" />} label="Reset" onClick={() => onResetGroup('backdrop')} />
              <GroupActionBtn icon={<Download size={12} aria-hidden="true" />} label="Export" onClick={() => onExport('backdrop')} />
            </>
          }
        >
          <TuneAsset name="Background" hint="Splash art" imageUrl={backdropImage} onPick={() => onPickImage('backdrop')} />
          {editMode === 'backdrop' ? (
            <>
              <TuneSlider label="Offset X" min={-100} max={200} value={backdropX} onChange={(v) => onStyleChange({ backdropX: v })} />
              <TuneSlider label="Offset Y" min={-100} max={200} value={backdropY} onChange={(v) => onStyleChange({ backdropY: v })} />
              <TuneSlider label="Scale" value={backdropScale} onChange={(v) => onStyleChange({ backdropScale: v })} />
              <TuneSlider label="Blur" value={backdropBlur} onChange={(v) => onStyleChange({ backdropBlur: v })} />
              <TuneSlider label="Opacity" value={backdropOpacity} onChange={(v) => onStyleChange({ backdropOpacity: v })} />
            </>
          ) : null}
        </TuneGroup>

        <TuneGroup
          title="Color"
          actions={<GroupActionBtn icon={<Download size={12} aria-hidden="true" />} label="Export" onClick={() => onExport('color')} />}
        >
          <TuneSwatch label="Accent" value={accent} onChange={(v) => onStyleChange({ accent: v })} />
          <TuneSwatch label="Surface" value={surface} onChange={(v) => onStyleChange({ surface: v })} />
          <TuneSlider label="Card opacity" value={cardOpacity} onChange={(v) => onStyleChange({ opacity: v })} />
        </TuneGroup>

        <TuneGroup
          title="Base type"
          actions={<GroupActionBtn icon={<Download size={12} aria-hidden="true" />} label="Export" onClick={() => onExport('type')} />}
        >
          <TuneFont label="Display" fallback="sans-serif" onApply={(stack) => onStyleChange({ displayFont: stack })} />
          <TuneFont label="Mono" fallback="monospace" onApply={(stack) => onStyleChange({ monoFont: stack })} />
          <TuneSwatch label="Text color" value={text} onChange={(v) => onStyleChange({ text: v })} />
          <span className="bench-tune-note">Card-wide defaults. Use Per-text styles below to override a single type.</span>
        </TuneGroup>

        <TuneGroup
          title="Per-text styles"
          actions={<GroupActionBtn icon={<Download size={12} aria-hidden="true" />} label="Export" onClick={() => onExport('text')} />}
        >
          <TextStyleEditor
            slots={textSlots}
            accent={accent}
            text={text}
            onChange={(next) => onStyleChange({ textSlots: next })}
          />
        </TuneGroup>

        <TuneGroup
          title="Custom CSS"
          actions={
            <>
              <GroupActionBtn icon={<Upload size={12} aria-hidden="true" />} label="Import" onClick={openImport} />
              <GroupActionBtn
                icon={<Maximize2 size={12} aria-hidden="true" />}
                label={docked ? 'Collapse' : 'Expand'}
                onClick={onExpandCss}
              />
              <GroupActionBtn icon={<Download size={12} aria-hidden="true" />} label="Export" onClick={() => onExport('css')} />
            </>
          }
        >
          {docked ? (
            <span className="bench-tune-note">Editing in the side panel; collapse to bring it back here.</span>
          ) : (
            <>
              <TuneTextarea
                value={customCss}
                placeholder={'.showcase-grade-score {\n  color: gold;\n}'}
                onChange={(value) => onStyleChange({ customCss: value || null })}
              />
              <span className="bench-tune-note">You know what to do..</span>
            </>
          )}
        </TuneGroup>
      </div>

      <div className="bench-tune-actions">
        <button
          type="button"
          className="bench-tune-cap bench-tune-cap--primary"
          disabled={capturing || editMode != null}
          onClick={() => onCapture('download')}
          title={captureAction === 'download' ? 'Capturing' : 'Capture'}
          aria-label="Capture card"
        >
          <TbCameraDown aria-hidden="true" size={15} />
        </button>
        <button
          type="button"
          className="bench-tune-cap"
          disabled={capturing || editMode != null}
          onClick={() => onCapture('clipboard')}
          title="Copy to clipboard"
          aria-label="Copy to clipboard"
        >
          <Clipboard aria-hidden="true" size={15} />
        </button>
        <button
          type="button"
          className="bench-tune-cap"
          onClick={openImport}
          title="Import card or group file"
          aria-label="Import card settings"
        >
          <Upload aria-hidden="true" size={15} />
        </button>
        <button
          type="button"
          className="bench-tune-cap"
          onClick={() => onExport('all')}
          title="Export everything to JSON"
          aria-label="Export all card settings"
        >
          <Download aria-hidden="true" size={15} />
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.css,application/json,text/css"
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
