/*
  Author: Runor Ewhro
  Description: The evaluation report, drawn as a pull-out beside Modulation
               board rather than as sections stacked under it.

               Two readings live here and each is one object with a list beside
               it. The rotation is a pie whose outer ring is the features and
               whose inner ring is the talent nodes they sit in, so both of the
               report's groupings are the same drawing and neither spectrum bar
               has to be printed. The upgrade paths are the score band's own
               grade line wound in to the stretch the paths actually cover: at
               full scale a swap moves the needle a pixel, at this zoom the
               grades it crosses are wide enough to be named, so the reading is
               where a change lands you rather than a bare delta.

               In both, the drawing carries no names. The list under it does,
               and pointing at either one answers in both.
*/

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import type {
  EvaluationFeature,
  BuildEvaluationReport,
} from '@/data/scoring/buildEvaluation.ts'
import { GRADE_LADDER } from '@/data/scoring/buildEvaluation.ts'
import {
  formatBuildEvaluationScore,
  getBuildEvaluationTone,
} from '@/modules/simulation/model/buildEvaluationDisplay.ts'
import { formatCompactNum } from '@/modules/simulation/model/statsView.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import { getPrimarySkill, getSkillType } from '@/modules/simulation/model/skillTypes'
import { RES_NODE_KEYS, glyphVars, resNodeIcon } from '@/shared/lib/gameAssets'
import type { ResNodeKey } from '@/shared/lib/gameAssets'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import {
  DETAIL_BUILD_LABEL,
  DETAIL_BUILD_ORDER,
  SwapToken,
  deltaSign,
  fmtSignedPct,
  groupAlternatives,
  type AlternativePathGroup,
  type CssVars,
  type DetailBuildKey,
} from '@/modules/simulation/workspace/ui.tsx'
import {
  ROTATION_CHART_COLORS,
  getEvaluationFeatureTabLabel,
  groupRotationFeatureRows,
} from './EvaluationReport.tsx'

/* ---------- the ladder the band is drawn from ---------- */

const LADDER = [...GRADE_LADDER].sort((left, right) => left[0] - right[0])
const TOP = 200

function gradeAt(score: number): { at: number; label: string; color: string } {
  let hit = LADDER[0]
  for (const row of LADDER) {
    if (score >= row[0]) hit = row
  }
  return { at: hit[0], label: hit[1], color: getBuildEvaluationTone(hit[0]).color }
}

/*
  The window is the run of whole grades the paths and the build touch, so the
  band is cut at grade boundaries rather than at arbitrary numbers and every
  section of it is a grade the reader already knows from the score band.
*/
function ladderWindow(points: number[]): [number, number] {
  const low = Math.min(...points)
  const high = Math.max(...points)
  const lo = LADDER.filter(([threshold]) => threshold <= low).at(-1)?.[0] ?? LADDER[0][0]
  const hi = LADDER.find(([threshold]) => threshold > high)?.[0] ?? TOP
  return hi > lo ? [lo, hi] : [lo, lo + 10]
}

function windowScale(lo: number, hi: number): string {
  const stops: string[] = []
  let held = gradeAt(lo).color
  stops.push(`${held} 0%`)
  for (const [threshold] of LADDER.filter(([at]) => at > lo && at < hi)) {
    const pos = ((threshold - lo) / (hi - lo)) * 100
    const color = getBuildEvaluationTone(threshold).color
    stops.push(`${held} ${(pos - 1.1).toFixed(2)}%`)
    stops.push(`${color} ${(pos + 1.1).toFixed(2)}%`)
    held = color
  }
  stops.push(`${held} 100%`)
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

/*
  A pointer crossing the list on its way somewhere else is not a reading. Every
  aim, arriving or leaving, waits out the same dwell, so scrolling the column
  under the cursor never sets the wheel or the band running, and sliding from
  one row to its neighbour reads as one move rather than a flicker through
  nothing.
*/
const DWELL_MS = 150

/* how far apart, in percent of the window, two marks have to be to share a lane */
const MARK_GAP = 13

function useDwell<T>(): [T | null, (next: T | null) => void] {
  const [at, setAt] = useState<T | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current)
  }, [])

  const aim = (next: T | null) => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setAt(next), DWELL_MS)
  }

  return [at, aim]
}

