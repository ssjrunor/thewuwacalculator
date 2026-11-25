/*
  Author: Runor Ewhro
  description: the profile editor's preview: the band as others see it, with
               the banner and avatar framed in place (drag to move, wheel or the
               zoom line to zoom, arrows and +/- on the keyboard, double-click to
               reset), live previews of the banner's two other frames (the hover
               card and a row's namecard), and the accent picker: the attribute
               colours, or any hue on a pad fixed to a lightness readable on both
               themes.
*/

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { ImageUp, RotateCcw } from 'lucide-react'
import type { ImageFrame } from '@/domain/leaderboard/documents'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay'
import { frameVars } from './Framed'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places
export const ZOOM = { min: 1, max: 4 }

/** each frame's default point for an unframed image, matching its surface. */
export const BASE: Record<'avatar' | 'banner', ImageFrame> = { avatar: { x: 50, y: 50, zoom: 1 }, banner: { x: 50, y: 35, zoom: 1 } }

const tidy = (f: ImageFrame): ImageFrame => ({ x: round(clamp(f.x, 0, 100), 1), y: round(clamp(f.y, 0, 100), 1), zoom: round(clamp(f.zoom, ZOOM.min, ZOOM.max), 2) })

/** one image framed in place; the frame is the real element, so the preview matches the surface. */
function FrameEdit({ src, frame, base, label, className, onChange, onEmpty, empty }: {
  src: string | null
  frame: ImageFrame | null
  base: ImageFrame
  label: string
  className: string
  onChange: (frame: ImageFrame | null) => void
  onEmpty: () => void
  empty: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const f = frame ?? base
  // the wheel listener below is added once per image and reads the latest frame and setter from this ref
  const live = useRef({ f, onChange })
  useEffect(() => { live.current = { f, onChange } })
  const drag = useRef<{ x: number; y: number; f: ImageFrame; over: { x: number; y: number } } | null>(null)
  const [moving, setMoving] = useState(false)

  // how far the image, filling the frame at a zoom, overhangs it in px: a drag of that many px moves the point
  // from one edge of the image to the other.
  const overhang = (zoom: number) => {
    const el = box.current, im = img.current
    if (!el || !im?.naturalWidth) return null
    const { width: w, height: h } = el.getBoundingClientRect()
    const s = Math.max(w / im.naturalWidth, h / im.naturalHeight) * zoom
    return { x: im.naturalWidth * s - w, y: im.naturalHeight * s - h }
  }

  // the wheel zooms the image without scrolling the window; react's wheel listener is passive and cannot prevent scroll
  useEffect(() => {
    const el = box.current
    if (!el || !src) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const { f: at, onChange: set } = live.current
      set(tidy({ ...at, zoom: at.zoom * Math.exp(-event.deltaY * 0.0015) }))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [src])

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (!src || event.button !== 0) return
    const over = overhang(f.zoom)
    if (!over) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus()
    drag.current = { x: event.clientX, y: event.clientY, f, over }
    setMoving(true)
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    // the image follows the pointer: dragging it right brings its left side into view, a smaller x.
    const dx = d.over.x > .5 ? (event.clientX - d.x) / d.over.x * 100 : 0
    const dy = d.over.y > .5 ? (event.clientY - d.y) / d.over.y * 100 : 0
    onChange(tidy({ ...d.f, x: d.f.x - dx, y: d.f.y - dy }))
  }
  const up = () => { drag.current = null; setMoving(false) }

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!src) return
    const step = event.shiftKey ? 5 : 1
    const next = event.key === 'ArrowLeft' ? { ...f, x: f.x + step } : event.key === 'ArrowRight' ? { ...f, x: f.x - step }
      : event.key === 'ArrowUp' ? { ...f, y: f.y + step } : event.key === 'ArrowDown' ? { ...f, y: f.y - step }
      : event.key === '+' || event.key === '=' ? { ...f, zoom: f.zoom + .1 } : event.key === '-' ? { ...f, zoom: f.zoom - .1 }
      : event.key === '0' ? null : undefined
    if (next === undefined) return
    event.preventDefault()
    onChange(next && tidy(next))
  }

  if (!src) return <button type="button" className={`ped-fe ${className} empty`} onClick={onEmpty} aria-label={`Upload ${label.toLowerCase()}`}>{empty}</button>
  return (
    <div ref={box} className={`ped-fe frm ${className}${moving ? ' moving' : ''}`} style={frameVars(f)} tabIndex={0} role="group"
      aria-label={`${label}: drag or use the arrow keys to move it, the wheel or + and - to zoom, double-click to reset`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key} onDoubleClick={() => onChange(null)}>
      <img ref={img} src={src} alt="" draggable={false} />
    </div>
  )
}

