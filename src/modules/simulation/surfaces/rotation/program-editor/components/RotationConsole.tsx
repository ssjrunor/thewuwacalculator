/*
  Author: Runor Ewhro
  Description: Projects executed rotation spans, active-member handoffs, containers, and state tracks.
*/

import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay.ts'
import { withDefResMg } from '@/shared/lib/imageFallback.ts'
import {
  formatDamage,
  type DamageDecimals,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows.ts'
import { RCN_BAND_LANES } from '@/modules/simulation/surfaces/rotation/program-editor/presentation/consoleModel.ts'
import type {
  RcnBand,
  RcnGlyph,
  RcnModel,
  RcnNode,
  RcnStateTrack,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/consoleModel.ts'
import type { FlatRowTarget } from '@/modules/simulation/surfaces/rotation/program-editor/presentation/flatRows.ts'
import type { EditorMember } from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'

/* the gutter the four track names are set in, and the room the state tracks
   need on the right to print what they ended on */
const GUT = 106
const PAD_R = 34

/*
  a rotation opens on hits worth a few hundred and closes on hits worth half a
  million, so a linear mark would draw the opening as nothing at all. this
  compression keeps the small end legible without flattening the big end.
*/
const CURVE = 0.38

/* one band lane, and the cell the pass ordinal is set in */
const LANE = 9
const CELL = 7

/* the ruler counts in whichever of these keeps its numbers from colliding */
const STRIDES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]

interface Props {
  model: RcnModel | null
  members: EditorMember[]
  decimals: DamageDecimals
  /** the node the table has open, which is where the playhead rests */
  selectedId: string | null
  /** absent on the saved list, where the console reads rather than picks */
  onSelect?: (target: FlatRowTarget) => void
  /** what this console is drawing, printed beside the node count */
  caption: string
  /** what to say when there is nothing to draw, which differs by surface */
  emptyNote: string
}

function markHeight(value: number, peak: number, room: number): number {
  if (value <= 0 || peak <= 0) return 0
  return Math.max(1.5, Math.pow(value / peak, CURVE) * room)
}

/* the cap that tells a liberation from a basic at six pixels wide */
function glyphMark(glyph: RcnGlyph, cx: number, top: number, width: number, color: string) {
  const style = { fill: color } as CSSProperties
  switch (glyph) {
    case 'heavy':
      return <rect x={cx - width / 2 - 2} y={top - 2.6} width={width + 4} height={2} style={style} />
    case 'lib':
      return <path d={`M${cx} ${top - 8.5} L${cx + 4} ${top - 4.2} L${cx} ${top} L${cx - 4} ${top - 4.2} Z`} style={style} />
    case 'echo':
      return <circle cx={cx} cy={top - 4.2} r={2.7} style={{ fill: 'none', stroke: color, strokeWidth: 1.4 }} />
    case 'intro':
      return <path d={`M${cx - 3} ${top - 6.4} L${cx + 3.4} ${top - 3.2} L${cx - 3} ${top} Z`} style={style} />
    case 'outro':
      return <path d={`M${cx + 3} ${top - 6.4} L${cx - 3.4} ${top - 3.2} L${cx + 3} ${top} Z`} style={style} />
    case 'tune':
      return <path d={`M${cx - 3.6} ${top - 4} L${cx + 3.6} ${top - 4} M${cx} ${top - 7.6} L${cx} ${top - 0.4}`} style={{ stroke: color, strokeWidth: 1.3 }} />
    case 'skill':
      return <rect x={cx - width / 2} y={top - 2.2} width={width} height={1.3} style={{ fill: 'var(--bg)' }} />
    default:
      return null
  }
}

/* the gutter holds about sixteen characters of the label face */
function gutterText(text: string): string {
  return text.length > 17 ? `${text.slice(0, 16)}\u2026` : text
}

/** what a container is called on its opening pass, count and share included */
function bandTitle(band: RcnBand): string {
  if (band.kind === 'uptime' && band.ratio !== undefined && band.ratio < 1) {
    return `${band.label} ${Math.round(band.ratio * 100)}%`
  }
  if (band.kind === 'repeat' && band.runs > 1) return `${band.label} x${band.runs}`
  return band.label
}

function statePath(track: RcnStateTrack, xOf: (i: number) => number, x0: number, x1: number, y: number, h: number) {
  const level = (v: number) => y + h - (Math.min(v, track.max) / track.max) * h
  let d = `M${x0} ${level(track.seed)}`
  let held = level(track.seed)
  for (const point of track.points) {
    const x = xOf(point.i)
    const next = level(point.v)
    d += ` L${x} ${held} L${x} ${next}`
    held = next
  }
  d += ` L${x1} ${held}`
  return { d, area: `${d} L${x1} ${y + h} L${x0} ${y + h} Z`, last: track.points[track.points.length - 1] }
}

export function RotationConsole({ model, members, decimals, selectedId, onSelect, caption, emptyNote }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  /* the plot only mounts once there is something to draw, so the observer is
     bound to the element rather than to the first render */
  const [plot, setPlot] = useState<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [probe, setProbe] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!plot) return undefined
    const measure = () => {
      const { width, height } = plot.getBoundingClientRect()
      setBox((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(plot)
    return () => observer.disconnect()
  }, [plot])

  const byId = useMemo(() => new Map(members.map((member) => [member.id, member])), [members])

  /*
    resonators of the same element carry the same colour, and always will: the
    colour is the element, not the person. so the first to use a colour takes
    it plain and everyone after it takes a texture, which keeps a mono element
    team readable without inventing hues the rest of the app does not use.
  */
  const texture = useMemo(() => {
    const taken = new Map<string, number>()
    const out = new Map<string, number>()
    for (const member of members) {
      const color = ATTR_COLORS[member.attribute]
      const nth = taken.get(color) ?? 0
      taken.set(color, nth + 1)
      if (nth > 0) out.set(member.id, Math.min(nth, 3))
    }
    return out
  }, [members])

  const colorOf = useCallback(
    (memberId: string | undefined) => {
      const member = memberId ? byId.get(memberId) : undefined
      return member ? ATTR_COLORS[member.attribute] : 'var(--muted)'
    },
    [byId],
  )
  const fillOf = useCallback(
    (memberId: string | undefined) =>
      memberId && texture.has(memberId) ? `url(#${uid}-tex-${memberId})` : colorOf(memberId),
    [colorOf, texture, uid],
  )

  const count = model?.nodes.length ?? 0
  const headIndex = useMemo(() => {
    if (!model || !selectedId) return null
    const live = model.nodes.find((node) => node.id === selectedId && node.live)
    return (live ?? model.nodes.find((node) => node.id === selectedId))?.i ?? null
  }, [model, selectedId])

  const lanes = useMemo(
    () => Math.min(RCN_BAND_LANES, model?.bands.reduce((deep, band) => Math.max(deep, band.depth + 1), 0) ?? 0),
    [model],
  )

  const geo = useMemo(() => {
    const w = box.w, h = box.h
    const x0 = GUT
    const pw = Math.max(1, w - GUT - PAD_R)
    const slot = pw / Math.max(1, count)
    const rows = model?.states.length ?? 0
    const bottom = h - 4
    const stateTop = bottom - rows * 15
    const outBase = rows > 0 ? stateTop - 15 : bottom - 8
    const rulerY = 12
    const bandTop = rulerY + 8
    const bandBase = lanes > 0 ? bandTop + lanes * LANE : rulerY + 4
    const fieldY = bandBase + 4
    const outTop = fieldY + 36
    return {
      x0,
      pw,
      slot,
      x1: x0 + pw,
      xOf: (i: number) => x0 + (i + 0.5) * slot,
      /* an edge sits between two columns, and the last one closes the ruler */
      edgeOf: (i: number) => (i >= count ? x0 + pw : x0 + i * slot),
      rulerY,
      bandTop,
      bandBase,
      laneY: (depth: number) => bandTop + Math.min(depth, RCN_BAND_LANES - 1) * LANE,
      fieldY,
      fieldH: 22,
      outTop,
      outBase,
      outRoom: Math.max(20, outBase - outTop),
      stateTop,
      bottom,
    }
  }, [box.h, box.w, count, lanes, model?.states.length])

  /* the ruler counts in whichever stride keeps its numbers from touching */
  const stride = useMemo(() => {
    const label = STRIDES.find((step) => step * geo.slot >= 34) ?? 1000
    return { label, tick: label % 2 === 0 ? label / 2 : label }
  }, [geo.slot])

  const at = useCallback(
    (event: ReactMouseEvent) => {
      if (!plot || !count) return null
      const rect = plot.getBoundingClientRect()
      const x = event.clientX - rect.left
      /* the gutter carries the track names, so pointing at one is not a pick */
      if (x < geo.x0) return null
      const index = Math.round((x - geo.x0) / geo.slot - 0.5)
      return Math.min(Math.max(index, 0), count - 1)
    },
    [count, geo.slot, geo.x0, plot],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!count) return
      const here = probe ?? headIndex ?? 0
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        setProbe(Math.min(Math.max(here + (event.key === 'ArrowRight' ? 1 : -1), 0), count - 1))
        return
      }
      if ((event.key === 'Enter' || event.key === ' ') && onSelect && model) {
        event.preventDefault()
        onSelect(model.nodes[here].target)
      }
    },
    [count, headIndex, model, onSelect, probe],
  )

  if (!model || !model.nodes.length) {
    return (
      <div className="rcon rcon--empty">
        <p className="rte-palette__empty">{emptyNote}</p>
      </div>
    )
  }

  const held = probe ?? headIndex
  const shown = held != null ? model.nodes[held] : null
  const parked = headIndex == null
  const headNode = model.nodes[headIndex ?? 0]

  const readout = (() => {
    if (!shown) {
      return (
        <>
          <span className="rcon__flag">no selection</span>
          {' . parked at '}
          <b>{headNode.label}</b>
        </>
      )
    }
    const who = shown.memberId ?? shown.hold
    const name = who ? byId.get(who)?.name : undefined
    const pass = shown.pass
      ? <span className="rcon__pass">{` . ${shown.pass.label} ${shown.pass.run}/${shown.pass.runs}`}</span>
      : null
    if (shown.kind === 'step') {
      return (
        <>
          <b>{shown.label}</b>
          {shown.typeLabel ? ` . ${shown.typeLabel}` : ''}
          {name ? ` . ${name}` : ''}
          {shown.dead ? ' . no damage' : ` . ${formatDamage(shown.value, decimals)}`}
          {pass}
        </>
      )
    }
    if (shown.kind === 'swap') return <>swap to <b>{shown.label}</b>{pass}</>
    return (
      <>
        <b>{shown.label}</b>
        {shown.from !== undefined ? ` ${shown.from} to ${shown.to}` : ` ${shown.to}`}
        {pass}
      </>
    )
  })()

  const { x0, x1, slot, xOf } = geo
  const headX = xOf(headIndex ?? 0)
  const headColor = parked ? 'var(--muted)' : 'var(--rte-res)'
  const headLabel = parked ? 'start' : String(headIndex)
  const chipW = Math.max(22, headLabel.length * 6.2 + 10)
  const chipMid = Math.min(Math.max(headX, geo.x0 + chipW / 2), geo.x1 - chipW / 2)
  const nodeY = (node: RcnNode) =>
    node.kind === 'step' ? geo.outBase - markHeight(node.value, model.peak, geo.outRoom) : geo.outBase
  const ticks = Array.from({ length: Math.ceil(count / stride.tick) }, (_, n) => n * stride.tick)

  const label = (y: number, text: string) => (
    <text x={x0 - 10} y={y} textAnchor="end" className="rcon__track">{text}</text>
  )

  return (
    <div className="rcon">
      <div className="rcon__head">
        <span className="rte-lbl">{caption}</span>
        <span className="rcon__count">
          {count} nodes
          {model.repeated ? ' . every pass' : ''}
        </span>
        <span className="rcon__fill" />
        <span className="rcon__read" aria-live="polite">{readout}</span>
      </div>

      <div
        ref={setPlot} className="rcon__plot"
        tabIndex={0}
        role="group"
        aria-label="Rotation console"
        onMouseMove={(event) => setProbe(at(event))}
        onMouseLeave={() => setProbe(null)}
        onBlur={() => setProbe(null)}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          const index = at(event)
          if (index != null && onSelect) onSelect(model.nodes[index].target)
        }}
        data-pick={onSelect ? 'on' : 'off'}
      >
        {box.w > 0 ? (
          <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true">
            <defs>
              {[...texture].map(([memberId, nth]) => (
                <pattern
                  key={memberId}
                  id={`${uid}-tex-${memberId}`}
                  width={nth === 3 ? 6 : 5}
                  height={nth === 3 ? 6 : 5}
                  patternUnits="userSpaceOnUse"
                  patternTransform={nth === 1 ? 'rotate(45)' : nth === 3 ? 'rotate(-45)' : undefined}
                >
                  <rect width={6} height={6} style={{ fill: colorOf(memberId), opacity: 0.3 }} />
                  {nth === 2 ? (
                    <circle cx={2.5} cy={2.5} r={1.3} style={{ fill: colorOf(memberId), opacity: 0.95 }} />
                  ) : (
                    <rect width={nth === 3 ? 2.4 : 1.6} height={6} style={{ fill: colorOf(memberId), opacity: 0.92 }} />
                  )}
                </pattern>
              ))}
            </defs>

            {/* a pass turns over under every track at once, so the seam is cut
                before anything is drawn on top of it */}
            {model.seams.map((seam) => (
              <line
                key={`seam${seam.i}`} className="rcon__seam"
                data-kind={seam.kind}
                x1={geo.edgeOf(seam.i)}
                y1={geo.rulerY}
                x2={geo.edgeOf(seam.i)}
                y2={geo.bottom}
                style={{ opacity: 1 - Math.min(seam.depth, 2) * 0.28 }}
              />
            ))}

            {/* the ruler every track is read against */}
            <line x1={x0} y1={geo.rulerY} x2={x1} y2={geo.rulerY} className="rcon__hair" />
            {ticks.map((i) => (
              <line key={`t${i}`} x1={xOf(i)} y1={geo.rulerY} x2={xOf(i)} y2={geo.rulerY - 4} className="rcon__tick" />
            ))}
            {ticks.map((i) => (
              i % stride.label === 0 && Math.abs(xOf(i) - chipMid) > chipW / 2 + 6 ? (
                <text key={`n${i}`} x={xOf(i)} y={geo.rulerY - 7} textAnchor="middle" className="rcon__ord">{i}</text>
              ) : null
            ))}

            {lanes > 0 ? label(geo.bandTop + 5.4, model.repeated ? 'Passes' : 'Blocks') : null}
            {model.bands.map((band) => (
              <BandCell key={band.key} band={band} edgeOf={geo.edgeOf} y={geo.laneY(band.depth)} />
            ))}

            {label(geo.fieldY + 14, 'Field')}
            {model.spans.map((span) => {
              const x = xOf(span.a) - slot / 2
              const width = (span.b - span.a + 1) * slot
              const member = byId.get(span.memberId)
              return (
                <g key={`${span.memberId}-${span.a}`}>
                  <rect x={x} y={geo.fieldY} width={width} height={geo.fieldH} style={{ fill: fillOf(span.memberId), opacity: 0.5 }} />
                  {width > 74 && member ? (
                    <text x={x + 25} y={geo.fieldY + 15} className="rcon__who">{member.name}</text>
                  ) : null}
                </g>
              )
            })}

            {label(geo.outTop + 10, 'Output')}
            <line x1={x0} y1={geo.outBase} x2={x1} y2={geo.outBase} className="rcon__rule" />
            {model.steps.map((step) => {
              const height = markHeight(step.value, model.peak, geo.outRoom)
              const width = Math.max(0.9, Math.min(slot * 0.66, 5))
              const cx = xOf(step.i)
              if (step.dead) {
                return <line key={step.key} x1={cx - 3} y1={geo.outBase - 2} x2={cx + 3} y2={geo.outBase - 2} className="rcon__gone" />
              }
              const color = step.color ?? colorOf(step.memberId)
              return (
                <g key={step.key}>
                  <rect x={cx - width / 2} y={geo.outBase - height} width={width} height={height} style={{ fill: color }} />
                  {slot > 9 && step.glyph ? glyphMark(step.glyph, cx, geo.outBase - height, width, color) : null}
                </g>
              )
            })}
            {model.peak > 0 ? (
              <text x={x0 - 10} y={geo.outTop + 22} textAnchor="end" className="rcon__note">{formatDamage(model.peak, decimals)} top</text>
            ) : null}

            {model.states.map((track, row) => {
              const y = geo.stateTop + row * 15
              const path = statePath(track, xOf, x0, x1, y, 11)
              return (
                <g key={track.key}>
                  <path d={path.area} className="rcon__statefill" />
                  <path d={path.d} className="rcon__stateline" />
                  {slot > 4 ? track.points.map((point) => (
                    <circle key={`${track.key}-${point.i}`} cx={xOf(point.i)} cy={y + 11 - (Math.min(point.v, track.max) / track.max) * 11} r={1.8} className="rcon__statedot" />
                  )) : null}
                  <text x={x0 - 10} y={y + 11} textAnchor="end" className="rcon__statename">
                    <title>{track.label}</title>
                    {gutterText(track.label)}
                  </text>
                  <text x={x1 + 5} y={y + 11} className="rcon__stateval">{path.last?.label ?? ''}</text>
                </g>
              )
            })}
            {model.states.length ? label(geo.stateTop - 6, 'State') : null}

            {/* the probe reads, the head holds what the table has open */}
            {probe != null ? (
              <g className="rcon__probe">
                <line x1={xOf(probe)} y1={geo.rulerY} x2={xOf(probe)} y2={geo.bottom} />
                <circle cx={xOf(probe)} cy={nodeY(model.nodes[probe])} r={2} />
              </g>
            ) : null}
            <g className={`rcon__head-mark${parked ? ' is-parked' : ''}`}>
              <line x1={headX} y1={geo.rulerY} x2={headX} y2={geo.bottom} style={{ stroke: headColor }} />
              <rect
                x={chipMid - chipW / 2}
                y={0}
                width={chipW}
                height={11}
                rx={1.5}
                style={parked ? { fill: 'none', stroke: headColor } : { fill: headColor }}
              />
              <text
                x={chipMid}
                y={8.4}
                textAnchor="middle" className="rcon__chip"
                style={{ fill: parked ? headColor : 'var(--bg)' }}
              >
                {headLabel}
              </text>
              <circle
                cx={headX}
                cy={nodeY(headNode)}
                r={2.6}
                style={parked ? { fill: 'none', stroke: headColor } : { fill: headColor }}
              />
            </g>
          </svg>
        ) : null}

        {/* portraits ride over the field band, where a colour alone cannot say who */}
        {box.w > 0 ? model.spans.map((span) => {
          const member = byId.get(span.memberId)
          if (!member || (span.b - span.a + 1) * slot < 22) return null
          return (
            <img
              key={`${span.memberId}-${span.a}-art`} className="rcon__face"
              src={member.profile}
              alt={member.name}
              title={member.name}
              onError={withDefResMg}
              loading="lazy"
              style={{
                left: `${xOf(span.a) - slot / 2 + 3}px`,
                top: `${geo.fieldY + 3}px`,
                boxShadow: `0 0 0 1px ${colorOf(span.memberId)}`,
              }}
            />
          )
        }) : null}
      </div>
    </div>
  )
}