/* ---------- the wheel's segments ---------- */

/*
  Two rings on one dial. Each arc is a dashed circle: one visible run the
  length of its share, then a gap the length of everything else, wound back to
  where the arcs before it left off.
*/
const R_OUT = 78
const R_IN = 57
const C_OUT = 2 * Math.PI * R_OUT
const C_IN = 2 * Math.PI * R_IN

interface Arc {
  dash: string
  offset: number
}

function arcAt(circumference: number, share: number, cursor: number, gap: number): Arc {
  const len = Math.max((circumference * share) / 100 - gap, 1)
  return {
    dash: `${len} ${circumference - len}`,
    offset: -((circumference * cursor) / 100),
  }
}

interface Seg {
  id: string
  row: EvaluationFeature
  nodeKey: string
  typeKey: string
  color: string
  share: number
  damage: number
  arc: Arc
}

interface Ring {
  key: string
  label: string
  color: string
  glyph: string | null
  share: number
  damage: number
  arc: Arc
}

/* whatever the ring, the key or the list is pointing at */
type Pick =
  | { kind: 'feature'; id: string }
  | { kind: 'type'; id: string }
  | { kind: 'node'; id: string }

function isNodeKey(tab: string): tab is ResNodeKey {
  return (RES_NODE_KEYS as readonly string[]).includes(tab)
}

function pct(value: number): string {
  return `${formatTruncCompact(value, 1)}%`
}

/* ---------- the aside ---------- */