/** the zoom line and the actions under one framed image. */
function FrameCtl({ label, frame, base, has, status, busy, onChange, onPick, onClear }: {
  label: string
  frame: ImageFrame | null
  base: ImageFrame
  has: boolean
  status: 'pending' | 'approved' | 'rejected' | null
  busy: boolean
  onChange: (frame: ImageFrame | null) => void
  onPick: () => void
  onClear: () => void
}) {
  const f = frame ?? base
  return (
    <div className="ped-fc">
      <div className="ped-fc-h">
        <b>{label}</b>
        {busy ? <i>Uploading</i> : status === 'pending' ? <i className="warn">In review</i> : status === 'approved' ? <i>Approved</i> : null}
        <span className="amdl__fill" />
        <button type="button" className="lk" onClick={onPick}>{has ? 'Replace' : 'Upload'}</button>
        {has ? <button type="button" className="lk" onClick={onClear}>Remove</button> : null}
      </div>
      <label className={`ped-zoom${has ? '' : ' off'}`}>
        <span>Zoom</span>
        <input type="range" min={ZOOM.min} max={ZOOM.max} step={0.01} value={f.zoom} disabled={!has}
          style={{ '--v': `${(f.zoom - ZOOM.min) / (ZOOM.max - ZOOM.min) * 100}%` } as CSSProperties}
          onChange={(event) => onChange(tidy({ ...f, zoom: Number(event.target.value) }))} aria-label={`${label} zoom`} />
        <output>{f.zoom.toFixed(2)}x</output>
        <button type="button" className="ped-ic" disabled={!has || !frame} onClick={() => onChange(null)} aria-label={`Reset ${label.toLowerCase()} framing`} title="Reset framing">
          <RotateCcw aria-hidden="true" /></button>
      </label>
    </div>
  )
}

export interface LookImage {
  src: string | null
  frame: ImageFrame | null
  status: 'pending' | 'approved' | 'rejected' | null
}

/** the band, framed in place, with the hover card and a row's namecard beside it. */
export function LookStage({ name, region, accent, avatar, banner, busy, onFrame, onPick, onClear }: {
  name: string
  region: ReactNode
  accent: string | null
  avatar: LookImage
  banner: LookImage
  busy: 'avatar' | 'banner' | null
  onFrame: (purpose: 'avatar' | 'banner', frame: ImageFrame | null) => void
  onPick: (purpose: 'avatar' | 'banner') => void
  onClear: (purpose: 'avatar' | 'banner') => void
}) {
  const me = accent ? { '--me': accent } as CSSProperties : undefined
  const initial = name[0]?.toUpperCase() ?? '?'
  // small frames read the stored framing, or their surface's default point, like the real frames
  const bf = banner.frame ? frameVars(banner.frame) : undefined
  const af = avatar.frame ? frameVars(avatar.frame) : undefined
  return (
    <div className="ped-look" style={me}>
      {/* the band at its real proportions: 1cqw here is 1/100 of the page's 73rem band. */}
      <div className="ped-band">
        <FrameEdit className="ped-band-ban" label="Banner" src={banner.src} frame={banner.frame} base={BASE.banner}
          onChange={(f) => onFrame('banner', f)} onEmpty={() => onPick('banner')} empty={<span><ImageUp aria-hidden="true" />Add a banner</span>} />
        <div className="ped-band-id">
          <FrameEdit className="ped-band-av" label="Avatar" src={avatar.src} frame={avatar.frame} base={BASE.avatar}
            onChange={(f) => onFrame('avatar', f)} onEmpty={() => onPick('avatar')} empty={<span className="mono">{initial}</span>} />
          <div className="ped-band-nm"><b>{name}</b><span>{region}</span></div>
        </div>
      </div>
      <div className="ped-look-row">
        <FrameCtl label="Banner" frame={banner.frame} base={BASE.banner} has={Boolean(banner.src)} status={banner.status} busy={busy === 'banner'}
          onChange={(f) => onFrame('banner', f)} onPick={() => onPick('banner')} onClear={() => onClear('banner')} />
        <FrameCtl label="Avatar" frame={avatar.frame} base={BASE.avatar} has={Boolean(avatar.src)} status={avatar.status} busy={busy === 'avatar'}
          onChange={(f) => onFrame('avatar', f)} onPick={() => onPick('avatar')} onClear={() => onClear('avatar')} />
        <div className="ped-seen" aria-label="Profile previews">
          <span className="ped-seen-h">Hover card</span>
          <div className="ped-pvc">
            {banner.src ? <span className="frm ped-pvc-ban" style={bf}><img src={banner.src} alt="" /></span> : <span className="ped-pvc-ban wash" />}
            {avatar.src ? <span className="frm ped-pvc-av" style={af}><img src={avatar.src} alt="" /></span> : <span className="ped-pvc-av mono">{initial}</span>}
            <b>{name}</b>
          </div>
          <span className="ped-seen-h">Rows</span>
          <div className="ped-nc">
            {banner.src ? <span className="frm ped-nc-bg" style={bf}><img src={banner.src} alt="" /></span> : <span className="ped-nc-bg" />}
            {avatar.src ? <span className="frm ped-nc-av" style={af}><img src={avatar.src} alt="" /></span> : <span className="ped-nc-av mono">{initial}</span>}
            <b>{name}</b>
          </div>
        </div>
      </div>
    </div>
  )
}