/**
 * One pass of one container. A stretch names itself on the pass it opens on
 * and counts itself on every pass after, so four cells reading `Loop A 2 3 4`
 * are one loop run four times rather than four things that share a name.
 */
function BandCell({
  band,
  edgeOf,
  y,
}: {
  band: RcnBand
  edgeOf: (i: number) => number
  y: number
}) {
  const a = edgeOf(band.a)
  const width = Math.max(1, edgeOf(band.b + 1) - a - 2)
  const title = bandTitle(band)
  const ordinal = String(band.run)
  /* the cell prints whichever of the two it can hold, and the name first */
  const text = band.head && width > title.length * 4.3 + 8
    ? title
    : band.runs > 1 && width > ordinal.length * 4.6 + 8
      ? ordinal
      : null
  return (
    <g>
      <rect
        x={a}
        y={y}
        width={width}
        height={CELL} className="rcon__cell"
        data-head={band.head ? 'on' : 'off'}
        data-tint={band.color ? 'on' : 'off'}
        style={band.color ? { fill: band.color } : undefined}
      />
      {/* the cell is struck where it starts, so a turnover reads as a place
          rather than as a gap the eye has to find */}
      <rect
        x={a}
        y={y - 2}
        width={1}
        height={CELL + 2} className="rcon__cellkey"
        data-head={band.head ? 'on' : 'off'}
        style={band.color ? { fill: band.color } : undefined}
      />
      {text ? (
        <text
          x={a + 4}
          y={y + 5.4}
          className={text === title ? 'rcon__bandlbl' : 'rcon__bandrun'}
        >
          {text}
        </text>
      ) : null}
    </g>
  )
}
