/*
  Author: Runor Ewhro
  Description: Lays the executed trace out on the one ruler the console draws
               against. Every entry the simulation actually ran takes a column,
               in the order it ran: a loop of four passes is four stretches of
               columns, not one stretch labelled x4. The handoffs cut those
               columns into field spans, the containers section them from
               above, and each state the rotation wrote becomes its own track.
*/

import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay.ts'
import { skllTypeDspl } from '@/modules/simulation/model/skillTypes.ts'
import { stepDamageAt } from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'
import { flatTargetMatchesRuns } from '@/modules/simulation/features/rotation/program-editor/presentation/flatRows.ts'
import { isEditorBlock } from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import { editorLoopId } from '@/modules/simulation/features/rotation/program-editor/model/executionScope.ts'
import type {
  FlatRow,
  FlatRowTarget,
  FlatScope,
} from '@/modules/simulation/features/rotation/program-editor/presentation/flatRows.ts'
import type {
  EditorMember,
  EditorNode,
  EditorSection,
  LoopRunSelections,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'

/** how a step's mark is capped, so a liberation is not read as a basic */
export type RcnGlyph = 'bar' | 'heavy' | 'skill' | 'lib' | 'intro' | 'outro' | 'echo' | 'tune'

type RcnKind = 'step' | 'swap' | 'state'

/** which pass of which container a column ran in, for the readout to state */
export interface RcnPass {
  label: string
  run: number
  runs: number
}

export interface RcnNode {
  /** unique per column: the same authored node runs in more than one pass */
  key: string
  /** the authored node behind this execution, which is what a pick selects */
  id: string
  /** the exact execution a pick asks for, passes included */
  target: FlatRowTarget

  i: number
  kind: RcnKind
  label: string
  /** the node's own resonator: a step's caster, or who a handoff hands to */
  memberId?: string

  hold?: string

  color?: string
  glyph?: RcnGlyph
  value: number
  /** ran, but put no damage on the board */
  dead: boolean
  typeLabel?: string
  from?: string
  to?: string
  /** this is the pass the register is reading, so the playhead belongs here */
  live: boolean
  pass?: RcnPass
}

interface RcnFieldSpan {
  memberId: string
  a: number
  b: number
}

/**
 * One container over one pass. A loop of four passes leaves four of these
 * side by side rather than a single span wearing a multiplier, which is the
 * whole point: the console draws what ran, so a pass is a place on the ruler.
 */
export interface RcnBand {
  key: string
  id: string
  label: string
  kind: FlatScope['kind']
  run: number
  runs: number
  ratio?: number
  a: number
  b: number
  depth: number
  color?: string
  /** the first pass of this stretch, which is where the name is printed */
  head: boolean
  /** the last pass of this stretch, which is where the section closes */
  tail: boolean
}

/** where a container opens, turns over to its next pass, or closes */
export interface RcnSeam {
  /** the column this edge sits to the left of; `count` is the far right edge */
  i: number
  kind: 'edge' | 'pass'
  depth: number
}

interface RcnStatePoint {
  i: number
  v: number
  label: string
}

export interface RcnStateTrack {
  key: string
  label: string
  /** what the state held before the first write the rotation makes */
  seed: number
  max: number

  bool: boolean
  points: RcnStatePoint[]
}

export interface RcnModel {
  nodes: RcnNode[]
  steps: RcnNode[]
  spans: RcnFieldSpan[]
  bands: RcnBand[]
  seams: RcnSeam[]
  states: RcnStateTrack[]

  peak: number
  total: number
  /** a container ran more than once, so the ruler carries repeated passes */
  repeated: boolean
}

/* three tracks is what 18rem has room for without crushing the output track */
export const RCN_STATE_TRACKS = 3

/* deeper than this and a band is thinner than its own hairline */
export const RCN_BAND_LANES = 3

const GLYPH_BY_TYPE: Record<string, RcnGlyph> = {
  basicAtk: 'bar',
  heavyAtk: 'heavy',
  resonanceSkill: 'skill',
  resonanceLiberation: 'lib',
  introSkill: 'intro',
  outroSkill: 'outro',
  echoSkill: 'echo',
  tuneRupture: 'tune',
}

/* a step carries the display label rather than the key it came from, so the
   lookup is built from the same table the label was printed out of */
const GLYPH_BY_LABEL = new Map<string, RcnGlyph>(
  Object.entries(GLYPH_BY_TYPE).map(([key, glyph]) => [
    skllTypeDspl[key]?.short ?? skllTypeDspl[key]?.label ?? key,
    glyph,
  ]),
)

function parseState(raw: string | undefined): { v: number; bool: boolean } {
  if (raw === undefined) return { v: 0, bool: false }
  const text = raw.trim().toLowerCase()
  if (text === 'on' || text === 'true' || text === 'yes') return { v: 1, bool: true }
  if (text === '' || text === 'off' || text === 'false' || text === 'no') {
    return { v: 0, bool: true }
  }
  const num = Number(text.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(num) ? { v: Math.max(0, num), bool: false } : { v: 1, bool: true }
}

/**
 * Authored container colors keyed by trace identity. Loop passes share their
 * loop id; all other containers use their node id.
 */
function rcnBandColors(
  sections: readonly EditorSection[] | undefined,
): ReadonlyMap<string, string> {
  const colors = new Map<string, string>()
  const visit = (nodes: readonly EditorNode[]) => {
    for (const node of nodes) {
      if (!isEditorBlock(node)) continue
      if (node.color) colors.set(node.type === 'loop' ? editorLoopId(node) : node.id, node.color)
      visit(node.children)
    }
  }
  for (const section of sections ?? []) visit(section.children)
  return colors
}

interface StateDraft extends RcnStateTrack {
  order: number
}

/**
 * Sections the trace by the containers it ran inside. A band closes the moment
 * the chain below it changes, so re-entering the same loop on its next pass
 * opens a new band rather than extending the old one.
 */
function bandsOf(
  rows: readonly FlatRow[],
  colors: ReadonlyMap<string, string>,
): { bands: RcnBand[]; seams: RcnSeam[] } {
  const bands: RcnBand[] = []
  const open: { band: RcnBand; scope: FlatScope }[] = []
  const lastAtDepth = new Map<number, RcnBand>()

  rows.forEach((row, i) => {
    let shared = 0
    while (
      shared < open.length
      && shared < row.scope.length
      && open[shared].scope.id === row.scope[shared].id
      && open[shared].scope.run === row.scope[shared].run
    ) shared += 1

    for (let depth = open.length - 1; depth >= shared; depth -= 1) {
      open[depth].band.b = i - 1
    }
    open.length = shared

    for (let depth = shared; depth < row.scope.length; depth += 1) {
      const scope = row.scope[depth]
      const previous = lastAtDepth.get(depth)
      const band: RcnBand = {
        key: `${scope.id}:${scope.run}:${i}`,
        id: scope.id,
        label: scope.label,
        kind: scope.kind,
        run: scope.run,
        runs: Math.max(1, scope.runs),
        ratio: scope.ratio,
        a: i,
        b: i,
        depth,
        color: colors.get(scope.id),
        /* a pass only continues a stretch if it picks up where the last one
           left off, on the very next count */
        head: !(previous
          && previous.id === scope.id
          && previous.b === i - 1
          && previous.run === scope.run - 1),
        tail: true,
      }
      bands.push(band)
      open.push({ band, scope })
      lastAtDepth.set(depth, band)
    }
  })

  for (const entry of open) entry.band.b = rows.length - 1

  const byDepth = new Map<number, RcnBand[]>()
  for (const band of bands) {
    const list = byDepth.get(band.depth)
    if (list) list.push(band)
    else byDepth.set(band.depth, [band])
  }
  for (const list of byDepth.values()) {
    list.forEach((band, index) => {
      const next = list[index + 1]
      band.tail = !(next && next.head === false)
    })
  }

  /*
    One line per boundary, however many containers meet there. The shallowest
    container owns the edge, and an opening or closing edge outranks a mere
    turnover: a reader should be able to tell entering a loop from starting
    its next pass without counting anything.
  */
  const edges = new Map<number, RcnSeam>()
  const mark = (i: number, kind: RcnSeam['kind'], depth: number) => {
    const held = edges.get(i)
    edges.set(i, held
      ? { i, kind: held.kind === 'edge' || kind === 'edge' ? 'edge' : 'pass', depth: Math.min(held.depth, depth) }
      : { i, kind, depth })
  }
  for (const band of bands) {
    if (band.kind !== 'loop' || band.runs < 2) continue
    mark(band.a, band.head ? 'edge' : 'pass', band.depth)
    if (band.tail) mark(band.b + 1, 'edge', band.depth)
  }

  return { bands, seams: [...edges.values()].sort((left, right) => left.i - right.i) }
}

export function makeConsoleModel(
  rows: readonly FlatRow[],
  members: EditorMember[],
  sections: readonly EditorSection[] | undefined,
  runsByLoopId: LoopRunSelections,
): RcnModel {
  const nodes: RcnNode[] = []
  const drafts = new Map<string, StateDraft>()
  const attribute = new Map(members.map((member) => [member.id, member.attribute]))
  const nameOf = (id: string | undefined) =>
    members.find((member) => member.id === id)?.name
  let hold: string | undefined

  rows.forEach((row, i) => {
    const innermost = [...row.scope].reverse().find((scope) => scope.kind === 'loop')
    const pass: RcnPass | undefined = innermost && innermost.runs > 1
      ? { label: innermost.label, run: innermost.run, runs: Math.max(1, innermost.runs) }
      : undefined
    const common = {
      key: row.key,
      id: row.target.nodeId,
      target: row.target,
      i,
      live: flatTargetMatchesRuns(row.target, runsByLoopId),
      pass,
    }

    if (row.kind === 'state') {
      const handoff = row.writes.find((write) => write.memberId)
      if (handoff?.memberId) hold = handoff.memberId
      const first = row.writes[0]
      if (handoff?.memberId) {
        nodes.push({
          ...common,
          kind: 'swap',
          label: nameOf(handoff.memberId) ?? 'Handoff',
          memberId: handoff.memberId,
          hold,
          value: 0,
          dead: false,
        })
        return
      }
      nodes.push({
        ...common,
        kind: 'state',
        label: first?.label ?? 'State',
        hold,
        value: 0,
        dead: false,
        from: first?.from,
        to: first?.value,
      })

      for (const write of row.writes) {
        if (write.memberId) continue
        const key = write.path ?? write.label
        const now = parseState(write.value)
        let draft = drafts.get(key)
        if (!draft) {
          const seed = parseState(write.from)
          draft = {
            key,
            label: write.label,
            seed: write.from === undefined ? now.v : seed.v,
            max: 1,
            bool: now.bool && (write.from === undefined || seed.bool),
            points: [],
            order: drafts.size,
          }
          drafts.set(key, draft)
        }
        draft.bool = draft.bool && now.bool
        draft.points.push({ i, v: now.v, label: write.value })
      }
      return
    }

    /* the field is only implied when nobody handed it over, which is the
       opening of a rotation sequence and of a program with no first handoff */
    if (!hold) hold = row.step.memberId
    const element = row.step.element ?? attribute.get(row.step.memberId)
    const value = stepDamageAt(row.step, row.run)
    nodes.push({
      ...common,
      kind: 'step',
      label: row.step.label,
      memberId: row.step.memberId,
      hold,
      color: row.step.color ?? (element ? ATTR_COLORS[element] : undefined),
      glyph: (row.step.skillTypeLabel && GLYPH_BY_LABEL.get(row.step.skillTypeLabel)) || 'bar',
      value,
      dead: value <= 0,
      typeLabel: row.step.skillTypeLabel,
    })
  })

  const spans: RcnFieldSpan[] = []
  for (const node of nodes) {
    if (!node.hold) continue
    const last = spans[spans.length - 1]
    if (last && last.memberId === node.hold) last.b = node.i
    else spans.push({ memberId: node.hold, a: node.i, b: node.i })
  }

  const states = [...drafts.values()]
    .map((draft) => ({
      ...draft,
      max: Math.max(1, draft.seed, ...draft.points.map((point) => point.v)),
    }))
    .sort((left, right) => right.points.length - left.points.length || left.order - right.order)
    .slice(0, RCN_STATE_TRACKS)
    .sort((left, right) => left.order - right.order)
    .map((draft): RcnStateTrack => ({
      key: draft.key,
      label: draft.label,
      seed: draft.seed,
      max: draft.max,
      bool: draft.bool,
      points: draft.points,
    }))

  const { bands, seams } = bandsOf(rows, rcnBandColors(sections))
  const steps = nodes.filter((node) => node.kind === 'step')
  return {
    nodes,
    steps,
    spans,
    bands,
    seams,
    states,
    peak: steps.reduce((most, step) => Math.max(most, step.value), 0),
    total: steps.reduce((sum, step) => sum + step.value, 0),
    repeated: bands.some((band) => band.runs > 1),
  }
}
