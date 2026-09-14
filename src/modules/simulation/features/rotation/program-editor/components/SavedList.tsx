/*
  Author: Runor Ewhro
  Description: Projects exact saved-rotation results into sortable entries,
               team contributions, comparison data, and selection actions.
*/

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
} from '@/modules/simulation/features/rotation/program-editor/presentation/savedRotationList.ts'
import { ChevronDown, GitCompare } from 'lucide-react'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import type { RotationComparisonSummary } from '@/domain/entities/rotationSummary.ts'
import type { ResonatorId } from '@/domain/entities/runtime.ts'
import type { UiState } from '@/domain/entities/appState.ts'
import { withDefResMg } from '@/shared/lib/imageFallback.ts'
import { makeLeadCursor, type LeadCursor } from '@/shared/lib/leadCursor.ts'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay.tsx'
import { Expandable } from '@/shared/ui/Expandable.tsx'
import { useCompareMount } from '@/modules/simulation/features/rotation/program-editor/interaction/compareRack.ts'
import { formatDamage } from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'
import { useAppStore } from '@/domain/state/store.ts'
import type { RunResult } from '@/modules/simulation/features/rotation/program-editor/simulation/runProgram.ts'
import {
  NO_ROTATION_SUMMARY,
  type EditorSection,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import { savedRotationMembers } from '@/modules/simulation/features/rotation/program-editor/simulation/simulation.ts'
import {
  BuildBand,
  RotationNodesInspector,
  RotationTotalsInspector,
  SelectionInspector,
  SupportReadings,
  selectionTone,
  type SelectionActions,
  type SelectionSummary,
} from '@/modules/simulation/features/rotation/program-editor/components/InspectPanels.tsx'

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
  /** Stable identity of the active saved entry. */
  selectedId: string | null
  onSelect: (id: string) => void
  panel: SavedListPanel
  dockPanel: boolean
  onPanelChange: (panel: SavedListPanel) => void
  /** Exact engine result for the active entry. */
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
  /** Exact result from which the entry and summary were projected. */
  run: RunResult
  /** True when current authored nodes differ from this result. */
  stale: boolean
}

/** Comparison state backed by already-computed exact results. */
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
  The axis is two numbers on the field, and every mark places itself from them
  in CSS, so one transition on those numbers glides the gridlines, the runs,
  the portraits and the figures together. The tick set is the only part that
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
      <img src={member.profile} alt="" loading="lazy" onError={withDefResMg} />
    </span>
  )
}

/* ---- the cut ----
   picked, the lead stops naming the take and shows the cast instead. the name,
   the rate and the rank are all printed elsewhere on this screen; who ran it is
   not, so that is the one thing the row spends its own room on.
*/

/*
  the cut's geometry, in its own unit so the whole strip scales with the root.
  a pane is a parallelogram, so its box is one rake wider than the room it
  occupies: each pane starts a rake back from where the last one ended, which
  puts the two raked edges on the same line and leaves nothing between two
  frames but the slash.
*/
const CUT_RAKE = 13
const CUT_SLASH = 2
/* what a pane reclaims by starting back on the last one's raked edge */
const CUT_STEP = CUT_RAKE - CUT_SLASH
/*
  one camera for the whole strip: the sprite is drawn at this multiple of the
  row's height whatever pane it lands in, so pane width buys a member room
  rather than moving the lens. at this distance the sprite's own ground covers
  the pane, which is what keeps the panes reading as frames and not as art on
  a plate.
*/
const CUT_ZOOM = 2.8
/*
  the panes nest: they share a floor and each one stands this much taller than
  the one behind it. counted from the back, so the last pane always stands one
  step and the head stands the whole cast's worth, which is what lets the order
  of the strip be read off its skyline. a team is three, so the head never
  stands more than three steps.
*/
const CUT_LIFT = 3
/* how long a leaving cut is held mounted for, so it can fold back out */
const CUT_OUT_MS = 420
/* the same, for a compared panel folding back under its neighbour */


