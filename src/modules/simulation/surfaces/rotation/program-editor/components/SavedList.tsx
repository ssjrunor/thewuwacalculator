/*
  Author: Runor Ewhro
  description: projects exact saved-rotation results into sortable entries,
               team contributions, comparison data, and selection actions.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger'
import type { MenuEntry } from '@/shared/ui/CtxMenu'
import {
  startTransition,
  type CSSProperties,
  type MouseEventHandler,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  CMP_MAX,
  formatSavedTime,
  formatSavedFigure,
  formatSavedTick,
  makeSavedAxis,
  makeSavedEntry,
  makeSavedEntries,
  groupSavedEntries,
  makeMemberTakes,
  rankSavedEntries,
  makeSavedRoster,
  makeSavedTicks,
  resolveSavedAxis,
  savedContributors,
  type SavedAxis,
  type SavedEntry,
  type SavedGroup,
  type SavedMember,
  type SavedMemberTake,
  type SavedRosterMember,
  type SavedListView,
  formatDuration,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/savedRotationList.ts'
import { ChevronDown, GitCompare } from 'lucide-react'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import type { RotationComparisonSummary } from '@/domain/entities/rotationSummary.ts'
import type { ResonatorId } from '@/domain/entities/runtime.ts'
import type { UiState } from '@/domain/entities/appState.ts'
import { withDefResMg } from '@/shared/lib/imageFallback.ts'
import { makeLeadCursor, type LeadCursor } from '@/shared/lib/leadCursor.ts'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay.tsx'
import { Expandable } from '@/shared/ui/Expandable.tsx'
import { useCompareMount } from '@/modules/simulation/surfaces/rotation/program-editor/interaction/compareRack.ts'
import { formatDamage } from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows.ts'
import { useAppStore } from '@/application/state'
import type { RunResult } from '@/modules/simulation/surfaces/rotation/program-editor/simulation/runProgram.ts'
import {
  NO_ROTATION_SUMMARY,
  type EditorSection,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import { savedRotationMembers } from '@/modules/simulation/surfaces/rotation/program-editor/simulation/simulation.ts'
import {
  BuildBand,
  RotationNodesInspector,
  RotationTotalsInspector,
  SelectionInspector,
  SupportReadings,
  selectionTone,
  type SelectionActions,
  type SelectionSummary,
} from '@/modules/simulation/surfaces/rotation/program-editor/components/InspectPanels.tsx'

const EMPTY_SECTIONS: EditorSection[] = []

const SAVED_FOLDS = { resonators: false, builds: true, breakdown: false }

const LABEL_ROOM = 92
const NODE_ROOM = 22
const TAG_ROOM = 104

const EDGE_ROOM = 58
const TICK_FADE = 340
const REFRAME_DELAY = 240

const LEAD_DOCK_MS = 110
const LEAD_CURSOR_H = 21
const LEAD_CURSOR_EDGE = 13
const TRACK_GUESS = 900
interface SavedListProps {
  entries: SavedRotation[]
  prefs: SavedListPrefs
  view: SavedListView
  /** stable identity of the active saved entry. */
  selectedId: string | null
  onSelect: (id: string) => void
  getContextItems: (id: string, live: boolean) => MenuEntry[]
  panel: SavedListPanel
  dockPanel: boolean
  onPanelChange: (panel: SavedListPanel) => void
  /** exact engine result for the active entry. */
  selectedRun: RunResult | null
  summariesById: ReadonlyMap<string, RotationComparisonSummary>
  loading: boolean
  query?: string
  shutGroupIds: ReadonlySet<ResonatorId>
  onGroupOpenChange: (id: ResonatorId, open: boolean) => void
  selection: SavedListSelection
  compare: SavedListCompare

  live?: SavedListLive | null
}

interface SavedListLive {
  entry: SavedRotation
  summary: RotationComparisonSummary
  /** exact result from which the entry and summary were projected. */
  run: RunResult
  /** true when current authored nodes differ from this result. */
  stale: boolean
}

/** comparison state backed by already-computed exact results. */
interface SavedListCompare {

  mode: boolean
  ids: readonly string[]
  runsById: ReadonlyMap<string, RunResult | null>

  full: boolean
  onToggle: (id: string) => void

  onExit: () => void
}

interface SavedListSelection {
  mode: boolean
  selectedIds: ReadonlySet<string>
  summary: SelectionSummary | null
  actions: SelectionActions
  buildClickCapture: (id: string) => MouseEventHandler<HTMLElement>
}

export type SavedListPanel = 'list' | 'read' | 'team' | null
type SavedListPrefs = Pick<
  UiState['savedRotationPreferences'],
  'sortBy' | 'sortOrder' | 'contributionFilter' | 'scaleToSelected'
>