export function EvaluationAside({
  open,
  onClose,
  report,
  resonatorId,
}: {
  open: boolean
  onClose: () => void
  report: BuildEvaluationReport
  resonatorId: string
}) {
  const [buildKey, setBuildKey] = useState<DetailBuildKey>('active')
  const [pick, aimPick] = useDwell<Pick>()
  const [pathAt, aimPath] = useDwell<number>()

  const build = report.evaluation.builds[buildKey] ?? report.evaluation.builds.active
  const host = mainPortal()

  /*
    The features are grouped by node so the inner ring's arcs are contiguous,
    which is what lets one drawing carry both cuts. Within a node they keep the
    report's own order, which is damage first.
  */
  const wheel = useMemo(() => {
    const ranked = groupRotationFeatureRows(build.features)

    const typeColor = new Map<string, string>()
    build.featureGroups.skillTypes.forEach((group, index) => {
      typeColor.set(group.key, ROTATION_CHART_COLORS[index % ROTATION_CHART_COLORS.length])
    })
    const nodeColor = new Map<string, string>()
    build.featureGroups.tabs.forEach((group, index) => {
      nodeColor.set(group.key, ROTATION_CHART_COLORS[index % ROTATION_CHART_COLORS.length])
    })

    const segs: Seg[] = []
    let outCursor = 0
    for (const group of build.featureGroups.tabs) {
      for (const row of ranked.filter((entry) => (entry.tab || 'feature') === group.key)) {
        const typeKey = getPrimarySkill(row.skillType) ?? 'feature'
        segs.push({
          id: row.skillId,
          row,
          nodeKey: group.key,
          typeKey,
          color: typeColor.get(typeKey) ?? ROTATION_CHART_COLORS[0],
          share: row.sharePct,
          damage: row.weightedDamage,
          arc: arcAt(C_OUT, row.sharePct, outCursor, 1.6),
        })
        outCursor += row.sharePct
      }
    }

    const sum = (keep: (seg: Seg) => boolean) => segs
      .filter(keep)
      .reduce((total, seg) => total + seg.damage, 0)

    const types: Ring[] = build.featureGroups.skillTypes.map((group) => {
      const display = getSkillType(group.skillType ?? group.key)
      return {
        key: group.key,
        label: display.label,
        color: typeColor.get(group.key) ?? ROTATION_CHART_COLORS[0],
        glyph: display.icon ?? null,
        share: group.sharePct,
        damage: sum((seg) => seg.typeKey === group.key),
        arc: arcAt(C_IN, group.sharePct, 0, 0),
      }
    })

    const nodes: Ring[] = []
    let inCursor = 0
    for (const group of build.featureGroups.tabs) {
      nodes.push({
        key: group.key,
        label: getEvaluationFeatureTabLabel(group.key, group.label),
        color: nodeColor.get(group.key) ?? ROTATION_CHART_COLORS[0],
        glyph: isNodeKey(group.key) ? resNodeIcon(resonatorId, group.key) : null,
        share: group.sharePct,
        damage: sum((seg) => seg.nodeKey === group.key),
        arc: arcAt(C_IN, group.sharePct, inCursor, 2.4),
      })
      inCursor += group.sharePct
    }

    return { segs, types, nodes }
  }, [build, resonatorId])

  const paths = useMemo(() => groupAlternatives(report.alternatives), [report.alternatives])

  const here = report.evaluation.percent * 100
  const ladder = useMemo(() => {
    const points = [here, ...paths.map((group) => group.representative.score)]
    const [lo, hi] = ladderWindow(points)
    const at = (value: number) => ((value - lo) / (hi - lo)) * 100

    /*
      Two paths can land a point apart, and their marks would then print over
      each other. Each mark takes the first lane that has room for it, so a
      crowded stretch steps down instead of overlapping.
    */
    const taken: number[] = []
    const lanes = paths.map((group) => {
      const pos = at(group.representative.score)
      let lane = 0
      while (taken[lane] != null && Math.abs(pos - taken[lane]) < MARK_GAP) lane += 1
      taken[lane] = pos
      return lane
    })

    return {
      lo,
      hi,
      at,
      lanes,
      depth: taken.length,
      scale: windowScale(lo, hi),
      tiers: LADDER.filter(([threshold]) => threshold >= lo && threshold <= hi),
    }
  }, [here, paths])

  if (!host) {
    return null
  }

  /* ---------- what the hole reads ---------- */

  const lead = wheel.segs[0]
  const reading = (() => {
    if (pick?.kind === 'type') {
      const ring = wheel.types.find((entry) => entry.key === pick.id)
      if (ring) return { color: ring.color, share: ring.share, damage: ring.damage, glyphs: [ring.glyph] }
    }
    if (pick?.kind === 'node') {
      const ring = wheel.nodes.find((entry) => entry.key === pick.id)
      if (ring) return { color: ring.color, share: ring.share, damage: ring.damage, glyphs: [ring.glyph] }
    }
    const seg = (pick?.kind === 'feature' ? wheel.segs.find((entry) => entry.id === pick.id) : null) ?? lead
    if (!seg) return null
    const node = wheel.nodes.find((entry) => entry.key === seg.nodeKey)
    return {
      color: seg.color,
      share: seg.share,
      damage: seg.damage,
      glyphs: [node?.glyph ?? null, getSkillType(seg.typeKey).icon ?? null],
    }
  })()

  const litSeg = (seg: Seg) => (
    pick?.kind === 'feature' ? pick.id === seg.id
      : pick?.kind === 'node' ? pick.id === seg.nodeKey
      : pick?.kind === 'type' ? pick.id === seg.typeKey
      : seg === lead
  )
  const litNode = (key: string) => (
    pick?.kind === 'node' ? pick.id === key
      : pick?.kind === 'feature' ? wheel.segs.some((seg) => seg.id === pick.id && seg.nodeKey === key)
      : pick?.kind === 'type' ? wheel.segs.some((seg) => seg.typeKey === pick.id && seg.nodeKey === key)
      : lead?.nodeKey === key
  )
  const litType = (key: string) => (
    pick?.kind === 'type' ? pick.id === key
      : pick?.kind === 'feature' ? wheel.segs.some((seg) => seg.id === pick.id && seg.typeKey === key)
      : pick?.kind === 'node' ? wheel.segs.some((seg) => seg.nodeKey === pick.id && seg.typeKey === key)
      : lead?.typeKey === key
  )

  /* the reach an arc would have had if it were a button */
  const reach = (next: Pick) => ({
    tabIndex: 0,
    onMouseEnter: () => aimPick(next),
    onFocus: () => aimPick(next),
    onMouseLeave: () => aimPick(null),
    onBlur: () => aimPick(null),
  })

  /* ---------- the ladder's reading ---------- */

  const path = pathAt == null ? null : paths[pathAt]
  const lands = path ? path.representative.score : here
  const landed = gradeAt(lands)
  const gain = path ? path.representative.scoreDelta > 0 : false
  const spanFrom = Math.min(here, lands)
  const spanTo = Math.max(here, lands)

  const reachPath = (index: number | null) => ({
    onMouseEnter: () => aimPath(index),
    onFocus: () => aimPath(index),
    onMouseLeave: () => aimPath(null),
    onBlur: () => aimPath(null),
  })

  return createPortal(
    <>
      <div
        className={open ? 'rpt-scrim is-open' : 'rpt-scrim'}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={open ? 'rpt rte-scope workspace-ink is-open' : 'rpt rte-scope workspace-ink'}
        aria-label="Build Details"
        aria-hidden={open ? undefined : true}
      >
        <header className="rpt-head">
          <span>
            <span className="rpt-eyebrow">Build Details</span>
            <b className="rpt-name">
              {build.label}
              <span className="rpt-mode">{build.substatMode}</span>
            </b>
          </span>
          <button type="button" className="rpt-x" aria-label="Close" onClick={onClose}>&times;</button>
        </header>

        <div className="rpt-tabs"
          role="group"
          aria-label="Build detail view"
          data-at={DETAIL_BUILD_ORDER.indexOf(buildKey)}
        >
          <span className="rpt-tabs-car" aria-hidden="true" />
          {DETAIL_BUILD_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              className={key === buildKey ? 'rpt-tab is-at' : 'rpt-tab'}
              aria-pressed={key === buildKey}
              onClick={() => setBuildKey(key)}
            >
              {DETAIL_BUILD_LABEL[key]}
            </button>
          ))}
        </div>

        <div className="rpt-trip" style={{ '--t': getBuildEvaluationTone(build.score).color } as CssVars}>
          <div className="is-hot">
            <span>Score</span>
            <b>{formatBuildEvaluationScore(build.score)}</b>
          </div>
          <div>
            <span>Damage</span>
            <b>{formatCompactNum(build.damage)}</b>
          </div>
        </div>

        <div className="rpt-body">
          <p className="rpt-band">Rotation Features</p>

          <div className="rpt-wheel">
            <div className={pick ? 'rpt-dial is-lit' : 'rpt-dial'}>
              <svg viewBox="0 0 200 200" role="presentation">
                <g transform="rotate(-90 100 100)">
                  {/* the inner ring is drawn first, so a lifted feature arc is
                      never painted underneath it */}
                  {wheel.nodes.map((ring) => (
                    <circle
                      key={ring.key}
                      className={litNode(ring.key) ? 'rpt-arc is-in is-at' : 'rpt-arc is-in'}
                      cx={100}
                      cy={100}
                      r={R_IN}
                      strokeDasharray={ring.arc.dash}
                      strokeDashoffset={ring.arc.offset}
                      style={{ '--c': ring.color } as CssVars}
                      {...reach({ kind: 'node', id: ring.key })}
                    >
                      <title>{ring.label}</title>
                    </circle>
                  ))}
                  {wheel.segs.map((seg) => (
                    <circle
                      key={seg.id}
                      className={litSeg(seg) ? 'rpt-arc is-out is-at' : 'rpt-arc is-out'}
                      cx={100}
                      cy={100}
                      r={R_OUT}
                      strokeDasharray={seg.arc.dash}
                      strokeDashoffset={seg.arc.offset}
                      style={{ '--c': seg.color } as CssVars}
                      {...reach({ kind: 'feature', id: seg.id })}
                    >
                      <title>{seg.row.label}</title>
                    </circle>
                  ))}
                </g>
              </svg>

              {reading ? (
                <span className="rpt-hole" style={{ '--h': reading.color } as CssVars}>
                  <span className="rpt-hole-g" aria-hidden="true">
                    {reading.glyphs.map((glyph, index) => (glyph ? (
                      <i key={glyph} style={glyphVars(glyph, '--g')} />
                    ) : (
                      <em key={`dot:${index}`} />
                    )))}
                  </span>
                  <span>Share</span>
                  <b>{pct(reading.share)}</b>
                  <u>{formatCompactNum(reading.damage)}</u>
                </span>
              ) : null}
            </div>

            <div className={pick ? 'rpt-keys is-lit' : 'rpt-keys'}>
              <p className="rpt-band">By skill type</p>
              {wheel.types.map((ring) => (
                <button
                  key={ring.key}
                  type="button"
                  className={litType(ring.key) ? 'rpt-key-row is-at' : 'rpt-key-row'}
                  style={{ '--c': ring.color } as CssVars}
                  {...reach({ kind: 'type', id: ring.key })}
                >
                  {ring.glyph ? <i style={glyphVars(ring.glyph, '--g')} /> : <em />}
                  <span>{ring.label}</span>
                  <b>{pct(ring.share)}</b>
                </button>
              ))}

              <p className="rpt-band">By talent node</p>
              {wheel.nodes.map((ring) => (
                <button
                  key={ring.key}
                  type="button"
                  className={litNode(ring.key) ? 'rpt-key-row is-at' : 'rpt-key-row'}
                  style={{ '--c': ring.color } as CssVars}
                  {...reach({ kind: 'node', id: ring.key })}
                >
                  {ring.glyph ? <i style={glyphVars(ring.glyph, '--g')} /> : <em />}
                  <span>{ring.label}</span>
                  <b>{pct(ring.share)}</b>
                </button>
              ))}
            </div>
          </div>

          {/* the list carries the names the drawing has no room for */}
          <div className="rpt-ghead rpt-key">
            <span />
            <span className="rpt-bkey">Feature</span>
            <span className="rpt-bkey">Total Damage</span>
            <span className="rpt-bkey">Share</span>
          </div>
          {wheel.segs.map((seg) => {
            const node = wheel.nodes.find((entry) => entry.key === seg.nodeKey)
            const top = wheel.segs[0]?.share || 1
            return (
              <div
                key={seg.id}
                className={litSeg(seg) ? 'rpt-row is-at' : 'rpt-row'}
                style={{
                  '--el': seg.color,
                  '--i': seg.color,
                  '--w': (0.5 + 0.5 * Math.min(1, seg.share / top)).toFixed(3),
                } as CssVars}
                {...reach({ kind: 'feature', id: seg.id })}
              >
                <span className="rpt-lb">
                  {node?.glyph ? <i className="rpt-alt" style={glyphVars(node.glyph, '--g')} /> : null}
                  {seg.row.label}
                </span>
                <span className="rpt-num">{formatCompactNum(seg.damage)}</span>
                <span className="rpt-num rpt-pct">{pct(seg.share)}</span>
              </div>
            )
          })}

          <p className="rpt-band">
            Upgrade Paths
            <em>{report.alternatives.length} main stat &amp; Sonata paths</em>
          </p>

          {paths.length > 0 ? (
            <>
              <div className={path ? 'rpt-lad is-lit' : 'rpt-lad'}>
                <div className="rpt-lad-flag">
                  <b
                    style={{
                      '--pos': `${ladder.at(lands)}%`,
                      '--grade': landed.color,
                    } as CssVars}
                  >
                    {landed.label}
                  </b>
                </div>

                <div className="rpt-lad-track" style={{ '--scale': ladder.scale } as CssVars}>
                  <span className="rpt-lad-scale" />
                  <span className="rpt-lad-fill" style={{ '--pos': `${ladder.at(lands)}%` } as CssVars} />
                  {LADDER.filter(([at]) => at > ladder.lo && at < ladder.hi).map(([at]) => (
                    <span key={at} className="rpt-lad-notch" style={{ '--at': `${ladder.at(at)}%` } as CssVars} />
                  ))}
                  <span className="rpt-lad-span"
                    style={{
                      '--a': `${ladder.at(spanFrom)}%`,
                      '--w': `${ladder.at(spanTo) - ladder.at(spanFrom)}%`,
                      '--k': gain ? 'var(--ok)' : 'var(--danger)',
                    } as CssVars}
                  />
                  <span className="rpt-lad-here" style={{ '--at': `${ladder.at(here)}%` } as CssVars} />
                </div>

                <div className="rpt-lad-tiers">
                  {ladder.tiers.map(([at, label], index) => {
                    const edge = index === 0 ? ' is-lead'
                      : index === ladder.tiers.length - 1 ? ' is-tail' : ''
                    return (
                      <div
                        key={`${at}:${label}`}
                        className={`rpt-lad-tier${at <= lands ? ' is-reached' : ''}${edge}`}
                        style={{
                          '--at': `${ladder.at(at)}%`,
                          '--c': getBuildEvaluationTone(at).color,
                        } as CssVars}
                      >
                        <i aria-hidden="true" />
                        <b>{label}</b>
                      </div>
                    )
                  })}
                </div>

                <div className="rpt-lad-marks" style={{ '--lanes': ladder.depth } as CssVars}>
                  {paths.map((group, index) => (
                    <button
                      key={group.id}
                      type="button"
                      className={pathAt === index ? 'rpt-lad-mk is-at' : 'rpt-lad-mk'}
                      style={{
                        '--at': `${ladder.at(group.representative.score)}%`,
                        '--lane': ladder.lanes[index],
                        '--k': group.representative.scoreDelta > 0 ? 'var(--ok)' : 'var(--danger)',
                      } as CssVars}
                      {...reachPath(index)}
                    >
                      <em aria-hidden="true" />
                      <s aria-hidden="true">
                        {group.to.slice(0, 2).map((side, at) => (
                          <SwapToken key={`${side.glyph ?? side.label}:${at}`} side={side} />
                        ))}
                      </s>
                      <b>{formatBuildEvaluationScore(group.representative.score)}</b>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rpt-bhead rpt-key rpt-key--paths">
                <span className="rpt-bkey">Change</span>
                <span className="rpt-bkey">Cost</span>
                <span className="rpt-bkey">Damage</span>
                <span className="rpt-bkey">&Delta; Score%</span>
              </div>
              {paths.map((group, index) => (
                <PathRow
                  key={group.id}
                  group={group}
                  at={pathAt === index}
                  reach={reachPath(index)}
                />
              ))}
            </>
          ) : (
            <p className="workspace-empty">No valid main stat or Sonata upgrades are available.</p>
          )}
        </div>
      </aside>
    </>,
    host,
  )
}

function PathRow({
  group,
  at,
  reach,
}: {
  group: AlternativePathGroup
  at: boolean
  reach: Record<string, () => void>
}) {
  const alternative = group.representative
  const gain = alternative.scoreDelta > 0

  return (
    <div
      className={at ? 'rpt-path is-at' : 'rpt-path'}
      style={{ '--k': gain ? 'var(--ok)' : 'var(--danger)' } as CssVars}
      tabIndex={0}
      {...reach}
    >
      <span className="rpt-swap">
        <SwapToken side={group.from} />
        <ChevronRight aria-hidden="true" size="0.75rem" />
        <span className="workspace-swap-dest-list">
          {group.to.map((side, index) => (
            <span key={`${side.glyph ?? side.label}:${index}`} className="workspace-swap-dest-item">
              {index > 0 ? <span className="workspace-swap-divider">/</span> : null}
              <SwapToken side={side} />
            </span>
          ))}
          {group.hiddenCount > 0 ? <span className="workspace-swap-more">+{group.hiddenCount}</span> : null}
        </span>
      </span>
      <span className="rpt-cost">{alternative.kind === 'sonataSet' ? '--' : alternative.cost}</span>
      <span className="rpt-num">{formatCompactNum(alternative.damage)}</span>
      <span className={`rpt-num workspace-num--${deltaSign(alternative.damageDeltaPct)}`}>
        {fmtSignedPct(alternative.damageDeltaPct)}
      </span>
    </div>
  )
}