/*
  how the run is split. a full team spends all of it, the head pane taking the
  most so the order of the cast reads from the widths alone. a part team stops
  short instead of stretching: past about a pane and a half the sprite runs out
  of ground and the frame would be showing floor.
*/
function cutShares(count: number): number[] {
  if (count <= 1) return [0.42]
  if (count === 2) return [0.42, 0.36]
  if (count === 3) return [0.37, 0.33, 0.3]
  return [0.28, 0.25, 0.24, 0.23]
}

/*
  a resonator whose standing art has not shipped yet still gets a pane. the
  shared default sits centred in it on a wash of the member's element instead
  of being placed as a face, which the icon does not have.
*/
function withBareCut(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.closest('.rsl-cut__pane')?.classList.add('is-bare')
  withDefResMg(event)
}

/*
  a pane is placed in two parts: its share of the run, and the whole steps of
  rake it has reclaimed from the panes before it. that keeps the strip sized to
  whatever room the lead column actually has while the seams stay exact.
*/
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

/* the headroom the whole strip needs, which is the head pane's own lift */
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
          {/* the sprite is placed on its height with an auto width, so before it
              has loaded its box is zero wide. deferring it would never resolve:
              a box with no width never meets the viewport, so the load it is
              waiting on is the load that would give it one. mounting the cut on
              at most two rows is the throttle here, not the loading hint */}
          <span className="rsl-cut__frame">
            <img src={pane.member.sprite} alt="" onError={withBareCut} />
            <i className="rsl-cut__scrim" />
          </span>
          <i className="rsl-cut__edge" />
        </span>
      ))}
    </span>
  )
}

/*
  the cut only mounts on the row that holds the floor and the one just leaving
  it, so a field of takes is never holding every member's standing art at once.
*/
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

/*
  Whether another panel would still leave the field something to be. The index
  and the note are the same box and the index never travels, so one measurement
  answers for all of them: its own margin is the page's margin, and its width
  is what every panel standing beside it is worth.
*/
/* what a standing take is worth against the best one in the rack */
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
  Compared panels are held mounted for one beat after they are taken down, so
  a panel folds back under the one it opened from instead of vanishing. Its
  place is captured on the way out: removing the middle of three should let the
  other two travel, and let the one leaving leave from where it stood.
*/
/*
  the beam. one run from zero to the average, cut into the members who dealt
  it, in team order, each in its own element. the heavy cap closes the run at
  the average and the dashed rule past it is headroom only a perfect run
  reaches, so the row still reads as one comparable mark.

  A member rides its own run. Runs too narrow to hold a portrait dock at their
  leading edge and overlap the neighbour rather than disappear, and a name only
  prints where the run is wide enough to carry it, which is what the zoom is
  for. At rest the row prints one figure, its average.
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
  /* an average whose cap sits too near the start of the track has no room to
     print before it, so the figure crosses to the other side */
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
            <img src={member.profile} alt="" loading="lazy" onError={withDefResMg} />
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