function useTrackWidth(): [(node: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(TRACK_GUESS)
  const observed = useRef<HTMLElement | null>(null)

  const ref = useCallback((node: HTMLElement | null) => {
    observed.current = node
    if (node) {
      setWidth(node.getBoundingClientRect().width || TRACK_GUESS)
    }
  }, [])

  useEffect(() => {
    const node = observed.current
    if (!node || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver((records) => {
      const next = records[0]?.contentRect.width ?? 0
      if (next > 0) {
        setWidth(next)
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}

/*
  the axis is two numbers on the field, and every mark places itself from them
  in css, so one transition on those numbers glides the gridlines, the runs,
  the portraits and the figures together. the tick set is the only part that
  cannot interpolate: outgoing values are kept for one beat and faded out while
  the incoming ones travel into place.
*/
interface SavedTick {
  value: number
  gone: boolean
}

const axisVars = (axis: SavedAxis) => ({
  '--rsl-lo': axis.lo,
  '--rsl-hi': axis.hi,
}) as CSSProperties

const atVar = (value: number) => ({ '--rsl-v': Math.round(value) }) as CSSProperties

const runVars = (from: number, to: number, seg?: string) => ({
  '--rsl-va': Math.round(from),
  '--rsl-vb': Math.round(to),
  ...(seg ? { '--rsl-seg': seg } : null),
}) as CSSProperties

function Portrait({
  member,
  className,
  style,
}: {
  member: SavedMember
  className: string
  style?: CSSProperties
}) {
  return (
    <span className={className} title={member.name} style={style}>
      <DisplayImage src={member.profile} alt="" loading="lazy" onError={withDefResMg} />
    </span>
  )
}

// each portrait overlaps the previous portrait by the slanted edge width.
const CUT_RAKE = 13
const CUT_SLASH = 2
// overlap after leaving the separator width visible.
const CUT_STEP = CUT_RAKE - CUT_SLASH
const CUT_ZOOM = 2.8
// each earlier portrait extends one step above the following portrait.
const CUT_LIFT = 3
// keep the outgoing row mounted until its exit animation finishes.
const CUT_OUT_MS = 420

function cutShares(count: number): number[] {
  if (count <= 1) return [0.42]
  if (count === 2) return [0.42, 0.36]
  if (count === 3) return [0.37, 0.33, 0.3]
  return [0.28, 0.25, 0.24, 0.23]
}

// use a default icon when a saved portrait image is unavailable.
function withBareCut(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.closest('.rsl-cut__pane')?.classList.add('is-bare')
  withDefResMg(event)
}

// calculate proportional widths and fixed overlap offsets separately.
interface CutPane {
  member: SavedMember
  x: number
  xu: number
  w: number
  wu: number
  lift: number
}

function buildComparePanes(members: SavedMember[]): CutPane[] {
  const shares = cutShares(members.length)
  const reclaimed = (members.length - 1) * CUT_STEP
  const panes: CutPane[] = []
  let taken = 0

  members.forEach((member, index) => {
    const share = shares[index] ?? shares[shares.length - 1]!
    panes.push({
      member,
      x: taken * 100,
      xu: taken * reclaimed - index * CUT_STEP,
      w: share * 100,
      wu: share * reclaimed,
      lift: (members.length - index) * CUT_LIFT,
    })
    taken += share
  })

  return panes
}

// reserve the height of the first portrait.
function cutRise(count: number): number {
  return count * CUT_LIFT
}

function ResonanceCut({ members, out }: { members: SavedMember[]; out: boolean }) {
  const panes = buildComparePanes(members)

  return (
    <span className={`rsl-cut${out ? ' is-out' : ''}`} aria-hidden="true">
      {panes.map((pane, index) => (
        <span
          key={pane.member.id}
          className={`rsl-cut__pane${index === 0 ? ' is-head' : ''}`}
          style={{
            '--rsl-cut-x': pane.x,
            '--rsl-cut-xu': pane.xu,
            '--rsl-cut-w': pane.w,
            '--rsl-cut-wu': pane.wu,
            '--rsl-cut-lift': pane.lift,
            '--rsl-i': index,
            '--rsl-n': panes.length - 1,
            '--rsl-seg': pane.member.accent,
            '--rsl-cut-fx': pane.member.faceX,
            '--rsl-cut-fy': pane.member.faceY,
            '--rsl-cut-z': CUT_ZOOM * pane.member.faceScale,
          } as CSSProperties}
        >
          {/* mount the image immediately because its auto-width box is empty until it loads. */}
          <span className="rsl-cut__frame">
            <DisplayImage src={pane.member.sprite} alt="" onError={withBareCut} />
            <i className="rsl-cut__scrim" />
          </span>
          <i className="rsl-cut__edge" />
        </span>
      ))}
    </span>
  )
}

// mount transition art for the selected and outgoing rows.
function useSvdLstCut(selectedId: string | null): string | null {
  const [leaving, setLeaving] = useState<string | null>(null)
  const held = useRef(selectedId)

  useEffect(() => {
    if (held.current === selectedId) return

    const gone = held.current
    held.current = selectedId
    if (!gone) return

    setLeaving(gone)
    const timer = window.setTimeout(() => setLeaving(null), CUT_OUT_MS)
    return () => window.clearTimeout(timer)
  }, [selectedId])

  return leaving
}

/* the index and note share dimensions; measure index width and page margin to
   determine available space for comparison panels. */
interface CompareShare {
  pct: string
  top: boolean
}

interface PanelRoom {
  body: number
  note: number
  margin: number
  gap: number
}

function useSvdPnlRoom(panel: HTMLElement | null): PanelRoom | null {
  const [room, setRoom] = useState<PanelRoom | null>(null)

  useEffect(() => {
    const body = panel?.parentElement
    if (!panel || !body || typeof ResizeObserver === 'undefined') {
      return
    }

    /* an observer reports once when it starts, which is the first measurement */
    const observer = new ResizeObserver(() => {
      const root = getComputedStyle(document.documentElement)
      const next: PanelRoom = {
        body: body.clientWidth,
        note: panel.offsetWidth,
        margin: parseFloat(getComputedStyle(panel).marginRight) || 0,
        gap: parseFloat(root.fontSize) || 16,
      }
      setRoom((current) => (
        current
        && current.body === next.body
        && current.note === next.note
        && current.margin === next.margin
        && current.gap === next.gap
          ? current
          : next
      ))
    })
    observer.observe(body)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [panel])

  return room
}

/*
  keep compared panels mounted through their exit fold under the parent. their
  place is captured on the way out: removing the middle of three should let the
  other two travel, and let the one leaving leave from where it stood.
*/
/*
  the beam. one run from zero to the average, cut into the members who dealt
  it, in team order, each in its own element. the heavy cap closes the run at
  the average and the dashed rule past it is headroom only a perfect run
  reaches, so the row still reads as one comparable mark.

  a member rides its own run. runs too narrow to hold a portrait dock at their
  leading edge and overlap the neighbour. a name only
  prints where the run is wide enough to carry it, which is what the zoom is
  for. at rest the row prints one figure, its average.
*/
function Beam({
  row,
  axis,
  track,
  decimals,
  selected,
  lit,
  onLight,
  picked,
  onPick,
}: {
  row: SavedEntry
  axis: SavedAxis
  track: number
  decimals: number
  selected: boolean
  lit: ResonatorId | null
  onLight: (id: ResonatorId | null) => void
  picked: ResonatorId | null
  onPick: (id: ResonatorId) => void
}) {
  const px = (value: number) => axis.at(value) * track
  const contributors = savedContributors(row)
  const capX = px(row.avg)
  const headroom = Math.max(0, px(row.crit) - capX)
  /* place the average label after the cap when the left side has insufficient space. */
  const after = capX < LABEL_ROOM
  const floorX = px(row.normal)

  return (
    <span className="rsl-track">
      <i className="rsl-base" />

      {contributors.map((member) => (
        <i
          key={`run-${member.id}`}
          className={`rsl-run${lit === member.id ? ' is-lit' : ''}`}
          style={runVars(member.from, member.to, member.accent)}
        />
      ))}

      {headroom > 1 ? (
        <i className="rsl-headroom" style={runVars(row.avg, row.crit)} />
      ) : null}
      {headroom > 4 ? <i className="rsl-ceiling" style={atVar(row.crit)} /> : null}
      <i className="rsl-cap" style={atVar(row.avg)} />

      <b className={`rsl-avg${after ? ' is-after' : ''}`} style={atVar(row.avg)}>
        {formatSavedFigure(row.avg, decimals)}
      </b>

      {selected ? (
        <>
          <u
            className={floorX > LABEL_ROOM ? 'rsl-tick is-left' : 'rsl-tick'}
            style={atVar(row.normal)}
          >
            {formatSavedFigure(row.normal, decimals)}
          </u>
          {headroom > 6 ? (
            <u className="rsl-tick" style={atVar(row.crit)}>
              {formatSavedFigure(row.crit, decimals)}
            </u>
          ) : null}
        </>
      ) : null}

      {contributors.map((member) => {
        const span = px(member.to) - px(member.from)
        const middle = (member.from + member.to) / 2
        const tight = span < NODE_ROOM
        const at = px(middle)
        const marks = [
          tight ? 'is-tight' : '',
          span > TAG_ROOM ? 'has-room' : '',
          at < EDGE_ROOM ? 'is-edge-first' : '',
          at > track - EDGE_ROOM ? 'is-edge-last' : '',
          lit === member.id ? 'is-lit' : '',
        ].filter(Boolean).join(' ')

        return (
          <button
            type="button"
            key={`node-${member.id}`}
            className={`rsl-node${marks ? ` ${marks}` : ''}${picked === member.id ? ' is-picked' : ''}`}
            style={{
              ...atVar(tight ? member.from : middle),
              '--rsl-seg': member.accent,
            } as CSSProperties}
            title={`${member.name} ${formatSavedFigure(member.figure ?? member.to - member.from, decimals)}, ${(member.share * 100).toFixed(1)}%`}
            aria-label={`Inspect ${member.name}'s saved rotation damage`}
            aria-pressed={picked === member.id}
            onPointerEnter={() => onLight(member.id)}
            onPointerLeave={() => onLight(null)}
            onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onPick(member.id)
            }}
          >
            <DisplayImage src={member.profile} alt="" loading="lazy" onError={withDefResMg} />
            <span className="rsl-node__tag">
              <em>{member.name}</em>
              <samp>{(member.share * 100).toFixed(0)}%</samp>
            </span>
          </button>
        )
      })}
    </span>
  )
}

function GroupMarks({ group, decimals }: { group: SavedGroup; decimals: number }) {
  const lo = Math.min(...group.takes.map((take) => take.avg))

  return (
    <span className="rsl-track" aria-hidden="true">
      <i className="rsl-base" />
      {group.best > lo ? <i className="rsl-span" style={runVars(lo, group.best)} /> : null}
      {group.takes.map((take) => (
        <i
          key={take.id} className="rsl-ghost"
          style={atVar(take.avg)}
          title={`${take.label} ${formatSavedFigure(take.avg, decimals)}`}
        />
      ))}
      <u className="rsl-sec__total" style={atVar(group.best)}>
        {formatSavedTick(group.best, decimals)}
      </u>
    </span>
  )
}

function Row({
  row,
  rank,
  axis,
  track,
  decimals,
  selected,
  batchSelected,
  selectionMode,
  onSelectionClickCapture,
  cut,
  lit,
  onLight,
  picked,
  onPick,
  onSelect,
  getContextItems,
  compareMark,
  compareOff,
  grouped = false,
  live = null,
}: {
  row: SavedEntry
  rank: number
  axis: SavedAxis
  track: number
  decimals: number
  selected: boolean
  batchSelected: boolean
  selectionMode: boolean
  /* `on` is included; `off` is excluded by the comparison limit. */
  compareMark: 'on' | 'off' | null
  /* percentage against the best compared entry, displayed in place of rank. */
  compareOff: CompareShare | null
  onSelectionClickCapture: MouseEventHandler<HTMLElement>
  /* entering or exiting the row transition. */
  cut: 'in' | 'out' | null
  lit: ResonatorId | null
  onLight: (id: ResonatorId | null) => void
  picked: ResonatorId | null
  onPick: (id: ResonatorId) => void
  onSelect: (id: string) => void
  getContextItems: (id: string, live: boolean) => MenuEntry[]
  /* in grouped view, the head identifies the lead and rows show teammates. */
  grouped?: boolean
  /* set on the live take only: whether the figure is still the program's */
  live?: { stale: boolean } | null
}) {
  const mateNames = row.mates.map((mate) => mate.name).join(', ')
  const contributors = savedContributors(row)
  const lastContributor = contributors[contributors.length - 1]
  const at = axis.at(row.avg)

  return (
    <ContextTrigger
      asChild
      ariaLabel={`${row.label} rotation actions`}
      getItems={() => getContextItems(row.id, Boolean(row.live))}
    >
    <div
      className={[
        'rsl-row',
        selected ? 'is-selected' : '',
        selectionMode ? 'selection-mode' : '',
        batchSelected ? 'focus-selected' : '',
        compareMark ? `is-cmp-${compareMark}` : '',
        at < 0 ? 'is-off-first' : '',
        at > 1 ? 'is-off-last' : '',
        row.live ? 'rsl-live' : '',
        row.live && live?.stale ? 'is-stale' : '',
      ].filter(Boolean).join(' ')}
      style={{
        '--rsl-e': row.lead.accent,
        '--rsl-last': lastContributor?.accent ?? row.lead.accent,
        /* the row renders the strip's extension above its top edge. */
        ...(cut ? { '--rsl-cut-rise': cutRise(row.members.length) } : null),
      } as CSSProperties}
      role="listitem"
      /* the leader points at the row from the note's edge, and the field
         tracks the final row position */
      data-rsl-row-id={row.id}
      aria-current={selected ? 'true' : undefined}
      /* disable unsaved takes during persisted-entry selection. */
      aria-disabled={compareMark === 'off' || (row.live && selectionMode) ? true : undefined}
      aria-selected={row.live ? undefined : batchSelected}
      data-selection-focus-item={row.live ? undefined : 'true'}
      aria-label={[
        row.live ? 'Live rotation,' : '',
        `${row.lead.name}, ${row.label},`,
        mateNames ? `with ${mateNames},` : '',
        `average ${formatSavedFigure(row.avg, decimals)}`,
      ].filter(Boolean).join(' ')}
      tabIndex={0}
      onClickCapture={row.live ? undefined : onSelectionClickCapture}
      onClick={() => {
        if (!row.live || !selectionMode) onSelect(row.id)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (!row.live || !selectionMode) onSelect(row.id)
        }
      }}
    >
      {cut ? <ResonanceCut members={row.members} out={cut === 'out'} /> : null}

      {/* show the live label over transition art because unsaved runs have no
          separate entry title. */}
      {row.live && cut === 'in' ? (
        <span className="rsl-live__stamp">
          <i aria-hidden="true" />
          {live?.stale ? 'Stale' : 'Live'}
        </span>
      ) : null}

      <span className="rsl-row__lead">
        <span
          className={[
            'rsl-row__ix',
            compareOff ? 'is-off__ix' : '',
            compareOff?.top ? 'is-top' : '',
          ].filter(Boolean).join(' ')}
        >
          {compareOff ? (
            <>
              <b>{compareOff.pct}</b>
              <i aria-hidden="true">%</i>
            </>
          ) : row.live ? (
            /* show the live take's projected rank only when its figure is current. */
            <em>{live?.stale ? '\u2026' : String(rank).padStart(2, '0')}</em>
          ) : String(rank).padStart(2, '0')}
        </span>

        {/* group heads identify the lead. each take row shows its teammates;
            a solo take retains the lead portrait. */}
        {grouped && row.mates.length > 0 ? (
          <span className="rsl-row__mates" title={row.mates.map((mate) => mate.name).join(', ')}>
            {row.mates.map((mate) => (
              <Portrait
                key={mate.id}
                member={mate} className="rsl-face rsl-face--mate rsl-face--crew"
                style={{ '--rsl-e': mate.accent } as CSSProperties}
              />
            ))}
          </span>
        ) : (
          <Portrait member={row.lead} className="rsl-face rsl-face--row" />
        )}

        <span className="rsl-row__name">
          <b>{row.label}</b>
          {row.live ? (
            <span className="rsl-row__rate">
              {live?.stale ? 'stale' : 'live'}
            </span>
          ) : row.dps != null ? (
            <span className="rsl-row__rate">
              {formatDuration(row.duration)} · {formatSavedFigure(row.dps, decimals)} DPS
            </span>
          ) : null}

        </span>

        {/* held for a beat, the whole identity block gives way to the take's
            roster: the same crew, cut to the same shares, across the same room
            the name was using */}
        {row.members.length > 1 ? (
          <span className="rsl-crew">
            {row.members.map((member, index) => (
              <span
                key={member.id} className="rsl-crew__cut"
                style={{
                  '--rsl-seg': member.accent,
                  '--rsl-i': index,
                  '--rsl-cut': member.share,
                } as CSSProperties}
                title={`${member.name} ${formatSavedFigure(member.figure ?? member.to - member.from, decimals)}`}
              >
                <DisplayImage src={member.profile} alt="" loading="lazy" onError={withDefResMg} />
                <samp>{(member.share * 100).toFixed(0)}%</samp>
              </span>
            ))}
          </span>
        ) : null}
      </span>

      <span className="rsl-row__plot">
        <Beam
          row={row}
          axis={axis}
          track={track}
          decimals={decimals}
          selected={selected}
          lit={lit}
          onLight={onLight}
          picked={picked}
          onPick={onPick}
        />
        <i className="rsl-off rsl-off--first" aria-hidden="true">‹</i>
        <i className="rsl-off rsl-off--last" aria-hidden="true">›</i>

      </span>
    </div>
    </ContextTrigger>
  )
}

/*
  what a rebuilt saved rotation reads as. it is drawn once and used twice: the
  panel beside the field is this, and so is every take standing to its left. a
  compared take is not a second design, it is this inspector for its own entry.
*/
function SavedInspectorRead({
  row,
  run,
  stale = false,
}: {
  row: SavedEntry
  run: RunResult | null
  stale?: boolean
}) {
  const savedAt = formatSavedTime(row.updatedAt)
  const decimals = useAppStore((state) => state.ui.rotationEditorPreferences.decimals)
  const damageBasis = useAppStore((state) => state.ui.rotationEditorPreferences.damageBasis)
  const runSummary = run
    ? damageBasis === 'full' ? run.fullSummary : run.summary
    : null
  /*
    the take snapshot supplies builds before the run resolves. keep them
    visible while result figures arrive.
  */
  const snapMembers = useMemo(
    () => run ? run.members : savedRotationMembers(row.entry),
    [run, row.entry],
  )

  return (
    <>
      <div className="rte-inspector__head">
        <div className="rte-inspector__top">
          <Portrait
            member={row.lead} className="rte-inspector__avatar rsl-inspector__avatar"
          />
          <span className="rte-inspector__titles">
            <b>{row.entry.name}</b>
            <small className="rsl-inspector__meta">
              {row.live
                ? stale
                  ? `Not saved · editor differs · last run ${savedAt}`
                  : `Not saved · last run ${savedAt}`
                : `Saved ${savedAt}`}
            </small>
          </span>
        </div>
        <div className="rte-figure">
          <b>
            {runSummary
              ? formatDamage(runSummary.total.avg, decimals)
              : formatSavedFigure(row.avg, decimals)}
          </b>
          <span className="rte-figure__unit">avg</span>
          {runSummary ? (
            <span className="rte-figure__share">
              {runSummary.counts.damage}{' '}
              {runSummary.counts.damage === 1 ? 'damage row' : 'damage rows'}
            </span>
          ) : null}
          {runSummary ? (
            <SupportReadings totals={runSummary.supportTotals} decimals={decimals} />
          ) : null}
        </div>
      </div>

      <div className="rte-inspector__mid rte-scroll">
        {/*
          the same sections in the same order as the editor reads them, standing
          whether the run has arrived or not. the builds come off the take's own
          snapshot and are open from the first frame; everything else is
          collapsed by default. results fill those folded sections as they arrive.
        */}
        <RotationTotalsInspector
          key={row.id}
          summary={runSummary ?? NO_ROTATION_SUMMARY}
          members={snapMembers}
          defaultOpen={SAVED_FOLDS}
          decimals={decimals}
        />
        <RotationNodesInspector sections={run?.sections ?? EMPTY_SECTIONS} />

        {row.entry.note.trim() ? (
          <section className="rte-sect">
            <span className="rte-lbl">Note</span>
            <p className="rsl-inspector__note">{row.entry.note}</p>
          </section>
        ) : null}
      </div>
    </>
  )
}

/*
  a compared take uses the same panel. each additional panel shifts left and
  stacks beneath its parent.
*/
function SavedCompareInspector({
  row,
  run,
  stale,
  index,
  leaving,
  open,
  aside,
}: {
  row: SavedEntry
  run: RunResult | null
  stale: boolean
  index: number
  leaving: boolean
  /* closing the read panel closes its compared panels. */
  open: boolean
  /* shift the rack left by one panel width when the index occupies the margin. */
  aside: boolean
}) {
  return (
    <aside
      className={[
        'rte-inspector rsl-inspector rsl-cmp',
        open ? 'is-out' : '',
        leaving ? 'is-leaving' : '',
      ].filter(Boolean).join(' ')}
      inert={leaving || !open}
      aria-label={`${row.entry.name}, compared`}
      style={{
        '--rte-res': row.lead.accent,
        '--rsl-cmp-k': index + 1,
        '--rsl-shift': aside ? 1 : 0,
      } as CSSProperties}
    >
      <SavedInspectorRead row={row} run={run} stale={stale} />
    </aside>
  )
}

function SavedRotationInspector({
  row,
  run,
  liveStale,
  open,
  aside,
  selection,
}: {
  row: SavedEntry | null
  run: RunResult | null
  liveStale: boolean
  open: boolean
  /* the index kept the margin, so the note hangs a panel further left */
  aside: boolean
  selection: SavedListSelection
}) {
  return (
    <aside
      className={`rte-inspector rsl-inspector${open ? ' is-out' : ''}`}
      inert={!open}
      aria-label="Saved rotation inspector"
      style={{
        ...(row ? { '--rte-res': row.lead.accent } : null),
        '--rsl-shift': aside ? 1 : 0,
      } as CSSProperties}
    >
      {selection.summary ? (
        <>
          <div className="rte-inspector__head">
            <div className="rte-inspector__top">
              <span className="rte-inspector__titles">
                <b>Selection</b>
                <small className="rsl-inspector__meta">Saved rotations</small>
              </span>
            </div>
            <div className="rte-figure rte-figure--sel">
              <b>{selection.summary.count}</b>
              <span className="rte-figure__unit">selected</span>
            </div>
            {selection.summary.count > 0 ? (
              <div className="rte-selsum__bar" aria-hidden="true">
                {selection.summary.tallies.map((tally, index) => (
                  <i
                    key={tally.label}
                    style={{
                      flexGrow: tally.count,
                      '--rte-tone': selectionTone(index),
                    } as CSSProperties}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div className="rte-inspector__mid rte-scroll">
            <SelectionInspector
              summary={selection.summary}
              actions={selection.actions}
              emptyText="Pick saved rotations to act on them together. Shift picks a range."
            />
          </div>
        </>
      ) : row ? (
        <SavedInspectorRead row={row} run={run} stale={row.live && liveStale} />
      ) : (
        <p className="rte-palette__empty">Select a saved rotation to inspect it.</p>
      )}
    </aside>
  )
}

/*
  the resonator rack, read from its panel. `mark` is a member's
  standing in it: `on` is already up, which includes the anchor the others are
  read against, and `off` is a member the full rack has no room for, which
  disables further picks visibly.
*/
interface MemberComparison {
  mode: boolean
  ids: readonly ResonatorId[]
  mark: (id: ResonatorId) => 'on' | 'off' | null
  onToggle: () => void
}

/*
  the archive's roster. the anchor panel picks the member it is about out of
  it, and a compared panel re-aims itself the same way, so the grid is written
  once and told what a portrait means where it is standing.
*/
function SavedTeamRoster({
  roster,
  member,
  mark,
  pressedIsMark,
  onSelect,
}: {
  roster: SavedRosterMember[]
  member: SavedRosterMember | null
  mark: (id: ResonatorId) => 'on' | 'off' | null
  /* during comparison, portrait pressed state indicates rack membership. */
  pressedIsMark: boolean
  onSelect: (id: ResonatorId) => void
}) {
  const decimals = useAppStore((state) => state.ui.rotationEditorPreferences.decimals)

  return (
    <section className="rte-sect rsl-team__roster">
      <div className="rsl-team__grid" role="group" aria-label="Choose a resonator">
        {roster.map((candidate) => {
          const selected = candidate.id === member?.id
          const cmp = mark(candidate.id)
          return (
            <button
              key={candidate.id}
              type="button"
              className={[
                'rsl-team__member',
                selected ? 'is-selected' : '',
                cmp ? `is-cmp-${cmp}` : '',
              ].filter(Boolean).join(' ')}
              style={{ '--rsl-e': candidate.accent } as CSSProperties}
              aria-pressed={pressedIsMark ? cmp === 'on' : selected}
              title={`${candidate.name}: ${formatSavedFigure(candidate.damage, decimals)} across ${candidate.entries} saved rotations`}
              onClick={() => onSelect(candidate.id)}
            >
              <span className="rsl-team__portrait">
                <DisplayImage
                  src={candidate.profile}
                  alt=""
                  loading="lazy"
                  onError={withDefResMg}
                />
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

/*
  what a take was run with, for the one member the ledger is about. the take's
  snapshot is only rebuilt when its row is opened: the fold's content is not
  mounted until then, so a ledger of twenty takes costs nothing to draw.
*/
function SavedTakeBuild({
  entry,
  memberId,
}: {
  entry: SavedRotation
  memberId: ResonatorId
}) {
  const build = useMemo(
    () => savedRotationMembers(entry).find((member) => member.id === memberId) ?? null,
    [entry, memberId],
  )

  if (!build) {
    return (
      <p className="rsl-team__take-void">
        This rotation was saved before builds were included.
      </p>
    )
  }

  return (
    <div className="rte-bld">
      <BuildBand member={build} identified={false} />
    </div>
  )
}

/*
  one member's saved damage, entry by entry, each take against the biggest of
  them. the anchor panel prints this under the roster it was picked from and a
  compared member prints the same thing on its own, so the rack is read across
  one shared ledger row.
*/
function SavedTeamLedger({
  member,
  takes,
}: {
  member: SavedRosterMember
  takes: SavedMemberTake[]
}) {
  const decimals = useAppStore((state) => state.ui.rotationEditorPreferences.decimals)
  const peak = Math.max(1, ...takes.map((take) => take.damage))

  return (
    <section className="rte-sect rsl-team__ledger">
      <div className="rsl-team__focus">
        <span className="rsl-team__focus-portrait">
          <DisplayImage src={member.profile} alt="" onError={withDefResMg} />
        </span>
        <span className="rsl-team__focus-name">
          <b>{member.name}</b>
          <small>
            {member.entries} {member.entries === 1 ? 'entry' : 'entries'}
          </small>
        </span>
        <span className="rsl-team__focus-total">
          <b>{formatSavedFigure(member.damage, decimals)}</b>
          <small>damage</small>
        </span>
      </div>

      <div className="rsl-team__takes">
      {takes.map((take, index) => (
        <Expandable
          key={take.id} className="rsl-team__take"
          style={{
            '--rsl-p': take.damage / peak,
            '--rsl-i': index,
            '--rsl-e': member.accent,
          } as CSSProperties}
          TriggerTag="button"
          triggerClass="rsl-team__take-head"
          innerClass="rsl-team__take-body"
          plainTrigger
          hideChevron
          noHeaderWrap
          header={(
            <>
              <div className="rsl-team__take-line">
                <span className="rsl-team__take-name">
                  <ChevronDown className="rsl-team__take-chev" size="0.7rem" aria-hidden="true" />
                  <DisplayImage src={take.lead.profile} alt="" onError={withDefResMg} />
                  <b>{take.label}</b>
                </span>
                <strong>{formatSavedFigure(take.damage, decimals)}</strong>
              </div>
              <span className="rsl-team__meter" aria-hidden="true">
                <i />
              </span>
              <span className="rsl-team__take-meta">
                {(take.share * 100).toFixed(1)}% of {formatSavedFigure(take.total, decimals)}
              </span>
            </>
          )}
        >
          <SavedTakeBuild entry={take.entry} memberId={member.id} />
        </Expandable>
      ))}
      </div>
    </section>
  )
}

/*
  a compared member uses the full roster panel. the rack aligns its rows.
  each panel has its own grid: a portrait re-aims the panel, which is how a
  comparison is corrected without taking it down and building it again. the
  members already up elsewhere are shown standing and stop taking picks, since
  one member cannot be two of the panels being read against each other.
*/
function SavedTeamCompareInspector({
  roster,
  member,
  takes,
  index,
  leaving,
  open,
  standing,
  onReaim,
}: {
  roster: SavedRosterMember[]
  member: SavedRosterMember
  takes: SavedMemberTake[]
  index: number
  leaving: boolean
  /* closing the resonator panel closes its comparison rack. */
  open: boolean
  /* every member the rack is already holding, the anchor included */
  standing: readonly ResonatorId[]
  onReaim: (from: ResonatorId, to: ResonatorId) => void
}) {
  const mark = useCallback(
    (id: ResonatorId): 'on' | 'off' | null => (
      id !== member.id && standing.includes(id) ? 'on' : null
    ),
    [member.id, standing],
  )

  return (
    <aside
      className={[
        'rte-inspector rsl-team rsl-cmp',
        open ? 'is-out' : '',
        leaving ? 'is-leaving' : '',
      ].filter(Boolean).join(' ')}
      inert={leaving || !open}
      aria-label={`${member.name}, compared`}
      style={{
        '--rte-res': member.accent,
        '--rsl-cmp-k': index + 1,
      } as CSSProperties}
    >
      <div className="rte-inspector__head rsl-team__head">
        <span className="rte-lbl">Compared</span>
        <b>Resonator damage</b>
        <small>{roster.length} across saved rotations</small>
      </div>

      <div className="rte-inspector__mid rte-scroll">
        <SavedTeamRoster
          roster={roster}
          member={member}
          mark={mark}
          pressedIsMark={false}
          onSelect={(id) => onReaim(member.id, id)}
        />
        <SavedTeamLedger member={member} takes={takes} />
      </div>
    </aside>
  )
}

function SavedTeamInspector({
  roster,
  member,
  takes,
  open,
  onSelect,
  compare,
}: {
  roster: SavedRosterMember[]
  member: SavedRosterMember | null
  takes: SavedMemberTake[]
  open: boolean
  onSelect: (id: ResonatorId) => void
  compare: MemberComparison
}) {
  const panelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    panelRef.current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'end',
    })
  }, [open])

  return (
    <aside
      ref={panelRef}
      className={`rte-inspector rsl-team${open ? ' is-out' : ''}`}
      inert={!open}
      aria-label="Resonator damage across saved rotations"
      style={member ? ({ '--rte-res': member.accent } as CSSProperties) : undefined}
    >
      <div className="rte-inspector__head rsl-team__head">
        <span className="rte-lbl">Resonators</span>
        <b>Resonator damage</b>
        <small>
          {compare.mode
            ? `${compare.ids.length + (member ? 1 : 0)} of ${CMP_MAX}`
            : `${roster.length} across saved rotations`}
        </small>
        <button
          type="button" className="rsl-team__cmp"
          aria-pressed={compare.mode}
          disabled={!compare.mode && roster.length < 2}
          title={compare.mode
            ? 'Stop comparing'
            : 'Compare with another resonator'}
          onClick={compare.onToggle}
        >
          <GitCompare aria-hidden="true" />
          <span>{compare.mode ? 'Stop' : 'Compare'}</span>
        </button>
      </div>

      <div className="rte-inspector__mid rte-scroll">
        <SavedTeamRoster
          roster={roster}
          member={member}
          mark={compare.mark}
          pressedIsMark={compare.mode}
          onSelect={onSelect}
        />

        {member ? (
          <SavedTeamLedger key={member.id} member={member} takes={takes} />
        ) : null}
      </div>
    </aside>
  )
}

export function SavedList({
  entries,
  prefs,
  view,
  selectedId,
  onSelect,
  getContextItems,
  panel,
  dockPanel,
  onPanelChange,
  selectedRun,
  summariesById,
  loading,
  query = '',
  shutGroupIds,
  onGroupOpenChange,
  selection,
  compare,
  live = null,
}: SavedListProps) {
  const [gaugeRef, track] = useTrackWidth()
  const decimals = useAppStore((state) => state.ui.rotationEditorPreferences.decimals)
  const leadBodyRef = useRef<HTMLDivElement | null>(null)
  const leadRailRef = useRef<HTMLDivElement | null>(null)
  const [leadPanel, setLeadPanel] = useState<HTMLElement | null>(null)
  const room = useSvdPnlRoom(leadPanel)
  const [framedSelectedId, setFramedSelectedId] = useState(selectedId)
  const { sortBy, sortOrder, contributionFilter, scaleToSelected } = prefs
  const fieldEntries = useMemo(
    () => (live ? [...entries, live.entry] : entries),
    [entries, live],
  )
  const fieldSummaries = useMemo(() => {
    if (!live) return summariesById
    const merged = new Map(summariesById)
    merged.set(live.entry.id, live.summary)
    return merged
  }, [live, summariesById])
  const rows = useMemo(
    () => makeSavedEntries(
      fieldEntries,
      { sortBy, sortOrder, contributionFilter },
      query,
      fieldSummaries,
      decimals,
    ),
    [contributionFilter, decimals, fieldEntries, fieldSummaries, query, sortBy, sortOrder],
  )
  /* the archive's own length, which is what the index counts and what the
     hidden-take line is measured against */
  const keptCount = useMemo(() => rows.filter((row) => !row.live).length, [rows])
  const liveHidden = Boolean(live) && rows.every((row) => !row.live)
  const ranks = useMemo(() => rankSavedEntries(rows), [rows])
  const full = useMemo(() => makeSavedAxis(rows), [rows])
  const groups = useMemo(() => (view === 'groups' ? groupSavedEntries(rows) : []), [rows, view])
  /* compute a live take's projected rank within its own bank. */
  const groupRanks = useMemo(() => new Map(
    groups.map((group) => [group.lead.id, rankSavedEntries(group.takes)] as const),
  ), [groups])
  const roster = useMemo(() => makeSavedRoster(rows), [rows])

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  )
  useEffect(() => {
    if (selected) return

    /* the field opens on the archive. a live take is read because it was
       picked, never because it happened to sort first, and never because it
       was the only row standing while the archive was still being recalculated */
    const order = view === 'groups' ? groups.flatMap((group) => group.takes) : rows
    const first = order.find((row) => !row.live)
    if (!first) return

    onSelect(first.id)
  }, [groups, onSelect, rows, selected, view])
  const framedSelected = useMemo(
    () => rows.find((row) => row.id === framedSelectedId) ?? null,
    [framedSelectedId, rows],
  )

  /*
    a compared take keeps its panel while the field is searched, so the row is
    taken from the field when it is there and rebuilt from the entry when the
    query has filtered it out from under itself.
  */
  const resolveCmpRow = useCallback((id: string): SavedEntry | null => {
    const shown = rows.find((row) => row.id === id)
    if (shown) return shown

    const entry = fieldEntries.find((candidate) => candidate.id === id)
    const summary = fieldSummaries.get(id)
    return entry && summary ? makeSavedEntry(entry, summary, decimals) : null
  }, [decimals, fieldEntries, fieldSummaries, rows])
  const comparePanels = useCompareMount(compare.ids)
  /*
    a row's standing in the comparison. `on` is already up, which includes the
    anchor the others are read against; `off` is a row the full rack has no
    room for, and it visibly disables further picks.
  */
  const cmpMark = useCallback((id: string): 'on' | 'off' | null => {
    if (!compare.mode) return null
    if (id === selectedId || compare.ids.includes(id)) return 'on'
    return compare.full ? 'off' : null
  }, [compare.full, compare.ids, compare.mode, selectedId])

  /*
    keep the index and note visible together. track whether the list opened
    the note for panel positioning.
  */
  const [listAside, setListAside] = useState(false)
  const [panelWas, setPanelWas] = useState(panel)
  if (panel !== panelWas) {
    setPanelWas(panel)
    setListAside(panel === 'read' && panelWas === 'list')
  }
  const listShown = panel === 'list' || (panel === 'read' && listAside)

  /*
    when comparison panels need room, shift the index to keep the field visible.
  */
  const standing = (listShown ? 1 : 0) + (panel === 'read' ? 1 : 0) + compare.ids.length
  const roomForNext = !room
    || room.margin + (standing + 1) * room.note + standing * room.gap <= room.body
  const [foldedFor, setFoldedFor] = useState<number | null>(null)
  if (!compare.mode) {
    if (foldedFor !== null) setFoldedFor(null)
  } else if (listAside && !roomForNext && foldedFor !== compare.ids.length) {
    setFoldedFor(compare.ids.length)
    setListAside(false)
  }

  /*
    a note opened during entry selection is its summary and closes when
    selection ends. notes opened for reading remain visible.
  */
  const selectionWas = useRef(selection.mode)
  useEffect(() => {
    const was = selectionWas.current
    selectionWas.current = selection.mode
    /* a comparison is opened by ending the selection that picked it, so the
       note it just stood up is not the one this is meant to put away */
    if (was && !selection.mode && !compare.mode && panel === 'read' && listAside) {
      onPanelChange('list')
    }
  }, [compare.mode, listAside, onPanelChange, panel, selection.mode])

  /*
    while a comparison is open the rank is spent on the question the rack was
    opened to answer: what each standing take is worth against the best of
    them. it is the one figure a row of panels does not already print, and the
    order the rank was reading is still the order the rows are in.
  */
  const cmpOff = useMemo(() => {
    if (!compare.mode) return null

    const takes = [selectedId, ...compare.ids]
      .filter((id): id is string => Boolean(id))
      .map((id) => [id, resolveCmpRow(id)?.avg ?? 0] as const)
      .filter(([, avg]) => avg > 0)
    const peak = Math.max(0, ...takes.map(([, avg]) => avg))
    if (peak <= 0) return null

    return new Map<string, CompareShare>(takes.map(([id, avg]) => [
      id,
      /* display the best result as one whole figure. */
      avg === peak
        ? { pct: '100', top: true }
        : { pct: ((avg / peak) * 100).toFixed(1), top: false },
    ]))
  }, [compare.ids, compare.mode, resolveCmpRow, selectedId])

  const leadRow = compare.mode ? null : selectedId
  const leavingCutId = useSvdLstCut(leadRow)
  const cutFor = useCallback(
    (id: string): 'in' | 'out' | null => {
      if (id === leadRow) return 'in'
      return id === leavingCutId ? 'out' : null
    },
    [leadRow, leavingCutId],
  )

  /* the whole field is read through one window: everything until an entry is
     picked, and that entry's own neighbourhood once one is */
  const axis = useMemo(
    () => resolveSavedAxis(rows, framedSelected, full, scaleToSelected),
    [framedSelected, full, rows, scaleToSelected],
  )
  const [hoveredMemberId, setHoveredMemberId] = useState<ResonatorId | null>(null)
  const [pickedMemberId, setPickedMemberId] = useState<ResonatorId | null>(null)
  const pickedMember = roster.find((member) => member.id === pickedMemberId) ?? null
  const activeMember = pickedMember ?? (panel === 'team'
    ? roster.find((member) => member.id === selected?.lead.id) ?? roster[0] ?? null
    : null)
  const selectedMemberId = panel === 'team' ? activeMember?.id ?? null : null
  const lit = hoveredMemberId ?? selectedMemberId
  const memberTakes = useMemo(
    () => makeMemberTakes(rows, activeMember?.id ?? null),
    [activeMember?.id, rows],
  )
  /*
    use the same comparison rack for resonators. the panel member remains the
    anchor while this mode adds compared members.
  */
  const [memCmpMode, setMemCmpMode] = useState(false)
  const [memCmpIds, setMemCmpIds] = useState<readonly ResonatorId[]>([])
  /*
    the anchor can be moved onto a member the rack is already holding, from
    the roster or off a run in the field. it is one member either way, so the
    rack gives that one up for as long as the panel is about it and takes it
    back when the panel moves on.
  */
  const memCmpStanding = useMemo(
    () => memCmpIds.filter((id) => id !== activeMember?.id),
    [activeMember?.id, memCmpIds],
  )
  const memCmpPanels = useCompareMount(memCmpStanding)
  const exitMemCmp = useCallback(() => {
    setMemCmpMode(false)
    setMemCmpIds([])
  }, [])
  const memCmpMark = useCallback((id: ResonatorId): 'on' | 'off' | null => {
    if (!memCmpMode) return null
    if (id === activeMember?.id || memCmpStanding.includes(id)) return 'on'
    return memCmpStanding.length >= CMP_MAX - 1 ? 'off' : null
  }, [activeMember?.id, memCmpMode, memCmpStanding])
  /*
    the gridlines the next window has no use for. they are handed over by the
    click that changes the window, so they travel with the set that replaced
    them for one beat during the transition.
  */
  const [fading, setFading] = useState<number[]>([])
  const fadeTimer = useRef<number | null>(null)
  const reframeTimer = useRef<number | null>(null)
  const wanted = useMemo(() => makeSavedTicks(axis), [axis])
  const ticks = useMemo<SavedTick[]>(() => [
    ...wanted.map((value) => ({ value, gone: false })),
    ...fading
      .filter((value) => !wanted.includes(value))
      .map((value) => ({ value, gone: true })),
  ], [wanted, fading])

  useEffect(() => {
    if (reframeTimer.current != null) {
      window.clearTimeout(reframeTimer.current)
      reframeTimer.current = null
    }

    if (selectedId === framedSelectedId) return

    reframeTimer.current = window.setTimeout(() => {
      reframeTimer.current = null
      const next = rows.find((row) => row.id === selectedId) ?? null
      const afterAxis = resolveSavedAxis(rows, next, full, scaleToSelected)
      const after = makeSavedTicks(afterAxis)
      startTransition(() => {
        setFading(wanted.filter((value) => !after.includes(value)))
        setFramedSelectedId(selectedId)
      })
      if (fadeTimer.current != null) window.clearTimeout(fadeTimer.current)
      fadeTimer.current = window.setTimeout(() => setFading([]), TICK_FADE)
    }, scaleToSelected ? REFRAME_DELAY : 0)

    return () => {
      if (reframeTimer.current != null) {
        window.clearTimeout(reframeTimer.current)
        reframeTimer.current = null
      }
    }
  }, [framedSelectedId, full, rows, scaleToSelected, selectedId, wanted])

  useEffect(() => () => {
    if (fadeTimer.current != null) window.clearTimeout(fadeTimer.current)
    if (reframeTimer.current != null) window.clearTimeout(reframeTimer.current)
  }, [])

  const litLead: ResonatorId | null = view === 'groups' ? selected?.lead.id ?? null : null

  /*
    the thread belongs to the viewport, not the scrolling entries, so the
    pointer is built once against the panel and kept across selections: the
    cursor has to travel from wherever it already is, and rebuilding it on
    every pick would teleport it.
  */
  const leadPointerRef = useRef<LeadCursor | null>(null)
  const leadPickedRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const body = leadBodyRef.current
    const rail = leadRailRef.current
    const cursor = rail?.querySelector<HTMLElement>('.rsl-thread__cursor') ?? null
    if (!body || !rail || !cursor) {
      return
    }

    const pointer = makeLeadCursor({
      body,
      rail,
      cursor,
      rowSelector: '.rsl-ld',
      prefix: '--rsl-cursor',
      inkVar: '--rsl-e',
      restHeight: LEAD_CURSOR_H,
      edge: LEAD_CURSOR_EDGE,
      dockMs: LEAD_DOCK_MS,
      findSelected: () => (
        leadPickedRef.current
          ? body.querySelector<HTMLElement>(`[data-rsl-lead-id="${CSS.escape(leadPickedRef.current)}"]`)
          : null
      ),
    })
    leadPointerRef.current = pointer
    const detach = pointer.attach()

    return () => {
      detach()
      leadPointerRef.current = null
    }
  }, [rows])

  /* update the cursor when the selected entry changes. */
  useLayoutEffect(() => {
    const first = leadPickedRef.current === null
    leadPickedRef.current = selectedId
    leadPointerRef.current?.select(!first && selectedId != null)
  }, [selectedId])

  if (loading) {
    return (
      <div className="rsl rsl--empty" aria-busy="true">
        <AppLdrVrly className="rsl__loader"
          mode="centered"
          text="Recalculating saved rotations..."
        />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rsl rsl--empty">
        <p className="rte-empty">
          {query.trim()
          ? 'No saved rotation matches this search.'
          : entries.length > 0
            ? 'These saved rotations do not have enough runtime data to recalculate.'
            : 'No rotations saved yet.'}
        </p>
        {liveHidden ? <p className="rsl-live__hidden">Current rotation hidden by this search.</p> : null}
      </div>
    )
  }

  const select = (id: string) => {
    if (compare.mode) {
      if (cmpMark(id) !== 'off') {
        compare.onToggle(id)
      }
      return
    }

    const next = rows.find((row) => row.id === id) ?? null
    /* picking a take from the lead panel opens its group and keeps the
       selected entry visible in the field. */
    if (next && shutGroupIds.has(next.lead.id)) {
      onGroupOpenChange(next.lead.id, true)
    }
    onSelect(id)
    if (id === selectedId) onPanelChange('read')
  }

  const pickMember = (id: ResonatorId) => {
    setPickedMemberId(pickedMemberId === id ? null : id)
    onPanelChange('team')
  }

  const pickRosterMember = (id: ResonatorId) => {
    if (!memCmpMode) {
      pickMember(id)
      return
    }
    if (id === activeMember?.id || memCmpMark(id) === 'off') return
    setMemCmpIds((current) => (current.includes(id)
      ? current.filter((held) => held !== id)
      : [...current, id]))
  }
  /* resolve a compared member from the roster through its exit fold. */
  const memCmpOf = (id: ResonatorId) => roster.find((member) => member.id === id) ?? null
  /*
    retarget a compared panel in place within the rack.
  */
  const reaimMemCmp = (from: ResonatorId, to: ResonatorId) => {
    if (to === activeMember?.id || memCmpIds.includes(to)) return
    setMemCmpIds((current) => current.map((held) => (held === from ? to : held)))
  }

  /*
    the index and the note can be up at the same time, so the marks have to
    read that way: the index is down whenever it is standing, wherever it is
    standing beside. pressing a mark that is already down folds that one panel
    away while preserving the other panel.
  */
  type Channel = Exclude<SavedListPanel, null>
  const markPressed = (channel: Channel) =>
    channel === 'list' ? listShown : panel === channel

  const markClick = (channel: Channel) => {
    /* toggle the index beside the open note. */
    if (channel === 'list' && panel === 'read') {
      setListAside(!listAside)
      return
    }

    if (channel === 'team' && memCmpMode) exitMemCmp()

    if (channel === 'read') {
      if (compare.mode) compare.onExit()

      /* close the note panel and return to the list. */
      if (panel === 'read' && listAside) {
        setListAside(false)
        onPanelChange('list')
        return
      }
    }

    onPanelChange(panel === channel && !dockPanel ? null : channel)
  }

  return (
    <>
    <div className={`rsl rsl--${view}`}>
      {/*
        the field. the axis is the heading, and it is the same axis in both
        views. share one gridline backdrop across the rows.
      */}
      <div className="rsl-field" style={axisVars(axis)}>
        <div className="rsl-axis">
          <span className="rsl-axis__track">
            {ticks.map((tick) => (
              <span
                key={tick.value}
                className={`rsl-axis__tick${tick.gone ? ' is-gone' : ''}`}
                style={atVar(tick.value)}
              >
                {formatSavedTick(tick.value, decimals)}
              </span>
            ))}
          </span>
        </div>

        <div
          className={`rsl-rows${selectedMemberId ? ' is-member-lit' : ''}`}
          role="list"
          aria-label={view === 'list' ? 'Saved rotations by damage' : 'Saved rotations by resonator'}
        >
          <span className="rsl-layer" aria-hidden="true">
            <i className="rsl-gauge" ref={gaugeRef} />
            {ticks.map((tick) => (
              <i
                className={`rsl-rule${tick.gone ? ' is-gone' : ''}`}
                key={tick.value}
                style={atVar(tick.value)}
              />
            ))}
            {/* the selection line anchors comparison marks across the field. */}
            {selected ? (
              <i className="rsl-plumb"
                style={{
                  ...atVar(selected.avg),
                  '--rsl-e': selected.lead.accent,
                } as CSSProperties}
              />
            ) : null}
          </span>

          {view === 'list'
            ? rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                rank={ranks.get(row.id) ?? 1}
                axis={axis}
                track={track}
                decimals={decimals}
                selected={row.id === leadRow}
                batchSelected={selection.selectedIds.has(row.id)}
                selectionMode={selection.mode}
                onSelectionClickCapture={selection.buildClickCapture(row.id)}
                compareMark={cmpMark(row.id)}
                compareOff={cmpOff?.get(row.id) ?? null}
                cut={cutFor(row.id)}
                lit={lit}
                onLight={setHoveredMemberId}
                picked={selectedMemberId}
                onPick={pickMember}
                onSelect={select}
                getContextItems={getContextItems}
                live={row.live ? live : null}
              />
            ))
            : groups.map((group) => {
              const isShut = shutGroupIds.has(group.lead.id)

              return (
                <Expandable
                  key={group.lead.id}
                  as="section"
                  className={[
                    'rsl-sec',
                    isShut ? 'is-shut' : '',
                    group.lead.id === litLead ? 'is-on' : '',
                  ].filter(Boolean).join(' ')}
                  style={{ '--rsl-e': group.lead.accent } as CSSProperties}
                  role="group"
                  aria-label={group.lead.name}
                  open={!isShut}
                  onOpenChange={(open) => onGroupOpenChange(group.lead.id, open)}
                  TriggerTag="button"
                  triggerClass="rsl-sec__head"
                  innerClass="rsl-sec__body"
                  plainTrigger
                  hideChevron
                  noHeaderWrap
                  header={(
                    <>
                    <span className="rsl-sec__lead">
                      <ChevronDown className="rsl-sec__chev" size="0.85rem" aria-hidden="true" />
                      <Portrait member={group.lead} className="rsl-face rsl-face--sec" />
                      <b className="rsl-sec__title">{group.lead.name}</b>
                      <span className="rsl-sec__n">
                        {group.takes.length}
                      </span>
                    </span>

                    <span className="rsl-row__plot">
                      {isShut ? <GroupMarks group={group} decimals={decimals} /> : null}
                    </span>
                    </>
                  )}
                >
                  {group.takes.map((row) => (
                      <Row
                        key={row.id}
                        row={row}
                        rank={groupRanks.get(group.lead.id)?.get(row.id) ?? 1}
                        axis={axis}
                        track={track}
                        decimals={decimals}
                        selected={row.id === leadRow}
                        batchSelected={selection.selectedIds.has(row.id)}
                        selectionMode={selection.mode}
                        onSelectionClickCapture={selection.buildClickCapture(row.id)}
                        compareMark={cmpMark(row.id)}
                compareOff={cmpOff?.get(row.id) ?? null}
                        cut={cutFor(row.id)}
                        lit={lit}
                        onLight={setHoveredMemberId}
                        picked={selectedMemberId}
                        onPick={pickMember}
                        onSelect={select}
                        getContextItems={getContextItems}
                        grouped
                        live={row.live ? live : null}
                      />
                    ))}
                </Expandable>
              )
            })}

          {/* a search can hide the live take; state that absence in the field. */}
          {liveHidden ? (
            <p className="rsl-live__hidden">Current rotation hidden by this search.</p>
          ) : null}
        </div>
      </div>
    </div>

    <aside
      ref={setLeadPanel}
      className={`rte-palette rsl-lead${listShown ? ' is-out' : ''}`}
      inert={!listShown}
      aria-label="Saved rotations by lead"
    >
      <div className="rte-palette__head rsl-lead__head">
        <span className="rte-lbl">Rotations</span>
        <b>Saved rotations</b>
        <small>
          {keptCount} entries
        </small>
      </div>

      <div className="rsl-lead__rail" ref={leadRailRef} aria-hidden="true">
        <i className="rsl-thread" aria-hidden="true" />
        <i className="rsl-thread__cursor"
          style={selected ? ({ '--rsl-e': selected.lead.accent } as CSSProperties) : undefined}
        />
      </div>
      <div className="rsl-lead__body"
        ref={leadBodyRef}
        role="listbox"
        aria-label="Saved rotations by lead"
      >
        {rows.map((row) => {
          const isOn = row.id === selectedId
          const isGrouped = !isOn && litLead != null && row.lead.id === litLead
          const leadMark = cmpMark(row.id)
          return (
            <ContextTrigger
              key={row.id}
              asChild
              ariaLabel={`${row.label} rotation actions`}
              getItems={() => getContextItems(row.id, Boolean(row.live))}
            >
            <div
              className={[
                'rsl-ld',
                isOn ? 'is-on' : '',
                isGrouped ? 'is-grouped' : '',
                selection.mode ? 'selection-mode' : '',
                !row.live && selection.selectedIds.has(row.id) ? 'focus-selected' : '',
                leadMark ? `is-cmp-${leadMark}` : '',
                row.live ? 'rsl-live' : '',
              ].filter(Boolean).join(' ')}
              style={{ '--rsl-e': row.lead.accent } as CSSProperties}
              role="option"
              aria-selected={selection.mode ? selection.selectedIds.has(row.id) && !row.live : isOn}
              aria-disabled={leadMark === 'off' || (row.live && selection.mode) ? true : undefined}
              data-selection-focus-item={row.live ? undefined : 'true'}
              aria-label={`${row.live ? 'Live rotation, not saved, ' : ''}${row.label}, with ${row.members.map((member) => member.name).join(', ')}, average ${formatSavedFigure(row.avg, decimals)}`}
              data-rsl-lead-id={row.id}
              tabIndex={0}
              onClickCapture={row.live ? undefined : selection.buildClickCapture(row.id)}
              onClick={() => {
                if (!row.live || !selection.mode) select(row.id)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  if (!row.live || !selection.mode) select(row.id)
                }
              }}
            >
              <i className="rsl-ld__seg" aria-hidden="true" />
              <span className="rsl-ld__ix">
                {row.live
                  ? <em>{live?.stale ? '\u2026' : String(ranks.get(row.id) ?? 1).padStart(2, '0')}</em>
                  : String(ranks.get(row.id) ?? 1).padStart(2, '0')}
              </span>
              {/* the whole team, at one size and one weight: the take is
                  theirs, and the resonator it was written from is marked by a
                  fuller ring and nothing else */}
              <span className="rsl-faces">
                {row.members.slice(0, 3).map((member) => (
                  <Portrait
                    key={member.id}
                    member={member}
                    className={`rsl-face${member.id === row.lead.id ? ' rsl-face--lead' : ''}`}
                    style={{ '--seg': member.accent } as CSSProperties}
                  />
                ))}
              </span>
              <b className="rsl-ld__name">{row.label}</b>
              <span className="rsl-ld__fig">{formatSavedFigure(row.avg, decimals)}</span>
              <span className="rsl-seam" aria-hidden="true">
                {row.members.map((member) => (
                  <i
                    key={member.id}
                    style={{
                      flexGrow: Math.max(member.share, 0.02),
                      '--seg': member.accent,
                    } as CSSProperties}
                  />
                ))}
              </span>
            </div>
            </ContextTrigger>
          )
        })}
      </div>
    </aside>

    <SavedRotationInspector
      row={selected}
      run={selectedRun}
      liveStale={Boolean(selected?.live && live?.stale)}
      open={panel === 'read'}
      aside={listAside}
      selection={selection}
    />
    {comparePanels.map((mount) => {
      const row = resolveCmpRow(mount.id)
      return row ? (
        <SavedCompareInspector
          key={mount.id}
          row={row}
          run={row.live ? live?.run ?? null : compare.runsById.get(mount.id) ?? null}
          stale={Boolean(row.live && live?.stale)}
          index={mount.index}
          leaving={mount.leaving}
          open={panel === 'read'}
          aside={listAside}
        />
      ) : null
    })}
    {memCmpPanels.map((mount) => {
      const member = memCmpOf(mount.id)
      return member ? (
        <SavedTeamCompareInspector
          key={mount.id}
          roster={roster}
          member={member}
          takes={makeMemberTakes(rows, member.id)}
          index={mount.index}
          leaving={mount.leaving}
          open={panel === 'team'}
          standing={memCmpStanding.concat(activeMember ? [activeMember.id] : [])}
          onReaim={reaimMemCmp}
        />
      ) : null
    })}
    <SavedTeamInspector
      roster={roster}
      member={activeMember}
      takes={memberTakes}
      open={panel === 'team'}
      onSelect={pickRosterMember}
      compare={{
        mode: memCmpMode,
        ids: memCmpStanding,
        mark: memCmpMark,
        onToggle: () => (memCmpMode ? exitMemCmp() : setMemCmpMode(true)),
      }}
    />

    <div className="rte-marks"
      role="group"
      aria-label="Saved rotation side panels"
      style={{
        ...(selected ? { '--rte-note-res': selected.lead.accent } : null),
        ...(activeMember ? { '--rte-team-res': activeMember.accent } : null),
      } as CSSProperties}
    >
      {([
        ['list', 'list', 'Saved rotations'],
        ['read', 'details', 'Details for the selected saved rotation'],
        ['team', 'damage', 'Compare resonator damage across saved rotations'],
      ] as const).map(([channel, label, hint]) => (
        <button
          key={channel}
          type="button"
          className={`rte-mark rte-mark--${channel}`}
          aria-pressed={markPressed(channel)}
          title={hint}
          onClick={() => markClick(channel)}
        >
          {label}
        </button>
      ))}
    </div>
    </>
  )
}