/* accent */

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  if (!d) return [0, 0, l * 100]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s * 100, l * 100]
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s / 100 * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round((l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255) }
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** accent lightness range: accents ring avatars and colour text on both themes, so they stay away from black and white. */
const LIGHT = { lo: 38, hi: 76 }
const readable = (hex: string) => { const [h, s, l] = hexToHsl(hex); return hslToHex(h, s, clamp(l, LIGHT.lo, LIGHT.hi)) }
const PRESETS = [...new Set(Object.values(ATTR_COLORS).map((c) => c.toLowerCase()))]

export function AccentPicker({ value, onChange }: { value: string | null; onChange: (accent: string | null) => void }) {
  const pad = useRef<HTMLCanvasElement>(null)
  const [hue, setHue] = useState(() => value ? hexToHsl(value)[0] : 200)
  const [hexText, setHexText] = useState(value ?? '')
  const [note, setNote] = useState<string | null>(null)
  // an external value (a preset, the default) reseeds the hue and the field; a grey preserves the previous hue
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setHexText(value ?? '')
    if (value) { const [h, s] = hexToHsl(value); if (s > 2) setHue(h) }
  }
  const [, sat, light] = value ? hexToHsl(value) : [hue, -1, -1]

  // the pad: saturation across, the readable lightness band down, at the strip's hue.
  useEffect(() => {
    const canvas = pad.current, ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const w = canvas.width, h = canvas.height, data = ctx.createImageData(w, h)
    for (let y = 0; y < h; y++) {
      const l = LIGHT.hi - (LIGHT.hi - LIGHT.lo) * y / (h - 1)
      for (let x = 0; x < w; x++) {
        const n = parseInt(hslToHex(hue, x / (w - 1) * 100, l).slice(1), 16), i = (y * w + x) * 4
        data.data[i] = n >> 16 & 255; data.data[i + 1] = n >> 8 & 255; data.data[i + 2] = n & 255; data.data[i + 3] = 255
      }
    }
    ctx.putImageData(data, 0, 0)
  }, [hue])

  const pick = (event: PointerEvent<HTMLCanvasElement>) => {
    const r = event.currentTarget.getBoundingClientRect()
    const s = clamp((event.clientX - r.left) / r.width, 0, 1) * 100
    const l = LIGHT.hi - (LIGHT.hi - LIGHT.lo) * clamp((event.clientY - r.top) / r.height, 0, 1)
    setNote(null)
    onChange(hslToHex(hue, s, l))
  }
  const commitHex = () => {
    const raw = hexText.trim().replace(/^#?/, '#').toLowerCase()
    if (!/^#[0-9a-f]{6}$/.test(raw)) { setHexText(value ?? ''); if (hexText.trim()) setNote("hmm... use six hex digits, like #4fb3c8 :P"); return }
    const kept = readable(raw)
    setNote(kept !== raw ? `${hexToHsl(raw)[2] < LIGHT.lo ? 'lightened' : 'darkened'} to ${kept} to keep it readable in both themes :P` : null)
    onChange(kept)
  }
  const custom = value != null && !PRESETS.includes(value.toLowerCase())

  return (
    <div className="ped-acc-wrap">
      <div className="ped-acc" role="radiogroup" aria-label="Accent">
        <button type="button" role="radio" aria-checked={!value} className={`none${!value ? ' on' : ''}`} aria-label="Theme accent" title="Theme accent" onClick={() => onChange(null)} />
        {PRESETS.map((c) => <button key={c} type="button" role="radio" aria-checked={value?.toLowerCase() === c} aria-label={c} title={c}
          className={value?.toLowerCase() === c ? 'on' : ''} style={{ background: c }} onClick={() => { setNote(null); onChange(c) }} />)}
        <span className={`ped-acc-own${custom ? ' on' : ''}`} style={custom ? { background: value } : undefined} aria-hidden="true" />
      </div>
      <div className="ped-pick">
        <div className="ped-pad">
          <canvas ref={pad} width={160} height={56} aria-label="Saturation and lightness"
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pick(event) }}
            onPointerMove={(event) => { if (event.buttons & 1) pick(event) }} />
          {value ? <i style={{ left: `${sat}%`, top: `${(LIGHT.hi - clamp(light, LIGHT.lo, LIGHT.hi)) / (LIGHT.hi - LIGHT.lo) * 100}%`, background: value }} /> : null}
        </div>
        <input type="range" className="ped-hue" min={0} max={359} step={1} value={Math.round(hue)} aria-label="Hue"
          onChange={(event) => {
            const h = Number(event.target.value)
            setHue(h)
            setNote(null)
            if (value) { const [, s, l] = hexToHsl(value); onChange(hslToHex(h, Math.max(s, 8), clamp(l, LIGHT.lo, LIGHT.hi))) }
          }} />
        <label className="ped-hex">
          <span style={value ? { background: value } : undefined} />
          <input value={hexText} placeholder="Theme" spellCheck={false} maxLength={7} aria-label="Accent hex"
            onChange={(event) => setHexText(event.target.value)} onBlur={commitHex}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitHex() } }} />
        </label>
      </div>
      {note ? <p className="ped-hint">{note}</p> : null}
    </div>
  )
}