/*
  the row: who it was written for, what the take is called, and the beam. the
  whole cast now rides the beam, so the slot beside the name holds the lead
  alone. Selected, the row grows, and the room goes to the two things it already
  has: the lead's portrait, at the size a 4rem band can carry, and the name.

  At rest it stands on its own sheer ground with its element edge and its place
  in the sort, which is what keeps a resting row from reading as loose text on
  the gridlines. The ground is thin enough for those gridlines to pass through.
*/
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
  /* whether this take is already standing in the comparison, or whether the
     rack is full and has no room for it */
  compareMark: 'on' | 'off' | null
  /* what this take is worth against the best one standing, printed where the
     rank goes: while a comparison is open, that is what the order is worth */
  compareOff: CompareShare | null
  onSelectionClickCapture: MouseEventHandler<HTMLElement>
  /* whether this row is dressing itself in the cut, or folding it back away */
  cut: 'in' | 'out' | null
  lit: ResonatorId | null
  onLight: (id: ResonatorId | null) => void
  picked: ResonatorId | null
  onPick: (id: ResonatorId) => void
  onSelect: (id: string) => void
  /* banked under its lead, where the head has already said who the take was
     written for. the row spends that portrait on the rest of the team instead */
  grouped?: boolean
  /* set on the live take only: whether the figure is still the program's */
  live?: { stale: boolean } | null
}) {
  const mateNames = row.mates.map((mate) => mate.name).join(', ')
  const contributors = savedContributors(row)
  const lastContributor = contributors[contributors.length - 1]
  const at = axis.at(row.avg)

  return (
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
        /* the row is the one that has to let the strip out of its top, so it
           is the one told how far the strip stands past it */
        ...(cut ? { '--rsl-cut-rise': cutRise(row.members.length) } : null),
      } as CSSProperties}
      role="listitem"
      /* the leader points at the row from the note's edge, and only the field
         knows where a row has ended up */
      data-rsl-row-id={row.id}
      aria-current={selected ? 'true' : undefined}
      /* an unsaved take has nothing to rename, duplicate or delete, so it is
         explicitly disabled while a persisted-entry selection is being built */
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

      {/* opened, a take gives its readout up to the standing art, because a
          record is named everywhere else. an unsaved one is not, so the line
          the art covered is printed back over it, on the scrim the cut already
          lays down to keep its own foot readable */}
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
            /* the rank it would take, held apart from the ranks that are real.
               a stale figure cannot claim a place at all, so it withholds one */
            <em>{live?.stale ? '\u2026' : String(rank).padStart(2, '0')}</em>
          ) : String(rank).padStart(2, '0')}
        </span>

        {/* banked, the group head is already the lead's portrait and name, so
            printing it again on every take says nothing. what the takes in a
            bank actually differ by is who else ran them, so that is what the
            row spends the cell on. a take with nobody else keeps the lead,
            which is the one case where the portrait is still the answer */}
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
                <img src={member.profile} alt="" loading="lazy" onError={withDefResMg} />
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
  )
}

/*
  What a rebuilt saved rotation reads as. It is drawn once and used twice: the
  panel beside the field is this, and so is every take standing to its left. A
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
    the builds are known from the take's own snapshot, so the panel shows them
    while the run is still resolving rather than leaving the fold out and
    putting it back once the numbers land.
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
          collapsed by default, so it can fill in inside a fold nobody is
          looking into rather than putting something else on screen first.
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
  A take being compared. The same panel, one note width and a rem further left
  for each one, and stacked under its neighbour so it comes out from beneath
  the panel it opened from rather than landing on top of it.
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
  /* the compared panels belong to the read panel: closing that one puts them
     away with it rather than leaving them standing on their own */
  open: boolean
  /* the index is standing in the margin, so the whole rack starts a panel
     further left rather than opening underneath it */
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
  The resonator rack, read from the panel that owns it. `mark` is a member's
  standing in it: `on` is already up, which includes the anchor the others are
  read against, and `off` is a member the full rack has no room for, which
  stops taking picks rather than failing them silently.
*/
interface MemberComparison {
  mode: boolean
  ids: readonly ResonatorId[]
  mark: (id: ResonatorId) => 'on' | 'off' | null
  onToggle: () => void
}

/*
  The archive's roster. The anchor panel picks the member it is about out of
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
  /* while a rack is up, a portrait answers whether it is standing rather than
     whether it is this panel's own subject */
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
                <img
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
  What a take was run with, for the one member the ledger is about. The take's
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
        This take was saved before builds were kept with them.
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
  One member's saved damage, entry by entry, each take against the biggest of
  them. The anchor panel prints this under the roster it was picked from and a
  compared member prints the same thing on its own, so the rack is read across
  one row rather than against two different ledgers.
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
          <img src={member.profile} alt="" onError={withDefResMg} />
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
                  <img src={take.lead.profile} alt="" onError={withDefResMg} />
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
  A member being compared. The whole panel the roster was picked from, so the
  rack is read straight across rather than against a shorter card. Its grid is
  its own: a portrait re-aims this panel at another member, which is how a
  comparison is corrected without taking it down and building it again. The
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
  /* the rack belongs to the resonator panel: closing that one puts these away
     with it rather than leaving them standing on their own */
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
        <b>Saved damage index</b>
        <small>{roster.length} across the archive</small>
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
        <b>Saved damage index</b>
        <small>
          {compare.mode
            ? `${compare.ids.length + (member ? 1 : 0)} of ${CMP_MAX}`
            : `${roster.length} across the archive`}
        </small>
        <button
          type="button" className="rsl-team__cmp"
          aria-pressed={compare.mode}
          disabled={!compare.mode && roster.length < 2}
          title={compare.mode
            ? 'Stop comparing'
            : 'Stand another resonator beside this one'}
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
  /*
    the live take is resolved through the same door as the archive rather than
    beside it: the rank it prints, the window it is read through and the bank
    it stands in are only true if it was sorted and filtered with the rest.
  */
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
  /* a live take the query has filtered out has not stopped existing, and it is
     the one row the reader is most likely to be looking for */
  const liveHidden = Boolean(live) && rows.every((row) => !row.live)
  const ranks = useMemo(() => rankSavedEntries(rows), [rows])
  const full = useMemo(() => makeSavedAxis(rows), [rows])
  const groups = useMemo(() => (view === 'groups' ? groupSavedEntries(rows) : []), [rows, view])
  /* a bank numbers its own takes, so the live take's would-be rank inside a
     bank is worked out against that bank rather than against the whole field */
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
    room for, and it stops taking picks rather than failing them silently.
  */
  const cmpMark = useCallback((id: string): 'on' | 'off' | null => {
    if (!compare.mode) return null
    if (id === selectedId || compare.ids.includes(id)) return 'on'
    return compare.full ? 'off' : null
  }, [compare.full, compare.ids, compare.mode, selectedId])

  /*
    the index and the note used to spend the same place: opening a take put
    the list it was picked from away. they stand together instead, the note one
    panel further left and under the index, so a take can be read without
    losing the index it came out of. which channel is open is still one value,
    so this is what remembers the note was opened out of the list rather than
    on its own.
  */
  const [listAside, setListAside] = useState(false)
  const [panelWas, setPanelWas] = useState(panel)
  if (panel !== panelWas) {
    setPanelWas(panel)
    /* the note stands beside the index only when it was opened out of it; any
       other channel takes the whole margin, so the index folds away */
    setListAside(panel === 'read' && panelWas === 'list')
  }
  const listShown = panel === 'list' || (panel === 'read' && listAside)

  /*
    a rack the field cannot be seen past is not a comparison. while takes are
    being stood up the index gives its place to the next panel, so the room a
    comparison needs is taken from the browsing aid rather than from the field
    it is being read against.
  */
  const standing = (listShown ? 1 : 0) + (panel === 'read' ? 1 : 0) + compare.ids.length
  const roomForNext = !room
    || room.margin + (standing + 1) * room.note + standing * room.gap <= room.body
  /*
    the index folds itself away for the rack that runs the page out of room,
    and only the once: it is a panel the reader owns, so opening it straight
    back leaves it open and the rack simply stands where it stands. what has
    been answered is remembered against the rack it was answered for, so the
    next take stood up asks again.
  */
  const [foldedFor, setFoldedFor] = useState<number | null>(null)
  if (!compare.mode) {
    if (foldedFor !== null) setFoldedFor(null)
  } else if (listAside && !roomForNext && foldedFor !== compare.ids.length) {
    setFoldedFor(compare.ids.length)
    setListAside(false)
  }

  /*
    a note standing beside the index while entries are being picked is the
    selection's own summary: it went up because the picking put it up, so it
    comes down when the picking stops rather than being left hanging next to
    the list. a note that has the whole margin was opened to be read and is
    left alone.
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
      /* the best of them is the whole, so it reads as one figure rather than
         a rounded hundred trailing a decimal that can only ever be zero */
      avg === peak
        ? { pct: '100', top: true }
        : { pct: ((avg / peak) * 100).toFixed(1), top: false },
    ]))
  }, [compare.ids, compare.mode, resolveCmpRow, selectedId])

  /*
    the picked take wears the field's standing art, which says it is the one
    being read. inside a comparison it is one of several being read, so it
    stands the art down for as long as the mode is on and takes the standing
    mark the rest of the rack is wearing.
  */
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
    the same rack the takes use, standing resonators instead. the member in
    the panel is the anchor, so the mode only ever adds the ones read against
    it and the panel it is read in stays where it is.
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
    them for one beat instead of vanishing under it.
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

  /* picking an entry in Groups lights that resonator's whole thread wherever
     those entries happen to sit in the sort. the column itself never regroups */
  const litLead: ResonatorId | null = view === 'groups' ? selected?.lead.id ?? null : null

  /*
    The thread belongs to the viewport, not the scrolling entries, so the
    pointer is built once against the panel and kept across selections: the
    cursor has to travel from wherever it already is, and rebuilding it on
    every pick would teleport it instead.
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

  /* a pick lands on the cursor as well as on the entry */
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
        {liveHidden ? <p className="rsl-live__hidden">1 live take hidden by this search.</p> : null}
      </div>
    )
  }

  const select = (id: string, noRead?: boolean) => {
    if (compare.mode) {
      if (cmpMark(id) !== 'off') {
        compare.onToggle(id)
      }
      return
    }

    const next = rows.find((row) => row.id === id) ?? null
    /* picking a take from the lead panel opens the group holding it, so the
       field never lands on an entry it is not showing a row for */
    if (next && shutGroupIds.has(next.lead.id)) {
      onGroupOpenChange(next.lead.id, true)
    }
    onSelect(id)
    /* a pick off the index used to stop short of the note because opening it
       would have closed the index. it opens beside it now, so it opens */
    if (!noRead || panel === 'list') onPanelChange('read')
  }

  const pickMember = (id: ResonatorId) => {
    setPickedMemberId(pickedMemberId === id ? null : id)
    onPanelChange('team')
  }

  /*
    the grid is read two ways. at rest a portrait is what the panel is about,
    and while the rack is up it is one more ledger to stand beside it. the
    anchor is already up, so its own click is the one the mode has no answer
    for and it is left alone rather than taken down.
  */
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
  /* a compared member keeps its ledger through the beat it folds out over, so
     it is resolved from the roster rather than from what is still standing */
  const memCmpOf = (id: ResonatorId) => roster.find((member) => member.id === id) ?? null
  /*
    a compared panel pointed at another member. it keeps its place in the rack
    rather than being taken down and stood back up at the end, so correcting a
    comparison costs the one click that was wrong.
  */
  const reaimMemCmp = (from: ResonatorId, to: ResonatorId) => {
    if (to === activeMember?.id || memCmpIds.includes(to)) return
    setMemCmpIds((current) => current.map((held) => (held === from ? to : held)))
  }

  /*
    the index and the note can be up at the same time, so the marks have to
    read that way: the index is down whenever it is standing, wherever it is
    standing beside. pressing a mark that is already down folds that one panel
    away instead of closing the pair.
  */
  type Channel = Exclude<SavedListPanel, null>
  const markPressed = (channel: Channel) =>
    channel === 'list' ? listShown : panel === channel

  const markClick = (channel: Channel) => {
    /* the note is open: the index joins it or leaves it rather than replacing */
    if (channel === 'list' && panel === 'read') {
      setListAside(!listAside)
      return
    }

    /* both racks are held by the channel their panels stand in and by nothing
       else, so putting a channel away is the end of the comparison it was
       holding: a mode still on with no panels left to show it is a field that
       has quietly stopped opening what it is clicked on */
    if (channel === 'team' && memCmpMode) exitMemCmp()

    if (channel === 'read') {
      if (compare.mode) compare.onExit()

      /* and the note folds back under the index, leaving the index standing */
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
        views, so the gridlines behind the rows are one backdrop rather than a
        set that rebuilds itself section by section.
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
            {/* the selection dropped through the field, so every other mark is
                read against it rather than against the edge */}
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
                        grouped
                        live={row.live ? live : null}
                      />
                    ))}
                </Expandable>
              )
            })}

          {/* the query filters the archive and the live take with it, so the
              field says what it is no longer drawing rather than losing it */}
          {liveHidden ? (
            <p className="rsl-live__hidden">1 live take hidden by this search.</p>
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
        <b>Saved index</b>
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
            <div
              key={row.id}
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
                if (!row.live || !selection.mode) select(row.id, true)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  if (!row.live || !selection.mode) select(row.id, true)
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
        ['read', 'read', 'Read the selected saved rotation'],
        ['team', 'team', 'Compare resonator damage across saved rotations'],
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
